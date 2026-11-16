use crate::ThreadId;
use crate::auth::KnownPlan;
use crate::auth::PlanType;
pub use crate::auth::RefreshTokenFailedError;
pub use crate::auth::RefreshTokenFailedReason;
use crate::exec_output::ExecToolCallOutput;
use crate::network_policy::NetworkPolicyDecisionPayload;
use crate::protocol::ErrorEvent;
use crate::protocol::LimeErrorInfo;
use crate::protocol::MisalignmentErrorDetails;
use crate::protocol::RateLimitReachedType;
use crate::protocol::RateLimitSnapshot;
use crate::protocol::TokenUsage;
use crate::protocol::TruncationPolicy;
use async_utils::CancelErr;
use async_utils::backoff;
use chrono::DateTime;
use chrono::Datelike;
use chrono::Local;
use chrono::Utc;
use http::StatusCode;
use http_client::HttpError;
use http_client::RetryAfter;
use serde_json;
use std::fmt;
use std::io;
use std::time::Duration;
use strum_macros::EnumDiscriminants;
use thiserror::Error;
use tokio::task::JoinError;
use utils_string::truncate_middle_chars;
use utils_string::truncate_middle_with_token_budget;

#[path = "agent_error.rs"]
mod agent;
pub use agent::AgentErrorContext;

pub type Result<T> = std::result::Result<T, LimeErr>;

/// Limit UI error messages to a reasonable size while keeping useful context.
const ERROR_MESSAGE_UI_MAX_BYTES: usize = 2 * 1024;

