use super::*;
use crate::hook_lifecycle::{
    RuntimeHookOutcome, RuntimeHookReporter, RuntimeHookSkipReason, RuntimeStopHookContext,
    evaluate_hook_event_async,
};
use crate::hook_runtime::{
    CommandHookReporter, HookLifecycleEmitter, HookLifecycleEvent, HookLifecyclePhase,
    resolve_command_shell, run_command_hook, shell_command_flag, status_for_report,
};
use crate::turn_snapshot::{
    RuntimeHookHandlerType, RuntimeHookSnapshot, RuntimeHookSource, RuntimeHookTrustStatus,
    RuntimeTurnSnapshot,
};
use agent_protocol::hook::{HookRunStatus, HookRunSummary};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

fn hook(event: RuntimeHookEventName, command: &str) -> DiscoveredHook {
    DiscoveredHook {
        snapshot: RuntimeHookSnapshot {
            key: "completion-check".into(),
            event_name: event,
            handler_type: RuntimeHookHandlerType::Command,
            execution_mode: RuntimeHookExecutionMode::Sync,
            matcher: None,
            command: Some(command.into()),
            mcp_server: None,
            mcp_tool: None,
            mcp_input: None,
            timeout_sec: 5,
            status_message: None,
            additional_context_limit: None,
            source_path: std::env::temp_dir().join("stop-hooks.json"),
            source: RuntimeHookSource::Project,
            plugin_id: None,
            display_order: 0,
            enabled: true,
            is_managed: false,
            current_hash: "sha256:fixture".into(),
            trust_status: RuntimeHookTrustStatus::Trusted,
        },
        executable: true,
        env: Default::default(),
    }
}

