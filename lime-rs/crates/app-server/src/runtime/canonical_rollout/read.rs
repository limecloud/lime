use super::*;
use agent_protocol::ThreadTurnsView;
use thread_store::ThreadHistoryBuilder;

impl RolloutStore {
    pub(in crate::runtime) fn absolute_path(&self, relative: &Path) -> Result<PathBuf, String> {
        match relative.components().next() {
            Some(Component::Normal(scope)) if scope == SESSIONS_DIR_NAME => {
                self.resolve_active(relative)
            }
            Some(Component::Normal(scope)) if scope == ARCHIVED_SESSIONS_DIR_NAME => {
                self.resolve_archived(relative)
            }
            _ => Err("rollout path must belong to active or archived sessions".into()),
        }
    }

    pub(in crate::runtime) fn read_requested_thread(
        &self,
        requested: &Path,
    ) -> Result<(PathBuf, Thread, u64, Vec<AgentEvent>), String> {
        let path = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            self.agent_root.join(requested)
        };
        if fs::metadata(&path).is_ok_and(|metadata| !metadata.is_file()) {
            return Err(format!(
                "failed to resolve rollout path `{}`: path is not a file",
                path.display()
            ));
        }
        let (path, reader) = compression::open_rollout_line_reader(&path)?;
        // Explicit reads accept a copied rollout outside agent home, like Codex. Validate
        // its recorded identity and digest; the caller's filename is not authoritative.
        let mut builder = None;
        let mut runtime_events = Vec::new();
        // Apply validated increments as they are read, releasing old Turn snapshots
        // instead of retaining the entire historical sequence alongside the result.
        let scan = scan::scan_rollout_reader_with_history(reader, &path, |thread, record| {
            let previous = builder.take().unwrap_or_else(|| {
                ThreadHistoryBuilder::for_thread(
                    thread.session_id.clone(),
                    thread.thread_id.clone(),
                )
            });
            builder = Some(
                previous
                    .replay_change_set(record.changes)
                    .map_err(|error| error.to_string())?,
            );
            runtime_events.extend(record.runtime_events);
            Ok(())
        })?;
        validate_scan_identity(
            &scan,
            Path::new(&scan.rollout_path),
            scan.initial_thread.session_id.as_str(),
            scan.initial_thread.thread_id.as_str(),
            &path,
        )?;
        if !scan.initial_thread.turns.is_empty() {
            return Err("rollout session metadata must not embed turns".to_string());
        }
        let mut thread = scan.initial_thread;
        thread.recency_at_ms.get_or_insert(scan.recency_at_ms);
        thread.updated_at_ms = lifecycle::file_updated_at_ms(&path)?;
        let builder = builder.unwrap_or_else(|| {
            ThreadHistoryBuilder::for_thread(thread.session_id.clone(), thread.thread_id.clone())
        });
        thread.turns = builder.turns().to_vec();
        for turn in &mut thread.turns {
            turn.items_view = agent_protocol::TurnItemsView::Full;
        }
        thread.turns_view = ThreadTurnsView::Full;
        thread.archived |= path
            .components()
            .any(|component| component == Component::Normal(ARCHIVED_SESSIONS_DIR_NAME.as_ref()));
        Ok((
            path,
            thread,
            builder.sequence().unwrap_or_default(),
            runtime_events,
        ))
    }
}
