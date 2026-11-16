use super::{CommandHookReport, HookCommandOutput, entries_for_report, failure_reason, non_empty};
use crate::hook_lifecycle::{RuntimeHookEventContext, RuntimeHookHandlerReport};
use agent_protocol::hook::{HookOutputEntry, HookOutputEntryKind};
use serde::Deserialize;
use serde_json::{Value, json};

/// Build the exact Codex Interrupt command input. Interrupt hooks observe the
/// cancelled turn and never receive Stop's `stop_hook_active` or decision fields.
pub(super) fn command_input(context: &RuntimeHookEventContext) -> Result<Value, String> {
    let session_id = context
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or("Interrupt hook has no canonical session id")?;
    let turn_id = context
        .turn_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or("Interrupt hook has no turn id")?;
    let interrupt = context
        .interrupt
        .as_ref()
        .ok_or("Interrupt hook context is missing")?;
    if interrupt.model.trim().is_empty() || interrupt.permission_mode.trim().is_empty() {
        return Err("Interrupt hook has incomplete turn context".to_string());
    }
    Ok(json!({
        "session_id": session_id,
        "turn_id": turn_id,
        "transcript_path": interrupt.transcript_path.as_ref().map(|path| path.display().to_string()),
        "cwd": context.working_directory.display().to_string(),
        "hook_event_name": "Interrupt",
        "model": interrupt.model,
        "permission_mode": interrupt.permission_mode,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InterruptOutput {
    #[serde(default)]
    system_message: Option<String>,
}

/// Parse the Codex Interrupt output contract. A successful empty stdout is
/// allowed; any non-empty stdout must be a JSON object containing only
/// `systemMessage`.
pub(super) fn parse_output(output: &HookCommandOutput) -> CommandHookReport {
    if output.timed_out || output.exit_code.is_none() {
        return failed(failure_reason(output));
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
    let payload = match serde_json::from_str::<Value>(stdout)
        .ok()
        .filter(Value::is_object)
        .and_then(|value| serde_json::from_value::<InterruptOutput>(value).ok())
    {
        Some(payload) => payload,
        None => return failed("Interrupt hook returned invalid interrupt hook JSON output"),
    };
    let warning = non_empty(payload.system_message);
    let report = RuntimeHookHandlerReport::Allow {
        additional_context: None,
    };
    let mut entries = warning
        .clone()
        .map(|text| HookOutputEntry {
            kind: HookOutputEntryKind::Warning,
            text,
        })
        .into_iter()
        .collect::<Vec<_>>();
    entries.extend(entries_for_report(&report));
    CommandHookReport { report, entries }
}

fn allowed(warning: Option<String>) -> CommandHookReport {
    let report = RuntimeHookHandlerReport::Allow {
        additional_context: None,
    };
    let entries = warning
        .map(|text| HookOutputEntry {
            kind: HookOutputEntryKind::Warning,
            text,
        })
        .into_iter()
        .collect();
    CommandHookReport { report, entries }
}

fn failed(reason: impl Into<String>) -> CommandHookReport {
    let report = RuntimeHookHandlerReport::Failed {
        reason: reason.into(),
    };
    CommandHookReport {
        entries: entries_for_report(&report),
        report,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn context() -> RuntimeHookEventContext {
        RuntimeHookEventContext {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            working_directory: PathBuf::from("/tmp"),
            interrupt: Some(crate::hook_lifecycle::RuntimeInterruptHookContext {
                model: "gpt-test".to_string(),
                permission_mode: "default".to_string(),
                transcript_path: None,
            }),
            ..RuntimeHookEventContext::default()
        }
    }

    #[test]
    fn input_matches_codex_interrupt_contract() {
        let input = command_input(&context()).expect("interrupt input");
        assert_eq!(input["session_id"], "session-1");
        assert_eq!(input["turn_id"], "turn-1");
        assert_eq!(input["hook_event_name"], "Interrupt");
        assert_eq!(input["model"], "gpt-test");
        assert_eq!(input["permission_mode"], "default");
        assert!(input["transcript_path"].is_null());
    }

    #[test]
    fn output_accepts_system_message_and_rejects_plain_text() {
        let output = HookCommandOutput {
            success: true,
            exit_code: Some(0),
            stdout: r#"{"systemMessage":"interrupted"}"#.to_string(),
            stderr: String::new(),
            timed_out: false,
        };
        let report = parse_output(&output);
        assert!(matches!(
            report.report,
            RuntimeHookHandlerReport::Allow { .. }
        ));
        assert_eq!(report.entries[0].kind, HookOutputEntryKind::Warning);

        let invalid = HookCommandOutput {
            stdout: "plain text".to_string(),
            ..output
        };
        assert!(matches!(
            parse_output(&invalid).report,
            RuntimeHookHandlerReport::Failed { .. }
        ));
    }
}
