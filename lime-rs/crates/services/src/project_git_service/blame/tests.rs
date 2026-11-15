use super::*;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tempfile::TempDir;

fn git_available() -> bool {
    Command::new("git").arg("--version").output().is_ok()
}

fn run_git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_AUTHOR_DATE", "2020-01-02T03:04:05+00:00")
        .env("GIT_COMMITTER_DATE", "2020-01-02T03:04:05+00:00")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_repo() -> Option<(TempDir, PathBuf)> {
    if !git_available() {
        return None;
    }
    let temp = TempDir::new().expect("temp dir");
    let repo = temp.path().join("repo");
    fs::create_dir_all(&repo).expect("create repo");
    run_git(&repo, &["init", "--initial-branch=main"]);
    run_git(&repo, &["config", "user.email", "fixture@example.com"]);
    run_git(&repo, &["config", "user.name", "Blame Fixture"]);
    Some((temp, repo))
}

#[test]
fn validate_blame_path_rejects_escape_and_control_paths() {
    for invalid in [
        "",
        "   ",
        "/etc/passwd",
        "\\\\server\\share\\file.txt",
        "C:\\repo\\file.txt",
        "C:file.txt",
        "~/.ssh/config",
        "../secret.txt",
        "src/../secret.txt",
        ".git/config",
        "src/.git/config",
        "src/.GIT/config",
        "src//main.rs",
        "src/main.rs/",
        "src/main\n.rs",
        "src/main\u{7f}.rs",
    ] {
        assert!(
            validate_blame_path(invalid).is_err(),
            "expected `{invalid}` to be rejected"
        );
    }

    assert_eq!(
        validate_blame_path(" src\\nested\\main.rs ").expect("relative path"),
        "src/nested/main.rs"
    );
    assert_eq!(
        validate_blame_path("-dash file.txt").expect("dash path"),
        "-dash file.txt"
    );
}

#[test]
fn parse_line_porcelain_reads_metadata_and_tab_content() {
    let first_sha = "1".repeat(40);
    let second_sha = "2".repeat(40);
    let output = format!(
        "{first_sha} 1 1 2\n\
         author First Author\n\
         author-mail <first@example.com>\n\
         author-time 1577934245\n\
         author-tz +0000\n\
         committer First Author\n\
         committer-mail <first@example.com>\n\
         committer-time 1577934245\n\
         committer-tz +0000\n\
         summary initial summary\n\
         boundary\n\
         filename src/main.rs\n\
         \tfn main() {{\n\
         {second_sha} 2 2 1\n\
         author Second Author\n\
         author-mail <second@example.com>\n\
         author-time 1577934245\n\
         author-tz +0000\n\
         committer Second Author\n\
         committer-mail <second@example.com>\n\
         committer-time 1577934245\n\
         committer-tz +0000\n\
         summary second summary\n\
         previous {first_sha} src/main.rs\n\
         filename src/main.rs\n\
         \t}}\n"
    );

    let lines = parse_line_porcelain(&output).expect("parse blame");
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].line_number, 1);
    assert_eq!(lines[0].sha, first_sha);
    assert_eq!(lines[0].short_sha, "1111111");
    assert_eq!(lines[0].author, "First Author");
    assert_eq!(lines[0].author_time, "2020-01-02T03:04:05Z");
    assert_eq!(lines[0].summary, "initial summary");
    assert_eq!(lines[0].content, "fn main() {");
    assert_eq!(lines[1].line_number, 2);
    assert_eq!(lines[1].author, "Second Author");
    assert_eq!(lines[1].summary, "second summary");
    assert_eq!(lines[1].content, "}");
}

#[test]
fn parse_line_porcelain_rejects_truncated_output() {
    let sha = "a".repeat(40);
    let error = parse_line_porcelain(&format!("{sha} 1 1 1\nauthor Incomplete\n"))
        .expect_err("truncated porcelain must fail");
    assert!(error.contains("输出不完整"), "unexpected error: {error}");
}

#[tokio::test]
async fn blame_reads_real_repository_history() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    let path = repo.join("note.txt");
    fs::write(&path, "alpha\nbeta\n").expect("write first version");
    run_git(&repo, &["add", "note.txt"]);
    run_git(&repo, &["commit", "-m", "initial commit"]);

    fs::write(&path, "alpha\ngamma\n").expect("write second version");
    run_git(&repo, &["add", "note.txt"]);
    run_git(
        &repo,
        &[
            "commit",
            "--author",
            "Second Author <second@example.com>",
            "-m",
            "second commit",
        ],
    );

    let blame = read_blame(repo.to_str().unwrap(), "note.txt")
        .await
        .expect("read blame");

    assert_eq!(blame.lines.len(), 2);
    assert_eq!(blame.lines[0].line_number, 1);
    assert_eq!(blame.lines[0].author, "Blame Fixture");
    assert_eq!(blame.lines[0].summary, "initial commit");
    assert_eq!(blame.lines[0].content, "alpha");
    assert_eq!(blame.lines[1].line_number, 2);
    assert_eq!(blame.lines[1].author, "Second Author");
    assert_eq!(blame.lines[1].summary, "second commit");
    assert_eq!(blame.lines[1].content, "gamma");
    assert!(blame.lines[1].sha.starts_with(&blame.lines[1].short_sha));
    assert_ne!(blame.lines[0].sha, blame.lines[1].sha);
    assert_eq!(
        blame.lines[0].author_time,
        "2020-01-02T03:04:05Z".to_string()
    );
}

