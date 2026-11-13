//! Collect the working-tree diff for `/diff` without consulting repository helpers.
//!
//! Adapted from upstream `tui/src/get_git_diff.rs`, reduced to a local, bounded
//! command runner: external diff drivers, textconv filters and hooks are disabled
//! so an informational command cannot execute repository-selected programs.

use std::path::Path;
use std::time::Duration;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[cfg(windows)]
const DISABLE_HOOKS_CONFIG: &str = "core.hooksPath=NUL";
#[cfg(not(windows))]
const DISABLE_HOOKS_CONFIG: &str = "core.hooksPath=/dev/null";

#[cfg(windows)]
const NULL_PATH: &str = "NUL";
#[cfg(not(windows))]
const NULL_PATH: &str = "/dev/null";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DiffCollection {
    NotARepository,
    Clean,
    Diff(String),
}

pub(crate) async fn collect_git_diff(cwd: &Path) -> Result<DiffCollection, String> {
    if !inside_git_repo(cwd).await? {
        return Ok(DiffCollection::NotARepository);
    }
    let tracked = run_git_capture(
        cwd,
        &[
            "-c",
            DISABLE_HOOKS_CONFIG,
            "diff",
            "--no-textconv",
            "--no-ext-diff",
            "--submodule=short",
            "--ignore-submodules=dirty",
            "--no-color",
        ],
    )
    .await?;
    let untracked = run_git_capture(cwd, &["ls-files", "--others", "--exclude-standard"]).await?;

    let mut diff = tracked;
    for file in untracked
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let file_diff = run_git_capture_allow_diff_exit(
            cwd,
            &[
                "-c",
                DISABLE_HOOKS_CONFIG,
                "diff",
                "--no-textconv",
                "--no-ext-diff",
                "--submodule=short",
                "--ignore-submodules=dirty",
                "--no-color",
                "--no-index",
                "--",
                NULL_PATH,
                file,
            ],
        )
        .await?;
        diff.push_str(&file_diff);
    }

    if diff.trim().is_empty() {
        Ok(DiffCollection::Clean)
    } else {
        Ok(DiffCollection::Diff(diff))
    }
}

async fn inside_git_repo(cwd: &Path) -> Result<bool, String> {
    match run_git(cwd, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(output) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
        }
        Ok(_) => Ok(false),
        Err(error) if error.contains("failed to run") => Ok(false),
        Err(error) => Err(error),
    }
}

async fn run_git_capture(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run_git_capture_impl(cwd, args, false).await
}

async fn run_git_capture_allow_diff_exit(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run_git_capture_impl(cwd, args, true).await
}

async fn run_git_capture_impl(
    cwd: &Path,
    args: &[&str],
    allow_diff_exit: bool,
) -> Result<String, String> {
    let output = run_git(cwd, args).await?;
    let diff_exit = allow_diff_exit && output.status.code() == Some(1);
    if !output.status.success() && !diff_exit {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
    }
    let mut stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if stdout.len() > MAX_DIFF_BYTES {
        stdout.truncate(MAX_DIFF_BYTES);
        stdout.push_str("\n[diff truncated]\n");
    }
    Ok(stdout)
}

async fn run_git(cwd: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = tokio::process::Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .args(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null());
    match tokio::time::timeout(COMMAND_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("failed to run git: {error}")),
        Err(_) => Err("git diff timed out".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(cwd: &Path, args: &[&str]) -> bool {
        std::process::Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn non_repository_directory_reports_not_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            collect_git_diff(dir.path()).await.unwrap(),
            DiffCollection::NotARepository
        );
    }

    #[tokio::test]
    async fn tracked_and_untracked_changes_are_included() {
        if !git_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(git(root, &["init", "--quiet"]));
        std::fs::write(root.join("tracked.txt"), "before\n").unwrap();
        assert!(git(root, &["add", "tracked.txt"]));
        assert!(git(
            root,
            &[
                "-c",
                "user.email=gate@example.com",
                "-c",
                "user.name=Gate",
                "commit",
                "--quiet",
                "-m",
                "init"
            ]
        ));
        std::fs::write(root.join("tracked.txt"), "after\n").unwrap();
        std::fs::write(root.join("untracked.txt"), "new file\n").unwrap();

        let DiffCollection::Diff(diff) = collect_git_diff(root).await.unwrap() else {
            panic!("expected a diff");
        };
        assert!(diff.contains("tracked.txt"), "{diff}");
        assert!(diff.contains("untracked.txt"), "{diff}");
    }

    #[tokio::test]
    async fn clean_repository_reports_clean() {
        if !git_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(git(root, &["init", "--quiet"]));
        std::fs::write(root.join("tracked.txt"), "same\n").unwrap();
        assert!(git(root, &["add", "tracked.txt"]));
        assert!(git(
            root,
            &[
                "-c",
                "user.email=gate@example.com",
                "-c",
                "user.name=Gate",
                "commit",
                "--quiet",
                "-m",
                "init"
            ]
        ));
        assert_eq!(collect_git_diff(root).await.unwrap(), DiffCollection::Clean);
    }
}