#[derive(Error, Debug)]
pub enum SandboxErr {
    /// Error from sandbox execution
    #[error(
        "sandbox denied exec error, exit code: {}, stdout: {}, stderr: {}",
        .output.exit_code, .output.stdout.text, .output.stderr.text
    )]
    Denied {
        output: Box<ExecToolCallOutput>,
        network_policy_decision: Option<NetworkPolicyDecisionPayload>,
    },

    /// Error from linux seccomp filter setup
    #[cfg(target_os = "linux")]
    #[error("seccomp setup error")]
    SeccompInstall(#[from] seccompiler::Error),

    /// Error from linux seccomp backend
    #[cfg(target_os = "linux")]
    #[error("seccomp backend error")]
    SeccompBackend(#[from] seccompiler::BackendError),

    /// Command timed out
    #[error("command timed out")]
    Timeout { output: Box<ExecToolCallOutput> },

    /// Command was killed by a signal
    #[error("command was killed by a signal")]
    Signal(i32),

    /// Error from linux landlock
    #[error("Landlock was not able to fully enforce all sandbox rules")]
    LandlockRestrict,
}

pub struct LimeErr {
    details: LimeErrorDetails,
    retry_after: Option<RetryAfter>,
    agent_context: Option<AgentErrorContext>,
}

enum RetryPolicy {
    Never,
    ServerDirected,
    Backoff,
    FallBackToHttp,
}

/// A terminal response that stopped before the model finished, with any reported usage.
/// Content-filter retries and explicit interruptions have separate handling.
#[derive(derive_more::Debug, Error, PartialEq, Eq)]
#[error("Incomplete response returned, reason: {reason}")]
pub struct ResponseIncompleteError {
    /// Provider output items explicitly marked incomplete, retained for failed inference traces.
    #[debug(skip)]
    pub partial_output: Vec<serde_json::Value>,
    pub reason: String,
    pub response_id: Option<String>,
    pub token_usage: Option<TokenUsage>,
}

/// The semantic category and diagnostic payload for a [`LimeErr`].
#[derive(Error, Debug, EnumDiscriminants)]
#[strum_discriminants(name(LimeErrKind))]
#[strum_discriminants(derive(serde::Serialize, strum_macros::IntoStaticStr))]
#[strum_discriminants(strum(serialize_all = "snake_case"))]
#[strum_discriminants(serde(rename_all = "snake_case"))]
#[strum_discriminants(doc = "The payload-free semantic category used for analytics.")]
pub enum LimeErrorDetails {
    #[error("turn aborted. Something went wrong? Hit `/feedback` to report the issue.")]
    TurnAborted,

    #[error("budget reached")]
    SessionBudgetExceeded,

    /// Returned by ResponsesClient when the SSE stream disconnects or errors out **after** the HTTP
    /// handshake has succeeded but **before** it finished emitting `response.completed`.
    ///
    /// The Session loop treats this as a transient error and will automatically retry the turn.
    #[error("stream disconnected before completion: {0}")]
    Stream(String),
    /// The peer's WebSocket message size limit requires sending this request over HTTP.
    #[error("websocket request exceeds the peer's message size limit")]
    WebsocketMessageTooLarge,
    /// A response stopped by the content filter. Sampling retries need developer guidance.
    #[error(
        "stream disconnected before completion: Incomplete response returned, reason: content_filter"
    )]
    ContentFilter,
    #[error(transparent)]
    ResponseIncomplete(Box<ResponseIncompleteError>),
    /// A retryable upstream rate limit received inside the response stream.
    #[error("rate limit exceeded: {0}")]
    RateLimitExceeded(String),
    // The iOS input-limit classifier matches this message's ASCII prefix.
    #[error(
        "Lime ran out of room in the model's context window. Start a new thread or clear earlier history before retrying."
    )]
    ContextWindowExceeded,
    #[error("no thread with id: {0}")]
    ThreadNotFound(ThreadId),
    #[error("agent thread limit reached")]
    AgentLimitReached { max_threads: usize },
    #[error("session configured event was not the first event in the stream")]
    SessionConfiguredNotFirstEvent,
    /// Returned by run_command_stream when the spawned child process timed out (10s).
    #[error("timeout waiting for child process to exit")]
    Timeout,
    #[error("request timed out")]
    RequestTimeout,
    /// Returned by run_command_stream when the child could not be spawned (its stdout/stderr pipes
    /// could not be captured). Analogous to the previous `LimeError::Spawn` variant.
    #[error("spawn failed: child stdout/stderr not captured")]
    Spawn,
    /// Returned by run_command_stream when the user pressed Ctrl-C (SIGINT). Session uses this to
    /// surface a polite FunctionCallOutput back to the model instead of crashing the CLI.
    #[error("interrupted (Ctrl-C). Something went wrong? Hit `/feedback` to report the issue.")]
    Interrupted,
    /// The account cannot use Lime in the selected workspace.
    #[error("{0}")]
    WorkspaceAccessDenied(UnexpectedResponseError),
    /// The provider denied the access program required for this request.
    #[error("{0}")]
    AccessProgramNotEnabled(ProviderRejection),
    /// Unexpected HTTP status code.
    #[error("{0}")]
    UnexpectedStatus(UnexpectedResponseError),
    /// Invalid request.
    #[error("{0}")]
    InvalidRequest(String),
    #[error("{message}")]
    InvalidAudioInput {
        message: String,
        /// True when the provider rejected an individual clip, independent of request size.
        per_recording: bool,
    },
    #[error("{message}")]
    ModelNotFound {
        message: String,
        status: Option<StatusCode>,
    },
    #[error("{message}")]
    InvalidPrompt { message: String },
    /// The workspace's inference hook explicitly denied this request.
    #[error("{message}")]
    InferenceHookDenied { message: String },
    /// The provider rejected the input under its content policy.
    #[error("{message}")]
    ContentPolicyViolation {
        message: String,
        status: Option<StatusCode>,
    },
    /// Multiple registered tools share the same effective name.
    #[error("duplicate tool: {0}")]
    ToolCollision(String),
    /// Invalid image.
    #[error("Image poisoning")]
    InvalidImageRequest(),
    #[error("{0}")]
    UsageLimitReached(UsageLimitReachedError),
    #[error("Selected model is at capacity. Please try a different model.")]
    ServerOverloaded,
    /// Policy-restricted capacity follows the same retry advice as ordinary overloads.
    #[error("Policy-restricted capacity is unavailable. Please try again later.")]
    PolicyCapacityUnavailable,
    #[error("Flex capacity unavailable.")]
    FlexUnavailable,
    #[error("{message}")]
    CyberPolicy { message: String },
    #[error("{message}")]
    BioPolicy { message: String },
    #[error("{message}")]
    MisalignmentPolicyViolation {
        message: String,
        misalignment: Option<MisalignmentErrorDetails>,
    },
    #[error("{0}")]
    ResponseStreamFailed(ResponseStreamFailed),
    #[error("{0}")]
    ConnectionFailed(ConnectionFailedError),
    #[error("Quota exceeded. Check your plan and billing details.")]
    QuotaExceeded,
    #[error(
        "To use Lime with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus."
    )]
    UsageNotIncluded,
    #[error("We’re currently experiencing high demand, which may cause temporary errors.")]
    InternalServerError,
    /// Retry limit exceeded.
    #[error("{0}")]
    RetryLimit(RetryLimitReachedError),
    /// Agent loop died unexpectedly
    #[error("internal error; agent loop died unexpectedly")]
    InternalAgentDied,
    /// Sandbox error
    #[error("sandbox error: {0}")]
    Sandbox(#[from] SandboxErr),
    #[error("lime-linux-sandbox was required but not provided")]
    LandlockSandboxExecutableNotProvided,
    #[error("unsupported operation: {0}")]
    UnsupportedOperation(String),
    #[error("{0}")]
    RefreshTokenFailed(RefreshTokenFailedError),
    /// Gateway credentials require user action before requests can resume.
    #[error("{0}")]
    GatewayLoginRequired(String),
    #[error("Fatal error: {0}")]
    Fatal(String),
    // -----------------------------------------------------------------
    // Automatic conversions for common external error types
    // -----------------------------------------------------------------
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[cfg(target_os = "linux")]
    #[error(transparent)]
    LandlockRuleset(#[from] landlock::RulesetError),
    #[cfg(target_os = "linux")]
    #[error(transparent)]
    LandlockPathFd(#[from] landlock::PathFdError),
    #[error(transparent)]
    TokioJoin(#[from] JoinError),
    #[error("{0}")]
    EnvVar(EnvVarError),
}

impl From<&LimeErr> for LimeErrKind {
    fn from(error: &LimeErr) -> Self {
        error.details().into()
    }
}

impl fmt::Debug for LimeErr {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.details {
            LimeErrorDetails::Stream(message) => formatter
                .debug_tuple("Stream")
                .field(message)
                .field(&self.server_retry_delay())
                .finish(),
            details => fmt::Debug::fmt(details, formatter),
        }
    }
}

impl fmt::Display for LimeErr {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.details, formatter)
    }
}

