//! GitHub Pull Request 命令边界：只通过 argv 调用 `gh`，不经过 shell。
//!
//! 该服务只负责本机 GitHub CLI 的输入校验、进程执行与输出解析；仓库归属、
//! Provider、账号和云端能力留在各自现役 owner。

use async_trait::async_trait;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// `gh` 可能等待网络、编辑器或浏览器，单独给足预算。
pub const GH_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

/// GitHub Pull Request 标题上限，按字符计。
pub const MAX_PULL_REQUEST_TITLE_CHARS: usize = 256;

/// GitHub Pull Request 正文上限，按字节计（GitHub 限制为 65536 字节）。
pub const MAX_PULL_REQUEST_BODY_BYTES: usize = 65_536;

const MAX_ERROR_DETAIL_CHARS: usize = 2_000;

/// 一次 `gh` 进程执行的退出状态与捕获输出。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GhOutput {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl GhOutput {
    pub fn success(&self) -> bool {
        self.status == Some(0)
    }
}

/// `gh` 进程未产生可判定退出状态时的失败原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GhRunErrorKind {
    /// 找不到 `gh` 可执行文件。
    MissingProgram,
    /// 命令超过调用方给定的时间预算。
    Timeout,
    /// 进程创建或输出读取失败。
    Spawn,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GhRunError {
    pub kind: GhRunErrorKind,
    pub message: String,
}

impl GhRunError {
    pub fn missing_program() -> Self {
        Self {
            kind: GhRunErrorKind::MissingProgram,
            message: "未找到 GitHub CLI（gh）。请先安装 GitHub CLI，并完成 `gh auth login`。"
                .to_string(),
        }
    }

    pub fn timeout(duration: Duration) -> Self {
        Self {
            kind: GhRunErrorKind::Timeout,
            message: format!("gh 命令超时（{}ms）", duration.as_millis()),
        }
    }

    pub fn spawn(message: impl Into<String>) -> Self {
        Self {
            kind: GhRunErrorKind::Spawn,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for GhRunError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for GhRunError {}

/// 可注入的 `gh` 执行器；生产实现是 [`LocalGhCommandRunner`]，测试可替换为假进程。
#[async_trait]
pub trait GhCommandRunner: Send + Sync {
    async fn run(&self, root: &Path, args: &[String]) -> Result<GhOutput, GhRunError>;
}

/// 在本机以显式 argv 执行 `gh`，永不经过 shell。
#[derive(Debug, Clone)]
pub struct LocalGhCommandRunner {
    program: PathBuf,
    command_timeout: Duration,
}

impl Default for LocalGhCommandRunner {
    fn default() -> Self {
        Self {
            program: PathBuf::from("gh"),
            command_timeout: GH_COMMAND_TIMEOUT,
        }
    }
}

impl LocalGhCommandRunner {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            command_timeout: GH_COMMAND_TIMEOUT,
        }
    }

    pub fn with_timeout(mut self, command_timeout: Duration) -> Self {
        self.command_timeout = command_timeout;
        self
    }

    pub fn program(&self) -> &Path {
        &self.program
    }
}

#[async_trait]
impl GhCommandRunner for LocalGhCommandRunner {
    async fn run(&self, root: &Path, args: &[String]) -> Result<GhOutput, GhRunError> {
        let mut command = Command::new(&self.program);
        command
            .args(args)
            .current_dir(root)
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let execute = async {
            let output = command.output().await?;
            Ok::<_, std::io::Error>(output)
        };
        match timeout(self.command_timeout, execute).await {
            Ok(Ok(output)) => Ok(GhOutput {
                status: output.status.code(),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            }),
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                Err(GhRunError::missing_program())
            }
            Ok(Err(error)) => Err(GhRunError::spawn(format!("无法执行 gh: {error}"))),
            Err(_) => Err(GhRunError::timeout(self.command_timeout)),
        }
    }
}

