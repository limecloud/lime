use super::{
    CommandHookReport, DiscoveredHook, HookCommandOutput, entries_for_report, event_config_label,
    failure_reason, non_empty,
};
use crate::hook_lifecycle::{
    RuntimeHookEventContext, RuntimeHookHandlerReport, RuntimeStopHookTarget,
};
use crate::turn_snapshot::{RuntimeHookEventName, RuntimeHookExecutionMode};
use agent_protocol::hook::{HookOutputEntry, HookOutputEntryKind};
use serde::Deserialize;
use serde_json::{Value, json};

pub(super) fn is_stop(event: RuntimeHookEventName) -> bool {
    matches!(
        event,
        RuntimeHookEventName::Stop | RuntimeHookEventName::SubagentStop
    )
}

pub(super) fn command_input(
    event: RuntimeHookEventName,
    context: &RuntimeHookEventContext,
) -> Result<Value, String> {
    let stop = context
        .stop
        .as_ref()
        .ok_or("Stop hook has no step context")?;
    let session_id = context
        .session_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or("Stop hook has no canonical thread id")?;
    let turn_id = context
        .turn_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or("Stop hook has no turn id")?;
    if stop.invocation_id.trim().is_empty()
        || stop.model.trim().is_empty()
        || stop.permission_mode.trim().is_empty()
    {
        return Err("Stop hook has incomplete step context".to_string());
    }
    let mut input = json!({
        "session_id": session_id,
        "turn_id": turn_id,
        "transcript_path": stop.transcript_path.as_ref().map(|path| path.display().to_string()),
        "cwd": context.working_directory.display().to_string(),
        "hook_event_name": event_config_label(event),
        "model": stop.model,
        "permission_mode": stop.permission_mode,
        "stop_hook_active": stop.stop_hook_active,
        "last_assistant_message": stop.last_assistant_message,
    });
    match (&stop.target, event) {
        (RuntimeStopHookTarget::Stop, RuntimeHookEventName::Stop)
        | (RuntimeStopHookTarget::MemoryConsolidation, RuntimeHookEventName::Stop) => {}
        (
            RuntimeStopHookTarget::SubagentStop {
                agent_id,
                agent_type,
                agent_transcript_path,
            },
            RuntimeHookEventName::SubagentStop,
        ) if !agent_id.trim().is_empty() && !agent_type.trim().is_empty() => {
            input["agent_id"] = json!(agent_id);
            input["agent_type"] = json!(agent_type);
            input["agent_transcript_path"] = json!(
                agent_transcript_path
                    .as_ref()
                    .map(|path| path.display().to_string())
            );
        }
        _ => return Err("Stop hook target does not match the invoked event".to_string()),
    }
    Ok(input)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StopOutput {
    #[serde(default = "default_continue", rename = "continue")]
    continue_processing: bool,
    stop_reason: Option<String>,
    #[serde(default, rename = "suppressOutput")]
    _suppress_output: bool,
    system_message: Option<String>,
    decision: Option<BlockDecision>,
    reason: Option<String>,
}

#[derive(Deserialize)]
enum BlockDecision {
    #[serde(rename = "block")]
    Block,
}

fn default_continue() -> bool {
    true
}

fn parsed(report: RuntimeHookHandlerReport, warning: Option<String>) -> CommandHookReport {
    let mut entries = warning
        .map(|text| HookOutputEntry {
            kind: HookOutputEntryKind::Warning,
            text,
        })
        .into_iter()
        .collect::<Vec<_>>();
    entries.extend(entries_for_report(&report));
    CommandHookReport { report, entries }
}

fn failed(reason: impl Into<String>) -> CommandHookReport {
    parsed(
        RuntimeHookHandlerReport::Failed {
            reason: reason.into(),
        },
        None,
    )
}

fn allowed(warning: Option<String>) -> CommandHookReport {
    parsed(
        RuntimeHookHandlerReport::Allow {
            additional_context: None,
        },
        warning,
    )
}

pub(super) fn parse_output(hook: &DiscoveredHook, output: &HookCommandOutput) -> CommandHookReport {
    let event = event_config_label(hook.snapshot.event_name);
    let can_control = hook.snapshot.execution_mode == RuntimeHookExecutionMode::Sync;
    if output.timed_out || output.exit_code.is_none() {
        return failed(failure_reason(output));
    }
    if output.exit_code == Some(2) && can_control {
        return match non_empty(Some(output.stderr.clone())) {
            Some(reason) => parsed(RuntimeHookHandlerReport::Block { reason }, None),
            None => failed(format!(
                "{event} hook exited with code 2 but did not write a continuation prompt to stderr"
            )),
        };
    }
    if output.exit_code != Some(0) {
        return failed(format!(
            "hook exited with code {}",
            output.exit_code.unwrap()
        ));
    }
    let stdout = output.stdout.trim();
    if stdout.is_empty() {
        return allowed(None);
    }
    let payload = serde_json::from_str::<Value>(stdout)
        .ok()
        .filter(Value::is_object)
        .and_then(|value| serde_json::from_value::<StopOutput>(value).ok());
    let payload = match payload {
        Some(payload) => payload,
        None if !can_control && !stdout.starts_with('{') && !stdout.starts_with('[') => {
            return allowed(None);
        }
        None => {
            let kind = if hook.snapshot.event_name == RuntimeHookEventName::Stop {
                "stop"
            } else {
                "subagent stop"
            };
            return failed(format!("hook returned invalid {kind} hook JSON output"));
        }
    };
    if !can_control {
        return allowed(payload.system_message);
    }
    // Stop 优先于 block；没有 stopReason 时不合成用户文案。
    let report = if !payload.continue_processing {
        RuntimeHookHandlerReport::Abort {
            reason: payload.stop_reason,
        }
    } else if payload.decision.is_some() {
        match non_empty(payload.reason) {
            Some(reason) => RuntimeHookHandlerReport::Block { reason },
            None => RuntimeHookHandlerReport::Failed {
                reason: format!("{event} hook returned decision:block without a non-empty reason"),
            },
        }
    } else {
        RuntimeHookHandlerReport::Allow {
            additional_context: None,
        }
    };
    parsed(report, payload.system_message)
}

#[cfg(test)]
mod tests;