#[tokio::test]
async fn blame_fails_cleanly_for_missing_untracked_binary_and_non_repository() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    fs::write(repo.join("tracked.txt"), "tracked\n").expect("write tracked");
    run_git(&repo, &["add", "tracked.txt"]);
    run_git(&repo, &["commit", "-m", "tracked"]);

    let missing = read_blame(repo.to_str().unwrap(), "missing.txt")
        .await
        .expect_err("missing file");
    assert!(missing.contains("文件不存在"), "unexpected: {missing}");

    fs::write(repo.join("untracked.txt"), "untracked\n").expect("write untracked");
    let untracked = read_blame(repo.to_str().unwrap(), "untracked.txt")
        .await
        .expect_err("untracked file");
    assert!(
        untracked.contains("未纳入 Git 跟踪"),
        "unexpected: {untracked}"
    );

    fs::write(repo.join("binary.dat"), [0u8, 1, 2, 3]).expect("write binary");
    run_git(&repo, &["add", "binary.dat"]);
    run_git(&repo, &["commit", "-m", "binary"]);
    let binary = read_blame(repo.to_str().unwrap(), "binary.dat")
        .await
        .expect_err("binary file");
    assert!(binary.contains("二进制文件"), "unexpected: {binary}");

    let absolute = read_blame(repo.to_str().unwrap(), "/etc/passwd")
        .await
        .expect_err("absolute path");
    assert!(absolute.contains("相对路径"), "unexpected: {absolute}");

    let plain = tempfile::tempdir().expect("plain temp dir");
    let non_repository = read_blame(plain.path().to_str().unwrap(), "file.txt")
        .await
        .expect_err("non repository");
    assert!(
        non_repository.contains("Git 仓库"),
        "unexpected: {non_repository}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn blame_uses_explicit_argv_without_shell_splitting() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().expect("temp dir");
    let root = temp.path().join("repo with space");
    fs::create_dir_all(&root).expect("create root");
    let path = "-dash file.txt";
    fs::write(root.join(path), "alpha\n").expect("write file");

    let args_log = temp.path().join("args.log");
    let cwd_log = temp.path().join("cwd.log");
    let fixture_path = temp.path().join("porcelain.txt");
    let first_sha = "3".repeat(40);
    fs::write(
        &fixture_path,
        format!(
            "{first_sha} 1 1 1\n\
             author Fake Author\n\
             author-time 1577934245\n\
             summary fake summary\n\
             filename {path}\n\
             \talpha\n"
        ),
    )
    .expect("write fixture");

    let script_path = temp.path().join("fake-git");
    fs::write(
        &script_path,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\npwd > '{}'\ncat '{}'\n",
            args_log.to_string_lossy(),
            cwd_log.to_string_lossy(),
            fixture_path.to_string_lossy()
        ),
    )
    .expect("write fake git");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script_path, permissions).expect("chmod fake git");

    let lines = run_blame(&script_path, &root, path, Duration::from_secs(5))
        .await
        .expect("fake git blame");

    assert_eq!(
        fs::read_to_string(&args_log).expect("args log"),
        format!("blame\n--line-porcelain\n--\n{path}\n")
    );
    let recorded_cwd = fs::read_to_string(&cwd_log).expect("cwd log");
    assert_eq!(
        fs::canonicalize(recorded_cwd.trim()).expect("recorded cwd"),
        fs::canonicalize(&root).expect("root")
    );
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].author, "Fake Author");
    assert_eq!(lines[0].summary, "fake summary");
    assert_eq!(lines[0].content, "alpha");
}

#[cfg(unix)]
#[tokio::test]
async fn blame_bounds_a_stuck_git_process_with_its_timeout() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().expect("temp dir");
    let script_path = temp.path().join("stuck-git");
    fs::write(&script_path, "#!/bin/sh\nsleep 5\n").expect("write stuck git");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&script_path, permissions).expect("chmod stuck git");

    let error = run_blame(
        &script_path,
        temp.path(),
        "file.txt",
        Duration::from_millis(50),
    )
    .await
    .expect_err("blame should time out");

    assert!(error.contains("超时"), "unexpected error: {error}");
}
