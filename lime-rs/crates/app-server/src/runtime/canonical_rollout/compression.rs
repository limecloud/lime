//! Cold rollout compression. File layout, constants, trigger and publication order follow
//! Codex's `rollout/src/compression.rs`; only Lime-owned paths and store types differ.
use super::*;
use fs2::FileExt;
use std::io;
use std::time::{Duration, Instant, SystemTime};
use tokio::task::JoinSet;

const COMPRESSED_SUFFIX: &str = ".zst";
const MAX_NOT_FOUND_RETRIES: usize = 3;
const OPEN_ROLLOUT_LINE_READER_RETRY_DELAY: Duration = Duration::from_millis(50);
const TEMP_FILE_PREFIX: &str = "rollout-compress-";
const TEMP_SUFFIX: &str = ".tmp";
const COMPRESSION_LEVEL: i32 = 3;
pub(in crate::runtime) const MIN_ROLLOUT_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const RUN_MARKER_STALE_AFTER: Duration = Duration::from_secs(6 * 60 * 60);
const WORKER_MAX_RUNTIME: Duration = Duration::from_secs(5 * 60 * 60);
const RUN_MARKER_FILE_NAME: &str = "rollout-compression.lock";
const MAX_CONCURRENT_COMPRESSION_JOBS: usize = 2;

/// The entry point that requested a compression pass, not a user cohort.
#[derive(Clone, Copy, Debug)]
pub(in crate::runtime) enum RolloutCompressionTrigger {
    Startup,
    Rpc,
}

impl RolloutCompressionTrigger {
    fn tag(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::Rpc => "rpc",
        }
    }
}

pub(super) fn plain_rollout_path(path: &Path) -> PathBuf {
    if path.extension().is_some_and(|extension| extension == "zst") {
        path.with_extension("")
    } else {
        path.to_path_buf()
    }
}

pub(super) fn compressed_rollout_path(path: &Path) -> PathBuf {
    let mut name = plain_rollout_path(path).into_os_string();
    name.push(COMPRESSED_SUFFIX);
    PathBuf::from(name)
}

pub(super) fn existing_rollout_path(path: &Path) -> Result<Option<PathBuf>, String> {
    for candidate in [plain_rollout_path(path), compressed_rollout_path(path)] {
        reject_symlink(&candidate)?;
        match fs::metadata(&candidate) {
            Ok(metadata) if metadata.is_file() => return Ok(Some(candidate)),
            Ok(_) => {
                return Err(format!(
                    "rollout path is not a file: {}",
                    candidate.display()
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to inspect rollout {}: {error}",
                    candidate.display()
                ))
            }
        }
    }
    Ok(None)
}

pub(super) fn remove_compressed_rollout(path: &Path) -> Result<bool, String> {
    let compressed = compressed_rollout_path(path);
    reject_symlink(&compressed)?;
    match fs::remove_file(&compressed) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "failed to delete rollout {}: {error}",
            compressed.display()
        )),
    }
}

/// Prefer plain JSONL while retaining the open representation during a concurrent compression.
/// Decoding is streamed into the existing record/digest scanner, with no durable materialization.
pub(super) fn open_rollout_line_reader(
    requested: &Path,
) -> Result<(PathBuf, Box<dyn BufRead>), String> {
    let plain = plain_rollout_path(requested);
    let compressed = compressed_rollout_path(&plain);
    for attempt in 0..MAX_NOT_FOUND_RETRIES {
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
        if attempt + 1 < MAX_NOT_FOUND_RETRIES {
            std::thread::sleep(OPEN_ROLLOUT_LINE_READER_RETRY_DELAY);
        }
    }
    Err(format!(
        "failed to resolve rollout path `{}`: file does not exist",
        requested.display()
    ))
}

