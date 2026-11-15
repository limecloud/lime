use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 在当前工作区创建并切换到一个新分支。
///
/// 分支名会 trim；拒绝空值、超过 200 个字符、空白/控制字符、`..` 和 `-` 开头。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitBranchCreateParams {
    pub root_path: String,
    pub branch: String,
}

/// 创建分支后返回最新的仓库状态。
pub type ProjectGitBranchCreateResponse = crate::ProjectGitStatusResponse;

/// 创建一次新的本地 Git 提交。
///
/// `paths` 省略时先 `git add -A` 再提交全部暂存内容；指定时只暂存并提交这些仓库内相对路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitCommitParams {
    pub root_path: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProjectGitCommitStatus {
    Committed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub status: ProjectGitCommitStatus,
}

/// 通过已安装的 `gh` CLI 在当前工作区创建 Pull Request。
///
/// `title` 会 trim；拒绝空值、超过 256 个字符、控制字符；`body` 最多 65536 字节；
/// `base` 可选，空字符串等同省略。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitPullRequestCreateParams {
    pub root_path: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
}

/// 创建成功后返回 `gh` 输出中可解析的 PR 元数据。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitPullRequestCreateResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub draft: bool,
}

/// 用系统浏览器打开当前分支的 Pull Request。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitPullRequestOpenParams {
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitPullRequestOpenResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// 读取当前分支关联 Pull Request 的状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitPullRequestStatusParams {
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitPullRequestStatusResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<ProjectGitPullRequestInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitPullRequestInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub state: String,
    pub is_draft: bool,
    pub base_ref_name: String,
    pub head_ref_name: String,
}

/// `gh pr merge` 支持的合并方式。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProjectGitPullRequestMergeMethod {
    #[default]
    Merge,
    Squash,
    Rebase,
}

/// 合并当前分支关联的 Pull Request，或按编号合并指定 PR。
///
/// `method` 省略时使用 merge commit；`prNumber` 省略时由 `gh` 解析当前分支的 PR，
/// `deleteBranch` 为 true 时同时删除远端与本地分支。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitPullRequestMergeParams {
    pub root_path: String,
    #[serde(default)]
    pub method: ProjectGitPullRequestMergeMethod,
    #[serde(default)]
    pub delete_branch: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitPullRequestMergeResponse {
    pub root_path: String,
    pub method: ProjectGitPullRequestMergeMethod,
    pub delete_branch: bool,
    pub merged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// 读取仓库内单个文件的逐行 blame。
///
/// `path` 是相对 `rootPath` 的文件路径；拒绝绝对路径、`..`、`.git` 和控制字符。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitBlameParams {
    pub root_path: String,
    pub path: String,
}

/// 文件中的一行及其最近一次提交信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBlameLine {
    pub line_number: u32,
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_time: String,
    pub summary: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBlameResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub lines: Vec<ProjectGitBlameLine>,
}

#[cfg(test)]
mod tests {
    use super::{
        ProjectGitBlameLine, ProjectGitBlameResponse, ProjectGitPullRequestCreateResponse,
        ProjectGitPullRequestMergeMethod, ProjectGitPullRequestMergeResponse,
    };
    use crate::protocol::v2::{ClientRequest, ClientResponsePayload, Method};
    use crate::RequestId;
    use serde_json::json;

    #[test]
    fn project_git_branch_create_round_trips_v2_request_and_response() {
        let request = json!({
            "id": 7,
            "method": "project/git/branch/create",
            "params": {"rootPath": "/repo", "branch": "feature/demo"}
        });
        let decoded: ClientRequest =
            serde_json::from_value(request.clone()).expect("decode branch create request");
        assert_eq!(decoded.method(), Method::ProjectGitBranchCreate);
        assert_eq!(serde_json::to_value(decoded).unwrap(), request);

        let response =
            ClientResponsePayload::ProjectGitBranchCreate(crate::ProjectGitStatusResponse {
                root_path: "/repo".to_string(),
                repository_root: Some("/repo".to_string()),
                has_git_repository: true,
                is_worktree: false,
                local_environment_config_path: None,
                current_branch: Some("feature/demo".to_string()),
                branches: vec!["feature/demo".to_string(), "main".to_string()],
                uncommitted_file_count: 0,
            });
        assert_eq!(response.method(), Method::ProjectGitBranchCreate);
        let wire = response
            .into_response(RequestId::Integer(7))
            .expect("branch create response wire");
        assert_eq!(
            serde_json::to_value(wire).unwrap()["result"]["currentBranch"],
            "feature/demo"
        );
    }

