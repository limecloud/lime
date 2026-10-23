use super::*;
use crate::project_git_service::{create_worktree, WorktreeOptions};
use std::{fs, process::Command};

fn run(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

async fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    fs::create_dir(&source).unwrap();
    run(&source, &["init", "--template=", "--initial-branch=main"]);
    fs::write(source.join("README.md"), "base\n").unwrap();
    fs::write(source.join("deleted.txt"), "old\n").unwrap();
    fs::write(source.join(".gitignore"), "ignored-data\n").unwrap();
    run(&source, &["add", "."]);
    run(
        &source,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Fixture",
        ],
    );
    let root = temp.path().join("托管 worktrees");
    let target = create_worktree(
        source.to_str().unwrap(),
        Some("snapshot"),
        Some("main"),
        &WorktreeOptions {
            root: root.clone(),
            refresh_upstream: false,
        },
    )
    .await
    .unwrap();
    let target = PathBuf::from(target.worktree_path);
    (temp, source, fs::canonicalize(root).unwrap(), target)
}

#[tokio::test]
async fn working_tree_snapshot_preserves_content_without_changing_index_or_source_branch() {
    let (_temp, source, root, target) = fixture().await;
    let head = run(&target, &["rev-parse", "HEAD"]);
    fs::write(target.join("README.md"), "staged\n").unwrap();
    run(&target, &["add", "README.md"]);
    fs::write(target.join("README.md"), "working\n").unwrap();
    fs::remove_file(target.join("deleted.txt")).unwrap();
    fs::create_dir(target.join("new folder")).unwrap();
    let literal = "new folder/literal [*] 中文.txt";
    fs::write(target.join(literal), b"binary\0content\n").unwrap();
    fs::write(target.join("ignored-data"), "not a full backup").unwrap();
    let index = PathBuf::from(run(
        &target,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    ));
    let index_bytes = fs::read(&index).unwrap();
    let snapshot = snapshot_worktree(&root, &target).await.unwrap();
    assert_ne!(snapshot.commit_sha, head);
    assert_eq!(fs::read(&index).unwrap(), index_bytes);
    assert_eq!(run(&target, &["rev-parse", "HEAD"]), head);
    assert_eq!(run(&source, &["symbolic-ref", "--short", "HEAD"]), "main");
    assert_eq!(
        run(
            &target,
            &["show", &format!("{}:README.md", snapshot.snapshot_ref)]
        ),
        "working"
    );
    let paths = run(
        &target,
        &[
            "-c",
            "core.quotePath=false",
            "ls-tree",
            "-r",
            "--name-only",
            &snapshot.snapshot_ref,
        ],
    );
    assert!(paths.contains(literal));
    assert!(!paths.contains("deleted.txt"));
    assert!(!paths.contains("ignored-data"));
    // 仅移除隔离测试checkout，随后验证快照恢复。
    run(
        &source,
        &["worktree", "remove", "--force", target.to_str().unwrap()],
    );
    restore_worktree(&snapshot, &target.join("new folder"))
        .await
        .unwrap();
    assert_eq!(
        fs::read(target.join(literal)).unwrap(),
        b"binary\0content\n"
    );
    assert_eq!(
        fs::read_to_string(target.join("README.md")).unwrap(),
        "working\n"
    );
    assert!(!target.join("deleted.txt").exists());
    assert!(!target.join("ignored-data").exists());
    fs::write(target.join("README.md"), "new local edits\n").unwrap();
    restore_worktree(&snapshot, &target).await.unwrap();
    assert_eq!(
        fs::read_to_string(target.join("README.md")).unwrap(),
        "new local edits\n"
    );
}

#[tokio::test]
async fn clean_snapshot_reuses_head_and_split_index_snapshot_keeps_user_index_bytes() {
    let (_temp, _source, root, target) = fixture().await;
    let head = run(&target, &["rev-parse", "HEAD"]);
    let clean = snapshot_worktree(&root, &target).await.unwrap();
    assert_eq!(clean.commit_sha, head);
    run(&target, &["update-index", "--split-index"]);
    let index = PathBuf::from(run(
        &target,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    ));
    let before = fs::read(&index).unwrap();
    fs::write(target.join("README.md"), "split working\n").unwrap();
    let snapshot = snapshot_worktree(&root, &target).await.unwrap();
    assert_eq!(fs::read(&index).unwrap(), before);
    assert_eq!(
        run(
            &target,
            &["show", &format!("{}:README.md", snapshot.snapshot_ref)]
        ),
        "split working"
    );
    assert_eq!(run(&target, &["rev-parse", "HEAD"]), head);
}

#[tokio::test]
async fn initialized_nested_repository_prevents_snapshot_without_touching_checkout() {
    let (_temp, _source, root, target) = fixture().await;
    let nested = target.join("nested");
    fs::create_dir(&nested).unwrap();
    run(&nested, &["init", "--template="]);
    fs::write(nested.join("local"), "keep").unwrap();
    let error = snapshot_worktree(&root, &target).await.unwrap_err();
    assert!(error.contains("嵌套 Git"));
    assert_eq!(fs::read_to_string(nested.join("local")).unwrap(), "keep");
}

#[tokio::test]
async fn unreadable_nested_git_path_does_not_become_a_successful_snapshot() {
    let (_temp, _source, root, target) = fixture().await;
    let head = run(&target, &["rev-parse", "HEAD"]);
    run(
        &target,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{head},blocked/child"),
        ],
    );
    // 中间路径是文件，stat应返回非NotFound错误，不能当成没有嵌套仓。
    fs::write(target.join("blocked"), "keep local data").unwrap();
    let error = snapshot_worktree(&root, &target).await.unwrap_err();
    assert!(error.contains("无法检查嵌套 Git"), "{error}");
    assert_eq!(
        fs::read_to_string(target.join("blocked")).unwrap(),
        "keep local data"
    );
}

#[tokio::test]
async fn restoration_refuses_occupied_paths_invalid_refs_and_cwd_escape() {
    let (_temp, source, root, target) = fixture().await;
    let snapshot = snapshot_worktree(&root, &target).await.unwrap();
    run(&source, &["worktree", "remove", target.to_str().unwrap()]);
    let mut tampered = snapshot.clone();
    tampered.snapshot_ref = "HEAD".into();
    assert!(restore_worktree(&tampered, &target).await.is_err());
    assert!(!target.exists());
    assert!(restore_worktree(&snapshot, &target.join("../escape"))
        .await
        .is_err());
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep"), "keep").unwrap();
    assert!(restore_worktree(&snapshot, &target).await.is_err());
    assert_eq!(fs::read_to_string(target.join("keep")).unwrap(), "keep");
    fs::remove_file(target.join("keep")).unwrap();
    fs::remove_dir(&target).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&source, &target).unwrap();
        assert!(restore_worktree(&snapshot, &target).await.is_err());
        assert!(source.join("README.md").exists());
    }
}