impl std::error::Error for LimeErr {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.details.source()
    }
}

impl From<LimeErrorDetails> for LimeErr {
    fn from(details: LimeErrorDetails) -> Self {
        Self {
            details,
            retry_after: None,
            agent_context: None,
        }
    }
}

impl From<CancelErr> for LimeErr {
    fn from(error: CancelErr) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

impl From<SandboxErr> for LimeErr {
    fn from(error: SandboxErr) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

impl From<io::Error> for LimeErr {
    fn from(error: io::Error) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

impl From<serde_json::Error> for LimeErr {
    fn from(error: serde_json::Error) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

impl From<JoinError> for LimeErr {
    fn from(error: JoinError) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

#[cfg(target_os = "linux")]
impl From<landlock::RulesetError> for LimeErr {
    fn from(error: landlock::RulesetError) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

#[cfg(target_os = "linux")]
impl From<landlock::PathFdError> for LimeErr {
    fn from(error: landlock::PathFdError) -> Self {
        LimeErrorDetails::from(error).into()
    }
}

impl From<CancelErr> for LimeErrorDetails {
    fn from(_: CancelErr) -> Self {
        LimeErrorDetails::TurnAborted
    }
}

// TODO(anp): Remove this compatibility macro once callers construct
// `LimeErrorDetails` directly.
macro_rules! lime_err_unit_constructors {
    ($($variant:ident),* $(,)?) => {
        $(
            #[doc(hidden)]
            #[allow(non_upper_case_globals)]
            pub const $variant: Self = Self {
                details: LimeErrorDetails::$variant,
                retry_after: None,
                agent_context: None,
            };
        )*
    };
}

// TODO(anp): Remove this compatibility macro once callers construct
// `LimeErrorDetails` directly.
macro_rules! lime_err_tuple_constructors {
    ($($(#[$attr:meta])* $variant:ident($value:ident: $value_type:ty)),* $(,)?) => {
        $(
            $(#[$attr])*
            #[doc(hidden)]
            #[allow(non_snake_case)]
            pub fn $variant($value: $value_type) -> Self {
                LimeErrorDetails::$variant($value).into()
            }
        )*
    };
}

impl LimeErr {
    lime_err_unit_constructors!(
        TurnAborted,
        SessionBudgetExceeded,
        ContextWindowExceeded,
        SessionConfiguredNotFirstEvent,
        Timeout,
        RequestTimeout,
        Spawn,
        Interrupted,
        ServerOverloaded,
        QuotaExceeded,
        UsageNotIncluded,
        InternalServerError,
        InternalAgentDied,
        LandlockSandboxExecutableNotProvided,
    );

    lime_err_tuple_constructors!(
        Stream(message: String),
        ThreadNotFound(thread_id: ThreadId),
        UnexpectedStatus(error: UnexpectedResponseError),
        InvalidRequest(message: String),
        UsageLimitReached(error: UsageLimitReachedError),
        ResponseStreamFailed(error: ResponseStreamFailed),
        ConnectionFailed(error: ConnectionFailedError),
        RetryLimit(error: RetryLimitReachedError),
        Sandbox(error: SandboxErr),
        UnsupportedOperation(message: String),
        RefreshTokenFailed(error: RefreshTokenFailedError),
        Fatal(message: String),
        Io(error: io::Error),
        Json(error: serde_json::Error),
        #[cfg(target_os = "linux")]
        LandlockRuleset(error: landlock::RulesetError),
        #[cfg(target_os = "linux")]
        LandlockPathFd(error: landlock::PathFdError),
        TokioJoin(error: JoinError),
        EnvVar(error: EnvVarError),
    );

    // TODO(anp): Remove this compatibility constructor once callers construct
    // `LimeErrorDetails` directly.
    #[doc(hidden)]
    #[allow(non_snake_case)]
    pub fn InvalidImageRequest() -> Self {
        LimeErrorDetails::InvalidImageRequest().into()
    }

    /// Creates an error with no server-provided retry delay.
    pub fn new(details: LimeErrorDetails) -> Self {
        details.into()
    }

    /// Returns the semantic failure and its diagnostic payload.
    pub fn details(&self) -> &LimeErrorDetails {
        &self.details
    }

    /// Whether retrying this request requires switching from WebSocket to HTTP.
    pub fn requires_http_fallback(&self) -> bool {
        matches!(self.retry_policy(), RetryPolicy::FallBackToHttp)
    }

    /// Returns the delay before the given retry attempt, or `None` for a terminal error.
    ///
    /// The first retry is attempt one. Retryable errors use server advice when available and
    /// otherwise use exponential backoff with jitter. Callers enforce their own retry budgets.
    pub fn retry_delay(&self, retry_count: u64) -> Option<Duration> {
        match self.retry_policy() {
            RetryPolicy::Never => None,
            RetryPolicy::ServerDirected => self.server_retry_delay(),
            RetryPolicy::Backoff | RetryPolicy::FallBackToHttp => Some(
                self.server_retry_delay()
                    .unwrap_or_else(|| backoff(retry_count)),
            ),
        }
    }

    fn retry_policy(&self) -> RetryPolicy {
        match self.details() {
            LimeErrorDetails::UnexpectedStatus(error)
                if is_runtime_auth_denial(
                    error.status,
                    &error.body,
                    error.identity_error_code.as_deref(),
                ) =>
            {
                RetryPolicy::Never
            }
            LimeErrorDetails::TurnAborted
            | LimeErrorDetails::SessionBudgetExceeded
            | LimeErrorDetails::Interrupted
            | LimeErrorDetails::EnvVar(_)
            | LimeErrorDetails::Fatal(_)
            | LimeErrorDetails::UsageNotIncluded
            | LimeErrorDetails::QuotaExceeded
            | LimeErrorDetails::InvalidImageRequest()
            | LimeErrorDetails::InvalidRequest(_)
            | LimeErrorDetails::InvalidAudioInput { .. }
            | LimeErrorDetails::ResponseIncomplete(_)
            | LimeErrorDetails::ModelNotFound { .. }
            | LimeErrorDetails::InvalidPrompt { .. }
            | LimeErrorDetails::InferenceHookDenied { .. }
            | LimeErrorDetails::ContentPolicyViolation { .. }
            | LimeErrorDetails::ToolCollision(_)
            | LimeErrorDetails::RefreshTokenFailed(_)
            | LimeErrorDetails::GatewayLoginRequired(_)
            | LimeErrorDetails::UnsupportedOperation(_)
            | LimeErrorDetails::Sandbox(_)
            | LimeErrorDetails::LandlockSandboxExecutableNotProvided
            | LimeErrorDetails::ContextWindowExceeded
            | LimeErrorDetails::ThreadNotFound(_)
            | LimeErrorDetails::AgentLimitReached { .. }
            | LimeErrorDetails::Spawn
            | LimeErrorDetails::SessionConfiguredNotFirstEvent
            | LimeErrorDetails::UsageLimitReached(_)
            | LimeErrorDetails::FlexUnavailable
            | LimeErrorDetails::CyberPolicy { .. }
            | LimeErrorDetails::BioPolicy { .. }
            | LimeErrorDetails::WorkspaceAccessDenied(_)
            | LimeErrorDetails::AccessProgramNotEnabled(_)
            | LimeErrorDetails::MisalignmentPolicyViolation { .. } => RetryPolicy::Never,
            LimeErrorDetails::ServerOverloaded
            | LimeErrorDetails::PolicyCapacityUnavailable
            | LimeErrorDetails::RetryLimit(_) => RetryPolicy::ServerDirected,
            LimeErrorDetails::WebsocketMessageTooLarge => RetryPolicy::FallBackToHttp,
            LimeErrorDetails::Stream(..)
            | LimeErrorDetails::ContentFilter
            | LimeErrorDetails::RateLimitExceeded(_)
            | LimeErrorDetails::Timeout
            | LimeErrorDetails::RequestTimeout
            | LimeErrorDetails::UnexpectedStatus(_)
            | LimeErrorDetails::ResponseStreamFailed(_)
            | LimeErrorDetails::ConnectionFailed(_)
            | LimeErrorDetails::InternalServerError
            | LimeErrorDetails::InternalAgentDied
            | LimeErrorDetails::Io(_)
            | LimeErrorDetails::Json(_)
            | LimeErrorDetails::TokioJoin(_) => RetryPolicy::Backoff,
            #[cfg(target_os = "linux")]
            LimeErrorDetails::LandlockRuleset(_) | LimeErrorDetails::LandlockPathFd(_) => {
                RetryPolicy::Never
            }
        }
    }

    /// Returns the original server-advised instant for callers that pass the error on.
    pub fn retry_after(&self) -> Option<RetryAfter> {
        self.retry_after
    }

    /// Returns the remaining server-advised delay without applying local retry policy.
    /// Expired advice stays present as zero instead of falling back to a local delay.
    pub fn server_retry_delay(&self) -> Option<Duration> {
        self.retry_after.map(RetryAfter::remaining_delay)
    }

    /// Retains an already captured server deadline without restarting it.
    pub fn with_retry_after(mut self, retry_after: RetryAfter) -> Self {
        self.retry_after = Some(retry_after);
        self
    }

    /// Minimal shim so that existing `e.downcast_ref::<LimeErr>()` checks continue to compile
    /// after replacing `anyhow::Error` in the return signature. This mirrors the behavior of
    /// `anyhow::Error::downcast_ref` but works directly on our concrete error type.
    pub fn downcast_ref<T: std::any::Any>(&self) -> Option<&T> {
        (self as &dyn std::any::Any).downcast_ref::<T>()
    }

    /// Translate core error to client-facing protocol error.
    pub fn to_protocol_error(&self) -> LimeErrorInfo {
        match &self.details {
            LimeErrorDetails::ContextWindowExceeded => LimeErrorInfo::ContextWindowExceeded,
            LimeErrorDetails::SessionBudgetExceeded => LimeErrorInfo::SessionBudgetExceeded,
            LimeErrorDetails::RateLimitExceeded(_) => LimeErrorInfo::RateLimitExceeded,
            LimeErrorDetails::UsageLimitReached(_)
            | LimeErrorDetails::QuotaExceeded
            | LimeErrorDetails::UsageNotIncluded => LimeErrorInfo::UsageLimitExceeded,
            LimeErrorDetails::ServerOverloaded => LimeErrorInfo::ServerOverloaded,
            LimeErrorDetails::PolicyCapacityUnavailable => LimeErrorInfo::PolicyCapacityUnavailable,
            LimeErrorDetails::FlexUnavailable => LimeErrorInfo::FlexUnavailable,
            LimeErrorDetails::InferenceHookDenied { .. } => LimeErrorInfo::InferenceHookDenied,
            LimeErrorDetails::CyberPolicy { .. } => LimeErrorInfo::CyberPolicy,
            LimeErrorDetails::BioPolicy { .. } => LimeErrorInfo::BioPolicy,
            LimeErrorDetails::ModelNotFound { .. } => LimeErrorInfo::ModelNotFound,
            LimeErrorDetails::InvalidPrompt { .. }
            | LimeErrorDetails::ContentPolicyViolation { .. } => LimeErrorInfo::InvalidPrompt,
            LimeErrorDetails::MisalignmentPolicyViolation { .. } => {
                LimeErrorInfo::MisalignmentPolicyViolation
            }
            LimeErrorDetails::RetryLimit(_) => LimeErrorInfo::ResponseTooManyFailedAttempts {
                http_status_code: self.http_status_code_value(),
            },
            LimeErrorDetails::ConnectionFailed(_)
            | LimeErrorDetails::WorkspaceAccessDenied(_)
            | LimeErrorDetails::AccessProgramNotEnabled(_)
            | LimeErrorDetails::UnexpectedStatus(_) => LimeErrorInfo::HttpConnectionFailed {
                http_status_code: self.http_status_code_value(),
            },
            LimeErrorDetails::ResponseStreamFailed(_) => {
                LimeErrorInfo::ResponseStreamConnectionFailed {
                    http_status_code: self.http_status_code_value(),
                }
            }
            LimeErrorDetails::RefreshTokenFailed(_) => LimeErrorInfo::Unauthorized,
            LimeErrorDetails::SessionConfiguredNotFirstEvent
            | LimeErrorDetails::InternalServerError
            | LimeErrorDetails::InternalAgentDied => LimeErrorInfo::InternalServerError,
            LimeErrorDetails::InvalidAudioInput { .. }
            | LimeErrorDetails::UnsupportedOperation(_)
            | LimeErrorDetails::ThreadNotFound(_)
            | LimeErrorDetails::AgentLimitReached { .. } => LimeErrorInfo::BadRequest,
            LimeErrorDetails::Sandbox(_) => LimeErrorInfo::SandboxError,
            _ => LimeErrorInfo::Other,
        }
    }

    pub fn to_error_event(&self, message_prefix: Option<String>) -> ErrorEvent {
        let error_message = self.to_string();
        let message: String = match message_prefix {
            Some(prefix) => format!("{prefix}: {error_message}"),
            None => error_message,
        };
        ErrorEvent {
            message,
            lime_error_info: Some(self.to_protocol_error()),
            rejected_audio_file_ids: Vec::new(),
            misalignment: match &self.details {
                LimeErrorDetails::MisalignmentPolicyViolation { misalignment, .. } => {
                    misalignment.clone()
                }
                _ => None,
            },
        }
    }

    pub fn http_status_code_value(&self) -> Option<u16> {
        let http_status_code = match &self.details {
            LimeErrorDetails::FlexUnavailable => Some(StatusCode::TOO_MANY_REQUESTS),
            LimeErrorDetails::ModelNotFound { status, .. }
            | LimeErrorDetails::ContentPolicyViolation { status, .. } => *status,
            LimeErrorDetails::RetryLimit(err) => Some(err.status),
            LimeErrorDetails::WorkspaceAccessDenied(err)
            | LimeErrorDetails::AccessProgramNotEnabled(ProviderRejection::Http(err))
            | LimeErrorDetails::UnexpectedStatus(err) => Some(err.status),
            LimeErrorDetails::ConnectionFailed(err) => err.source.status(),
            LimeErrorDetails::ResponseStreamFailed(err) => err.source.status(),
            _ => None,
        };
        http_status_code.as_ref().map(StatusCode::as_u16)
    }
}

#[derive(Debug)]
pub struct ConnectionFailedError {
    pub source: HttpError,
}

impl std::fmt::Display for ConnectionFailedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Connection failed: {}", self.source)
    }
}

#[derive(Debug)]
pub struct ResponseStreamFailed {
    pub source: HttpError,
    pub request_id: Option<String>,
}

impl std::fmt::Display for ResponseStreamFailed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Error while reading the server response: {}{}",
            self.source,
            self.request_id
                .as_ref()
                .map(|id| format!(", request id: {id}"))
                .unwrap_or_default()
        )
    }
}

/// A provider can reject a request before or after opening the response stream.
#[derive(Debug, Error)]
pub enum ProviderRejection {
    #[error(transparent)]
    Http(UnexpectedResponseError),
    #[error("{0}")]
    Stream(String),
}

#[derive(Clone, Debug)]
pub struct UnexpectedResponseError {
    pub status: StatusCode,
    pub body: String,
    pub user_message: Option<String>,
    pub url: Option<String>,
    pub cf_ray: Option<String>,
    pub request_id: Option<String>,
    pub identity_authorization_error: Option<String>,
    pub identity_error_code: Option<String>,
}

/// Runtime denial cannot be repaired by retrying the request or refreshing its original credential.
/// Keep unavailable verification state and ordinary credential errors on their existing paths.
pub fn is_runtime_auth_denial(
    status: StatusCode,
    body: &str,
    identity_error_code: Option<&str>,
) -> bool {
    if !matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        return false;
    }
    let is_terminal = |code| {
        matches!(
            code,
            Some(
                "runtime_assertion_invalid"
                    | "runtime_instance_paused"
                    | "runtime_instance_revoked"
                    | "invalid_agent_instance_assertion"
            )
        )
    };
    if is_terminal(identity_error_code) {
        return true;
    }
    let Ok(body) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    is_terminal(
        body.pointer("/error/code")
            .and_then(serde_json::Value::as_str),
    )
}

const UNEXPECTED_RESPONSE_BODY_MAX_BYTES: usize = 1000;

impl UnexpectedResponseError {
    fn display_body(&self) -> String {
        if let Some(message) = self.extract_error_message() {
            return message;
        }

        let trimmed_body = self.body.trim();
        if trimmed_body.is_empty() {
            return "Unknown error".to_string();
        }

        truncate_with_ellipsis(trimmed_body, UNEXPECTED_RESPONSE_BODY_MAX_BYTES)
    }

