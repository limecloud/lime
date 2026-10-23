use app_server_protocol::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const MAX_RECORDINGS: usize = 20;
const MAX_AUDIO_BYTES: u64 = 32 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 1024 * 1024;

pub(super) struct DictationHistoryStore {
    root: PathBuf,
    // A lease survives requests, but closes automatically when this owner exits.
    leases: Mutex<HashMap<String, File>>,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

impl DictationHistoryStore {
    pub(super) fn new(root: PathBuf) -> Self {
        Self {
            root,
            leases: Mutex::new(HashMap::new()),
        }
    }

    fn path(&self, id: &str, extension: &str) -> io::Result<PathBuf> {
        let parsed = Uuid::parse_str(id).map_err(|_| invalid("Invalid recording id"))?;
        if parsed.to_string() != id {
            return Err(invalid("Invalid recording id"));
        }
        Ok(self.root.join(format!("{id}.{extension}")))
    }

    fn lock(&self) -> io::Result<File> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&self.root)?;
        let lock = private_file(&self.root.join(".lock"))?;
        FileExt::lock_exclusive(&lock)?;
        Ok(lock)
    }

    fn read(&self, id: &str) -> io::Result<DictationHistoryEntry> {
        let bytes = fs::read(self.path(id, "json")?)?;
        let mut entry: DictationHistoryEntry = serde_json::from_slice(&bytes)?;
        if entry.id != id {
            return Err(invalid("Recording identity mismatch"));
        }
        entry.size_bytes = fs::metadata(self.path(id, "audio")?)?.len();
        if entry.size_bytes > MAX_AUDIO_BYTES {
            return Err(invalid("Recording exceeds size limit"));
        }
        Ok(entry)
    }

    fn write(&self, entry: &DictationHistoryEntry) -> io::Result<()> {
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)?;
        serde_json::to_writer(temporary.as_file_mut(), entry)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(self.path(&entry.id, "json")?)
            .map_err(|e| e.error)?;
        Ok(())
    }

    fn entries(&self) -> io::Result<Vec<DictationHistoryEntry>> {
        let mut entries = Vec::new();
        for file in fs::read_dir(&self.root)? {
            let path = file?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let mut entry = self.read(id)?;
            if entry.status == DictationHistoryStatus::Recording {
                let lease = private_file(&self.path(id, "lease")?)?;
                match FileExt::try_lock_exclusive(&lease) {
                    Ok(()) => {
                        entry.status = DictationHistoryStatus::Interrupted;
                        self.write(&entry)?;
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                    Err(error) => return Err(error),
                }
            }
            entries.push(entry);
        }
        entries.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms).then(b.id.cmp(&a.id)));
        Ok(entries)
    }

    fn remove(&self, id: &str) -> io::Result<()> {
        fs::remove_file(self.path(id, "json")?)?;
        fs::remove_file(self.path(id, "audio")?)?;
        let path = self.path(id, "lease")?;
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    pub(super) fn list(&self) -> io::Result<DictationHistoryListResponse> {
        let _lock = self.lock()?;
        Ok(DictationHistoryListResponse {
            recordings: self.entries()?,
        })
    }

    pub(super) fn start(
        &self,
        params: DictationHistoryStartParams,
    ) -> io::Result<DictationHistoryWriteResponse> {
        let mime = params.mime_type.trim().to_lowercase();
        if mime.len() > 128
            || mime.chars().any(char::is_control)
            || !["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"]
                .contains(&mime.split(';').next().unwrap_or_default().trim())
        {
            return Err(invalid("Unsupported recording audio type"));
        }
        let _lock = self.lock()?;
        let mut entries = self.entries()?;
        let created_at_ms = chrono::Utc::now()
            .timestamp_millis()
            .max(entries.first().map_or(0, |e| e.created_at_ms + 1));
        while entries.len() >= MAX_RECORDINGS {
            let index = entries
                .iter()
                .rposition(|e| e.status != DictationHistoryStatus::Recording)
                .ok_or_else(|| invalid("All recording slots are active"))?;
            self.remove(&entries.remove(index).id)?;
        }
        let entry = DictationHistoryEntry {
            id: Uuid::new_v4().to_string(),
            created_at_ms,
            text: None,
            size_bytes: 0,
            status: DictationHistoryStatus::Recording,
            mime_type: mime,
        };
        let lease = private_file(&self.path(&entry.id, "lease")?)?;
        FileExt::lock_exclusive(&lease)?;
        private_file(&self.path(&entry.id, "audio")?)?.sync_all()?;
        self.write(&entry)?;
        self.leases
            .lock()
            .map_err(|_| io::Error::other("Recording owner unavailable"))?
            .insert(entry.id.clone(), lease);
        Ok(DictationHistoryWriteResponse { recording: entry })
    }

    pub(super) fn append_audio(
        &self,
        params: DictationHistoryAppendAudioParams,
    ) -> io::Result<DictationHistoryWriteResponse> {
        if params.audio_base64.len() > MAX_CHUNK_BYTES.div_ceil(3) * 4 {
            return Err(invalid("Audio chunk exceeds size limit"));
        }
        let bytes = STANDARD
            .decode(params.audio_base64)
            .map_err(|_| invalid("Invalid audio encoding"))?;
        if bytes.len() > MAX_CHUNK_BYTES {
            return Err(invalid("Audio chunk exceeds size limit"));
        }
        let _lock = self.lock()?;
        let mut entry = self.read(&params.id)?;
        if entry.status != DictationHistoryStatus::Recording
            || !self
                .leases
                .lock()
                .map_err(|_| io::Error::other("Recording owner unavailable"))?
                .contains_key(&params.id)
        {
            return Err(invalid("Recording is not owned by this process"));
        }
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(self.path(&params.id, "audio")?)?;
        // Retrying an acknowledged chunk is safe; overlapping different bytes fail closed.
        if params.offset < entry.size_bytes {
            if params.offset + bytes.len() as u64 > entry.size_bytes {
                return Err(invalid("Audio offset mismatch"));
            }
            file.seek(SeekFrom::Start(params.offset))?;
            let mut existing = vec![0; bytes.len()];
            file.read_exact(&mut existing)?;
            if existing != bytes {
                return Err(invalid("Audio offset mismatch"));
            }
            return Ok(DictationHistoryWriteResponse { recording: entry });
        }
        if params.offset != entry.size_bytes {
            return Err(invalid("Audio offset mismatch"));
        }
        if entry.size_bytes + bytes.len() as u64 > MAX_AUDIO_BYTES {
            return Err(invalid("Recording exceeds size limit"));
        }
        file.seek(SeekFrom::End(0))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        entry.size_bytes += bytes.len() as u64;
        self.write(&entry)?;
        Ok(DictationHistoryWriteResponse { recording: entry })
    }

    pub(super) fn finish(
        &self,
        params: DictationHistoryFinishParams,
    ) -> io::Result<DictationHistoryWriteResponse> {
        let _lock = self.lock()?;
        let mut entry = self.read(&params.id)?;
        let status = match params.status {
            DictationHistoryFinishStatus::Saved => DictationHistoryStatus::Saved,
            DictationHistoryFinishStatus::Cancelled => DictationHistoryStatus::Cancelled,
            DictationHistoryFinishStatus::Interrupted => DictationHistoryStatus::Interrupted,
        };
        let mut leases = self
            .leases
            .lock()
            .map_err(|_| io::Error::other("Recording owner unavailable"))?;
        if entry.status != status {
            if entry.status != DictationHistoryStatus::Recording || !leases.contains_key(&params.id)
            {
                return Err(invalid("Recording cannot be finished by this process"));
            }
            entry.status = status;
            self.write(&entry)?;
        }
        leases.remove(&params.id);
        Ok(DictationHistoryWriteResponse { recording: entry })
    }

    pub(super) fn read_audio(
        &self,
        params: DictationHistoryIdParams,
    ) -> io::Result<DictationHistoryReadAudioResponse> {
        let _lock = self.lock()?;
        let entry = self.read(&params.id)?;
        Ok(DictationHistoryReadAudioResponse {
            audio_base64: STANDARD.encode(fs::read(self.path(&params.id, "audio")?)?),
            mime_type: entry.mime_type,
        })
    }

    pub(super) fn set_transcript(
        &self,
        params: DictationHistorySetTranscriptParams,
    ) -> io::Result<DictationHistoryWriteResponse> {
        if params.text.len() > 128 * 1024 {
            return Err(invalid("Transcript exceeds size limit"));
        }
        let _lock = self.lock()?;
        let mut entry = self.read(&params.id)?;
        if entry.status == DictationHistoryStatus::Recording {
            return Err(invalid("Recording is still active"));
        }
        entry.text = Some(params.text.trim().to_string()).filter(|s| !s.is_empty());
        self.write(&entry)?;
        Ok(DictationHistoryWriteResponse { recording: entry })
    }

    pub(super) fn delete(
        &self,
        params: DictationHistoryIdParams,
    ) -> io::Result<DictationHistoryDeleteResponse> {
        let _lock = self.lock()?;
        let entry = self.read(&params.id)?;
        if entry.status == DictationHistoryStatus::Recording {
            return Err(invalid("Recording is still active"));
        }
        self.remove(&params.id)?;
        Ok(DictationHistoryDeleteResponse {})
    }
}

#[cfg(test)]
mod tests;
