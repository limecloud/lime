//! project git request processor tests.

use super::super::*;
use app_server_protocol::protocol::v2::{
    METHOD_PROJECT_GIT_BLAME, METHOD_PROJECT_GIT_BRANCH_CREATE, METHOD_PROJECT_GIT_COMMIT,
    METHOD_PROJECT_GIT_PULL_REQUEST_CREATE, METHOD_PROJECT_GIT_PULL_REQUEST_MERGE,
    METHOD_PROJECT_GIT_PULL_REQUEST_OPEN, METHOD_PROJECT_GIT_PULL_REQUEST_STATUS,
};
use app_server_protocol::{
    ClientCapabilities, JsonRpcMessage, RequestId, METHOD_INITIALIZE, METHOD_INITIALIZED,
    METHOD_PROJECT_GIT_BRANCH_CREATE_V0, METHOD_PROJECT_GIT_STATUS,
};
use app_server_protocol::{ClientInfo, InitializeParams};
use serde_json::json;

#[tokio::test]
async fn project_git_status_requires_initialized_and_returns_local_mode_for_plain_directory() {
    let processor = RequestProcessor::new(RuntimeCore::default());
    let blocked = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(1),
            METHOD_PROJECT_GIT_STATUS,
            Some(json!({ "rootPath": "." })),
        ))
        .await
        .expect("blocked response");
    assert!(matches!(
        &blocked[0],
        JsonRpcMessage::Error(error) if error.error.code == error_codes::NOT_INITIALIZED
    ));

    processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_INITIALIZE,
            Some(
                serde_json::to_value(InitializeParams {
                    client_info: ClientInfo {
                        name: "test-client".to_string(),
                        title: None,
                        version: None,
                    },
                    capabilities: ClientCapabilities::default(),
                })
                .expect("initialize params"),
            ),
        ))
        .await
        .expect("initialize");
    processor.handle_notification(JsonRpcNotification::new(
        METHOD_INITIALIZED,
        Some(json!({})),
    ));

    let temp_dir = tempfile::tempdir().expect("temp dir");
    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(3),
            METHOD_PROJECT_GIT_STATUS,
            Some(json!({ "rootPath": temp_dir.path() })),
        ))
        .await
        .expect("project git status response");

    match &messages[0] {
        JsonRpcMessage::Response(response) => {
            assert_eq!(response.result["hasGitRepository"], false);
            assert_eq!(response.result["branches"], serde_json::json!([]));
            assert_eq!(response.result["uncommittedFileCount"], 0);
            assert!(response.result.get("currentBranch").is_none());
            assert!(response.result.get("repositoryRoot").is_none());
        }
        other => panic!("expected response, got {other:?}"),
    }
}

fn git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok()
}

fn run_git(root: &std::path::Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn init_repo() -> Option<(tempfile::TempDir, std::path::PathBuf)> {
    if !git_available() {
        return None;
    }
    let temp = tempfile::tempdir().expect("temp dir");
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(&repo).expect("create repo");
    run_git(&repo, &["init"]);
    run_git(&repo, &["config", "user.email", "test@example.com"]);
    run_git(&repo, &["config", "user.name", "Test User"]);
    std::fs::write(repo.join("README.md"), "hello").expect("write readme");
    run_git(&repo, &["add", "README.md"]);
    run_git(&repo, &["commit", "-m", "init"]);
    Some((temp, repo))
}

async fn initialized_processor() -> RequestProcessor {
    let processor = RequestProcessor::new(RuntimeCore::default());
    processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(1),
            METHOD_INITIALIZE,
            Some(
                serde_json::to_value(InitializeParams {
                    client_info: ClientInfo {
                        name: "test-client".to_string(),
                        title: None,
                        version: None,
                    },
                    capabilities: ClientCapabilities::default(),
                })
                .expect("initialize params"),
            ),
        ))
        .await
        .expect("initialize");
    processor.handle_notification(JsonRpcNotification::new(
        METHOD_INITIALIZED,
        Some(json!({})),
    ));
    processor
}

