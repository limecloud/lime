//! Checks fresh output handles and safe replacement of caller-controlled entries.

use super::create_temporary_file;
use super::write_file_atomically;
use anyhow::Result;
use pretty_assertions::assert_eq;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::os::windows::fs::OpenOptionsExt;
use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_WRITE;

#[test]
fn replaces_hard_link_without_writing_to_its_target() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let victim = temp.path().join("victim");
    let output = temp.path().join("sandbox_users.json");
    fs::write(&victim, b"unchanged")?;
    fs::hard_link(&victim, &output)?;

    write_file_atomically(&output, b"new contents")?;

    assert_eq!(fs::read(&victim)?, b"unchanged");
    assert_eq!(fs::read(&output)?, b"new contents");
    assert_eq!(fs::read_dir(temp.path())?.count(), 2);
    Ok(())
}

#[test]
fn failed_replacement_does_not_truncate_target_or_leave_temporary_file() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let victim = temp.path().join("victim");
    let output = temp.path().join("setup_error.json");
    fs::write(&victim, b"unchanged")?;
    fs::hard_link(&victim, &output)?;
    let _held = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(&output)?;

    assert!(write_file_atomically(&output, b"new contents").is_err());

    assert_eq!(fs::read(&victim)?, b"unchanged");
    assert_eq!(fs::read(&output)?, b"unchanged");
    assert_eq!(fs::read_dir(temp.path())?.count(), 2);
    Ok(())
}

#[test]
fn fresh_output_cannot_be_written_or_replaced_while_held() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let (mut file, _directory) = create_temporary_file(temp.path(), ".log")?;
    let path = fs::read_dir(temp.path())?.next().unwrap()?.path();

    assert!(
        OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&path)
            .is_err()
    );
    assert!(fs::remove_file(&path).is_err());
    assert!(fs::rename(&path, temp.path().join("moved")).is_err());
    file.write_all(b"log contents")?;
    drop(file);

    assert_eq!(fs::read(path)?, b"log contents");
    Ok(())
}