/// 校验后可交给 `gh` 的创建参数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatePullRequestInput {
    pub root_path: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
    pub base: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatePullRequestResult {
    pub root_path: String,
    pub url: Option<String>,
    pub number: Option<u64>,
    pub title: String,
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenPullRequestResult {
    pub root_path: String,
    pub url: Option<String>,
}

/// `gh pr merge` 支持的合并方式，对应三个互斥的 argv 开关。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

impl MergeMethod {
    fn flag(self) -> &'static str {
        match self {
            Self::Merge => "--merge",
            Self::Squash => "--squash",
            Self::Rebase => "--rebase",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergePullRequestResult {
    pub root_path: String,
    pub method: MergeMethod,
    pub delete_branch: bool,
    pub number: Option<u64>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub state: String,
    pub is_draft: bool,
    pub base_ref_name: String,
    pub head_ref_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullRequestError {
    InvalidInput(String),
    MissingGh(String),
    NotAuthenticated(String),
    NoPullRequest(String),
    MergeConflict(String),
    Timeout(String),
    CommandFailed(String),
    OutputParse(String),
}

impl PullRequestError {
    pub fn message(&self) -> &str {
        match self {
            Self::InvalidInput(message)
            | Self::MissingGh(message)
            | Self::NotAuthenticated(message)
            | Self::NoPullRequest(message)
            | Self::MergeConflict(message)
            | Self::Timeout(message)
            | Self::CommandFailed(message)
            | Self::OutputParse(message) => message,
        }
    }
}

impl std::fmt::Display for PullRequestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for PullRequestError {}

/// 校验输入并执行 `gh pr create`。
pub async fn create_pull_request(
    runner: &dyn GhCommandRunner,
    root_path: &str,
    title: &str,
    body: &str,
    draft: bool,
    base: Option<&str>,
) -> Result<CreatePullRequestResult, PullRequestError> {
    let input = validate_create_input(root_path, title, body, draft, base)?;
    let root = Path::new(&input.root_path);
    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        format!("--title={}", input.title),
        format!("--body={}", input.body),
    ];
    if input.draft {
        args.push("--draft".to_string());
    }
    if let Some(base) = input.base.as_deref() {
        args.push(format!("--base={base}"));
    }
    let output = runner
        .run(root, &args)
        .await
        .map_err(pull_request_error_from_run)?;
    if !output.success() {
        return Err(classify_failure(&output));
    }
    let url = extract_pull_request_url(&output.stdout)
        .or_else(|| extract_pull_request_url(&output.stderr));
    let number = url.as_deref().and_then(pull_request_number_from_url);
    Ok(CreatePullRequestResult {
        root_path: input.root_path,
        url,
        number,
        title: input.title,
        draft: input.draft,
    })
}

/// 校验工作区后执行 `gh pr view --web`，由 `gh` 交给系统浏览器打开。
pub async fn open_pull_request(
    runner: &dyn GhCommandRunner,
    root_path: &str,
) -> Result<OpenPullRequestResult, PullRequestError> {
    let root = validate_root_path(root_path)?;
    let args = vec!["pr".to_string(), "view".to_string(), "--web".to_string()];
    let output = runner
        .run(Path::new(&root), &args)
        .await
        .map_err(pull_request_error_from_run)?;
    if !output.success() {
        return Err(classify_failure(&output));
    }
    let url = extract_pull_request_url(&output.stdout)
        .or_else(|| extract_pull_request_url(&output.stderr));
    Ok(OpenPullRequestResult {
        root_path: root,
        url,
    })
}

/// 读取当前分支关联的 Pull Request；分支没有 PR 时返回 `Ok(None)`。
pub async fn read_pull_request(
    runner: &dyn GhCommandRunner,
    root_path: &str,
) -> Result<Option<PullRequestInfo>, PullRequestError> {
    let root = validate_root_path(root_path)?;
    let args = vec![
        "pr".to_string(),
        "view".to_string(),
        "--json".to_string(),
        "number,url,title,state,isDraft,baseRefName,headRefName".to_string(),
    ];
    let output = runner
        .run(Path::new(&root), &args)
        .await
        .map_err(pull_request_error_from_run)?;
    if !output.success() {
        if is_no_pull_request(&output.stderr) {
            return Ok(None);
        }
        return Err(classify_failure(&output));
    }
    let view: GhPullRequestView = serde_json::from_str(output.stdout.trim()).map_err(|error| {
        PullRequestError::OutputParse(format!(
            "无法解析 gh pr view 输出：{error}。输出：{}",
            bounded_detail(&output.stdout)
        ))
    })?;
    Ok(Some(PullRequestInfo {
        number: view.number,
        url: view.url,
        title: view.title,
        state: view.state,
        is_draft: view.is_draft,
        base_ref_name: view.base_ref_name,
        head_ref_name: view.head_ref_name,
    }))
}

/// 校验输入并执行 `gh pr merge`；省略 `pr_number` 时合并当前分支关联的 PR。
pub async fn merge_pull_request(
    runner: &dyn GhCommandRunner,
    root_path: &str,
    method: MergeMethod,
    delete_branch: bool,
    pr_number: Option<u64>,
) -> Result<MergePullRequestResult, PullRequestError> {
    let root = validate_root_path(root_path)?;
    let pr_number = validate_pr_number(pr_number)?;
    let mut args = vec!["pr".to_string(), "merge".to_string()];
    if let Some(number) = pr_number {
        args.push(number.to_string());
    }
    args.push(method.flag().to_string());
    if delete_branch {
        args.push("--delete-branch".to_string());
    }
    let output = runner
        .run(Path::new(&root), &args)
        .await
        .map_err(pull_request_error_from_run)?;
    if !output.success() {
        return Err(classify_failure(&output));
    }
    let url = extract_pull_request_url(&output.stdout)
        .or_else(|| extract_pull_request_url(&output.stderr));
    let number = pr_number.or_else(|| url.as_deref().and_then(pull_request_number_from_url));
    Ok(MergePullRequestResult {
        root_path: root,
        method,
        delete_branch,
        number,
        url,
    })
}

/// 校验创建参数；Rust 侧校验先于任何进程启动。
pub fn validate_create_input(
    root_path: &str,
    title: &str,
    body: &str,
    draft: bool,
    base: Option<&str>,
) -> Result<CreatePullRequestInput, PullRequestError> {
    let root_path = validate_root_path(root_path)?;
    let title = validate_title(title)?;
    let body = validate_body(body)?;
    let base = validate_base(base)?;
    Ok(CreatePullRequestInput {
        root_path,
        title,
        body,
        draft,
        base,
    })
}

fn validate_root_path(root_path: &str) -> Result<String, PullRequestError> {
    let root_path = root_path.trim();
    if root_path.is_empty() {
        return Err(PullRequestError::InvalidInput(
            "工作目录不能为空".to_string(),
        ));
    }
    if !Path::new(root_path).is_dir() {
        return Err(PullRequestError::InvalidInput(
            "工作目录不存在或不是目录".to_string(),
        ));
    }
    Ok(root_path.to_string())
}

fn validate_title(title: &str) -> Result<String, PullRequestError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(PullRequestError::InvalidInput(
            "Pull Request 标题不能为空".to_string(),
        ));
    }
    if title.chars().count() > MAX_PULL_REQUEST_TITLE_CHARS {
        return Err(PullRequestError::InvalidInput(format!(
            "Pull Request 标题过长（最多 {MAX_PULL_REQUEST_TITLE_CHARS} 个字符）"
        )));
    }
    if title.chars().any(char::is_control) {
        return Err(PullRequestError::InvalidInput(
            "Pull Request 标题不能包含控制字符或换行".to_string(),
        ));
    }
    Ok(title.to_string())
}

fn validate_body(body: &str) -> Result<String, PullRequestError> {
    if body.contains('\0') {
        return Err(PullRequestError::InvalidInput(
            "Pull Request 正文不能包含 NUL 字符".to_string(),
        ));
    }
    if body.len() > MAX_PULL_REQUEST_BODY_BYTES {
        return Err(PullRequestError::InvalidInput(format!(
            "Pull Request 正文过长（最多 {MAX_PULL_REQUEST_BODY_BYTES} 字节）"
        )));
    }
    Ok(body.to_string())
}

fn validate_pr_number(pr_number: Option<u64>) -> Result<Option<u64>, PullRequestError> {
    if pr_number == Some(0) {
        return Err(PullRequestError::InvalidInput(
            "Pull Request 编号必须是正整数".to_string(),
        ));
    }
    Ok(pr_number)
}

fn validate_base(base: Option<&str>) -> Result<Option<String>, PullRequestError> {
    let Some(base) = base else {
        return Ok(None);
    };
    let base = base.trim();
    if base.is_empty() {
        return Ok(None);
    }
    let base = crate::project_git_service::validate_branch_name(base)
        .map_err(|error| PullRequestError::InvalidInput(format!("目标分支无效：{error}")))?;
    Ok(Some(base.to_string()))
}

fn pull_request_error_from_run(error: GhRunError) -> PullRequestError {
    match error.kind {
        GhRunErrorKind::MissingProgram => PullRequestError::MissingGh(error.message),
        GhRunErrorKind::Timeout => PullRequestError::Timeout(error.message),
        GhRunErrorKind::Spawn => PullRequestError::CommandFailed(error.message),
    }
}

fn classify_failure(output: &GhOutput) -> PullRequestError {
    let detail = bounded_detail(if output.stderr.trim().is_empty() {
        &output.stdout
    } else {
        &output.stderr
    });
    if is_authentication_failure(&output.stderr) {
        return PullRequestError::NotAuthenticated(format!(
            "GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。{detail}"
        ));
    }
    if is_no_pull_request(&output.stderr) {
        return PullRequestError::NoPullRequest(format!(
            "当前分支没有可用的 Pull Request。{detail}"
        ));
    }
    if is_merge_conflict(&output.stderr) {
        return PullRequestError::MergeConflict(format!(
            "Pull Request 存在合并冲突，无法合并。{detail}"
        ));
    }
    let status = output
        .status
        .map(|status| status.to_string())
        .unwrap_or_else(|| "未知".to_string());
    PullRequestError::CommandFailed(format!("gh 命令失败（退出码 {status}）：{detail}"))
}

fn is_authentication_failure(stderr: &str) -> bool {
    let stderr = stderr.to_ascii_lowercase();
    [
        "gh auth login",
        "not logged in",
        "authentication",
        "bad credentials",
        "http 401",
        "requires authentication",
    ]
    .iter()
    .any(|needle| stderr.contains(needle))
}

fn is_no_pull_request(stderr: &str) -> bool {
    let stderr = stderr.to_ascii_lowercase();
    [
        "no pull requests found",
        "no pull request found",
        "no open pull requests",
        "could not find a pull request",
    ]
    .iter()
    .any(|needle| stderr.contains(needle))
}

fn is_merge_conflict(stderr: &str) -> bool {
    let stderr = stderr.to_ascii_lowercase();
    [
        "merge conflict",
        "conflicts",
        "not mergeable",
        "cannot be cleanly created",
    ]
    .iter()
    .any(|needle| stderr.contains(needle))
}

fn bounded_detail(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "gh 未返回错误详情。".to_string();
    }
    let mut detail = trimmed
        .chars()
        .take(MAX_ERROR_DETAIL_CHARS)
        .collect::<String>();
    if trimmed.chars().count() > MAX_ERROR_DETAIL_CHARS {
        detail.push('…');
    }
    detail
}