#[tokio::test]
async fn project_git_commit_creates_commit_and_rejects_follow_up_states() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    let processor = initialized_processor().await;
    std::fs::write(repo.join("README.md"), "hello\nworld\n").expect("write readme");
    std::fs::write(repo.join("new.txt"), "new\n").expect("write new");
    let parent = run_git(&repo, &["rev-parse", "HEAD"]);

    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_PROJECT_GIT_COMMIT,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "message": "  feat: commit through app server  ",
            })),
        ))
        .await
        .expect("commit response");

    let result = match &messages[0] {
        JsonRpcMessage::Response(response) => &response.result,
        other => panic!("expected response, got {other:?}"),
    };
    let sha = result["sha"].as_str().expect("sha");
    assert!(!sha.is_empty());
    let short_sha = result["shortSha"].as_str().expect("short sha");
    assert!(!short_sha.is_empty());
    assert!(sha.starts_with(short_sha));
    assert_eq!(result["subject"], "feat: commit through app server");
    assert_eq!(result["status"], "committed");
    assert_eq!(run_git(&repo, &["rev-parse", "HEAD"]), sha);
    assert_eq!(run_git(&repo, &["rev-parse", "HEAD^"]), parent);
    assert_eq!(run_git(&repo, &["status", "--porcelain"]), "");

    let no_changes = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(3),
            METHOD_PROJECT_GIT_COMMIT,
            Some(json!({"rootPath": repo.to_string_lossy(), "message": "again"})),
        ))
        .await
        .expect("no changes response");
    assert!(matches!(
        &no_changes[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::RUNTIME_ERROR
                && error.error.message.contains("没有可提交的更改")
    ));

    let empty_message = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(4),
            METHOD_PROJECT_GIT_COMMIT,
            Some(json!({"rootPath": repo.to_string_lossy(), "message": "   "})),
        ))
        .await
        .expect("empty message response");
    assert!(matches!(
        &empty_message[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::INVALID_REQUEST
                && error.error.message.contains("提交信息不能为空")
    ));
}

#[tokio::test]
async fn project_git_commit_rejects_missing_repository() {
    let processor = initialized_processor().await;
    let temp_dir = tempfile::tempdir().expect("temp dir");

    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_PROJECT_GIT_COMMIT,
            Some(json!({
                "rootPath": temp_dir.path().to_string_lossy(),
                "message": "feat: nope",
            })),
        ))
        .await
        .expect("missing repo response");

    assert!(matches!(
        &messages[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::RUNTIME_ERROR
                && error.error.message.contains("Git 仓库")
    ));
    assert!(!temp_dir.path().join(".git").exists());
}

#[tokio::test]
async fn project_git_branch_create_switches_to_new_branch_and_keeps_v0_compat() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    let processor = initialized_processor().await;

    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_PROJECT_GIT_BRANCH_CREATE,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "branch": "  feature/app-server  ",
            })),
        ))
        .await
        .expect("branch create response");

    let result = match &messages[0] {
        JsonRpcMessage::Response(response) => &response.result,
        other => panic!("expected response, got {other:?}"),
    };
    assert_eq!(result["currentBranch"], "feature/app-server");
    assert_eq!(result["hasGitRepository"], true);
    assert!(result["branches"]
        .as_array()
        .expect("branches")
        .iter()
        .any(|branch| branch == "feature/app-server"));
    assert_eq!(
        run_git(&repo, &["branch", "--show-current"]),
        "feature/app-server"
    );

    let v0 = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(3),
            METHOD_PROJECT_GIT_BRANCH_CREATE_V0,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "branch": "feature/legacy-call",
            })),
        ))
        .await
        .expect("v0 branch create response");
    match &v0[0] {
        JsonRpcMessage::Response(response) => {
            assert_eq!(response.result["currentBranch"], "feature/legacy-call");
        }
        other => panic!("expected v0 response, got {other:?}"),
    }
}