impl RolloutStore {
    /// Reads never materialize. Writers publish a complete, validated plain file before
    /// removing its compressed source, following Codex's append materialization boundary.
    pub(super) fn materialize_rollout_for_append_blocking(
        &self,
        path: &Path,
    ) -> Result<(), String> {
        let Some(source) = existing_rollout_path(path)? else {
            return Ok(());
        };
        let plain = plain_rollout_path(path);
        if source == plain {
            return Ok(());
        }
        let parent = plain
            .parent()
            .ok_or_else(|| "rollout path has no parent".to_string())?;
        let result = (|| -> Result<(), String> {
            let input = File::open(&source).map_err(|error| error.to_string())?;
            let metadata = input.metadata().map_err(|error| error.to_string())?;
            let mut decoder =
                zstd::stream::read::Decoder::new(input).map_err(|error| error.to_string())?;
            let mut temp = tempfile::Builder::new()
                .prefix(".rollout-")
                .suffix(".decompress")
                .tempfile_in(parent)
                .map_err(|error| error.to_string())?;
            temp.as_file()
                .set_permissions(metadata.permissions())
                .map_err(|error| error.to_string())?;
            std::io::copy(&mut decoder, &mut temp).map_err(|error| error.to_string())?;
            temp.flush().map_err(|error| error.to_string())?;
            // Compressed files are immutable completed representations. Never repair a
            // malformed decoded tail or publish a file with a conflicting identity.
            let scan = scan_rollout(temp.path())?;
            let relative = plain
                .strip_prefix(&self.agent_root)
                .map_err(|error| error.to_string())?;
            let active = if relative.starts_with(ARCHIVED_SESSIONS_DIR_NAME) {
                active_path_from_archived(relative)?
            } else {
                relative.to_path_buf()
            };
            validate_scan_identity(
                &scan,
                &active,
                scan.initial_thread.session_id.as_str(),
                scan.initial_thread.thread_id.as_str(),
                &source,
            )?;
            temp.as_file()
                .set_times(
                    std::fs::FileTimes::new()
                        .set_modified(metadata.modified().map_err(|error| error.to_string())?),
                )
                .map_err(|error| error.to_string())?;
            temp.as_file()
                .sync_all()
                .map_err(|error| error.to_string())?;
            match temp.persist_noclobber(&plain) {
                Ok(_) => {}
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                    // A concurrently published plain file wins; do not overwrite it.
                    reject_symlink(&plain)?;
                    let winner = scan_rollout(&plain)?;
                    validate_scan_identity(
                        &winner,
                        &active,
                        scan.session_id.as_str(),
                        scan.thread_id.as_str(),
                        &plain,
                    )?;
                }
                Err(error) => return Err(error.error.to_string()),
            }
            sync_directory(parent)?;
            remove_compressed_rollout(&plain)?;
            sync_directory(parent)
        })();
        result.map_err(|error| {
            format!(
                "failed to materialize rollout {}: {error}",
                source.display()
            )
        })
    }
}

pub(super) fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            format!(
                "failed to sync rollout directory {}: {error}",
                path.display()
            )
        })?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

mod worker {
    use super::*;

    #[derive(Debug, Default)]
    pub(in crate::runtime) struct CompressionStats {
        pub scanned: usize,
        pub compressed: usize,
        pub skipped: usize,
        pub failed: usize,
        pub scan_errors: bool,
        pub cleanup_errors: bool,
        pub time_budget_exhausted: bool,
    }

    pub(in crate::runtime) struct CompressionRunMarker {
        path: PathBuf,
        remove_on_drop: bool,
    }

    impl CompressionRunMarker {
        pub(in crate::runtime) fn try_claim(agent_root: &Path) -> io::Result<Option<Self>> {
            let marker_dir = agent_root.join(".tmp");
            fs::create_dir_all(marker_dir.as_path())?;
            let path = marker_dir.join(RUN_MARKER_FILE_NAME);
            reject_symlink(&path).map_err(io::Error::other)?;
            match create_run_marker_file(path.as_path()) {
                Ok(()) => return Ok(Some(Self::new(path))),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
            let stale = fs::metadata(path.as_path())
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age >= RUN_MARKER_STALE_AFTER);
            if !stale {
                return Ok(None);
            }
            match fs::remove_file(path.as_path()) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            match create_run_marker_file(path.as_path()) {
                Ok(()) => Ok(Some(Self::new(path))),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(None),
                Err(error) => Err(error),
            }
        }

        fn new(path: PathBuf) -> Self {
            Self {
                path,
                remove_on_drop: true,
            }
        }