/// 从 `gh` 输出中提取第一个 GitHub Pull Request URL。
pub fn extract_pull_request_url(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .map(|token| {
            token.trim_matches(|character: char| {
                matches!(character, '"' | '\'' | '(' | ')' | '[' | ']' | ',' | '.')
            })
        })
        .find(|token| {
            (token.starts_with("https://") || token.starts_with("http://"))
                && token.split('/').any(|segment| segment == "pull")
                && pull_request_number_from_url(token).is_some()
        })
        .map(str::to_string)
}

fn pull_request_number_from_url(url: &str) -> Option<u64> {
    let mut segments = url.trim_end_matches('/').rsplit('/');
    let number = segments.next()?;
    if !segments.next()?.eq("pull") {
        return None;
    }
    number.parse::<u64>().ok().filter(|number| *number > 0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequestView {
    number: u64,
    url: String,
    title: String,
    state: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeGh {
        calls: Mutex<Vec<(PathBuf, Vec<String>)>>,
        responses: Mutex<VecDeque<Result<GhOutput, GhRunError>>>,
    }

    impl FakeGh {
        fn with_responses(responses: Vec<Result<GhOutput, GhRunError>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responses: Mutex::new(responses.into()),
            }
        }

        fn calls(&self) -> Vec<(PathBuf, Vec<String>)> {
            self.calls.lock().expect("calls lock").clone()
        }
    }

    #[async_trait]
    impl GhCommandRunner for FakeGh {
        async fn run(&self, root: &Path, args: &[String]) -> Result<GhOutput, GhRunError> {
            self.calls
                .lock()
                .expect("calls lock")
                .push((root.to_path_buf(), args.to_vec()));
            self.responses
                .lock()
                .expect("responses lock")
                .pop_front()
                .unwrap_or_else(|| Err(GhRunError::spawn("unexpected gh call")))
        }
    }

    fn output(status: i32, stdout: &str, stderr: &str) -> GhOutput {
        GhOutput {
            status: Some(status),
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
        }
    }

    fn temp_root() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp root")
    }

    #[tokio::test]
    async fn create_runs_gh_with_explicit_argv_and_parses_url() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            0,
            "https://github.com/example/repo/pull/42\n",
            "Creating pull request for feature/demo into main\n",
        ))]);

        let result = create_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            "  feat: demo  ",
            "Body\nwith lines",
            false,
            None,
        )
        .await
        .expect("create result");

        assert_eq!(result.root_path, root.path().to_str().expect("root"));
        assert_eq!(
            result.url.as_deref(),
            Some("https://github.com/example/repo/pull/42")
        );
        assert_eq!(result.number, Some(42));
        assert_eq!(result.title, "feat: demo");
        assert!(!result.draft);

        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, root.path());
        assert_eq!(
            calls[0].1,
            vec![
                "pr".to_string(),
                "create".to_string(),
                "--title=feat: demo".to_string(),
                "--body=Body\nwith lines".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn create_passes_draft_and_base_as_argv_values() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            0,
            "https://github.com/example/repo/pull/7\n",
            "",
        ))]);

        let result = create_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            "title",
            "",
            true,
            Some("  release/1.0  "),
        )
        .await
        .expect("create result");

        assert!(result.draft);
        let args = &runner.calls()[0].1;
        assert!(args.contains(&"--draft".to_string()));
        assert!(args.contains(&"--base=release/1.0".to_string()));
    }

    #[tokio::test]
    async fn create_rejects_invalid_input_without_starting_gh() {
        let root = temp_root();
        let root_path = root.path().to_str().expect("root").to_string();
        let cases = [
            ("", "body", None),
            ("   ", "body", None),
            ("bad\nline", "body", None),
            ("bad\u{7f}line", "body", None),
            (&"a".repeat(MAX_PULL_REQUEST_TITLE_CHARS + 1), "body", None),
            ("title", "body\0", None),
            ("title", &"a".repeat(MAX_PULL_REQUEST_BODY_BYTES + 1), None),
            ("title", "body", Some("-leading")),
            ("title", "body", Some("bad name")),
            ("title", "body", Some("bad..name")),
        ];
        for (title, body, base) in cases {
            let runner = FakeGh::default();
            let error = create_pull_request(&runner, &root_path, title, body, false, base)
                .await
                .expect_err("invalid input must fail");
            assert!(
                matches!(error, PullRequestError::InvalidInput(_)),
                "{title:?}/{body:?}/{base:?} => {error:?}"
            );
            assert!(runner.calls().is_empty());
        }
    }

    #[tokio::test]
    async fn create_rejects_missing_root_without_starting_gh() {
        let runner = FakeGh::default();
        let error = create_pull_request(
            &runner,
            "/definitely/not/a/real/lime/workspace",
            "title",
            "body",
            false,
            None,
        )
        .await
        .expect_err("missing root must fail");
        assert!(matches!(error, PullRequestError::InvalidInput(_)));
        assert!(runner.calls().is_empty());
    }

    #[tokio::test]
    async fn missing_gh_has_a_clean_error() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Err(GhRunError::missing_program())]);
        let error = create_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            "title",
            "body",
            false,
            None,
        )
        .await
        .expect_err("missing gh");
        assert!(
            matches!(error, PullRequestError::MissingGh(message) if message.contains("gh auth login"))
        );
    }

    #[tokio::test]
    async fn timeout_has_a_clean_error() {
        let root = temp_root();
        let runner =
            FakeGh::with_responses(vec![Err(GhRunError::timeout(Duration::from_secs(60)))]);
        let error = open_pull_request(&runner, root.path().to_str().expect("root"))
            .await
            .expect_err("timeout");
        assert!(matches!(error, PullRequestError::Timeout(message) if message.contains("60000ms")));
    }

    #[tokio::test]
    async fn auth_failure_is_reported_as_not_authenticated() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            4,
            "",
            "To get started with GitHub CLI, please run: gh auth login\n",
        ))]);
        let error = create_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            "title",
            "body",
            false,
            None,
        )
        .await
        .expect_err("auth failure");
        assert!(matches!(
            error,
            PullRequestError::NotAuthenticated(message)
                if message.contains("gh auth login")
        ));
    }

    #[tokio::test]
    async fn status_returns_none_when_branch_has_no_pull_request() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            1,
            "",
            "no pull requests found for branch \"feature/demo\"\n",
        ))]);
        let result = read_pull_request(&runner, root.path().to_str().expect("root"))
            .await
            .expect("no pr is not an error");
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn status_parses_current_branch_pull_request() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            0,
            r#"{"number":12,"url":"https://github.com/example/repo/pull/12","title":"feat: demo","state":"OPEN","isDraft":true,"baseRefName":"main","headRefName":"feature/demo"}"#,
            "",
        ))]);
        let result = read_pull_request(&runner, root.path().to_str().expect("root"))
            .await
            .expect("status result")
            .expect("pull request");
        assert_eq!(result.number, 12);
        assert_eq!(result.state, "OPEN");
        assert!(result.is_draft);
        assert_eq!(result.base_ref_name, "main");
        assert_eq!(result.head_ref_name, "feature/demo");
        let args = &runner.calls()[0].1;
        assert_eq!(args[0..2], ["pr", "view"]);
        assert!(args.iter().any(|arg| arg.contains("baseRefName")));
    }

    #[tokio::test]
    async fn status_reports_auth_failure_instead_of_treating_it_as_no_pr() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            4,
            "",
            "HTTP 401: Bad credentials (https://api.github.com/graphql)\n",
        ))]);
        let error = read_pull_request(&runner, root.path().to_str().expect("root"))
            .await
            .expect_err("auth failure");
        assert!(matches!(error, PullRequestError::NotAuthenticated(_)));
    }

    #[tokio::test]
    async fn open_runs_gh_pr_view_web_and_returns_url_when_available() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            0,
            "Opening https://github.com/example/repo/pull/9 in your browser.\n",
            "",
        ))]);
        let result = open_pull_request(&runner, root.path().to_str().expect("root"))
            .await
            .expect("open result");
        assert_eq!(
            result.url.as_deref(),
            Some("https://github.com/example/repo/pull/9")
        );
        assert_eq!(
            runner.calls()[0].1,
            vec!["pr".to_string(), "view".to_string(), "--web".to_string()]
        );
    }

    #[tokio::test]
    async fn open_reports_no_pull_request_cleanly() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            1,
            "",
            "no pull requests found for branch \"feature/demo\"\n",
        ))]);
        let error = open_pull_request(&runner, root.path().to_str().expect("root"))
            .await
            .expect_err("no pr");
        assert!(matches!(error, PullRequestError::NoPullRequest(_)));
    }

    #[tokio::test]
    async fn merge_defaults_to_current_branch_pr_with_explicit_argv() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            0,
            "Merged pull request https://github.com/example/repo/pull/42\n",
            "",
        ))]);

        let result = merge_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            MergeMethod::Merge,
            false,
            None,
        )
        .await
        .expect("merge result");

        assert_eq!(result.root_path, root.path().to_str().expect("root"));
        assert_eq!(result.method, MergeMethod::Merge);
        assert!(!result.delete_branch);
        assert_eq!(result.number, Some(42));
        assert_eq!(
            result.url.as_deref(),
            Some("https://github.com/example/repo/pull/42")
        );
        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, root.path());
        assert_eq!(
            calls[0].1,
            vec!["pr".to_string(), "merge".to_string(), "--merge".to_string()]
        );
    }

    #[tokio::test]
    async fn merge_maps_each_method_and_delete_branch_to_argv() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![
            Ok(output(0, "Merged pull request #31\n", "")),
            Ok(output(0, "Merged pull request #32\n", "")),
            Ok(output(0, "Merged pull request #33\n", "")),
        ]);
        let root_path = root.path().to_str().expect("root");
        for (method, flag) in [
            (MergeMethod::Merge, "--merge"),
            (MergeMethod::Squash, "--squash"),
            (MergeMethod::Rebase, "--rebase"),
        ] {
            let result = merge_pull_request(&runner, root_path, method, true, Some(31))
                .await
                .expect("merge result");
            assert_eq!(result.method, method);
            assert!(result.delete_branch);
            assert_eq!(result.number, Some(31));
            let calls = runner.calls();
            let args = &calls.last().expect("call").1;
            assert_eq!(args[0..3], ["pr", "merge", "31"]);
            assert!(args.contains(&flag.to_string()));
            assert!(args.contains(&"--delete-branch".to_string()));
        }
    }

    #[tokio::test]
    async fn merge_reports_conflict_cleanly() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            1,
            "",
            "X Pull request #42 is not mergeable: the merge commit cannot be cleanly created.\n",
        ))]);
        let error = merge_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            MergeMethod::Merge,
            false,
            Some(42),
        )
        .await
        .expect_err("conflict");
        assert!(
            matches!(error, PullRequestError::MergeConflict(message) if message.contains("合并冲突"))
        );
    }

    #[tokio::test]
    async fn merge_reports_missing_pull_request_and_auth_failures_cleanly() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![
            Ok(output(
                1,
                "",
                "no pull requests found for branch \"feature/demo\"\n",
            )),
            Ok(output(
                4,
                "",
                "HTTP 401: Bad credentials (https://api.github.com/graphql)\n",
            )),
        ]);
        let root_path = root.path().to_str().expect("root");
        let no_pr = merge_pull_request(&runner, root_path, MergeMethod::Squash, false, None)
            .await
            .expect_err("no pr");
        assert!(matches!(no_pr, PullRequestError::NoPullRequest(_)));
        let auth = merge_pull_request(&runner, root_path, MergeMethod::Squash, false, None)
            .await
            .expect_err("auth");
        assert!(matches!(auth, PullRequestError::NotAuthenticated(_)));
    }

    #[tokio::test]
    async fn merge_reports_failure_with_exit_code_detail() {
        let root = temp_root();
        let runner = FakeGh::with_responses(vec![Ok(output(
            1,
            "",
            "failed to merge: repository is locked\n",
        ))]);
        let error = merge_pull_request(
            &runner,
            root.path().to_str().expect("root"),
            MergeMethod::Rebase,
            false,
            None,
        )
        .await
        .expect_err("failure");
        assert!(
            matches!(error, PullRequestError::CommandFailed(message) if message.contains("退出码 1") && message.contains("repository is locked"))
        );
    }

    #[tokio::test]
    async fn merge_rejects_invalid_root_and_zero_number_without_starting_gh() {
        let root = temp_root();
        let root_path = root.path().to_str().expect("root").to_string();
        for (runner, root_path, pr_number) in [
            (
                FakeGh::default(),
                "/definitely/not/a/real/lime/workspace",
                None,
            ),
            (FakeGh::default(), "", None),
            (FakeGh::default(), root_path.as_str(), Some(0)),
        ] {
            let error =
                merge_pull_request(&runner, root_path, MergeMethod::Merge, false, pr_number)
                    .await
                    .expect_err("invalid merge input");
            assert!(matches!(error, PullRequestError::InvalidInput(_)));
            assert!(runner.calls().is_empty());
        }
    }

    #[test]
    fn url_extraction_ignores_non_pr_links_and_trailing_punctuation() {
        assert_eq!(
            extract_pull_request_url("see https://github.com/example/repo/pull/15."),
            Some("https://github.com/example/repo/pull/15".to_string())
        );
        assert_eq!(
            extract_pull_request_url("https://github.com/example/repo/issues/15"),
            None
        );
        assert_eq!(
            extract_pull_request_url("https://github.com/example/repo/pull/not-a-number"),
            None
        );
    }

    #[tokio::test]
    async fn local_runner_reports_missing_program() {
        let root = temp_root();
        let runner = LocalGhCommandRunner::new("/definitely/not/a/real/gh-binary");
        let error = runner
            .run(root.path(), &["--version".to_string()])
            .await
            .expect_err("missing program");
        assert_eq!(error.kind, GhRunErrorKind::MissingProgram);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_runner_times_out_and_kills_child() {
        let root = temp_root();
        let runner = LocalGhCommandRunner::new("/bin/sh").with_timeout(Duration::from_millis(50));
        let error = runner
            .run(root.path(), &["-c".to_string(), "sleep 5".to_string()])
            .await
            .expect_err("timeout");
        assert_eq!(error.kind, GhRunErrorKind::Timeout);
    }
}