#[tokio::test]
async fn project_git_branch_create_rejects_invalid_names_before_mutating() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    let processor = initialized_processor().await;
    let before = run_git(&repo, &["branch", "--show-current"]);

    for (index, branch) in [
        String::new(),
        "   ".to_string(),
        "-leading".to_string(),
        "bad name".to_string(),
        "bad..name".to_string(),
        format!("bad{}name", '\u{7f}'),
        "a".repeat(201),
    ]
    .into_iter()
    .enumerate()
    {
        let messages = processor
            .handle_request(JsonRpcRequest::new(
                RequestId::Integer(10 + index as i64),
                METHOD_PROJECT_GIT_BRANCH_CREATE,
                Some(json!({
                    "rootPath": repo.to_string_lossy(),
                    "branch": branch,
                })),
            ))
            .await
            .expect("invalid branch response");
        assert!(
            matches!(
                &messages[0],
                JsonRpcMessage::Error(error)
                    if error.error.code == error_codes::INVALID_REQUEST
            ),
            "branch {branch:?} must be rejected"
        );
    }

    assert_eq!(run_git(&repo, &["branch", "--show-current"]), before);
}

#[tokio::test]
async fn project_git_branch_create_rejects_existing_branch_and_missing_repository() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    let processor = initialized_processor().await;
    let current = run_git(&repo, &["branch", "--show-current"]);

    let existing = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_PROJECT_GIT_BRANCH_CREATE,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "branch": current,
            })),
        ))
        .await
        .expect("existing branch response");
    assert!(matches!(
        &existing[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::RUNTIME_ERROR
                && error.error.message.contains("分支已存在")
    ));

    let temp_dir = tempfile::tempdir().expect("temp dir");
    let missing = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(3),
            METHOD_PROJECT_GIT_BRANCH_CREATE,
            Some(json!({
                "rootPath": temp_dir.path().to_string_lossy(),
                "branch": "feature/nope",
            })),
        ))
        .await
        .expect("missing repo response");
    assert!(matches!(
        &missing[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::RUNTIME_ERROR
                && error.error.message.contains("Git 仓库")
    ));
    assert!(!temp_dir.path().join(".git").exists());
}

#[tokio::test]
async fn project_git_pull_request_create_rejects_invalid_input_before_gh() {
    let processor = initialized_processor().await;
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path().to_string_lossy().to_string();
    let not_a_directory = temp_dir.path().join("file.txt");
    std::fs::write(&not_a_directory, "not a directory").expect("write file");

    let cases = vec![
        json!({"rootPath": root, "title": "   ", "body": "body"}),
        json!({"rootPath": root, "title": "bad\nline", "body": "body"}),
        json!({"rootPath": root, "title": "bad\u{7f}line", "body": "body"}),
        json!({"rootPath": root, "title": "a".repeat(257), "body": "body"}),
        json!({"rootPath": root, "title": "title", "body": "a".repeat(65_537)}),
        json!({"rootPath": root, "title": "title", "body": "body", "base": "-leading"}),
        json!({"rootPath": root, "title": "title", "body": "body", "base": "bad name"}),
        json!({"rootPath": "", "title": "title", "body": "body"}),
        json!({"rootPath": not_a_directory, "title": "title", "body": "body"}),
    ];

    for (index, params) in cases.into_iter().enumerate() {
        let messages = processor
            .handle_request(JsonRpcRequest::new(
                RequestId::Integer(100 + index as i64),
                METHOD_PROJECT_GIT_PULL_REQUEST_CREATE,
                Some(params),
            ))
            .await
            .expect("invalid pull request create response");
        assert!(
            matches!(
                &messages[0],
                JsonRpcMessage::Error(error) if error.error.code == error_codes::INVALID_REQUEST
            ),
            "case {index} must be rejected before starting gh"
        );
    }
}