        pub(in crate::runtime) fn persist(mut self) {
            self.remove_on_drop = false;
        }
    }

    impl Drop for CompressionRunMarker {
        fn drop(&mut self) {
            if self.remove_on_drop {
                let _ = fs::remove_file(&self.path);
            }
        }
    }

    pub(super) fn spawn(agent_root: PathBuf, trigger: RolloutCompressionTrigger) {
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            tracing::warn!(
                "failed to start rollout compression worker for {}: no Tokio runtime",
                agent_root.display()
            );
            return;
        };
        handle.spawn(async move {
            if let Err(error) = run(agent_root.clone(), trigger).await {
                tracing::warn!(
                    "rollout compression worker failed for {}: {error}",
                    agent_root.display()
                );
            }
        });
    }

    pub(in crate::runtime) async fn run(
        agent_root: PathBuf,
        trigger: RolloutCompressionTrigger,
    ) -> io::Result<CompressionStats> {
        let Some((_maintenance, _directory)) = try_acquire_rollout_maintenance_lock(&agent_root)?
        else {
            tracing::debug!(
                target: "rollout_compression",
                "rollout maintenance is already running for {}",
                agent_root.display()
            );
            return Ok(CompressionStats::default());
        };
        let Some(marker) = CompressionRunMarker::try_claim(&agent_root)? else {
            tracing::debug!(
                target: "rollout_compression",
                "rollout compression worker recently ran or is already running for {}",
                agent_root.display()
            );
            return Ok(CompressionStats::default());
        };
        let started_at = Instant::now();
        let mut stats = CompressionStats::default();
        let mut jobs = JoinSet::new();
        for scope in [ARCHIVED_SESSIONS_DIR_NAME, SESSIONS_DIR_NAME] {
            let mut directories = vec![agent_root.join(scope)];
            while let Some(directory) = directories.pop() {
                if started_at.elapsed() >= WORKER_MAX_RUNTIME {
                    stats.time_budget_exhausted = true;
                    break;
                }
                match tokio::fs::symlink_metadata(&directory).await {
                    Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
                    Ok(_) => continue,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                    Err(error) => {
                        stats.scan_errors = true;
                        stats.failed += 1;
                        tracing::warn!(%error, "rollout directory metadata failed");
                        continue;
                    }
                }
                let mut entries = match tokio::fs::read_dir(&directory).await {
                    Ok(entries) => entries,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                    Err(error) => {
                        stats.scan_errors = true;
                        stats.failed += 1;
                        tracing::warn!(%error, path = %directory.display(), "rollout scan failed");
                        continue;
                    }
                };
                loop {
                    let entry = match entries.next_entry().await {
                        Ok(Some(entry)) => entry,
                        Ok(None) => break,
                        Err(error) => {
                            stats.scan_errors = true;
                            stats.failed += 1;
                            tracing::warn!(%error, "rollout directory entry failed");
                            break;
                        }
                    };
                    if started_at.elapsed() >= WORKER_MAX_RUNTIME {
                        stats.time_budget_exhausted = true;
                        break;
                    }
                    let kind = match entry.file_type().await {
                        Ok(kind) => kind,
                        Err(error) => {
                            stats.scan_errors = true;
                            stats.failed += 1;
                            tracing::warn!(%error, "rollout entry metadata failed");
                            continue;
                        }
                    };
                    if kind.is_symlink() {
                        continue;
                    }
                    if kind.is_dir() {
                        directories.push(entry.path());
                        continue;
                    }
                    if !kind.is_file() {
                        continue;
                    }
                    let name = entry.file_name();
                    let Some(name) = name.to_str() else {
                        continue;
                    };
                    if name.starts_with(TEMP_FILE_PREFIX) && name.ends_with(TEMP_SUFFIX) {
                        match entry
                            .metadata()
                            .await
                            .and_then(|metadata| old_enough(&metadata, RUN_MARKER_STALE_AFTER))
                        {
                            Ok(true) => {
                                if let Err(error) = tokio::fs::remove_file(entry.path()).await {
                                    stats.cleanup_errors = true;
                                    stats.failed += 1;
                                    tracing::warn!(%error, "rollout temp cleanup failed");
                                }
                            }
                            Ok(false) => {}
                            Err(error) => {
                                stats.cleanup_errors = true;
                                stats.failed += 1;
                                tracing::warn!(%error, "rollout temp metadata failed");
                            }
                        }
                        continue;
                    }
                    if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
                        continue;
                    }
                    stats.scanned += 1;
                    while jobs.len() >= MAX_CONCURRENT_COMPRESSION_JOBS {
                        collect_next_compression_job(&mut jobs, &mut stats).await;
                    }
                    let root = agent_root.clone();
                    let path = entry.path();
                    jobs.spawn_blocking(move || compress_rollout_if_cold_blocking(&root, &path));
                }
            }
        }
        while !jobs.is_empty() {
            collect_next_compression_job(&mut jobs, &mut stats).await;
        }
        // A finished pass retains the six-hour marker even when individual files failed.
        marker.persist();
        tracing::info!(
            trigger = trigger.tag(),
            scanned = stats.scanned,
            compressed = stats.compressed,
            skipped = stats.skipped,
            failed = stats.failed,
            scan_errors = stats.scan_errors,
            cleanup_errors = stats.cleanup_errors,
            time_budget_exhausted = stats.time_budget_exhausted,
            "rollout compression worker finished"
        );
        Ok(stats)
    }

    async fn collect_next_compression_job(
        jobs: &mut JoinSet<io::Result<bool>>,
        stats: &mut CompressionStats,
    ) {
        match jobs.join_next().await {
            Some(Ok(Ok(true))) => stats.compressed += 1,
            Some(Ok(Ok(false))) => stats.skipped += 1,
            Some(result) => {
                stats.failed += 1;
                tracing::warn!(?result, "rollout compression job failed");
            }
            None => {}
        }
    }

    fn old_enough(metadata: &fs::Metadata, minimum: Duration) -> io::Result<bool> {
        Ok(SystemTime::now()
            .duration_since(metadata.modified()?)
            .unwrap_or_default()
            >= minimum)
    }

    fn create_run_marker_file(path: &Path) -> io::Result<()> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
        writeln!(
            file,
            "pid={} started_at={:?}",
            std::process::id(),
            SystemTime::now()
        )
    }

    pub(in crate::runtime) fn try_acquire_rollout_maintenance_lock(
        agent_root: &Path,
    ) -> io::Result<Option<(File, PathBuf)>> {
        let directory = agent_root.join(".tmp");
        reject_symlink(agent_root).map_err(io::Error::other)?;
        reject_symlink(&directory).map_err(io::Error::other)?;
        fs::create_dir_all(&directory)?;
        let file = writer_lock::open_lock(&directory.join("rollout-maintenance.lock"))?;
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => Ok(Some((file, directory))),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error),
        }
    }

    struct FileState {
        len: u64,
        modified: SystemTime,
        permissions: fs::Permissions,
    }

    impl FileState {
        fn read(path: &Path) -> io::Result<Option<Self>> {
            let metadata = match fs::symlink_metadata(path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(error),
            };
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Ok(None);
            }
            Ok(Some(Self {
                len: metadata.len(),
                modified: metadata.modified()?,
                permissions: metadata.permissions(),
            }))
        }

        fn matches(&self, path: &Path) -> io::Result<bool> {
            Ok(Self::read(path)?.is_some_and(|current| {
                current.len == self.len
                    && current.modified == self.modified
                    && current.permissions == self.permissions
            }))
        }
    }

    pub(in crate::runtime) struct PreparedCompression {
        root: PathBuf,
        source: PathBuf,
        destination: PathBuf,
        thread_id: String,
        before: FileState,
        temp: tempfile::NamedTempFile,
    }

    impl PreparedCompression {
        pub(in crate::runtime) fn prepare(root: &Path, source: &Path) -> io::Result<Option<Self>> {
            let Some(before) = FileState::read(source)? else {
                return Ok(None);
            };
            if SystemTime::now()
                .duration_since(before.modified)
                .unwrap_or_default()
                < MIN_ROLLOUT_AGE
            {
                return Ok(None);
            }
            let destination = compressed_rollout_path(source);
            if destination.try_exists()? {
                return Ok(None);
            }
            let thread_id = thread_id(source)?;
            let parent = source
                .parent()
                .ok_or_else(|| io::Error::other("rollout has no parent"))?;
            let mut temp = tempfile::Builder::new()
                .prefix(TEMP_FILE_PREFIX)
                .suffix(TEMP_SUFFIX)
                .tempfile_in(parent)?;
            let mut input = File::open(source)?;
            let mut encoder =
                zstd::stream::write::Encoder::new(temp.as_file_mut(), COMPRESSION_LEVEL)?;
            encoder.set_pledged_src_size(Some(input.metadata()?.len()))?;
            io::copy(&mut input, &mut encoder)?;
            encoder.finish()?;
            temp.flush()?;
            let decoder = zstd::stream::read::Decoder::new(File::open(temp.path())?)?;
            let scan =
                scan_rollout_reader(BufReader::new(decoder), source).map_err(io::Error::other)?;
            let relative = source.strip_prefix(root).map_err(io::Error::other)?;
            let active = if relative.starts_with(ARCHIVED_SESSIONS_DIR_NAME) {
                active_path_from_archived(relative).map_err(io::Error::other)?
            } else {
                relative.to_path_buf()
            };
            validate_scan_identity(&scan, &active, &scan.session_id, &thread_id, source)
                .map_err(io::Error::other)?;
            if !before.matches(source)? {
                return Ok(None);
            }
            temp.as_file()
                .set_times(fs::FileTimes::new().set_modified(before.modified))?;
            temp.as_file().set_permissions(before.permissions.clone())?;
            temp.as_file().sync_all()?;
            Ok(Some(Self {
                root: root.to_path_buf(),
                source: source.to_path_buf(),
                destination,
                thread_id,
                before,
                temp,
            }))
        }

        pub(in crate::runtime) fn publish(self) -> io::Result<bool> {
            let Some(_publication) = writer_lock::try_publication(&self.root, &self.thread_id)?
            else {
                return Ok(false);
            };
            if !self.before.matches(&self.source)? {
                return Ok(false);
            }
            match self.temp.persist_noclobber(&self.destination) {
                Ok(_) => {}
                Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                    return Ok(false)
                }
                Err(error) => return Err(error.error),
            }
            if !self.before.matches(&self.source)? {
                fs::remove_file(&self.destination)?;
                return Ok(false);
            }
            sync_directory(self.source.parent().unwrap()).map_err(io::Error::other)?;
            fs::remove_file(&self.source)?;
            sync_directory(self.source.parent().unwrap()).map_err(io::Error::other)?;
            Ok(true)
        }
    }

    pub(in crate::runtime) fn compress_rollout_if_cold_blocking(
        root: &Path,
        source: &Path,
    ) -> io::Result<bool> {
        match PreparedCompression::prepare(root, source)? {
            Some(prepared) => prepared.publish(),
            None => Ok(false),
        }
    }

    pub(in crate::runtime) fn thread_id(path: &Path) -> io::Result<String> {
        let (_, mut reader) = open_rollout_line_reader(path).map_err(io::Error::other)?;
        let mut line = String::new();
        reader.read_line(&mut line)?;
        match serde_json::from_str::<RolloutRecord>(&line)? {
            RolloutRecord::SessionMeta { thread_id, .. } => {
                validate_thread_id_for_file(&thread_id).map_err(io::Error::other)?;
                Ok(thread_id)
            }
            _ => Err(io::Error::other(
                "rollout first record must be session metadata",
            )),
        }
    }
}

#[cfg(test)]
pub(in crate::runtime) use worker::compress_rollout_if_cold_blocking;
#[cfg(test)]
pub(in crate::runtime) use worker::run;
pub(in crate::runtime) use worker::thread_id;
#[cfg(test)]
pub(in crate::runtime) use worker::try_acquire_rollout_maintenance_lock;
#[cfg(test)]
pub(in crate::runtime) use worker::PreparedCompression;

impl RolloutStore {
    pub(in crate::runtime) fn spawn_rollout_compression_worker(
        &self,
        trigger: RolloutCompressionTrigger,
    ) {
        worker::spawn(self.agent_root.clone(), trigger);
    }
}
