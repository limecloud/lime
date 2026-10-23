use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

impl LocalMemoryBackend {
    /// Runs Codex phase-1 extraction through the caller supplied current provider.
    ///
    /// The backend owns claim/lease/parse/commit state. Provider selection and wire
    /// lowering remain outside this module so Chat Completions, Responses, Anthropic
    /// and Gemini routes share the same durable memory contract.
    pub async fn run_stage1(
        &self,
        root_params: MemoryStoreRootParams,
        version: MemoryStageOneVersion,
        route: &MemoryStageOneRoute,
        provider: &dyn MemoryStageOneProvider,
    ) -> Result<MemoryStageOneRunResult, RuntimeCoreError> {
        let root = self.resolve_root(&root_params)?;
        self.ensure_layout(&root)?;
        let scope_key = self.state_scope_key(&root)?;
        self.register_pending_sources(&root, &scope_key)?;
        let candidates = self
            .state
            .stage1_candidates(&scope_key, MEMORY_STAGE1_MAX_JOBS)
            .map_err(backend_error)?;
        let mut result = MemoryStageOneRunResult::default();
        for source_path in candidates {
            let source = root.join(&source_path);
            if !source.is_file() || is_symlink(&source)? {
                continue;
            }
            let content = match fs::read_to_string(&source) {
                Ok(content) => content,
                Err(error) if error.kind() == io::ErrorKind::InvalidData => continue,
                Err(_) => {
                    // No claim has been acquired, so this reader cannot fail another worker.
                    result.failed += 1;
                    continue;
                }
            };
            let source_updated_at =
                modified_at_seconds(&fs::metadata(&source).map_err(io_error)?).to_string();
            let source_thread_id = state::source_thread_id_from_content(&content);
            if !provider
                .source_eligible(source_thread_id.as_deref())
                .await?
            {
                continue;
            }
            let owner = uuid::Uuid::new_v4().to_string();
            if !self
                .state
                .try_claim_stage1(
                    &scope_key,
                    &source_path,
                    &owner,
                    MEMORY_STAGE1_LEASE_SECONDS,
                    MEMORY_STAGE1_MAX_JOBS,
                )
                .map_err(backend_error)?
            {
                continue;
            }
            result.claimed += 1;
            let input = MemoryStageOneProviderRequest {
                session_id: route.session_id.clone(),
                thread_id: route.thread_id.clone(),
                turn_id: format!("memory-stage1-{}", result.claimed),
                provider: route.provider.clone(),
                model: route.model.clone(),
                reasoning_effort: route.reasoning_effort.clone(),
                service_tier: route.service_tier.clone(),
                api_version: route.api_version.clone(),
                route_protocol: route.route_protocol.clone(),
                credential_ref: route.credential_ref.clone(),
                cwd: route.cwd.clone().or_else(|| Some(root.clone())),
                scope_key: scope_key.clone(),
                source_path: source_path.clone(),
                source_content: content.clone(),
                system_prompt: stage_one_system_prompt(version).to_string(),
                user_prompt: stage_one_user_prompt(&source_path, &content),
                output_schema: stage_one_output::output_schema(version.output_version()),
                strict: true,
            };
            let heartbeat_cancel = CancellationToken::new();
            let heartbeat_lost = Arc::new(AtomicBool::new(false));
            let heartbeat_task = {
                let state = self.state.clone();
                let scope_key = scope_key.clone();
                let source_path = source_path.clone();
                let owner = owner.clone();
                let cancel = heartbeat_cancel.clone();
                let heartbeat_lost = heartbeat_lost.clone();
                tokio::spawn(async move {
                    let mut interval = tokio::time::interval(Duration::from_secs(30));
                    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                    loop {
                        tokio::select! {
                            _ = cancel.cancelled() => break,
                            _ = interval.tick() => {
                                match state.heartbeat_stage1(&scope_key, &source_path, &owner, MEMORY_STAGE1_LEASE_SECONDS) {
                                    Ok(true) => {}
                                    Ok(false) | Err(_) => {
                                        heartbeat_lost.store(true, Ordering::Release);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                })
            };
            let _heartbeat_guard = heartbeat_cancel.clone().drop_guard();
            let sampled = provider.sample(input).await;
            heartbeat_cancel.cancel();
            let _ = heartbeat_task.await;
            if heartbeat_lost.load(Ordering::Acquire) {
                self.state
                    .mark_stage1_failed(
                        &scope_key,
                        &source_path,
                        &owner,
                        MEMORY_STAGE1_RETRY_SECONDS,
                        "memory stage-1 lease heartbeat was lost",
                    )
                    .map_err(backend_error)?;
                result.failed += 1;
                continue;
            }
            match sampled {
                Ok(raw) => match stage_one_output::parse(&raw, version.output_version()) {
                    Ok(output)
                        if !output.rollout_summary.trim().is_empty()
                            && (version == MemoryStageOneVersion::V2
                                || output
                                    .raw_memory
                                    .as_deref()
                                    .is_some_and(|value| !value.trim().is_empty())) =>
                    {
                        let saved = self
                            .state
                            .save_stage1_output(
                                &scope_key,
                                &source_path,
                                &owner,
                                state::StageOneOutputSnapshot {
                                    source_path: source_path.clone(),
                                    content_hash: state::hash_content(&content),
                                    source_updated_at,
                                    raw_memory: output.raw_memory,
                                    rollout_summary: output.rollout_summary,
                                    rollout_slug: output.rollout_slug,
                                },
                            )
                            .map_err(backend_error)?;
                        if saved {
                            result.succeeded += 1;
                        } else {
                            result.failed += 1;
                        }
                    }
                    Ok(_) => {
                        let saved = self
                            .state
                            .mark_stage1_no_output(&scope_key, &source_path, &owner)
                            .map_err(backend_error)?;
                        if saved {
                            result.no_output += 1;
                        } else {
                            result.failed += 1;
                        }
                    }
                    Err(error) => {
                        self.state
                            .mark_stage1_failed(
                                &scope_key,
                                &source_path,
                                &owner,
                                MEMORY_STAGE1_RETRY_SECONDS,
                                &error,
                            )
                            .map_err(backend_error)?;
                        result.failed += 1;
                    }
                },
                Err(error) => {
                    self.state
                        .mark_stage1_failed(
                            &scope_key,
                            &source_path,
                            &owner,
                            MEMORY_STAGE1_RETRY_SECONDS,
                            &error.to_string(),
                        )
                        .map_err(backend_error)?;
                    result.failed += 1;
                }
            }
        }
        Ok(result)
    }

    fn register_pending_sources(
        &self,
        root: &Path,
        scope_key: &str,
    ) -> Result<(), RuntimeCoreError> {
        for relative_dir in [NOTES_DIR, ROLLOUT_SUMMARIES_DIR] {
            let directory = root.join(relative_dir);
            reject_symlink_chain(root, &directory)?;
            for entry in fs::read_dir(&directory).map_err(io_error)? {
                let entry = entry.map_err(io_error)?;
                let path = entry.path();
                if is_symlink(&path)?
                    || !path.is_file()
                    || !path
                        .extension()
                        .and_then(OsStr::to_str)
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                {
                    continue;
                }
                let content = match fs::read_to_string(&path) {
                    Ok(content) => content,
                    Err(error) if error.kind() == io::ErrorKind::InvalidData => continue,
                    Err(error) => return Err(io_error(error)),
                };
                let source_path = self.relative_path(root, &path)?;
                self.state
                    .register_rollout(
                        scope_key,
                        &source_path,
                        &content,
                        &modified_at_seconds(&fs::metadata(&path).map_err(io_error)?).to_string(),
                    )
                    .map_err(backend_error)?;
            }
        }
        Ok(())
    }
}

fn stage_one_system_prompt(version: MemoryStageOneVersion) -> &'static str {
    match version {
        MemoryStageOneVersion::V1 => STAGE_ONE_SYSTEM_PROMPT_V1,
        MemoryStageOneVersion::V2 => STAGE_ONE_SYSTEM_PROMPT_V2,
    }
}

fn stage_one_user_prompt(source_path: &str, content: &str) -> String {
    format!(
        "Read this immutable rollout record from `{source_path}` as evidence.\n\n<rollout>\n{content}\n</rollout>"
    )
}

#[cfg(test)]
mod tests;
