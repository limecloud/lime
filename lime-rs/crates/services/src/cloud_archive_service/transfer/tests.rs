use super::*;

#[cfg(unix)]
fn fixture(root: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let program = root.join("rclone-fixture");
    fs::write(
        &program,
        r#"#!/usr/bin/env python3
import json, pathlib, shutil, sys, time
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
with (root/'calls').open('a') as log: log.write(json.dumps(args)+'\n')
assert args[args.index('--retries')+1] == '1'
assert args[args.index('--low-level-retries')+1] == '1'
if (root/'fail').exists():
 print('credential-secret-must-not-project', file=sys.stderr)
 sys.exit(1)
if args[0] == 'cat':
 assert '--ignore-existing' not in args
 src = root/args[1].split(':',1)[1]
 if (root/'oversized-download').exists():
  sys.stdout.buffer.write(b'x'*4096)
  sys.stdout.buffer.flush()
  time.sleep(10)
  (root/'continued-after-limit').write_text('unexpected')
  sys.exit(0)
 with src.open('rb') as stream:
  shutil.copyfileobj(stream, sys.stdout.buffer)
 if (root/'fail-after-output').exists(): sys.exit(1)
else:
 src, dst = args[1:3]
 assert args[0] == 'copyto' and '--ignore-existing' in args and '--error-on-no-transfer' in args
 assert '--max-size' not in args
 assert pathlib.Path(src).stat().st_mode & 0o077 == 0
 if (root/'replace-source').exists(): (root/'original.age').write_text('replaced-after-validation')
 target = root/dst.split(':',1)[1]
 if target.exists(): sys.exit(1)
 shutil.copyfile(src, target)
"#,
    )
    .unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o700)).unwrap();
    program
}

#[cfg(unix)]
fn archive(root: &Path) -> (PathBuf, String) {
    let source = root.join("home");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("document"), "private synthetic document").unwrap();
    let identity = age::x25519::Identity::generate();
    let output = root.join("original.age");
    let result = export(
        &source,
        &["document".into()],
        &output,
        &identity.to_public().to_string(),
        false,
        true,
    )
    .unwrap();
    (output, result["sha256"].as_str().unwrap().into())
}