fn context(cwd: &std::path::Path, event: RuntimeHookEventName) -> RuntimeHookEventContext {
    RuntimeHookEventContext {
        session_id: Some("canonical-thread".into()),
        turn_id: Some("turn-1".into()),
        working_directory: cwd.to_path_buf(),
        // 工具字段故意存在，Stop stdin 和 matcher 不得消费它们。
        tool_call_id: Some("unrelated-call".into()),
        tool_name: Some("Bash".into()),
        tool_arguments: Some(r#"{"command":"pwd"}"#.into()),
        tool_output: Some("{}".into()),
        compact: None,
        stop: Some(RuntimeStopHookContext {
            invocation_id: "stop-1".into(),
            model: "selected-provider-model".into(),
            permission_mode: "default".into(),
            transcript_path: None,
            stop_hook_active: false,
            last_assistant_message: None,
            target: if event == RuntimeHookEventName::SubagentStop {
                RuntimeStopHookTarget::SubagentStop {
                    agent_id: "child-thread".into(),
                    agent_type: "reviewer".into(),
                    agent_transcript_path: None,
                }
            } else {
                RuntimeStopHookTarget::Stop
            },
        }),
        ..Default::default()
    }
}

fn output(code: i32, stdout: &str, stderr: &str) -> HookCommandOutput {
    HookCommandOutput {
        success: code == 0,
        exit_code: Some(code),
        stdout: stdout.into(),
        stderr: stderr.into(),
        timed_out: false,
    }
}

fn echo_json(value: Value) -> String {
    let value = value.to_string();
    match shell_command_flag(&resolve_command_shell()) {
        "/C" => format!("echo {value}"),
        "-Command" => format!("'{}'", value.replace('\'', "''")),
        _ => format!("printf '%s' '{}'", value.replace('\'', "'\\''")),
    }
}

#[test]
fn stop_output_requires_feedback_and_stop_takes_precedence() {
    for event in [
        RuntimeHookEventName::Stop,
        RuntimeHookEventName::SubagentStop,
    ] {
        let hook = hook(event, "unused");
        for (code, stdout, stderr, status) in [
            (2, "ignored", " retry with tests ", HookRunStatus::Blocked),
            (
                2,
                r#"{"reason":"stdout is not feedback"}"#,
                " \n",
                HookRunStatus::Failed,
            ),
            (
                0,
                r#"{"decision":"block","reason":" retry with tests "}"#,
                "",
                HookRunStatus::Blocked,
            ),
            (0, r#"{"decision":"block"}"#, "", HookRunStatus::Failed),
            (
                0,
                r#"{"decision":"block","reason":"  "}"#,
                "",
                HookRunStatus::Failed,
            ),
            (
                0,
                r#"{"continue":false,"decision":"block"}"#,
                "",
                HookRunStatus::Stopped,
            ),
            (0, "not json", "", HookRunStatus::Failed),
            (
                0,
                r#"{"continue":false,"continue":true}"#,
                "",
                HookRunStatus::Completed,
            ),
            (0, "", "", HookRunStatus::Completed),
            (3, "", "error", HookRunStatus::Failed),
        ] {
            let parsed = parse_output(&hook, &output(code, stdout, stderr));
            assert_eq!(
                status_for_report(&parsed.report),
                status,
                "{event:?}: {code} {stdout:?}"
            );
            match parsed.report {
                RuntimeHookHandlerReport::Block { reason } => {
                    assert_eq!(reason, "retry with tests")
                }
                RuntimeHookHandlerReport::Abort { reason } => {
                    assert_eq!(reason, None);
                    assert!(parsed.entries.is_empty(), "no synthetic stop reason");
                }
                RuntimeHookHandlerReport::Failed { .. } => assert!(
                    parsed
                        .entries
                        .iter()
                        .all(|entry| entry.kind == HookOutputEntryKind::Error)
                ),
                _ => {}
            }
        }
    }
}

#[test]
fn stop_rejects_tool_output_fields_and_wrong_json_types() {
    let hook = hook(RuntimeHookEventName::Stop, "unused");
    for stdout in [
        r#"{"additionalContext":"must not become developer input"}"#,
        r#"{"hookSpecificOutput":{"hookEventName":"Stop","updatedInput":{}}}"#,
        r#"{"decision":"allow"}"#,
        r#"{"continue":null}"#,
        r#"{"suppressOutput":"true"}"#,
        r#"{"systemMessage":7}"#,
        "[]",
        "null",
        "{",
    ] {
        let parsed = parse_output(&hook, &output(0, stdout, ""));
        assert!(
            matches!(parsed.report, RuntimeHookHandlerReport::Failed { .. }),
            "{stdout}"
        );
        assert!(
            parsed
                .entries
                .iter()
                .all(|entry| entry.kind == HookOutputEntryKind::Error)
        );
    }
}

#[test]
fn stop_preserves_warning_and_optional_stop_reason() {
    let hook = hook(RuntimeHookEventName::Stop, "unused");
    let parsed = parse_output(
        &hook,
        &output(
            0,
            r#"{"continue":false,"stopReason":"done","systemMessage":"notice","suppressOutput":true,"decision":"block","reason":"keep going"}"#,
            "",
        ),
    );
    assert_eq!(
        parsed.report,
        RuntimeHookHandlerReport::Abort {
            reason: Some("done".into())
        }
    );
    assert_eq!(
        parsed.entries,
        vec![
            HookOutputEntry {
                kind: HookOutputEntryKind::Warning,
                text: "notice".into()
            },
            HookOutputEntry {
                kind: HookOutputEntryKind::Stop,
                text: "done".into()
            },
        ]
    );
}

#[test]
fn async_stop_never_applies_control_effects_or_context() {
    let mut hook = hook(RuntimeHookEventName::Stop, "unused");
    hook.snapshot.execution_mode = RuntimeHookExecutionMode::Async;
    for stdout in [
        r#"{"continue":false,"stopReason":"stop","systemMessage":"notice"}"#,
        r#"{"decision":"block","reason":"retry","systemMessage":"notice"}"#,
        r#"{"decision":"block","systemMessage":"notice"}"#,
    ] {
        let parsed = parse_output(&hook, &output(0, stdout, ""));
        assert_eq!(
            parsed.report,
            RuntimeHookHandlerReport::Allow {
                additional_context: None
            }
        );
        assert_eq!(
            parsed.entries,
            vec![HookOutputEntry {
                kind: HookOutputEntryKind::Warning,
                text: "notice".into()
            }]
        );
    }
    assert!(matches!(
        parse_output(&hook, &output(2, "", "retry")).report,
        RuntimeHookHandlerReport::Failed { .. }
    ));
    assert!(matches!(
        parse_output(&hook, &output(0, "{", "")).report,
        RuntimeHookHandlerReport::Failed { .. }
    ));
    assert_eq!(
        parse_output(&hook, &output(0, "plain async output", "")).report,
        RuntimeHookHandlerReport::Allow {
            additional_context: None
        }
    );
}

#[tokio::test]
async fn real_stop_command_receives_exact_root_and_subagent_inputs() {
    let cwd = tempfile::tempdir().expect("workspace");
    let command = match shell_command_flag(&resolve_command_shell()) {
        "/C" => "more",
        "-Command" => "[Console]::In.ReadToEnd()",
        _ => "cat",
    };
    for event in [
        RuntimeHookEventName::Stop,
        RuntimeHookEventName::SubagentStop,
    ] {
        let context = context(cwd.path(), event);
        let output = run_command_hook(&hook(event, command), &context).await;
        assert!(output.success, "{event:?}: {}", output.stderr);
        let input: Value = serde_json::from_str(output.stdout.trim()).expect("command stdin");
        let mut expected = json!({
            "session_id":"canonical-thread", "turn_id":"turn-1", "transcript_path":null,
            "cwd":cwd.path(), "hook_event_name":event_config_label(event),
            "model":"selected-provider-model", "permission_mode":"default",
            "stop_hook_active":false, "last_assistant_message":null,
        });
        if event == RuntimeHookEventName::SubagentStop {
            expected["agent_id"] = json!("child-thread");
            expected["agent_type"] = json!("reviewer");
            expected["agent_transcript_path"] = Value::Null;
        }
        assert_eq!(input, expected, "{event:?} stdin");
    }
}

#[tokio::test]
async fn missing_stop_context_and_mismatched_target_fail_before_execution() {
    let cwd = tempfile::tempdir().expect("workspace");
    let hook = hook(RuntimeHookEventName::Stop, "echo invoked");
    let mut missing = context(cwd.path(), RuntimeHookEventName::Stop);
    missing.stop = None;
    let mismatch = context(cwd.path(), RuntimeHookEventName::SubagentStop);
    let mut missing_thread = context(cwd.path(), RuntimeHookEventName::Stop);
    missing_thread.session_id = None;
    for context in [missing, mismatch, missing_thread] {
        let output = run_command_hook(&hook, &context).await;
        assert!(!output.success);
        assert_eq!(output.exit_code, None);
        assert!(
            output.stdout.is_empty(),
            "invalid input must not execute echo"
        );
    }
}

#[derive(Default)]
struct Emitter {
    events: Mutex<Vec<HookLifecycleEvent>>,
    changed: Notify,
}

impl HookLifecycleEmitter for Emitter {
    fn emit(&self, event: HookLifecycleEvent) {
        self.events.lock().expect("events").push(event);
        self.changed.notify_one();
    }
}

impl Emitter {
    async fn completed(&self) -> HookRunSummary {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let changed = self.changed.notified();
                if let Some(event) = self
                    .events
                    .lock()
                    .expect("events")
                    .iter()
                    .find(|event| event.phase == HookLifecyclePhase::Completed)
                {
                    return event.run.clone();
                }
                changed.await;
            }
        })
        .await
        .expect("hook command terminal")
    }
}