    /// Returns the provider message from a structured HTTP error body.
    pub fn extract_error_message(&self) -> Option<String> {
        let json = serde_json::from_str::<serde_json::Value>(&self.body).ok()?;
        let message = json
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)?;
        let message = message.trim();
        if message.is_empty() {
            None
        } else {
            Some(message.to_string())
        }
    }
}

impl std::fmt::Display for UnexpectedResponseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut message = if let Some(user_message) = &self.user_message {
            user_message.clone()
        } else {
            let status = self.status;
            let body = self.display_body();
            format!("unexpected status {status}: {body}")
        };
        if let Some(url) = &self.url {
            message.push_str(&format!(", url: {url}"));
        }
        if let Some(cf_ray) = &self.cf_ray {
            message.push_str(&format!(", cf-ray: {cf_ray}"));
        }
        if let Some(id) = &self.request_id {
            message.push_str(&format!(", request id: {id}"));
        }
        if let Some(auth_error) = &self.identity_authorization_error {
            message.push_str(&format!(", auth error: {auth_error}"));
        }
        if let Some(error_code) = &self.identity_error_code {
            message.push_str(&format!(", auth error code: {error_code}"));
        }
        write!(f, "{message}")
    }
}

impl std::error::Error for UnexpectedResponseError {}