    #[test]
    fn project_git_pull_request_round_trips_v2_requests_and_responses() {
        let create = json!({
            "id": 8,
            "method": "project/git/pull_request/create",
            "params": {
                "rootPath": "/repo",
                "title": "feat: demo",
                "body": "Body",
                "draft": true,
                "base": "main"
            }
        });
        let decoded: ClientRequest =
            serde_json::from_value(create.clone()).expect("decode pull request create");
        assert_eq!(decoded.method(), Method::ProjectGitPullRequestCreate);
        assert_eq!(serde_json::to_value(decoded).unwrap(), create);

        let open = json!({
            "id": 9,
            "method": "project/git/pull_request/open",
            "params": {"rootPath": "/repo"}
        });
        let decoded: ClientRequest =
            serde_json::from_value(open.clone()).expect("decode pull request open");
        assert_eq!(decoded.method(), Method::ProjectGitPullRequestOpen);
        assert_eq!(serde_json::to_value(decoded).unwrap(), open);

        let status = json!({
            "id": 10,
            "method": "project/git/pull_request/status",
            "params": {"rootPath": "/repo"}
        });
        let decoded: ClientRequest =
            serde_json::from_value(status.clone()).expect("decode pull request status");
        assert_eq!(decoded.method(), Method::ProjectGitPullRequestStatus);
        assert_eq!(serde_json::to_value(decoded).unwrap(), status);

        let response = ClientResponsePayload::ProjectGitPullRequestCreate(
            ProjectGitPullRequestCreateResponse {
                root_path: "/repo".to_string(),
                url: Some("https://github.com/example/repo/pull/42".to_string()),
                number: Some(42),
                title: Some("feat: demo".to_string()),
                draft: true,
            },
        );
        assert_eq!(response.method(), Method::ProjectGitPullRequestCreate);
        let wire = response
            .into_response(RequestId::Integer(8))
            .expect("pull request create response wire");
        let wire = serde_json::to_value(wire).unwrap();
        assert_eq!(
            wire["result"]["url"],
            "https://github.com/example/repo/pull/42"
        );
        assert_eq!(wire["result"]["number"], 42);
    }

    #[test]
    fn project_git_pull_request_merge_round_trips_v2_request_and_response() {
        let request = json!({
            "id": 11,
            "method": "project/git/pull_request/merge",
            "params": {
                "rootPath": "/repo",
                "method": "squash",
                "deleteBranch": true,
                "prNumber": 42
            }
        });
        let decoded: ClientRequest =
            serde_json::from_value(request.clone()).expect("decode pull request merge");
        assert_eq!(decoded.method(), Method::ProjectGitPullRequestMerge);
        assert_eq!(serde_json::to_value(decoded).unwrap(), request);

        let defaulted = json!({
            "id": 12,
            "method": "project/git/pull_request/merge",
            "params": {"rootPath": "/repo"}
        });
        let decoded: ClientRequest =
            serde_json::from_value(defaulted).expect("decode default merge");
        assert_eq!(decoded.method(), Method::ProjectGitPullRequestMerge);
        let defaulted = serde_json::to_value(decoded).unwrap();
        assert_eq!(defaulted["params"]["method"], "merge");
        assert_eq!(defaulted["params"]["deleteBranch"], false);
        assert!(defaulted["params"].get("prNumber").is_none());

        let response =
            ClientResponsePayload::ProjectGitPullRequestMerge(ProjectGitPullRequestMergeResponse {
                root_path: "/repo".to_string(),
                method: ProjectGitPullRequestMergeMethod::Rebase,
                delete_branch: true,
                merged: true,
                number: Some(42),
                url: Some("https://github.com/example/repo/pull/42".to_string()),
            });
        assert_eq!(response.method(), Method::ProjectGitPullRequestMerge);
        let wire = response
            .into_response(RequestId::Integer(11))
            .expect("pull request merge response wire");
        let wire = serde_json::to_value(wire).unwrap();
        assert_eq!(wire["result"]["method"], "rebase");
        assert_eq!(wire["result"]["deleteBranch"], true);
        assert_eq!(wire["result"]["merged"], true);
        assert_eq!(wire["result"]["number"], 42);
    }

    #[test]
    fn project_git_pull_request_merge_rejects_unknown_method() {
        let request = json!({
            "id": 13,
            "method": "project/git/pull_request/merge",
            "params": {"rootPath": "/repo", "method": "octopus"}
        });
        assert!(serde_json::from_value::<ClientRequest>(request).is_err());
    }

    #[test]
    fn project_git_blame_round_trips_v2_request_and_response() {
        let request = json!({
            "id": 14,
            "method": "project/git/blame",
            "params": {"rootPath": "/repo", "path": "src/main.rs"}
        });
        let decoded: ClientRequest =
            serde_json::from_value(request.clone()).expect("decode blame request");
        assert_eq!(decoded.method(), Method::ProjectGitBlame);
        assert_eq!(serde_json::to_value(decoded).unwrap(), request);

        let response = ClientResponsePayload::ProjectGitBlame(ProjectGitBlameResponse {
            root_path: "/repo".to_string(),
            repository_root: Some("/repo".to_string()),
            lines: vec![ProjectGitBlameLine {
                line_number: 7,
                sha: "0123456789abcdef0123456789abcdef01234567".to_string(),
                short_sha: "0123456".to_string(),
                author: "Fixture".to_string(),
                author_time: "2020-01-02T03:04:05Z".to_string(),
                summary: "feat: fixture".to_string(),
                content: "fn main() {}".to_string(),
            }],
        });
        assert_eq!(response.method(), Method::ProjectGitBlame);
        let wire = response
            .into_response(RequestId::Integer(14))
            .expect("blame response wire");
        let wire = serde_json::to_value(wire).unwrap();
        assert_eq!(wire["result"]["lines"][0]["lineNumber"], 7);
        assert_eq!(wire["result"]["lines"][0]["shortSha"], "0123456");
        assert_eq!(wire["result"]["lines"][0]["summary"], "feat: fixture");
        assert_eq!(wire["result"]["lines"][0]["content"], "fn main() {}");
    }
}
