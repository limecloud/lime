use super::*;
use crate::project_git_service::save_local_environment_config_path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) {
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
}

#[tokio::test]
async fn status_reads_worktree_selection_without_inheriting_source_or_sibling() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    std::fs::create_dir(&source).unwrap();
    git(&source, &["init", "--template=", "--initial-branch=main"]);
    git(
        &source,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    );
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    git(
        &source,
        &["worktree", "add", "--detach", first.to_str().unwrap()],
    );
    git(
        &source,
        &["worktree", "add", "--detach", second.to_str().unwrap()],
    );
    let config = first
        .join(".codex/environments/environment.toml")
        .to_string_lossy()
        .into_owned();
    save_local_environment_config_path(&source, Some("/source-only.toml"))
        .await
        .unwrap();
    save_local_environment_config_path(&first, Some(&config))
        .await
        .unwrap();
    save_local_environment_config_path(&second, None)
        .await
        .unwrap();
    let source_status = read_status(source.to_str().unwrap()).await.unwrap();
    assert!(!source_status.is_worktree);
    assert_eq!(source_status.local_environment_config_path, None);
    let subdirectory = first.join("packages/app");
    std::fs::create_dir_all(&subdirectory).unwrap();
    let first_status = read_status(subdirectory.to_str().unwrap()).await.unwrap();
    assert!(first_status.is_worktree);
    assert_eq!(
        first_status.local_environment_config_path.as_deref(),
        Some(config.as_str())
    );
    assert_eq!(
        std::fs::canonicalize(first_status.repository_root.unwrap()).unwrap(),
        std::fs::canonicalize(&first).unwrap()
    );
    let second_status = read_status(second.to_str().unwrap()).await.unwrap();
    assert!(second_status.is_worktree);
    assert_eq!(second_status.local_environment_config_path, None);
    save_local_environment_config_path(&first, None)
        .await
        .unwrap();
    assert_eq!(
        read_status(first.to_str().unwrap())
            .await
            .unwrap()
            .local_environment_config_path,
        None
    );
}

#[tokio::test]
async fn non_repository_has_no_worktree_selection() {
    let temp = tempfile::tempdir().unwrap();
    let status = read_status(temp.path().to_str().unwrap()).await.unwrap();
    assert!(!status.has_git_repository);
    assert!(!status.is_worktree);
    assert_eq!(status.local_environment_config_path, None);
}