fn truncate_with_ellipsis(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    let mut cut = max_bytes;
    while !text.is_char_boundary(cut) {
        cut = cut.saturating_sub(1);
    }
    let mut truncated = text[..cut].to_string();
    truncated.push_str("...");
    truncated
}

fn truncate_text(content: &str, policy: TruncationPolicy) -> String {
    match policy {
        TruncationPolicy::Bytes(bytes) => truncate_middle_chars(content, bytes),
        TruncationPolicy::Tokens(tokens) => truncate_middle_with_token_budget(content, tokens).0,
    }
}

#[derive(Debug)]
pub struct RetryLimitReachedError {
    pub status: StatusCode,
    pub request_id: Option<String>,
}

impl std::fmt::Display for RetryLimitReachedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "exceeded retry limit, last status: {}{}",
            self.status,
            self.request_id
                .as_ref()
                .map(|id| format!(", request id: {id}"))
                .unwrap_or_default()
        )
    }
}

#[derive(Debug)]
pub struct UsageLimitReachedError {
    pub plan_type: Option<PlanType>,
    pub resets_at: Option<DateTime<Utc>>,
    /// Server-selected window responsible for the limit, in minutes.
    pub limit_window_minutes: Option<u16>,
    pub rate_limits: Option<Box<RateLimitSnapshot>>,
    pub promo_message: Option<String>,
    pub rate_limit_reached_type: Option<RateLimitReachedType>,
}

