//! Exercises retained setup pins using bounded, disposable child processes.

use std::fs;
use std::io;
use std::io::Write;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsHandle;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command;
use std::time::Duration;
use std::time::Instant;

use pretty_assertions::assert_eq;
use windows_sys::Win32::Storage::FileSystem::DELETE;
use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE;
use windows_sys::Win32::Storage::FileSystem::FILE_READ_DATA;
use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_WRITE;

use super::spawn_with_retained_handles;

const CHILD_TEST: &str = "setup_launch::tests::retained_handles_child";
const CHILD_DIRECTORY_ENV: &str = "LIME_TEST_SETUP_LAUNCH_DIRECTORY";
const CHILD_TIMEOUT: Duration = Duration::from_secs(/*secs*/ 10);
const POLL_INTERVAL: Duration = Duration::from_millis(/*millis*/ 10);

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn child_retains_directory_pin_until_exit() -> io::Result<()> {
    let temporary = tempfile::tempdir()?;
    let directory = temporary.path().join("pinned");
    let renamed_directory = temporary.path().join("renamed");
    fs::create_dir(&directory)?;
    let pin = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(&directory)?;
    let guard_path = directory.join(".guard");
    let guard = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .access_mode(FILE_READ_DATA | DELETE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
        .open(&guard_path)?;
    let mut command = Command::new(std::env::current_exe()?);
    command
        .args(["--exact", CHILD_TEST, "--ignored"])
        .env(CHILD_DIRECTORY_ENV, temporary.path());
    let mut child = ChildGuard(spawn_with_retained_handles(
        &mut command,
        &[pin.as_handle(), guard.as_handle()],
    )?);
    drop(pin);
    drop(guard);

    let started = Instant::now();
    while !temporary.path().join("ready").exists() {
        assert_eq!(
            child.0.try_wait()?,
            None,
            "child exited before becoming ready"
        );
        assert!(
            started.elapsed() < CHILD_TIMEOUT,
            "child did not become ready"
        );
        std::thread::sleep(POLL_INTERVAL);
    }
    assert!(
        fs::rename(&directory, &renamed_directory).is_err(),
        "the child's duplicate must keep the directory pinned after the parent drops its handle"
    );
    assert_eq!(child.0.try_wait()?, None);
    assert!(guard_path.exists(), "the child must retain the guard file");

    fs::write(temporary.path().join("release"), b"")?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.0.try_wait()? {
            break status;
        }
        assert!(started.elapsed() < CHILD_TIMEOUT, "child did not exit");
        std::thread::sleep(POLL_INTERVAL);
    };
    assert!(status.success(), "child failed: {status}");
    assert!(
        !guard_path.exists(),
        "the guard must be deleted on child exit"
    );
    fs::rename(&directory, &renamed_directory)?;
    Ok(())
}

#[test]
fn missing_executable_returns_spawn_error_without_closing_retained_handles() -> io::Result<()> {
    let temporary = tempfile::tempdir()?;
    let mut retained_file = tempfile::tempfile()?;
    let mut command = Command::new(temporary.path().join("missing.exe"));

    let error = spawn_with_retained_handles(&mut command, &[retained_file.as_handle()])
        .expect_err("missing executable must fail to spawn");

    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    retained_file.write_all(b"the caller still owns its handle")?;
    Ok(())
}

#[test]
#[ignore = "child process for child_retains_directory_pin_until_exit"]
fn retained_handles_child() -> io::Result<()> {
    let Some(directory) = std::env::var_os(CHILD_DIRECTORY_ENV).map(PathBuf::from) else {
        return Ok(());
    };
    fs::write(directory.join("ready"), b"")?;
    let started = Instant::now();
    while !directory.join("release").exists() {
        assert!(
            started.elapsed() < CHILD_TIMEOUT,
            "parent did not release child"
        );
        std::thread::sleep(POLL_INTERVAL);
    }
    Ok(())
}
