use app_server_protocol::protocol::v2::ProjectGitBlameResponse;
use app_server_protocol::protocol::v2::ProjectGitCommitResponse;
use app_server_protocol::protocol::v2::ProjectGitPullRequestCreateResponse;
use app_server_protocol::protocol::v2::ProjectGitPullRequestInfo;
use app_server_protocol::protocol::v2::ProjectGitPullRequestMergeMethod;
use app_server_protocol::protocol::v2::ProjectGitPullRequestMergeResponse;
use app_server_protocol::protocol::v2::ProjectGitPullRequestOpenResponse;
use app_server_protocol::protocol::v2::ProjectGitPullRequestStatusResponse;
use app_server_protocol::ProjectGitCommit;
use app_server_protocol::ProjectGitCommitListResponse;
use app_server_protocol::ProjectGitDiffResponse;
use app_server_protocol::ProjectGitStatusResponse;
use app_server_protocol::ProjectGitWorktreeCreateResponse;

pub(super) fn project_git_status_from_service(
    status: lime_services::project_git_service::ProjectGitStatus,
) -> ProjectGitStatusResponse {
    ProjectGitStatusResponse {
        root_path: status.root_path,
        repository_root: status.repository_root,
        has_git_repository: status.has_git_repository,
        is_worktree: status.is_worktree,
        local_environment_config_path: status.local_environment_config_path,
        current_branch: status.current_branch,
        branches: status.branches,
        uncommitted_file_count: status.uncommitted_file_count,
    }
}

pub(super) fn project_git_diff_from_service(
    diff: lime_services::project_git_service::ProjectGitDiff,
) -> ProjectGitDiffResponse {
    ProjectGitDiffResponse {
        root_path: diff.root_path,
        repository_root: diff.repository_root,
        has_git_repository: diff.has_git_repository,
        current_ref: diff.current_ref,
        comparison_base_ref: diff.comparison_base_ref,
        patch: diff.patch,
        uncommitted_file_count: diff.uncommitted_file_count,
    }
}

pub(super) fn project_git_commit_list_from_service(
    list: lime_services::project_git_service::ProjectGitCommitList,
) -> ProjectGitCommitListResponse {
    ProjectGitCommitListResponse {
        root_path: list.root_path,
        repository_root: list.repository_root,
        has_git_repository: list.has_git_repository,
        commits: list
            .commits
            .into_iter()
            .map(project_git_commit_from_service)
            .collect(),
    }
}

fn project_git_commit_from_service(
    commit: lime_services::project_git_service::ProjectGitCommit,
) -> ProjectGitCommit {
    ProjectGitCommit {
        sha: commit.sha,
        short_sha: commit.short_sha,
        subject: commit.subject,
        author_name: commit.author_name,
        author_email: commit.author_email,
        committed_at: commit.committed_at,
    }
}

pub(super) fn project_git_commit_result_from_service(
    result: lime_services::project_git_service::ProjectGitCommitResult,
) -> ProjectGitCommitResponse {
    ProjectGitCommitResponse {
        root_path: result.root_path,
        repository_root: result.repository_root,
        sha: result.sha,
        short_sha: result.short_sha,
        subject: result.subject,
        status: match result.status {
            lime_services::project_git_service::ProjectGitCommitStatus::Committed => {
                app_server_protocol::protocol::v2::ProjectGitCommitStatus::Committed
            }
        },
    }
}

pub(super) fn project_git_blame_from_service(
    blame: lime_services::project_git_service::ProjectGitBlame,
) -> ProjectGitBlameResponse {
    ProjectGitBlameResponse {
        root_path: blame.root_path,
        repository_root: blame.repository_root,
        lines: blame
            .lines
            .into_iter()
            .map(
                |line| app_server_protocol::protocol::v2::ProjectGitBlameLine {
                    line_number: line.line_number,
                    sha: line.sha,
                    short_sha: line.short_sha,
                    author: line.author,
                    author_time: line.author_time,
                    summary: line.summary,
                    content: line.content,
                },
            )
            .collect(),
    }
}

pub(super) fn project_git_worktree_from_service(
    worktree: lime_services::project_git_service::ProjectGitWorktree,
) -> ProjectGitWorktreeCreateResponse {
    ProjectGitWorktreeCreateResponse {
        worktree_path: worktree.worktree_path,
        branch: worktree.branch,
        status: project_git_status_from_service(worktree.status),
        setup_result: None,
        setup_error: None,
    }
}

pub(super) fn project_git_pull_request_create_from_service(
    result: lime_services::pull_request_service::CreatePullRequestResult,
) -> ProjectGitPullRequestCreateResponse {
    ProjectGitPullRequestCreateResponse {
        root_path: result.root_path,
        url: result.url,
        number: result.number,
        title: Some(result.title),
        draft: result.draft,
    }
}

pub(super) fn project_git_pull_request_open_from_service(
    result: lime_services::pull_request_service::OpenPullRequestResult,
) -> ProjectGitPullRequestOpenResponse {
    ProjectGitPullRequestOpenResponse {
        root_path: result.root_path,
        url: result.url,
    }
}

pub(super) fn project_git_pull_request_status_from_service(
    root_path: String,
    pull_request: Option<lime_services::pull_request_service::PullRequestInfo>,
) -> ProjectGitPullRequestStatusResponse {
    ProjectGitPullRequestStatusResponse {
        root_path,
        pull_request: pull_request.map(project_git_pull_request_info_from_service),
    }
}

pub(super) fn project_git_pull_request_merge_from_service(
    result: lime_services::pull_request_service::MergePullRequestResult,
) -> ProjectGitPullRequestMergeResponse {
    ProjectGitPullRequestMergeResponse {
        root_path: result.root_path,
        method: merge_method_from_service(result.method),
        delete_branch: result.delete_branch,
        merged: true,
        number: result.number,
        url: result.url,
    }
}

fn merge_method_from_service(
    method: lime_services::pull_request_service::MergeMethod,
) -> ProjectGitPullRequestMergeMethod {
    match method {
        lime_services::pull_request_service::MergeMethod::Merge => {
            ProjectGitPullRequestMergeMethod::Merge
        }
        lime_services::pull_request_service::MergeMethod::Squash => {
            ProjectGitPullRequestMergeMethod::Squash
        }
        lime_services::pull_request_service::MergeMethod::Rebase => {
            ProjectGitPullRequestMergeMethod::Rebase
        }
    }
}

fn project_git_pull_request_info_from_service(
    pull_request: lime_services::pull_request_service::PullRequestInfo,
) -> ProjectGitPullRequestInfo {
    ProjectGitPullRequestInfo {
        number: pull_request.number,
        url: pull_request.url,
        title: pull_request.title,
        state: pull_request.state,
        is_draft: pull_request.is_draft,
        base_ref_name: pull_request.base_ref_name,
        head_ref_name: pull_request.head_ref_name,
    }
}