impl std::fmt::Display for UsageLimitReachedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Reserve is a fallback for exhausted ordinary usage, so keep the standard
        // promo/plan recovery copy below instead of suggesting another model.
        if let Some(limit_name) = self
            .rate_limits
            .as_ref()
            .and_then(|snapshot| snapshot.limit_name.as_deref())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            && !limit_name.eq_ignore_ascii_case("lime")
            && !limit_name.eq_ignore_ascii_case("gpt-reserve")
        {
            return write!(
                f,
                "You’ve hit your usage limit for {limit_name}. Switch to another model now,{}",
                retry_suffix_after_or(self.resets_at.as_ref())
            );
        }

        if let Some(rate_limit_reached_type) = self.rate_limit_reached_type {
            match rate_limit_reached_type {
                RateLimitReachedType::WorkspaceOwnerCreditsDepleted => {
                    return write!(
                        f,
                        "Your workspace is out of credits. Add credits to continue."
                    );
                }
                RateLimitReachedType::WorkspaceMemberCreditsDepleted => {
                    return write!(
                        f,
                        "Your workspace is out of credits. Ask your workspace owner to refill in order to continue."
                    );
                }
                RateLimitReachedType::WorkspaceOwnerUsageLimitReached => {
                    return write!(
                        f,
                        "You hit your spend cap set in your workspace. Increase your spend cap to continue."
                    );
                }
                RateLimitReachedType::WorkspaceMemberUsageLimitReached => {
                    return write!(
                        f,
                        "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue."
                    );
                }
                RateLimitReachedType::RateLimitReached => {
                    // Generic limits intentionally use the existing promo or plan copy below.
                }
            }
        }

        if let Some(promo_message) = &self.promo_message {
            return write!(
                f,
                "You’ve hit your usage limit. {promo_message},{}",
                retry_suffix_after_or(self.resets_at.as_ref())
            );
        }

        let message = match self.plan_type.as_ref() {
            Some(PlanType::Known(KnownPlan::Plus)) => format!(
                "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits{}",
                retry_suffix_after_or(self.resets_at.as_ref())
            ),
            Some(PlanType::Known(
                KnownPlan::Team
                | KnownPlan::SelfServeBusinessProLite
                | KnownPlan::SelfServeBusinessUsageBased
                | KnownPlan::Business
                | KnownPlan::Ent26
                | KnownPlan::EnterpriseCbpAutomation
                | KnownPlan::EnterpriseCbpUsageBased
                | KnownPlan::Sci
                | KnownPlan::SciPlus,
            )) => {
                format!(
                    "You’ve hit your usage limit. To get more access now, send a request to your admin{}",
                    retry_suffix_after_or(self.resets_at.as_ref())
                )
            }
            Some(PlanType::Known(KnownPlan::Free)) | Some(PlanType::Known(KnownPlan::Go)) => {
                format!(
                    "You’ve hit your usage limit. Upgrade to Plus to continue using Lime (https://chatgpt.com/explore/plus),{}",
                    retry_suffix_after_or(self.resets_at.as_ref())
                )
            }
            Some(PlanType::Known(KnownPlan::Pro | KnownPlan::ProLite | KnownPlan::ProMax)) => {
                format!(
                    "You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits{}",
                    retry_suffix_after_or(self.resets_at.as_ref())
                )
            }
            Some(PlanType::Known(
                KnownPlan::Enterprise | KnownPlan::Edu | KnownPlan::EduPlus | KnownPlan::EduPro,
            )) => format!(
                "You’ve hit your usage limit.{}",
                retry_suffix(self.resets_at.as_ref())
            ),
            Some(PlanType::Unknown(_)) | None => format!(
                "You’ve hit your usage limit.{}",
                retry_suffix(self.resets_at.as_ref())
            ),
        };

        write!(f, "{message}")
    }
}

