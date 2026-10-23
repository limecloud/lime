use super::*;
use tempfile::TempDir;

fn start(store: &DictationHistoryStore) -> DictationHistoryEntry {
    store
        .start(DictationHistoryStartParams {
            mime_type: "audio/webm;codecs=opus".into(),
        })
        .unwrap()
        .recording
}

fn append(
    store: &DictationHistoryStore,
    id: &str,
    offset: u64,
    audio: &[u8],
) -> io::Result<DictationHistoryWriteResponse> {
    store.append_audio(DictationHistoryAppendAudioParams {
        id: id.into(),
        offset,
        audio_base64: STANDARD.encode(audio),
    })
}

fn finish(store: &DictationHistoryStore, id: &str) {
    store
        .finish(DictationHistoryFinishParams {
            id: id.into(),
            status: DictationHistoryFinishStatus::Saved,
        })
        .unwrap();
}

#[test]
fn cold_recovery_preserves_audio_and_transcript_without_reopening_deleted_entries() {
    let temp = TempDir::new().unwrap();
    let store = DictationHistoryStore::new(temp.path().into());
    let entry = start(&store);
    append(&store, &entry.id, 0, b"first").unwrap();
    append(&store, &entry.id, 5, b"second").unwrap();
    finish(&store, &entry.id);
    store
        .set_transcript(DictationHistorySetTranscriptParams {
            id: entry.id.clone(),
            text: "  hello  ".into(),
        })
        .unwrap();
    drop(store);
    let store = DictationHistoryStore::new(temp.path().into());
    let entry = store.list().unwrap().recordings.remove(0);
    assert_eq!(entry.size_bytes, 11);
    assert_eq!(entry.text.as_deref(), Some("hello"));
    assert_eq!(entry.status, DictationHistoryStatus::Saved);
    let params = DictationHistoryIdParams {
        id: entry.id.clone(),
    };
    let audio = store.read_audio(params.clone()).unwrap();
    assert_eq!(STANDARD.decode(audio.audio_base64).unwrap(), b"firstsecond");
    assert_eq!(audio.mime_type, "audio/webm;codecs=opus");
    store.delete(params).unwrap();
    assert!(store
        .set_transcript(DictationHistorySetTranscriptParams {
            id: entry.id,
            text: "late result".into()
        })
        .is_err());
    assert!(store.list().unwrap().recordings.is_empty());
}

#[test]
fn active_lease_survives_other_owners_but_recovers_after_owner_exit() {
    let temp = TempDir::new().unwrap();
    let owner = DictationHistoryStore::new(temp.path().into());
    let observer = DictationHistoryStore::new(temp.path().into());
    let entry = start(&owner);
    append(&owner, &entry.id, 0, b"recover me").unwrap();
    let params = DictationHistoryIdParams {
        id: entry.id.clone(),
    };
    assert_eq!(
        observer.list().unwrap().recordings[0].status,
        DictationHistoryStatus::Recording
    );
    assert!(observer.delete(params.clone()).is_err());
    assert_eq!(
        observer.read_audio(params.clone()).unwrap().audio_base64,
        STANDARD.encode(b"recover me")
    );
    assert!(append(&observer, &entry.id, 10, b"wrong owner").is_err());
    assert!(observer
        .finish(DictationHistoryFinishParams {
            id: entry.id.clone(),
            status: DictationHistoryFinishStatus::Saved
        })
        .is_err());
    // Simulate metadata lag after audio fsync; recovery uses the actual file length.
    let mut metadata = owner.read(&entry.id).unwrap();
    metadata.size_bytes = 0;
    owner.write(&metadata).unwrap();
    drop(owner);
    let recovered = observer.list().unwrap().recordings.remove(0);
    assert_eq!(recovered.status, DictationHistoryStatus::Interrupted);
    assert_eq!(recovered.size_bytes, 10);
    assert_eq!(
        STANDARD
            .decode(observer.read_audio(params).unwrap().audio_base64)
            .unwrap(),
        b"recover me"
    );
}

#[test]
fn keeps_twenty_newest_and_never_evicts_active_recordings() {
    let temp = TempDir::new().unwrap();
    let store = DictationHistoryStore::new(temp.path().into());
    let active = start(&store);
    let oldest = start(&store);
    finish(&store, &oldest.id);
    for _ in 0..19 {
        let entry = start(&store);
        finish(&store, &entry.id);
    }
    let entries = store.list().unwrap().recordings;
    assert_eq!(entries.len(), 20);
    assert!(entries.iter().any(|e| e.id == active.id));
    assert!(!entries.iter().any(|e| e.id == oldest.id));
    assert!(entries
        .windows(2)
        .all(|p| p[0].created_at_ms > p[1].created_at_ms));
    assert!(!store.path(&oldest.id, "audio").unwrap().exists());
}

