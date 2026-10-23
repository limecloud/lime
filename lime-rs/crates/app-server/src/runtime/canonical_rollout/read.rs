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
        let (path, reader) = open_rollout_reader(&path)?;
        // Explicit reads accept a copied rollout outside agent home, like Codex. Validate
        // its recorded identity and digest; the caller's filename is not authoritative.
        let scan = scan_rollout_reader(reader, &path)?;
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
        let mut builder =
            ThreadHistoryBuilder::for_thread(thread.session_id.clone(), thread.thread_id.clone());
        let mut runtime_events = Vec::new();
        for record in scan.history {
            runtime_events.extend(record.runtime_events);
            builder
                .apply_change_set(record.changes)
                .map_err(|error| error.to_string())?;
        }
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

/// Prefer plain JSONL while retaining the open representation during a concurrent compression.
/// Decoding is streamed into the existing record/digest scanner, with no durable materialization.
pub(super) fn open_rollout_reader(requested: &Path) -> Result<(PathBuf, Box<dyn BufRead>), String> {
    let plain = compression::plain_path(requested);
    let compressed = compression::compressed_path(&plain);
    for attempt in 0..4 {
        for (path, compressed) in [(&plain, false), (&compressed, true)] {
            let file = match File::open(path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(format!(
                        "failed to read rollout file {}: {error}",
                        path.display()
                    ))
                }
            };
            if !file
                .metadata()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                return Err(format!("rollout path is not a file: {}", path.display()));
            }
            let canonical = match fs::canonicalize(path) {
                Ok(path) => path,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(format!(
                        "failed to resolve rollout file {}: {error}",
                        path.display()
                    ))
                }
            };
            let reader: Box<dyn BufRead> = if compressed {
                Box::new(BufReader::new(
                    zstd::stream::read::Decoder::new(file).map_err(|error| {
                        format!("invalid compressed rollout {}: {error}", path.display())
                    })?,
                ))
            } else {
                Box::new(BufReader::new(file))
            };
            return Ok((canonical, reader));
        }
        if attempt < 3 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    Err(format!(
        "failed to resolve rollout path `{}`: file does not exist",
        requested.display()
    ))
}