fn retry_suffix(resets_at: Option<&DateTime<Utc>>) -> String {
    if let Some(resets_at) = resets_at {
        let formatted = format_retry_timestamp(resets_at);
        format!(" Try again at {formatted}.")
    } else {
        " Try again later.".to_string()
    }
}

fn retry_suffix_after_or(resets_at: Option<&DateTime<Utc>>) -> String {
    if let Some(resets_at) = resets_at {
        let formatted = format_retry_timestamp(resets_at);
        format!(" or try again at {formatted}.")
    } else {
        " or try again later.".to_string()
    }
}

fn format_retry_timestamp(resets_at: &DateTime<Utc>) -> String {
    let local_reset = resets_at.with_timezone(&Local);
    let local_now = now_for_retry().with_timezone(&Local);
    if local_reset.date_naive() == local_now.date_naive() {
        local_reset.format("%-I:%M %p").to_string()
    } else {
        let suffix = day_suffix(local_reset.day());
        local_reset
            .format(&format!("%b %-d{suffix}, %Y %-I:%M %p"))
            .to_string()
    }
}

fn day_suffix(day: u32) -> &'static str {
    match day {
        11..=13 => "th",
        _ => match day % 10 {
            1 => "st",
            2 => "nd", // codespell:ignore
            3 => "rd",
            _ => "th",
        },
    }
}