#[tokio::test]
async fn project_git_pull_request_merge_rejects_invalid_input_before_gh() {
    let processor = initialized_processor().await;
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path().to_string_lossy().to_string();
    let cases = vec![
        json!({"rootPath": root, "method": "octopus"}),
        json!({"rootPath": root, "prNumber": 0}),
        json!({"rootPath": root, "prNumber": -1}),
        json!({"rootPath": root, "prNumber": 1.5}),
        json!({"rootPath": root, "unknownField": true}),
        json!({"rootPath": "", "method": "squash"}),
        json!({"rootPath": "/definitely/not/a/real/lime/workspace"}),
    ];

    for (index, params) in cases.into_iter().enumerate() {
        let messages = processor
            .handle_request(JsonRpcRequest::new(
                RequestId::Integer(300 + index as i64),
                METHOD_PROJECT_GIT_PULL_REQUEST_MERGE,
                Some(params),
            ))
            .await
            .expect("invalid pull request merge response");
        assert!(
            matches!(
                &messages[0],
                JsonRpcMessage::Error(error) if error.error.code == error_codes::INVALID_REQUEST
            ),
            "case {index} must be rejected before starting gh"
        );
    }
}

#[tokio::test]
async fn project_git_pull_request_open_and_status_reject_missing_root_before_gh() {
    let processor = initialized_processor().await;
    for (index, method) in [
        METHOD_PROJECT_GIT_PULL_REQUEST_OPEN,
        METHOD_PROJECT_GIT_PULL_REQUEST_STATUS,
    ]
    .into_iter()
    .enumerate()
    {
        let messages = processor
            .handle_request(JsonRpcRequest::new(
                RequestId::Integer(200 + index as i64),
                method,
                Some(json!({"rootPath": "/definitely/not/a/real/lime/workspace"})),
            ))
            .await
            .expect("invalid pull request root response");
        assert!(
            matches!(
                &messages[0],
                JsonRpcMessage::Error(error) if error.error.code == error_codes::INVALID_REQUEST
            ),
            "{method} must reject a missing root before starting gh"
        );
    }
}

#[tokio::test]
async fn project_git_blame_returns_lines_and_rejects_unsafe_paths() {
    let Some((_temp, repo)) = init_repo() else {
        return;
    };
    std::fs::write(repo.join("README.md"), "hello\nworld\n").expect("write readme");
    run_git(&repo, &["add", "README.md"]);
    run_git(&repo, &["commit", "-m", "blame fixture"]);
    let processor = initialized_processor().await;

    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_PROJECT_GIT_BLAME,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "path": "README.md",
            })),
        ))
        .await
        .expect("blame response");

    let result = match &messages[0] {
        JsonRpcMessage::Response(response) => &response.result,
        other => panic!("expected response, got {other:?}"),
    };
    let lines = result["lines"].as_array().expect("blame lines");
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["lineNumber"], 1);
    assert_eq!(lines[0]["author"], "Test User");
    assert_eq!(lines[0]["summary"], "blame fixture");
    assert_eq!(lines[0]["content"], "hello");
    assert!(lines[0]["shortSha"]
        .as_str()
        .is_some_and(|short| lines[0]["sha"]
            .as_str()
            .unwrap_or_default()
            .starts_with(short)));

    let unsafe_path = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(3),
            METHOD_PROJECT_GIT_BLAME,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "path": "../README.md",
            })),
        ))
        .await
        .expect("unsafe path response");
    assert!(matches!(
        &unsafe_path[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::INVALID_REQUEST
                && error.error.message.contains("文件路径格式无效")
    ));

    std::fs::write(repo.join("untracked.txt"), "untracked\n").expect("write untracked");
    let untracked = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(4),
            METHOD_PROJECT_GIT_BLAME,
            Some(json!({
                "rootPath": repo.to_string_lossy(),
                "path": "untracked.txt",
            })),
        ))
        .await
        .expect("untracked response");
    assert!(matches!(
        &untracked[0],
        JsonRpcMessage::Error(error)
            if error.error.code == error_codes::RUNTIME_ERROR
                && error.error.message.contains("未纳入 Git 跟踪")
    ));
}