#[tokio::test]
async fn real_reporter_pairs_repeat_invocations_with_evaluation_ids() {
    let cwd = tempfile::tempdir().expect("workspace");
    let mut hook = hook(
        RuntimeHookEventName::Stop,
        &echo_json(json!({"decision":"block","reason":"retry"})),
    );
    hook.snapshot.matcher = Some("[invalid-regex-is-ignored-for-root-stop".into());
    let snapshot =
        RuntimeTurnSnapshot::try_new(vec![], vec![hook.snapshot.clone()]).expect("snapshot");
    let emitter = Arc::new(Emitter::default());
    let reporter = CommandHookReporter::new(vec![hook.clone()], emitter.clone());
    let mut context = context(cwd.path(), RuntimeHookEventName::Stop);
    let first =
        evaluate_hook_event_async(&snapshot, RuntimeHookEventName::Stop, &context, &reporter).await;
    context.stop.as_mut().unwrap().invocation_id = "stop-2".into();
    context.stop.as_mut().unwrap().stop_hook_active = true;
    let second =
        evaluate_hook_event_async(&snapshot, RuntimeHookEventName::Stop, &context, &reporter).await;
    let events = emitter.events.lock().expect("events");
    assert_eq!(events.len(), 4);
    for (pair, evaluation) in events.chunks_exact(2).zip([&first, &second]) {
        assert_eq!(pair[0].phase, HookLifecyclePhase::Started);
        assert_eq!(pair[1].phase, HookLifecyclePhase::Completed);
        assert_eq!(pair[0].run.id, pair[1].run.id);
        assert_eq!(pair[1].run.id, evaluation.decisions[0].run_id);
        assert_eq!(pair[1].run.status, HookRunStatus::Blocked);
        assert_eq!(
            evaluation.decisions[0].outcome,
            RuntimeHookOutcome::Block {
                reason: "retry".into()
            }
        );
    }
    assert_ne!(events[0].run.id, events[2].run.id);
    assert!(
        events
            .iter()
            .all(|event| event.turn_id.as_deref() == Some("turn-1"))
    );
}