#[cfg(test)]
thread_local! {
    static NOW_OVERRIDE: std::cell::RefCell<Option<DateTime<Utc>>> =
        const { std::cell::RefCell::new(None) };
}

fn now_for_retry() -> DateTime<Utc> {
    #[cfg(test)]
    {
        if let Some(now) = NOW_OVERRIDE.with(|cell| *cell.borrow()) {
            return now;
        }
    }
    Utc::now()
}

#[derive(Debug)]
pub struct EnvVarError {
    /// Name of the environment variable that is missing.
    pub var: String,
    /// Optional instructions to help the user get a valid value for the
    /// variable and set it.
    pub instructions: Option<String>,
}

impl std::fmt::Display for EnvVarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Missing environment variable: `{}`.", self.var)?;
        if let Some(instructions) = &self.instructions {
            write!(f, " {instructions}")?;
        }
        Ok(())
    }
}

pub fn get_error_message_ui(e: &LimeErr) -> String {
    let message = match e.details() {
        LimeErrorDetails::Sandbox(SandboxErr::Denied { output, .. }) => {
            let aggregated = output.aggregated_output.text.trim();
            if !aggregated.is_empty() {
                output.aggregated_output.text.clone()
            } else {
                let stderr = output.stderr.text.trim();
                let stdout = output.stdout.text.trim();
                match (stderr.is_empty(), stdout.is_empty()) {
                    (false, false) => format!("{stderr}\n{stdout}"),
                    (false, true) => output.stderr.text.clone(),
                    (true, false) => output.stdout.text.clone(),
                    (true, true) => format!(
                        "command failed inside sandbox with exit code {}",
                        output.exit_code
                    ),
                }
            }
        }
        // Timeouts are not sandbox errors from a UX perspective; present them plainly.
        LimeErrorDetails::Sandbox(SandboxErr::Timeout { output }) => {
            format!(
                "error: command timed out after {} ms",
                output.duration.as_millis()
            )
        }
        _ => e.to_string(),
    };

    truncate_text(
        &message,
        TruncationPolicy::Bytes(ERROR_MESSAGE_UI_MAX_BYTES),
    )
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