#[test]
fn full_active_store_rejects_new_recording_without_data_loss() {
    let temp = TempDir::new().unwrap();
    let store = DictationHistoryStore::new(temp.path().into());
    for _ in 0..20 {
        start(&store);
    }
    assert!(store
        .start(DictationHistoryStartParams {
            mime_type: "audio/webm".into()
        })
        .is_err());
    assert_eq!(store.list().unwrap().recordings.len(), 20);
}

#[test]
fn rejects_path_encoding_order_and_size_violations_and_allows_identical_retry() {
    let temp = TempDir::new().unwrap();
    let store = DictationHistoryStore::new(temp.path().into());
    assert!(store
        .read_audio(DictationHistoryIdParams {
            id: "../../secret".into()
        })
        .is_err());
    assert!(store
        .start(DictationHistoryStartParams {
            mime_type: "text/html".into()
        })
        .is_err());
    let entry = start(&store);
    assert!(append(&store, &entry.id, 1, b"a").is_err());
    append(&store, &entry.id, 0, b"abc").unwrap();
    append(&store, &entry.id, 0, b"abc").unwrap();
    assert!(append(&store, &entry.id, 0, b"xyz").is_err());
    assert!(append(&store, &entry.id, 2, b"de").is_err());
    assert!(store
        .append_audio(DictationHistoryAppendAudioParams {
            id: entry.id.clone(),
            offset: 3,
            audio_base64: "invalid!".into()
        })
        .is_err());
    assert!(append(&store, &entry.id, 3, &vec![0; MAX_CHUNK_BYTES + 1]).is_err());
    let file = OpenOptions::new()
        .write(true)
        .open(store.path(&entry.id, "audio").unwrap())
        .unwrap();
    file.set_len(MAX_AUDIO_BYTES).unwrap();
    assert!(append(&store, &entry.id, MAX_AUDIO_BYTES, b"a").is_err());
    assert_eq!(file.metadata().unwrap().len(), MAX_AUDIO_BYTES);
    finish(&store, &entry.id);
    assert!(append(&store, &entry.id, MAX_AUDIO_BYTES, b"").is_err());
    assert!(store
        .set_transcript(DictationHistorySetTranscriptParams {
            id: entry.id,
            text: "x".repeat(128 * 1024 + 1)
        })
        .is_err());
}

#[test]
fn cancelled_status_is_durable_and_finish_is_idempotent() {
    let temp = TempDir::new().unwrap();
    let store = DictationHistoryStore::new(temp.path().into());
    let entry = start(&store);
    let params = DictationHistoryFinishParams {
        id: entry.id.clone(),
        status: DictationHistoryFinishStatus::Cancelled,
    };
    store.finish(params.clone()).unwrap();
    store.finish(params).unwrap();
    drop(store);
    assert_eq!(
        DictationHistoryStore::new(temp.path().into())
            .list()
            .unwrap()
            .recordings[0]
            .status,
        DictationHistoryStatus::Cancelled
    );
}

#[test]
fn supports_recorder_codec_parameters_and_rejects_control_characters() {
    let temp = TempDir::new().unwrap();
    let store = DictationHistoryStore::new(temp.path().into());
    let recording = store
        .start(DictationHistoryStartParams {
            mime_type: "audio/mp4;codecs=mp4a.40.2".into(),
        })
        .unwrap()
        .recording;
    assert_eq!(recording.mime_type, "audio/mp4;codecs=mp4a.40.2");
    assert!(store
        .start(DictationHistoryStartParams {
            mime_type: "audio/webm;\r\ninvalid".into()
        })
        .is_err());
}

#[test]
fn crash_recording_writer_child() {
    let Ok(root) = std::env::var("LIME_DICTATION_HISTORY_CRASH_TEST_ROOT") else {
        return;
    };
    let store = DictationHistoryStore::new(PathBuf::from(root));
    let entry = start(&store);
    append(&store, &entry.id, 0, b"audio before crash").unwrap();
    // Exit without Rust destructors, as a terminated sidecar would.
    std::process::exit(0);
}

#[test]
fn recovers_after_real_writer_process_exit() {
    let temp = TempDir::new().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "local_data_source::dictation_history::tests::crash_recording_writer_child",
        ])
        .env("LIME_DICTATION_HISTORY_CRASH_TEST_ROOT", temp.path())
        .status()
        .unwrap();
    assert!(status.success());
    let store = DictationHistoryStore::new(temp.path().into());
    let entries = store.list().unwrap().recordings;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].status, DictationHistoryStatus::Interrupted);
    assert_eq!(entries[0].size_bytes, 18);
    let audio = store
        .read_audio(DictationHistoryIdParams {
            id: entries[0].id.clone(),
        })
        .unwrap();
    assert_eq!(
        STANDARD.decode(audio.audio_base64).unwrap(),
        b"audio before crash"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(store.path(&entries[0].id, "audio").unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(store.path(&entries[0].id, "json").unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