#[tokio::test]
async fn subagent_stop_matches_agent_type_and_emits_warning_without_context() {
    let cwd = tempfile::tempdir().expect("workspace");
    let mut hook = hook(
        RuntimeHookEventName::SubagentStop,
        &echo_json(json!({"systemMessage":"notice"})),
    );
    hook.snapshot.matcher = Some("^reviewer$".into());
    let snapshot =
        RuntimeTurnSnapshot::try_new(vec![], vec![hook.snapshot.clone()]).expect("snapshot");
    let emitter = Arc::new(Emitter::default());
    let reporter = CommandHookReporter::new(vec![hook], emitter.clone());
    let mut context = context(cwd.path(), RuntimeHookEventName::SubagentStop);
    let evaluation = evaluate_hook_event_async(
        &snapshot,
        RuntimeHookEventName::SubagentStop,
        &context,
        &reporter,
    )
    .await;
    assert!(!evaluation.is_blocked());
    assert!(evaluation.injected_context().is_empty());
    assert_eq!(
        emitter.completed().await.entries,
        vec![HookOutputEntry {
            kind: HookOutputEntryKind::Warning,
            text: "notice".into()
        }]
    );
    if let RuntimeStopHookTarget::SubagentStop { agent_type, .. } =
        &mut context.stop.as_mut().unwrap().target
    {
        *agent_type = "builder".into();
    }
    let skipped = evaluate_hook_event_async(
        &snapshot,
        RuntimeHookEventName::SubagentStop,
        &context,
        &reporter,
    )
    .await;
    assert_eq!(
        skipped.decisions[0].outcome,
        RuntimeHookOutcome::Skipped {
            reason: RuntimeHookSkipReason::MatcherMismatch
        }
    );
    assert_eq!(emitter.events.lock().expect("events").len(), 2);
}

#[tokio::test]
async fn real_async_stop_returns_allow_and_emits_noncontrolling_terminal() {
    let cwd = tempfile::tempdir().expect("workspace");
    let mut hook = hook(
        RuntimeHookEventName::Stop,
        &echo_json(
            json!({"continue":false,"decision":"block","reason":"retry","systemMessage":"notice"}),
        ),
    );
    hook.snapshot.execution_mode = RuntimeHookExecutionMode::Async;
    let emitter = Arc::new(Emitter::default());
    let reporter = CommandHookReporter::new(vec![hook.clone()], emitter.clone());
    let context = context(cwd.path(), RuntimeHookEventName::Stop);
    assert_eq!(
        reporter
            .report(&hook.snapshot, RuntimeHookEventName::Stop, &context)
            .await,
        Some(RuntimeHookHandlerReport::Allow {
            additional_context: None
        })
    );
    let terminal = emitter.completed().await;
    assert_eq!(terminal.status, HookRunStatus::Completed);
    assert_eq!(
        terminal.entries,
        vec![HookOutputEntry {
            kind: HookOutputEntryKind::Warning,
            text: "notice".into()
        }]
    );
    let events = emitter.events.lock().expect("events");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].run.id, terminal.id);
}

