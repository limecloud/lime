use super::*;
use std::process::Command;

#[test]
fn missing_host_directory_rejects_control_without_resolving_a_default() {
    let error = ControlBroker::default().acquire().unwrap_err();
    assert!(error.0.contains("not supplied by the host"));
}

#[test]
fn independent_processes_exclude_and_crashed_owner_releases_os_lock() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("computer-use");
    let broker = ControlBroker::at(path.clone());
    let first = broker.acquire().unwrap();
    let first_fence = first.fence;
    let child = |mode: &str| {
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "computer_use::broker::tests::child_process_lock",
                "--ignored",
                "--nocapture",
            ])
            .env("LIME_CONTROL_LOCK_TEST_PATH", &path)
            .env("LIME_CONTROL_LOCK_TEST_MODE", mode)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("control-lock-child-ok"));
    };
    child("busy");
    drop(first);
    child("crash");
    // The child exits without running Rust destructors, so only OS handle cleanup
    // can release its lock. Its persisted fence must survive that exit.
    assert_eq!(broker.acquire().unwrap().fence, first_fence + 2);
}

#[test]
#[ignore = "subprocess fixture invoked by independent_processes_exclude_and_crashed_owner_releases_os_lock"]
fn child_process_lock() {
    let broker = ControlBroker::at(
        std::env::var_os("LIME_CONTROL_LOCK_TEST_PATH")
            .expect("test path")
            .into(),
    );
    match std::env::var("LIME_CONTROL_LOCK_TEST_MODE")
        .unwrap()
        .as_str()
    {
        "busy" => assert!(broker.acquire().unwrap_err().0.contains("busy")),
        "crash" => {
            let _guard = broker.acquire().unwrap();
            println!("control-lock-child-ok");
            std::io::stdout().flush().unwrap();
            std::process::exit(0);
        }
        _ => panic!("invalid test mode"),
    }
    println!("control-lock-child-ok");
}

#[cfg(unix)]
#[test]
fn last_lease_reference_releases_lock_with_duplicated_handle() {
    let temp = tempfile::tempdir().unwrap();
    let broker = ControlBroker::at(temp.path().join("computer-use"));
    let lease = std::sync::Arc::new(broker.acquire().unwrap());
    let first_fence = lease.fence;
    let inflight = std::sync::Arc::clone(&lease);
    // Share the open file description as fork would, without inheriting
    // unrelated descriptors from other tests.
    let inherited = lease._file.try_clone().unwrap();
    drop(lease);
    assert!(broker.acquire().unwrap_err().0.contains("busy"));
    drop(inflight);
    let next = broker
        .acquire()
        .expect("the inherited descriptor must not retain a dropped lease's lock");
    assert_eq!(next.fence, first_fence + 1);
    drop(next);
    drop(inherited);
}

#[test]
fn corrupt_and_exhausted_fence_never_reset_to_a_new_generation() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("computer-use");
    let broker = ControlBroker::at(path.clone());
    drop(broker.acquire().unwrap());
    fs::write(path.join("desktop.lock"), [0, 1, 2]).unwrap();
    let corrupt = broker.acquire().unwrap_err();
    assert!(
        corrupt.0.contains("corrupt"),
        "unexpected corrupt error: {corrupt:?}"
    );
    fs::write(path.join("desktop.lock"), u64::MAX.to_be_bytes()).unwrap();
    let exhausted = broker.acquire().unwrap_err();
    assert!(
        exhausted.0.contains("exhausted"),
        "unexpected exhausted error: {exhausted:?}"
    );
}

#[cfg(unix)]
#[test]
fn symlink_or_shared_lock_path_is_rejected_without_modifying_target() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("computer-use");
    fs::create_dir(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    let external = temp.path().join("external");
    fs::write(&external, b"leave me intact").unwrap();
    symlink(&external, path.join("desktop.lock")).unwrap();
    let broker = ControlBroker::at(path.clone());
    assert!(broker.acquire().is_err());
    assert_eq!(fs::read(&external).unwrap(), b"leave me intact");
    fs::remove_file(path.join("desktop.lock")).unwrap();
    drop(broker.acquire().unwrap());
    fs::set_permissions(path.join("desktop.lock"), fs::Permissions::from_mode(0o644)).unwrap();
    assert!(broker.acquire().unwrap_err().0.contains("not private"));
}
