//! 请求级工具策略与 current provider reply facade。

mod current_reply_adapter;
mod policy_config;
#[cfg(test)]
mod web_search_access_tests;
mod web_search_execution_tracker;

pub use self::current_reply_adapter::stream_reply_with_policy;
pub(crate) use self::current_reply_adapter::stream_runtime_message_reply_with_policy;
pub(crate) use self::policy_config::is_same_tool;
pub use self::policy_config::{
    merge_system_prompt_with_request_tool_policy,
    request_tool_policy_with_additional_required_tools, resolve_request_tool_policy,
    resolve_request_tool_policy_with_mode, RequestToolPolicy, RequestToolPolicyMode,
    REQUEST_TOOL_POLICY_MARKER,
};
pub use self::web_search_execution_tracker::WebSearchExecutionTracker;
pub use agent_runtime::reply_execution::{
    RuntimeReplyAttemptError as ReplyAttemptError, RuntimeReplyExecution as StreamReplyExecution,
};
pub(crate) use agent_runtime::reply_input::{
    RuntimeReplyInput as ReplyInput, RuntimeReplyInputImage as ReplyInputImage,
};