#[tokio::test]
async fn fast_stop_preserves_feedback_when_large_stdin_is_not_consumed() {
    let cwd = tempfile::tempdir().expect("workspace");
    let hook = hook(
        RuntimeHookEventName::Stop,
        &echo_json(json!({"decision":"block","reason":"retry"})),
    );
    let mut context = context(cwd.path(), RuntimeHookEventName::Stop);
    context.stop.as_mut().unwrap().last_assistant_message = Some("x".repeat(1024 * 1024));
    let output = tokio::time::timeout(Duration::from_secs(5), run_command_hook(&hook, &context))
        .await
        .expect("fast Stop must finish even without reading its input");
    assert!(output.success, "{}", output.stderr);
    assert_eq!(
        parse_output(&hook, &output).report,
        RuntimeHookHandlerReport::Block {
            reason: "retry".into()
        }
    );
}

#[cfg(unix)]
#[tokio::test]
async fn stop_drains_both_output_pipes_and_times_out_blocked_stdin() {
    let cwd = tempfile::tempdir().expect("workspace");
    let chunk = "x".repeat(8192);
    // 全部使用 shell builtin；超时只需终结该进程，不留下测试子进程。
    let command = format!(
        "hook_index=0; while [ \"$hook_index\" -lt 128 ]; do printf '%s' '{chunk}'; hook_index=$((hook_index+1)); done; hook_index=0; while [ \"$hook_index\" -lt 128 ]; do printf '%s' '{chunk}' >&2; hook_index=$((hook_index+1)); done; : > output-drained; while :; do :; done"
    );
    let mut hook = hook(RuntimeHookEventName::Stop, &command);
    hook.snapshot.timeout_sec = 2;
    let mut context = context(cwd.path(), RuntimeHookEventName::Stop);
    context.stop.as_mut().unwrap().last_assistant_message = Some("x".repeat(1024 * 1024));
    let output = tokio::time::timeout(Duration::from_secs(5), run_command_hook(&hook, &context))
        .await
        .expect("the hook deadline must include blocked stdin writes");
    assert!(output.timed_out);
    assert!(
        cwd.path().join("output-drained").exists(),
        "both output pipes must drain before the timeout"
    );
    assert!(matches!(
        parse_output(&hook, &output).report,
        RuntimeHookHandlerReport::Failed { .. }
    ));
}

#[cfg(unix)]
#[test]
fn stop_input_serializes_non_unicode_paths_as_display_strings() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;
    use std::path::PathBuf;
    let path = PathBuf::from(OsString::from_vec(b"/tmp/work-\xff".to_vec()));
    let mut context = context(&path, RuntimeHookEventName::SubagentStop);
    let stop = context.stop.as_mut().unwrap();
    stop.transcript_path = Some(path.clone());
    stop.stop_hook_active = true;
    stop.last_assistant_message = Some("last answer".into());
    if let RuntimeStopHookTarget::SubagentStop {
        agent_transcript_path,
        ..
    } = &mut stop.target
    {
        *agent_transcript_path = Some(path.clone());
    }
    let input = command_input(RuntimeHookEventName::SubagentStop, &context).expect("display paths");
    for field in ["cwd", "transcript_path", "agent_transcript_path"] {
        assert_eq!(input[field], json!(path.display().to_string()), "{field}");
    }
    assert_eq!(input["stop_hook_active"], true);
    assert_eq!(input["last_assistant_message"], "last answer");
}

#[test]
fn memory_consolidation_uses_stop_input_without_subagent_fields() {
    let cwd = tempfile::tempdir().expect("workspace");
    let mut context = context(cwd.path(), RuntimeHookEventName::Stop);
    context.stop.as_mut().expect("stop context").target =
        RuntimeStopHookTarget::MemoryConsolidation;
    let input = command_input(RuntimeHookEventName::Stop, &context).expect("stop input");
    assert_eq!(input["hook_event_name"], "Stop");
    assert!(input.get("agent_id").is_none());
    assert!(input.get("agent_type").is_none());
}

#[test]
fn disabled_stop_target_cannot_be_serialized_as_a_user_hook() {
    let cwd = tempfile::tempdir().expect("workspace");
    let mut context = context(cwd.path(), RuntimeHookEventName::Stop);
    context.stop.as_mut().expect("stop context").target = RuntimeStopHookTarget::Disabled;
    let error = command_input(RuntimeHookEventName::Stop, &context)
        .expect_err("disabled target must fail closed");
    assert!(error.contains("target does not match"));
}