#[cfg(unix)]
#[tokio::test]
async fn upload_uses_a_private_verified_copy_even_when_original_is_replaced() {
    let root = tempfile::tempdir().unwrap();
    let program = fixture(root.path());
    let (source, sha) = archive(root.path());
    let original = fs::read(&source).unwrap();
    fs::write(root.path().join("replace-source"), "").unwrap();
    let result = transfer_with_program(&source, "fixture:stored.age", true, &sha, &program)
        .await
        .unwrap();
    assert_eq!(fs::read(root.path().join("stored.age")).unwrap(), original);
    assert_ne!(fs::read(&source).unwrap(), original);
    assert_eq!(result["sha256"], sha);
    assert_eq!(result["restoreVerified"], false);
    let calls: Vec<String> = serde_json::from_str(
        fs::read_to_string(root.path().join("calls"))
            .unwrap()
            .trim(),
    )
    .unwrap();
    assert_ne!(Path::new(&calls[1]), source);
    assert!(
        !Path::new(&calls[1]).exists(),
        "private upload staging is cleaned"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn plaintext_wrong_digests_unsafe_paths_links_and_oversized_uploads_never_start_network() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let program = fixture(root.path());
    let (source, sha) = archive(root.path());
    let plaintext = root.path().join("plaintext.age");
    fs::write(&plaintext, "private text renamed to .age").unwrap();
    let link = root.path().join("link.age");
    symlink(&source, &link).unwrap();
    let huge = root.path().join("huge.age");
    File::create(&huge)
        .unwrap()
        .set_len(MAX_CIPHERTEXT_BYTES + 1)
        .unwrap();
    for (file, remote, digest) in [
        (
            &plaintext,
            "fixture:stored.age",
            digest(&plaintext).unwrap().0,
        ),
        (&source, "fixture:stored.age", "0".repeat(64)),
        (&source, "fixture:stored.age", "invalid".into()),
        (&source, "fixture:../escape.age", sha.clone()),
        (&source, "fixture:/absolute.age", sha.clone()),
        (&source, ":stored.age", sha.clone()),
        (&source, "-flag:stored.age", sha.clone()),
        (&source, "fixture:stored.txt", sha.clone()),
        (&link, "fixture:stored.age", sha.clone()),
        (&huge, "fixture:stored.age", sha.clone()),
    ] {
        assert!(transfer_with_program(file, remote, true, &digest, &program)
            .await
            .is_err());
    }
    assert!(!root.path().join("calls").exists());
    assert!(!root.path().join("stored.age").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn download_publishes_only_verified_age_ciphertext_and_never_overwrites() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = tempfile::tempdir().unwrap();
    let program = fixture(root.path());
    let (source, sha) = archive(root.path());
    let output = root.path().join("download.age");
    let result = transfer_with_program(
        &output,
        "fixture:original.age",
        false,
        &sha.to_uppercase(),
        &program,
    )
    .await
    .unwrap();
    assert_eq!(fs::read(&output).unwrap(), fs::read(source).unwrap());
    assert_eq!(
        fs::metadata(&output).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(result["sha256"], sha);
    assert!(
        transfer_with_program(&output, "fixture:original.age", false, &sha, &program)
            .await
            .is_err()
    );
    let dangling = root.path().join("dangling.age");
    symlink(root.path().join("missing.age"), &dangling).unwrap();
    assert!(
        transfer_with_program(&dangling, "fixture:original.age", false, &sha, &program)
            .await
            .is_err()
    );
    let invalid = root.path().join("invalid.age");
    assert!(
        transfer_with_program(&invalid, "fixture:original.age", false, "invalid", &program)
            .await
            .is_err()
    );
    let calls = fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.lines().count(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn corrupt_plaintext_and_failed_downloads_publish_nothing_and_redact_diagnostics() {
    let root = tempfile::tempdir().unwrap();
    let program = fixture(root.path());
    let (_, sha) = archive(root.path());
    let plaintext = root.path().join("plaintext.age");
    fs::write(&plaintext, "not encrypted").unwrap();
    let corrupt = root.path().join("corrupt.age");
    let mut bytes = fs::read(root.path().join("original.age")).unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    fs::write(&corrupt, bytes).unwrap();
    for (remote, expected) in [
        ("fixture:plaintext.age", digest(&plaintext).unwrap().0),
        ("fixture:corrupt.age", sha.clone()),
    ] {
        let output = root.path().join("download.age");
        assert!(
            transfer_with_program(&output, remote, false, &expected, &program)
                .await
                .is_err()
        );
        assert!(!output.exists());
    }
    fs::write(root.path().join("fail"), "").unwrap();
    let output = root.path().join("download.age");
    let error = transfer_with_program(&output, "fixture:original.age", false, &sha, &program)
        .await
        .unwrap_err();
    assert!(!error.contains("credential-secret"));
    assert!(!output.exists());
    let count = fs::read_to_string(root.path().join("calls"))
        .unwrap()
        .lines()
        .count();
    assert_eq!(count, 3, "failures do not automatically replay transfers");
    let staged: Vec<_> = fs::read_dir(root.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .filter(|name| name.to_string_lossy().starts_with(".tmp"))
        .collect();
    assert!(staged.is_empty(), "failed transfers clean private staging");
}

#[cfg(unix)]
#[tokio::test]
async fn oversized_download_is_stopped_and_never_published() {
    let root = tempfile::tempdir().unwrap();
    let program = fixture(root.path());
    let (_, sha) = archive(root.path());
    fs::write(root.path().join("oversized-download"), "").unwrap();
    let output = root.path().join("download.age");
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        transfer_with_download_limit(&output, "fixture:original.age", false, &sha, &program, 512),
    )
    .await
    .unwrap();
    assert!(result.unwrap_err().contains("transfer limit"));
    assert!(!output.exists());
    assert!(!root.path().join("continued-after-limit").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn exact_limit_is_accepted_but_complete_output_from_failed_command_is_not() {
    let root = tempfile::tempdir().unwrap();
    let program = fixture(root.path());
    let (source, sha) = archive(root.path());
    let limit = fs::metadata(&source).unwrap().len();
    let output = root.path().join("download.age");
    fs::write(root.path().join("fail-after-output"), "").unwrap();
    let result = transfer_with_download_limit(
        &output,
        "fixture:original.age",
        false,
        &sha,
        &program,
        limit,
    )
    .await;
    assert!(result.unwrap_err().contains("Archive transfer failed"));
    assert!(!output.exists());
    let published = root.path().join("published.age");
    fs::rename(
        root.path().join("fail-after-output"),
        root.path().join("unused"),
    )
    .unwrap();
    transfer_with_download_limit(
        &published,
        "fixture:original.age",
        false,
        &sha,
        &program,
        limit,
    )
    .await
    .unwrap();
    assert_eq!(fs::read(published).unwrap(), fs::read(source).unwrap());
}
