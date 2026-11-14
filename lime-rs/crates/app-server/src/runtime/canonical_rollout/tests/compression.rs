use super::super::compression::compressed_rollout_path;
use super::*;

fn compress(path: &Path, keep_plain: bool) -> PathBuf {
    let compressed = compressed_rollout_path(path);
    fs::write(
        &compressed,
        zstd::stream::encode_all(fs::read(path).unwrap().as_slice(), 3).unwrap(),
    )
    .unwrap();
    if !keep_plain {
        fs::remove_file(path).unwrap();
    }
    compressed
}

#[test]
fn compressed_discovery_is_read_only_and_plain_wins_once() {
    let (_temp, store, source, relative, path) = setup("compressed-discovery");
    append(&store, &relative, &source, 1, &fingerprint('a')).unwrap();
    let compressed = compress(&path, false);
    let before = fs::read(&compressed).unwrap();
    let snapshots = store.snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].relative_path, relative);
    assert_eq!(snapshots[0].history[0].sequence, 1);
    assert!(!path.exists());
    assert_eq!(fs::read(&compressed).unwrap(), before);
    let copied = store.agent_root.join("copied.zst");
    fs::write(&copied, &before).unwrap();
    let (_, recovered, sequence, _) = store.read_requested_thread(&copied).unwrap();
    assert_eq!(recovered.thread_id, source.thread_id);
    assert_eq!(sequence, 1);
    assert!(!copied.with_extension("").exists());

    fs::write(&path, zstd::stream::decode_all(before.as_slice()).unwrap()).unwrap();
    append(&store, &relative, &source, 2, &fingerprint('b')).unwrap();
    // Even an unreadable hidden sibling must not replace the authoritative plain file.
    fs::write(&compressed, b"invalid compressed sibling").unwrap();
    let snapshots = store.snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].history.len(), 2);
}

#[test]
fn ensure_and_append_materialize_without_losing_history_or_file_permissions() {
    let (_temp, store, source, relative, path) = setup("compressed-append");
    append(&store, &relative, &source, 1, &fingerprint('a')).unwrap();
    let original = fs::read(&path).unwrap();
    let compressed = compress(&path, false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&compressed, fs::Permissions::from_mode(0o600)).unwrap();
    }
    store.ensure_thread(&relative, &source).unwrap();
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(!compressed.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    compress(&path, false);
    append(&store, &relative, &source, 2, &fingerprint('b')).unwrap();
    assert_eq!(scan_rollout(&path).unwrap().history.len(), 2);
    assert!(!compressed.exists());
    assert!(fs::read(&path).unwrap().starts_with(&original));
}

#[test]
fn compressed_archive_metadata_restore_and_delete_do_not_resurrect_siblings() {
    let (_temp, store, source, relative, path) = setup("compressed-lifecycle");
    append(&store, &relative, &source, 1, &fingerprint('a')).unwrap();
    let compressed = compress(&path, true);
    let archived = store
        .archive(
            &relative,
            source.session_id.as_str(),
            source.thread_id.as_str(),
        )
        .unwrap()
        .commit();
    assert!(!path.exists());
    assert!(!compressed.exists());
    let archived_path = store.agent_root.join(&archived);
    let archived_compressed = compress(&archived_path, false);
    let snapshots = store.snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    assert!(snapshots[0].archived);
    assert_eq!(snapshots[0].relative_path, archived);
    assert!(!archived_path.exists());
    let mut next = source.clone();
    next.metadata = json!({"gitInfo":{"branch":"compressed"}});
    next.updated_at_ms += 1;
    store
        .append_metadata(&archived, &source, &next, true)
        .unwrap();
    assert!(!archived_compressed.exists());
    compress(&archived_path, false);
    assert_eq!(
        store
            .unarchive(
                &archived,
                source.session_id.as_str(),
                source.thread_id.as_str()
            )
            .unwrap()
            .commit(),
        relative
    );
    assert!(!archived_compressed.exists());
    assert_eq!(
        store.snapshots().unwrap()[0].initial_thread.metadata,
        next.metadata
    );
    assert!(!path.exists());
    assert!(compressed.exists());
    store
        .materialize_rollout_for_append_blocking(&path)
        .unwrap();
    for keep_plain in [false, true] {
        if !path.exists() {
            store.ensure_thread(&relative, &source).unwrap();
        }
        compress(&path, keep_plain);
        assert!(store
            .delete(
                &relative,
                source.session_id.as_str(),
                source.thread_id.as_str(),
                false
            )
            .unwrap());
        assert!(store.snapshots().unwrap().is_empty());
        assert!(!path.exists());
        assert!(!compressed.exists());
    }
}

#[test]
fn invalid_compressed_files_never_publish_plain_or_change_the_source() {
    for corruption in ["frame", "truncated", "record-tail", "digest", "identity"] {
        let (_temp, store, source, relative, path) = setup(corruption);
        append(&store, &relative, &source, 1, &fingerprint('a')).unwrap();
        if corruption == "record-tail" {
            fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b"{\"partial\":")
                .unwrap();
        } else if corruption == "digest" {
            let text = fs::read_to_string(&path).unwrap();
            let mut records: Vec<Value> = text
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            records[1]["content_digest"] = json!("0".repeat(64));
            fs::write(
                &path,
                records
                    .iter()
                    .map(|record| format!("{record}\n"))
                    .collect::<String>(),
            )
            .unwrap();
        } else if corruption == "identity" {
            let text = fs::read_to_string(&path).unwrap().replace(
                &relative.to_string_lossy().replace('\\', "/"),
                "sessions/wrong.jsonl",
            );
            fs::write(&path, text).unwrap();
        }
        let compressed = compress(&path, false);
        if corruption == "frame" {
            fs::write(&compressed, b"not a zstd frame").unwrap();
        } else if corruption == "truncated" {
            let mut bytes = fs::read(&compressed).unwrap();
            bytes.truncate(bytes.len() - 5);
            fs::write(&compressed, bytes).unwrap();
        }
        let before = fs::read(&compressed).unwrap();
        assert!(
            store.snapshots().is_err(),
            "{corruption}: discovery must fail closed"
        );
        assert!(
            append(&store, &relative, &source, 2, &fingerprint('b')).is_err(),
            "{corruption}: append must fail closed"
        );
        assert!(!path.exists(), "{corruption}: must not publish plain");
        assert_eq!(fs::read(&compressed).unwrap(), before, "{corruption}");
        assert_eq!(
            fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1,
            "{corruption}: temp files must be cleaned"
        );
    }
}
