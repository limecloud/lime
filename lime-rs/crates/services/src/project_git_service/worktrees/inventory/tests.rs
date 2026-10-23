use super::*;
use crate::project_git_service::{create_worktree, WorktreeOptions};
use std::process::Command;

#[test]
fn porcelain_paths_preserve_quotes_unicode_and_octal_without_accepting_invalid_escapes() {
    assert_eq!(
        decode_git_path(r#""/tmp/\"工作树\"\\file""#).unwrap(),
        PathBuf::from("/tmp/\"工作树\"\\file")
    );
    assert_eq!(
        decode_git_path(r#""/tmp/\303\251""#).unwrap(),
        PathBuf::from("/tmp/é")
    );
    assert!(decode_git_path(r#""/tmp/\377""#).is_err());
    assert!(decode_git_path(r#""/tmp/\q""#).is_err());
    assert!(decode_git_path(r#""/tmp/\3""#).is_err());
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repository(root: &Path) -> PathBuf {
    let repository = root.join("source");
    std::fs::create_dir(&repository).unwrap();
    git(
        &repository,
        &["init", "--template=", "--initial-branch=main"],
    );
    std::fs::write(repository.join(".gitignore"), "ignored-data\n").unwrap();
    git(&repository, &["add", ".gitignore"]);
    git(
        &repository,
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
    repository
}

async fn create(repository: &Path, root: &Path, name: &str) -> PathBuf {
    let result = create_worktree(
        repository.to_str().unwrap(),
        Some(name),
        Some("main"),
        &WorktreeOptions {
            root: root.to_path_buf(),
            refresh_upstream: false,
        },
    )
    .await
    .unwrap();
    PathBuf::from(result.worktree_path)
}

#[tokio::test]
async fn inventory_uses_registered_linked_checkouts_and_excludes_main_plain_and_forged_paths() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Managed \"工作树\"");
    assert!(list_worktrees(&root).await.unwrap().is_empty());
    assert!(!root.exists());
    let source = repository(temp.path());
    let first = create(&source, &root, "first").await;
    let second = create(&source, &root, "second").await;
    std::fs::create_dir(root.join("plain")).unwrap();
    let forged = root.join("forged");
    std::fs::create_dir(&forged).unwrap();
    std::fs::copy(first.join(".git"), forged.join(".git")).unwrap();
    let main = repository(&root);
    assert!(main.join(".git").is_dir());
    #[cfg(unix)]
    std::os::unix::fs::symlink(&first, root.join("alias")).unwrap();
    let listed = list_worktrees(&root).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].worktree_path, first);
    assert_eq!(listed[1].worktree_path, second);
    assert_eq!(
        listed[0].repository_root,
        std::fs::canonicalize(source).unwrap()
    );
    assert_eq!(listed[0].head_sha.len(), 40);
    assert_eq!(listed[0].branch, None);
    assert!(list_worktrees(Path::new("relative")).await.is_err());
}

#[tokio::test]
async fn targeted_removal_accepts_local_files_but_refuses_unmanaged_paths() {
    let temp = tempfile::tempdir().unwrap();
    let source = repository(temp.path());
    let root = temp.path().join("managed");
    let target = create(&source, &root, "target").await;
    for name in ["untracked", "ignored-data"] {
        let local = target.join(name);
        std::fs::write(&local, "Keep this data").unwrap();
        assert!(validate_worktree_removal(&root, &target).await.is_ok());
        assert_eq!(std::fs::read_to_string(&local).unwrap(), "Keep this data");
        std::fs::remove_file(&local).unwrap();
    }
    std::fs::write(target.join(".gitignore"), "changed\n").unwrap();
    assert!(validate_worktree_removal(&root, &target).await.is_ok());
    assert!(remove_worktree(&root, &source).await.is_err());
    let main = repository(&root);
    assert!(remove_worktree(&root, &main).await.is_err());
    #[cfg(unix)]
    {
        let alias = root.join("alias");
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        assert!(remove_worktree(&root, &alias).await.is_err());
        assert!(target.exists());
    }
    let removed = remove_worktree(&root, &target).await.unwrap();
    assert_eq!(removed.worktree_path, target);
    assert!(!target.exists());
    assert!(source.join(".git").exists());
    assert!(main.exists());
    assert!(list_worktrees(&root).await.unwrap().is_empty());
}
