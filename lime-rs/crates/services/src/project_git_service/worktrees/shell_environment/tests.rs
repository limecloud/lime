use super::*;

#[test]
fn captures_only_changed_values_and_removals_in_stable_order() {
    let before = "\u{feff}UNCHANGED=yes\r\nREMOVE=old\r\nCHANGE=before\r\nEMPTY=before\r\nPWD=/source\r\nLIME_SHELL=bash\r\nBASH_FUNC_f%%=old\r\n";
    let after = "UNCHANGED=yes\nCHANGE=after=with=equals\nEMPTY=\nNEW=added\nPWD=/worktree\nLIME_SHELL=zsh\nBASH_FUNC_f%%=new\nnot an assignment\n=ignored\n";
    let diff = WorktreeShellEnvironment::from_captures(before, after).unwrap();
    assert_eq!(
        serde_json::to_value(diff).unwrap(),
        serde_json::json!({
            "version": 1,
            "set": {"CHANGE":"after=with=equals","EMPTY":"","NEW":"added"},
            "exclude": ["REMOVE"]
        })
    );
    assert!(WorktreeShellEnvironment::from_captures("SAME=value\n", "SAME=value\n").is_none());
}

#[test]
fn ignores_multiline_values_and_all_injected_or_shell_noise() {
    let before = BTreeMap::from([
        ("MULTILINE".into(), "first\nsecond".into()),
        ("REMOVED_MULTILINE".into(), "first\rsecond".into()),
    ]);
    let mut after = BTreeMap::from([("MULTILINE".into(), "single".into())]);
    for key in [
        "LIME_SOURCE_TREE_PATH",
        "LIME_WORKTREE_PATH",
        "LIME_SETUP_EXIT_CODE",
        "LIME_SHELL",
        "OLDPWD",
        "PWD",
        "SHELLOPTS",
        "SHLVL",
        "_",
        "BASH_FUNC_example%%",
    ] {
        after.insert(key.into(), "changed".into());
    }
    assert!(WorktreeShellEnvironment::between(before, after, false).is_none());
}

#[test]
fn windows_keys_compare_without_case_and_replace_existing_aliases() {
    let before = BTreeMap::from([
        ("Path".into(), "before".into()),
        ("Same".into(), "same".into()),
        ("Remove".into(), "old".into()),
    ]);
    let after = BTreeMap::from([
        ("PATH".into(), "after".into()),
        ("SAME".into(), "same".into()),
        ("pwd".into(), "noise".into()),
    ]);
    let diff = WorktreeShellEnvironment::between(before, after, true).unwrap();
    assert_eq!(diff.set, BTreeMap::from([("PATH".into(), "after".into())]));
    assert_eq!(diff.exclude, vec!["Remove"]);
    let mut environment = HashMap::from([
        ("Path".into(), "old".into()),
        ("REMOVE".into(), "old".into()),
        ("KEEP".into(), "kept".into()),
    ]);
    diff.apply_to_for_platform(&mut environment, true);
    assert_eq!(
        environment,
        HashMap::from([
            ("PATH".into(), "after".into()),
            ("KEEP".into(), "kept".into()),
        ])
    );
}

#[test]
fn native_keys_remain_case_sensitive_and_debug_never_prints_values() {
    let diff = WorktreeShellEnvironment::between(
        BTreeMap::from([("UPPER".into(), "remove-secret".into())]),
        BTreeMap::from([("upper".into(), "set-secret".into())]),
        false,
    )
    .unwrap();
    let mut environment = HashMap::from([
        ("UPPER".into(), "remove-secret".into()),
        ("Keep".into(), "kept".into()),
    ]);
    diff.apply_to_for_platform(&mut environment, false);
    assert_eq!(
        environment.get("upper").map(String::as_str),
        Some("set-secret")
    );
    assert!(!environment.contains_key("UPPER"));
    assert_eq!(environment.get("Keep").map(String::as_str), Some("kept"));
    assert!(!format!("{diff:?}").contains("secret"));
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", cwd.join("missing-global-config"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn metadata_is_git_scoped_and_readable_from_subdirectories_after_reopening() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    std::fs::create_dir(&source).unwrap();
    git(&source, &["init", "--template=", "--initial-branch=main"]);
    std::fs::create_dir_all(source.join("packages/app")).unwrap();
    std::fs::write(source.join("packages/app/file"), "fixture").unwrap();
    git(&source, &["add", "."]);
    git(
        &source,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "fixture",
        ],
    );
    let worktree = temporary.path().join("linked");
    git(
        &source,
        &["worktree", "add", "--detach", worktree.to_str().unwrap()],
    );
    let source_diff = WorktreeShellEnvironment::from_captures("", "VALUE=source\n").unwrap();
    let linked_diff =
        WorktreeShellEnvironment::from_captures("REMOVE=old\n", "VALUE=linked\n").unwrap();
    write_worktree_shell_environment(&source, &source_diff)
        .await
        .unwrap();
    write_worktree_shell_environment(&worktree, &linked_diff)
        .await
        .unwrap();
    assert_eq!(
        read_worktree_shell_environment(&source.join("packages/app"))
            .await
            .unwrap(),
        Some(source_diff.clone())
    );
    assert_eq!(
        read_worktree_shell_environment(&worktree.join("packages/app"))
            .await
            .unwrap(),
        Some(linked_diff)
    );
    remove_worktree_shell_environment(&worktree).await.unwrap();
    assert!(read_worktree_shell_environment(&worktree)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        read_worktree_shell_environment(&source).await.unwrap(),
        Some(source_diff)
    );
    remove_worktree_shell_environment(&worktree).await.unwrap();
}

#[tokio::test]
async fn missing_or_invalid_metadata_has_no_partial_environment() {
    let temporary = tempfile::tempdir().unwrap();
    let cwd = temporary.path();
    assert!(read_worktree_shell_environment(cwd)
        .await
        .unwrap()
        .is_none());
    assert!(write_worktree_shell_environment(
        cwd,
        &WorktreeShellEnvironment::from_captures("", "X=y\n").unwrap()
    )
    .await
    .is_err());
    git(cwd, &["init", "--template="]);
    let path = config_path(cwd).await.unwrap().unwrap();
    for invalid in [
        "invalid json",
        r#"{"version":2,"set":{},"exclude":[]}"#,
        r#"{"version":1,"set":{"SECRET":42},"exclude":[]}"#,
        r#"{"version":1,"set":{}}"#,
    ] {
        std::fs::write(&path, invalid).unwrap();
        let error = read_worktree_shell_environment(cwd).await.unwrap_err();
        assert!(!error.contains("SECRET"));
    }
    remove_worktree_shell_environment(cwd).await.unwrap();
    assert!(read_worktree_shell_environment(cwd)
        .await
        .unwrap()
        .is_none());
}
