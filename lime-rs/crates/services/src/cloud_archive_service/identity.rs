//! 在用户选择的本机新文件中创建恢复身份；只返回公钥和保存位置。

use super::*;
use age::secrecy::ExposeSecret;
use std::io::Write;

pub fn create_identity(output: &Path) -> Result<Value, String> {
    if !output.is_absolute() {
        return Err("Recovery identity requires an absolute new file path".into());
    }
    let name = output.file_name().ok_or("Invalid recovery identity path")?;
    let parent = output
        .parent()
        .ok_or("Recovery identity requires a parent directory")?
        .canonicalize()
        .map_err(|_| "Recovery identity directory is unavailable")?;
    let destination = parent.join(name);
    match fs::symlink_metadata(&destination) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        _ => return Err("Recovery identity destination must be a new file".into()),
    }
    let mut pending =
        tempfile::NamedTempFile::new_in(&parent).map_err(|_| "Cannot stage recovery identity")?;
    // Protect the empty file before writing secret material, including on Windows.
    lime_infra::secure_file::ensure_owner_only_permissions(pending.path())
        .map_err(|_| "Cannot protect recovery identity")?;
    let identity = age::x25519::Identity::generate();
    let recipient = identity.to_public().to_string();
    writeln!(
        pending,
        "# Lime Cloud recovery key. Keep an offline copy.\n# public key: {recipient}"
    )
    .map_err(|_| "Cannot write recovery identity")?;
    let secret = identity.to_string();
    pending
        .write_all(secret.expose_secret().as_bytes())
        .and_then(|()| pending.write_all(b"\n"))
        .and_then(|()| pending.as_file().sync_all())
        .map_err(|_| "Cannot save recovery identity")?;
    pending
        .persist_noclobber(&destination)
        .map_err(|_| "Recovery identity destination exists or cannot be saved")?;
    #[cfg(unix)]
    File::open(&parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "Recovery identity may be saved; inspect the selected destination")?;
    Ok(json!({ "identityFile": destination, "recipient": recipient }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_identity_decrypts_an_archive_and_never_enters_the_response() {
        let root = tempfile::tempdir().unwrap();
        let key = root.path().join("recovery.agekey");
        let result = create_identity(&key).unwrap();
        let identity = rewrap::read_identity(&key).unwrap();
        assert_eq!(result["recipient"], identity.to_public().to_string());
        assert_eq!(
            result["identityFile"],
            key.canonicalize().unwrap().to_str().unwrap()
        );
        assert!(!result.to_string().contains("AGE-SECRET-KEY-"));
        assert_eq!(result.as_object().unwrap().len(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&key).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let source = root.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(
            source.join("document"),
            "restored with a product-generated key",
        )
        .unwrap();
        let archive = root.path().join("backup.age");
        let exported = export(
            &source,
            &["document".into()],
            &archive,
            result["recipient"].as_str().unwrap(),
            false,
            true,
        )
        .unwrap();
        let destination = root.path().join("restored");
        restore(
            &archive,
            &key,
            &destination,
            exported["sha256"].as_str().unwrap(),
            1024,
        )
        .unwrap();
        assert_eq!(
            fs::read(destination.join("document")).unwrap(),
            fs::read(source.join("document")).unwrap()
        );
        // The recovery identity is still excluded even with credentials enabled.
        fs::copy(&key, source.join("renamed-key.txt")).unwrap();
        assert!(
            export(
                &source,
                &["renamed-key.txt".into()],
                &root.path().join("unsafe.age"),
                result["recipient"].as_str().unwrap(),
                true,
                true
            )
            .is_err()
        );
        assert!(!root.path().join("unsafe.age").exists());
    }

    #[test]
    fn existing_files_and_directories_are_preserved_and_relative_paths_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let key = root.path().join("recovery.agekey");
        create_identity(&key).unwrap();
        let original = fs::read(&key).unwrap();
        assert!(create_identity(&key).is_err());
        assert_eq!(fs::read(&key).unwrap(), original);
        assert!(create_identity(root.path()).is_err());
        assert!(create_identity(&root.path().join("missing/recovery.agekey")).is_err());
        assert!(create_identity(Path::new("relative.agekey")).is_err());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_destinations_are_not_followed_or_replaced() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("original");
        fs::write(&original, "keep").unwrap();
        let existing = root.path().join("existing-link");
        let dangling = root.path().join("dangling-link");
        symlink(&original, &existing).unwrap();
        symlink(root.path().join("missing"), &dangling).unwrap();
        for link in [&existing, &dangling] {
            assert!(create_identity(link).is_err());
            assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
        }
        assert_eq!(fs::read(&original).unwrap(), b"keep");
        assert!(!root.path().join("missing").exists());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 3);
    }

    #[test]
    fn concurrent_creators_publish_only_one_matching_identity() {
        let root = tempfile::tempdir().unwrap();
        let key = root.path().join("recovery.agekey");
        let barrier = std::sync::Barrier::new(2);
        let results = std::thread::scope(|scope| {
            let create = || {
                barrier.wait();
                create_identity(&key)
            };
            let first = scope.spawn(create);
            let second = scope.spawn(create);
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let saved = rewrap::read_identity(&key).unwrap().to_public().to_string();
        assert_eq!(
            results.into_iter().find_map(Result::ok).unwrap()["recipient"],
            saved
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
