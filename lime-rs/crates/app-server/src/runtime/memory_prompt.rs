use super::context_packet::{
    assemble_context_packets, contains_secret_like_content, ContextPacket, ContextScope,
};
use super::output_refs::SIDECAR_REF_FIELD;
use super::sidecar_store::{session_scoped_relative_path, SidecarWriteRequest};
use super::{RuntimeCore, TurnStartRequest};
use app_server_protocol::{
    MemoryStoreReadParams, MemoryStoreRootParams, MemoryStoreScope, RuntimeOptions,
};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

pub(crate) const MEMORY_PROMPT_CONTEXT_KEY: &str = "memory_store_prompt_context";
pub(crate) const SESSION_COMPACTION_PROMPT_CONTEXT_KEY: &str = "session_compaction_prompt_context";
pub(crate) const CONTEXT_PACKET_TELEMETRY_KEY: &str = "context_packet_telemetry";
const SUMMARY_PATH: &str = "memory_summary.md";
const SUMMARY_MAX_TOKENS: usize = 1_200;
const PROMPT_CONTEXT_VERSION: &str = "memory_store_prompt_context.v1";
const SESSION_COMPACTION_CONTEXT_VERSION: &str = "session_compaction_prompt_context.v1";
const MEMORY_PACKET_MAX_TOKENS: usize = 1_200;
const SESSION_COMPACTION_PACKET_MAX_TOKENS: usize = 1_600;
const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT: usize = 95;
const AUTO_COMPACT_CONTEXT_WINDOW_RATIO_NUMERATOR: usize = 9;
const AUTO_COMPACT_CONTEXT_WINDOW_RATIO_DENOMINATOR: usize = 10;
const CONTEXT_POLICY_PACKET_BUDGET_RATIO_DENOMINATOR: usize = 10;

pub(crate) use super::soul::memory_soul_prompt_context_from_config;

impl RuntimeCore {
    pub(in crate::runtime) async fn prepare_memory_prompt_context(
        &self,
        params: &mut TurnStartRequest,
    ) {
        if !self.session_memory_enabled(&params.session_id) {
            return;
        }
        let roots = memory_summary_roots(params);
        let Some((root, response)) = find_memory_summary(self, roots).await else {
            return;
        };
        let summary = response.content.trim();
        if summary.is_empty() {
            return;
        }
        let scope = match root.scope {
            MemoryStoreScope::Global => "global",
            MemoryStoreScope::Workspace => "workspace",
        };
        let mut context = json!({
            "schema": PROMPT_CONTEXT_VERSION,
            "scope": scope,
            "workspaceRoot": root.workspace_root,
            "path": response.path,
            "content": summary,
            "truncated": response.truncated,
            "citation": response.citation,
        });
        if let Some(sidecar_ref) = self.memory_summary_sidecar_ref(
            params.session_id.as_str(),
            params.turn_id.as_deref(),
            scope,
            response.path.as_str(),
            summary,
        ) {
            context[SIDECAR_REF_FIELD] = sidecar_ref;
        }
        apply_prompt_context_budget_policy(
            &mut context,
            params.runtime_options.as_ref(),
            MEMORY_PACKET_MAX_TOKENS,
        );
        let packet = memory_packet_from_prompt_context(&context);
        if let Some(packet) = packet {
            let assembly = assemble_context_packets(vec![packet]);
            context["contextPacketTelemetry"] = assembly.telemetry.clone();
            merge_context_packet_telemetry(params, assembly.telemetry);
        }
        merge_runtime_options_metadata(params, MEMORY_PROMPT_CONTEXT_KEY, context);
    }

    pub(in crate::runtime) fn prepare_session_compaction_prompt_context(
        &self,
        params: &mut TurnStartRequest,
    ) {
        let Some(context) = self.latest_session_compaction_prompt_context(&params.session_id)
        else {
            return;
        };
        let mut context = context;
        apply_prompt_context_budget_policy(
            &mut context,
            params.runtime_options.as_ref(),
            SESSION_COMPACTION_PACKET_MAX_TOKENS,
        );
        let packet = session_compaction_packet_from_prompt_context(&context);
        if let Some(packet) = packet {
            let assembly = assemble_context_packets(vec![packet]);
            context["contextPacketTelemetry"] = assembly.telemetry.clone();
            merge_context_packet_telemetry(params, assembly.telemetry);
            merge_runtime_options_metadata(params, SESSION_COMPACTION_PROMPT_CONTEXT_KEY, context);
        }
    }

    fn latest_session_compaction_prompt_context(&self, session_id: &str) -> Option<Value> {
        self.events_for_session(session_id)
            .ok()?
            .into_iter()
            .rev()
            .find(|event| event.event_type == "context.compaction.completed")
            .and_then(|event| session_compaction_prompt_context_from_event(&event.payload))
    }

    fn memory_summary_sidecar_ref(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        scope: &str,
        path: &str,
        content: &str,
    ) -> Option<Value> {
        let (session, _) = self.session_snapshot(session_id).ok()?;
        if super::session_is_ephemeral(&session) || contains_secret_like_content(content) {
            return None;
        }
        let sidecar_store = self.sidecar_store.as_deref()?;
        let turn_stem = sidecar_file_stem(turn_id.unwrap_or("latest"));
        let relative_path = session_scoped_relative_path(
            session_id,
            &format!("context/memory-summary-{turn_stem}.md"),
        );
        let sidecar_ref = sidecar_store
            .write_text(&SidecarWriteRequest {
                session_id: session_id.to_string(),
                kind: "memory_summary_context".to_string(),
                logical_id: format!("memory-summary:{scope}:{path}:{turn_stem}"),
                relative_path,
                content: content.to_string(),
            })
            .ok()?;
        serde_json::to_value(sidecar_ref).ok()
    }
}

pub(crate) fn append_memory_context_to_system_prompt(
    system_prompt: Option<String>,
    runtime_metadata: Option<&Value>,
) -> Option<String> {
    let system_prompt = append_context_block(
        system_prompt,
        memory_prompt_assembly_from_metadata(runtime_metadata)
            .and_then(|assembly| assembly.rendered),
    );
    append_context_block(
        system_prompt,
        session_compaction_prompt_assembly_from_metadata(runtime_metadata)
            .and_then(|assembly| assembly.rendered),
    )
}

pub(crate) fn append_soul_context_to_system_prompt(
    system_prompt: Option<String>,
    config_metadata: Option<&Value>,
) -> Option<String> {
    append_context_block(
        system_prompt,
        soul_prompt_assembly_from_metadata(config_metadata).and_then(|assembly| assembly.rendered),
    )
}

fn memory_prompt_assembly_from_metadata(
    metadata: Option<&Value>,
) -> Option<super::context_packet::ContextAssembly> {
    let value = metadata?.get(MEMORY_PROMPT_CONTEXT_KEY)?;
    let packet = memory_packet_from_prompt_context(value)?;
    Some(assemble_context_packets(vec![packet]))
}

fn memory_packet_from_prompt_context(value: &Value) -> Option<ContextPacket> {
    let content = value
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())?;
    let path = value
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .unwrap_or(SUMMARY_PATH);
    let scope = value
        .get("scope")
        .and_then(Value::as_str)
        .filter(|scope| !scope.trim().is_empty())
        .unwrap_or("global");
    let citation = value.get("citation");
    let start_line = citation
        .and_then(|citation| citation.get("startLineNumber"))
        .and_then(Value::as_u64)
        .or_else(|| {
            citation
                .and_then(|citation| citation.get("start_line_number"))
                .and_then(Value::as_u64)
        })
        .unwrap_or(1);
    let end_line = citation
        .and_then(|citation| citation.get("endLineNumber"))
        .and_then(Value::as_u64)
        .or_else(|| {
            citation
                .and_then(|citation| citation.get("end_line_number"))
                .and_then(Value::as_u64)
        })
        .unwrap_or(start_line);
    let truncated = value
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut metadata = Map::new();
    metadata.insert("path".to_string(), json!(path));
    metadata.insert("scope".to_string(), json!(scope));
    metadata.insert("startLineNumber".to_string(), json!(start_line));
    metadata.insert("endLineNumber".to_string(), json!(end_line));
    copy_optional_value(value, &mut metadata, SIDECAR_REF_FIELD);
    Some(ContextPacket::memory_summary(
        content,
        match scope {
            "workspace" => ContextScope::Workspace,
            _ => ContextScope::Global,
        },
        prompt_context_packet_budget(value, MEMORY_PACKET_MAX_TOKENS),
        truncated,
        metadata,
    ))
}

fn session_compaction_prompt_context_from_event(payload: &Value) -> Option<Value> {
    if provider_uses_compaction_replacement_history(payload) {
        return None;
    }
    let summary = payload
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let mut context = Map::new();
    context.insert(
        "schema".to_string(),
        json!(SESSION_COMPACTION_CONTEXT_VERSION),
    );
    copy_optional_value(payload, &mut context, "compactionId");
    copy_optional_value(payload, &mut context, "contextEpoch");
    copy_optional_value(payload, &mut context, "coveredThroughSequence");
    copy_optional_value(payload, &mut context, "turnCount");
    copy_optional_value(payload, &mut context, "trigger");
    copy_optional_value(payload, &mut context, SIDECAR_REF_FIELD);
    context.insert("summary".to_string(), json!(summary));
    Some(Value::Object(context))
}

fn provider_uses_compaction_replacement_history(payload: &Value) -> bool {
    let field = |name: &str| {
        payload
            .get("artifact")
            .filter(|value| value.is_object())
            .and_then(|artifact| artifact.get(name))
            .or_else(|| payload.get(name))
    };

    field("windowNumber").and_then(Value::as_u64).is_some()
        && field("firstWindowId").and_then(Value::as_str).is_some()
        && field("windowId").and_then(Value::as_str).is_some()
        && field("replacementHistory")
            .and_then(Value::as_array)
            .is_some()
}

fn session_compaction_prompt_assembly_from_metadata(
    metadata: Option<&Value>,
) -> Option<super::context_packet::ContextAssembly> {
    let value = metadata?.get(SESSION_COMPACTION_PROMPT_CONTEXT_KEY)?;
    let packet = session_compaction_packet_from_prompt_context(value)?;
    Some(assemble_context_packets(vec![packet]))
}

fn session_compaction_packet_from_prompt_context(value: &Value) -> Option<ContextPacket> {
    let summary = value
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|summary| !summary.is_empty())?;
    let mut metadata = Map::new();
    copy_optional_value(value, &mut metadata, "compactionId");
    copy_optional_value(value, &mut metadata, "contextEpoch");
    copy_optional_value(value, &mut metadata, "coveredThroughSequence");
    copy_optional_value(value, &mut metadata, "turnCount");
    copy_optional_value(value, &mut metadata, "trigger");
    copy_optional_value(value, &mut metadata, SIDECAR_REF_FIELD);
    Some(ContextPacket::session_compaction(
        summary,
        prompt_context_packet_budget(value, SESSION_COMPACTION_PACKET_MAX_TOKENS),
        metadata,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PromptContextBudgetPolicy {
    model_context_window: Option<usize>,
    auto_compact_token_limit: Option<usize>,
    effective_context_window: usize,
}

impl PromptContextBudgetPolicy {
    fn packet_budget(self, default_budget: usize) -> usize {
        let policy_budget = self
            .effective_context_window
            .saturating_div(CONTEXT_POLICY_PACKET_BUDGET_RATIO_DENOMINATOR)
            .max(1);
        default_budget.min(policy_budget)
    }

    fn metadata(self, packet_budget: usize) -> Value {
        json!({
            "source": "model_request_policy",
            "modelContextWindow": self.model_context_window,
            "autoCompactTokenLimit": self.auto_compact_token_limit,
            "effectiveContextWindow": self.effective_context_window,
            "packetBudgetRatio": format!("1/{CONTEXT_POLICY_PACKET_BUDGET_RATIO_DENOMINATOR}"),
            "packetTokenBudget": packet_budget,
        })
    }
}

fn apply_prompt_context_budget_policy(
    context: &mut Value,
    runtime_options: Option<&RuntimeOptions>,
    default_budget: usize,
) {
    let Some(policy) = runtime_options
        .and_then(|options| options.runtime_metadata())
        .and_then(prompt_context_budget_policy_from_metadata)
    else {
        return;
    };
    let packet_budget = policy.packet_budget(default_budget);
    context["packetTokenBudget"] = json!(packet_budget);
    context["contextBudgetPolicy"] = policy.metadata(packet_budget);
}

fn prompt_context_budget_policy_from_metadata(
    metadata: &Value,
) -> Option<PromptContextBudgetPolicy> {
    let policy = [
        "/lime_runtime/context_policy",
        "/limeRuntime/contextPolicy",
        "/harness/model_request_policy/context_policy",
        "/harness/modelRequestPolicy/contextPolicy",
        "/model_request_policy/context_policy",
        "/modelRequestPolicy/contextPolicy",
    ]
    .into_iter()
    .find_map(|pointer| metadata.pointer(pointer))?;

    let context_window = positive_usize_field(policy, &["context_window", "contextWindow"]);
    let max_context_window =
        positive_usize_field(policy, &["max_context_window", "maxContextWindow"]);
    let resolved_context_window = positive_usize_field(
        policy,
        &["resolved_context_window", "resolvedContextWindow"],
    )
    .or(context_window)
    .or(max_context_window);
    let effective_context_window_percent = positive_usize_field(
        policy,
        &[
            "effective_context_window_percent",
            "effectiveContextWindowPercent",
        ],
    )
    .filter(|percent| *percent <= 100)
    .unwrap_or(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT);
    let model_context_window =
        positive_usize_field(policy, &["model_context_window", "modelContextWindow"]).or_else(
            || {
                resolved_context_window
                    .map(|window| window.saturating_mul(effective_context_window_percent) / 100)
            },
        );
    let auto_compact_token_limit = positive_usize_field(
        policy,
        &["auto_compact_token_limit", "autoCompactTokenLimit"],
    )
    .map(|limit| {
        resolved_context_window.map_or(limit, |window| {
            let max_limit = window.saturating_mul(AUTO_COMPACT_CONTEXT_WINDOW_RATIO_NUMERATOR)
                / AUTO_COMPACT_CONTEXT_WINDOW_RATIO_DENOMINATOR;
            limit.min(max_limit)
        })
    })
    .or_else(|| {
        resolved_context_window.map(|window| {
            window.saturating_mul(AUTO_COMPACT_CONTEXT_WINDOW_RATIO_NUMERATOR)
                / AUTO_COMPACT_CONTEXT_WINDOW_RATIO_DENOMINATOR
        })
    });
    let effective_context_window = match (model_context_window, auto_compact_token_limit) {
        (Some(model_window), Some(compact_limit)) => model_window.min(compact_limit),
        (Some(model_window), None) => model_window,
        (None, Some(compact_limit)) => compact_limit,
        (None, None) => return None,
    };

    Some(PromptContextBudgetPolicy {
        model_context_window,
        auto_compact_token_limit,
        effective_context_window,
    })
}

fn prompt_context_packet_budget(value: &Value, default_budget: usize) -> usize {
    positive_usize_field(value, &["packetTokenBudget", "packet_token_budget"])
        .unwrap_or(default_budget)
}

fn positive_usize_field(value: &Value, keys: &[&str]) -> Option<usize> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find_map(|value| {
            value
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .or_else(|| {
                    value
                        .as_i64()
                        .filter(|value| *value > 0)
                        .and_then(|value| usize::try_from(value).ok())
                })
        })
        .filter(|value| *value > 0)
}

fn soul_prompt_assembly_from_metadata(
    config_metadata: Option<&Value>,
) -> Option<super::context_packet::ContextAssembly> {
    let packet = soul_packet_from_metadata(config_metadata)?;
    Some(assemble_context_packets(vec![packet]))
}

fn soul_packet_from_metadata(config_metadata: Option<&Value>) -> Option<ContextPacket> {
    super::soul::soul_packet_from_metadata(config_metadata)
}

fn memory_summary_roots(params: &TurnStartRequest) -> Vec<MemoryStoreRootParams> {
    let mut roots = Vec::with_capacity(2);
    if let Some(root) = workspace_root_from_runtime_options(params.runtime_options.as_ref()) {
        roots.push(MemoryStoreRootParams {
            scope: MemoryStoreScope::Workspace,
            workspace_root: Some(root),
        });
    }
    roots.push(MemoryStoreRootParams {
        scope: MemoryStoreScope::Global,
        workspace_root: None,
    });
    roots
}

async fn find_memory_summary(
    runtime: &RuntimeCore,
    roots: Vec<MemoryStoreRootParams>,
) -> Option<(
    MemoryStoreRootParams,
    app_server_protocol::MemoryStoreReadResponse,
)> {
    for root in roots {
        let response = match runtime
            .app_data_source
            .read_memory_store(MemoryStoreReadParams {
                root: root.clone(),
                path: SUMMARY_PATH.to_string(),
                line_offset: None,
                max_lines: None,
                max_tokens: Some(SUMMARY_MAX_TOKENS),
            })
            .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };
        if !response.content.trim().is_empty() {
            return Some((root, response));
        }
    }
    None
}

fn workspace_root_from_runtime_options(runtime_options: Option<&RuntimeOptions>) -> Option<String> {
    let options = runtime_options?;
    let request_root = options
        .runtime_request
        .as_ref()
        .and_then(|request| {
            request
                .workspace_root
                .as_deref()
                .or(request.project_root.as_deref())
        })
        .map(ToString::to_string);
    request_root
        .or_else(|| metadata_workspace_root(options.runtime_metadata()))
        .and_then(|value| {
            let path = PathBuf::from(&value);
            path.is_absolute().then_some(value)
        })
}

fn metadata_workspace_root(metadata: Option<&Value>) -> Option<String> {
    let metadata = metadata?;
    let pointers = [
        "/workspaceRoot",
        "/workspace_root",
        "/projectRoot",
        "/project_root",
        "/harness/workspaceRoot",
        "/harness/workspace_root",
        "/harness/projectRoot",
        "/harness/project_root",
    ];
    pointers
        .iter()
        .find_map(|pointer| metadata.pointer(pointer))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn sidecar_file_stem(value: &str) -> String {
    let stem = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let stem = stem.trim_matches('_');
    if stem.is_empty() {
        "latest".to_string()
    } else {
        stem.to_string()
    }
}

pub(in crate::runtime) fn merge_runtime_options_metadata(
    params: &mut TurnStartRequest,
    key: &str,
    value: Value,
) {
    let options = params
        .runtime_options
        .get_or_insert_with(RuntimeOptions::default);
    let mut metadata = match options.runtime_metadata_mut().take() {
        Some(Value::Object(map)) => map,
        Some(existing) => {
            let mut map = Map::new();
            map.insert("original".to_string(), existing);
            map
        }
        None => Map::new(),
    };
    metadata.insert(key.to_string(), value);
    *options.runtime_metadata_mut() = Some(Value::Object(metadata));
}

pub(in crate::runtime) fn merge_context_packet_telemetry(
    params: &mut TurnStartRequest,
    telemetry: Value,
) {
    let options = params
        .runtime_options
        .get_or_insert_with(RuntimeOptions::default);
    let mut metadata = match options.runtime_metadata_mut().take() {
        Some(Value::Object(map)) => map,
        Some(existing) => {
            let mut map = Map::new();
            map.insert("original".to_string(), existing);
            map
        }
        None => Map::new(),
    };
    let merged = metadata
        .remove(CONTEXT_PACKET_TELEMETRY_KEY)
        .map(|existing| merge_context_telemetry_values(existing, telemetry.clone()))
        .unwrap_or(telemetry);
    metadata.insert(CONTEXT_PACKET_TELEMETRY_KEY.to_string(), merged);
    *options.runtime_metadata_mut() = Some(Value::Object(metadata));
}

fn merge_context_telemetry_values(existing: Value, next: Value) -> Value {
    let existing_packets = existing
        .get("packets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let next_packets = next
        .get("packets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut packets = existing_packets;
    packets.extend(next_packets);
    let admitted_count = packets
        .iter()
        .filter(|packet| packet.get("admitted").and_then(Value::as_bool) == Some(true))
        .count();
    let total_tokens = packets
        .iter()
        .filter_map(|packet| packet.get("actualTokens").and_then(Value::as_u64))
        .sum::<u64>();
    json!({
        "schema": "context_packet_assembly.v1",
        "packetCount": packets.len(),
        "admittedCount": admitted_count,
        "rejectedCount": packets.len().saturating_sub(admitted_count),
        "totalTokens": total_tokens,
        "hardPacketMaxTokens": next
            .get("hardPacketMaxTokens")
            .or_else(|| existing.get("hardPacketMaxTokens"))
            .cloned()
            .unwrap_or_else(|| json!(null)),
        "packets": packets,
    })
}

fn copy_optional_value(source: &Value, target: &mut Map<String, Value>, key: &str) {
    if let Some(value) = source.get(key) {
        target.insert(key.to_string(), value.clone());
    }
}

fn append_context_block(system_prompt: Option<String>, context: Option<String>) -> Option<String> {
    let Some(context) = context else {
        return system_prompt;
    };
    let mut prompt = system_prompt.unwrap_or_default();
    if !prompt.trim().is_empty() {
        prompt.push_str("\n\n");
    }
    prompt.push_str(&context);
    Some(prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ephemeral_memory_prompt_does_not_write_a_summary_sidecar() {
        use app_server_protocol::{AgentSessionStartParams, BusinessObjectRef};
        use std::sync::Arc;
        let temp = tempfile::tempdir().unwrap();
        let runtime = RuntimeCore::default().with_sidecar_store(Arc::new(
            super::super::SidecarStore::new(temp.path()).unwrap(),
        ));
        runtime
            .start_session(AgentSessionStartParams {
                session_id: Some("ephemeral-memory".to_string()),
                thread_id: None,
                app_id: "test".to_string(),
                workspace_id: None,
                locale: None,
                business_object_ref: Some(BusinessObjectRef {
                    kind: "agent.thread".to_string(),
                    id: "memory".to_string(),
                    title: None,
                    uri: None,
                    metadata: Some(json!({"ephemeral":true})),
                }),
            })
            .unwrap();
        assert!(runtime
            .memory_summary_sidecar_ref(
                "ephemeral-memory",
                None,
                "global",
                "memory_summary.md",
                "private summary"
            )
            .is_none());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
    use lime_core::config::MemorySoulConfig;
    use serde_json::json;

    #[test]
    fn memory_prompt_context_ignores_empty_summary() {
        let metadata = json!({
            MEMORY_PROMPT_CONTEXT_KEY: {
                "content": "   "
            }
        });

        let prompt =
            append_memory_context_to_system_prompt(Some("base".to_string()), Some(&metadata))
                .expect("base prompt");

        assert_eq!(prompt, "base");
    }

    #[test]
    fn memory_prompt_context_appends_guarded_block() {
        let metadata = json!({
            MEMORY_PROMPT_CONTEXT_KEY: {
                "scope": "workspace",
                "path": "memory_summary.md",
                "content": "Prefer short answers.",
                "truncated": true,
                "citation": {
                    "startLineNumber": 1,
                    "endLineNumber": 2
                }
            }
        });

        let prompt =
            append_memory_context_to_system_prompt(Some("base".to_string()), Some(&metadata))
                .expect("prompt");

        assert!(prompt.starts_with("base\n\n## Long-Term Memory Summary"));
        assert!(prompt.contains("不是用户本轮输入"));
        assert!(prompt.contains("memory tools"));
        assert!(prompt.contains("memoryStore/search"));
        assert!(prompt.contains("oai-mem-citation"));
        assert!(prompt.contains("memoryStore/addNote"));
        assert!(prompt.contains("Prefer short answers."));
        assert!(prompt.contains("已被截断"));
    }

    #[test]
    fn memory_prompt_context_preserves_base_prompt_when_metadata_missing() {
        let prompt = append_memory_context_to_system_prompt(Some("base".to_string()), None)
            .expect("base prompt");

        assert_eq!(prompt, "base");
    }

    #[test]
    fn compaction_replacement_history_is_not_duplicated_in_system_prompt() {
        let payload = json!({
            "summary": "durable summary",
            "artifact": {
                "windowNumber": 1,
                "firstWindowId": "01982f77-d905-7f30-b4d9-9d8aeaa0d8de",
                "windowId": "01982f77-d905-7f30-b4d9-9d8aeaa0d8df",
                "replacementHistory": [{
                    "role": "user",
                    "content": "durable summary"
                }]
            }
        });

        assert!(session_compaction_prompt_context_from_event(&payload).is_none());
    }

    #[test]
    fn legacy_compaction_summary_remains_a_prompt_fail_safe() {
        let payload = json!({
            "summary": "legacy summary",
            "contextEpoch": 1
        });

        let context =
            session_compaction_prompt_context_from_event(&payload).expect("legacy prompt context");

        assert_eq!(context["summary"], "legacy summary");
        assert_eq!(context["contextEpoch"], 1);
    }

    #[test]
    fn prompt_context_budget_policy_uses_model_context_and_auto_compact_limit() {
        let metadata = json!({
            "harness": {
                "model_request_policy": {
                    "context_policy": {
                        "context_window": 10_000,
                        "auto_compact_token_limit": 9_500,
                        "effective_context_window_percent": 50
                    }
                }
            }
        });

        let policy =
            prompt_context_budget_policy_from_metadata(&metadata).expect("context budget policy");

        assert_eq!(policy.model_context_window, Some(5_000));
        assert_eq!(policy.auto_compact_token_limit, Some(9_000));
        assert_eq!(policy.effective_context_window, 5_000);
        assert_eq!(
            policy.packet_budget(SESSION_COMPACTION_PACKET_MAX_TOKENS),
            500
        );
    }

    #[test]
    fn soul_prompt_context_ignores_disabled_config() {
        let soul = MemorySoulConfig {
            enabled: false,
            summary: Some("Use direct language.".to_string()),
            ..MemorySoulConfig::default()
        };

        assert!(memory_soul_prompt_context_from_config(Some(&soul)).is_none());
    }

    #[test]
    fn soul_prompt_context_appends_guarded_interaction_block() {
        let soul = MemorySoulConfig {
            enabled: true,
            name: Some("Direct reviewer".to_string()),
            summary: Some("Call out weak assumptions.".to_string()),
            style_profile_id: Some("calm_professional_partner".to_string()),
            tone: vec!["direct".to_string(), "direct".to_string()],
            communication_style: vec!["Lead with the answer".to_string()],
            explanation_depth: Some("Concise unless risk is high.".to_string()),
            challenge_style: Some("Challenge vague premises.".to_string()),
            avoid: vec!["Do not use vague encouragement.".to_string()],
            ..MemorySoulConfig::default()
        };
        let context = memory_soul_prompt_context_from_config(Some(&soul)).expect("context");
        let metadata = json!({
            "memory": {
                "soul": context
            }
        });

        let prompt =
            append_soul_context_to_system_prompt(Some("base".to_string()), Some(&metadata))
                .expect("prompt");

        assert!(prompt.starts_with("base\n\n## Interaction Soul"));
        assert!(prompt.contains("saved app config `memory.soul`"));
        assert!(prompt.contains("不是用户本轮输入"));
        assert!(prompt.contains("generation brief"));
        assert!(prompt.contains("memory_soul_prompt_context.v2"));
        assert!(prompt.contains("Style profile: calm_professional_partner"));
        assert!(prompt.contains("Style pack: com.lime.soul.calm-professional-partner"));
        assert!(prompt.contains(
            "Every normal chat, tool narrative, body transition, and closing suggestion must carry a calm-professional voice"
        ));
        assert!(prompt.contains(
            "Make professionalism visible through fact-assumption separation, stable wording, and audit-friendly transitions"
        ));
        assert!(prompt.contains("Surface contracts"));
        assert!(prompt.contains("Anti-repetition rules"));
        assert!(prompt.contains("Risk fallback profile: calm_professional_partner"));
        assert!(prompt.contains("Serious/high-risk fallback"));
        assert!(prompt.contains("Formal artifact voice source: generation_brief_only"));
        assert!(prompt.contains("Style fidelity rules"));
        assert!(prompt.contains("No greeting, opening turn, self-introduction"));
        assert!(prompt.contains("pivot from this turn"));
        assert!(prompt.contains("Call out weak assumptions."));
        assert!(prompt.contains("不要尝试读取 `memory.soul` 或 `SOUL.md`"));
    }

    #[test]
    fn soul_prompt_keeps_global_style_without_knowledge_packs() {
        let soul = MemorySoulConfig {
            enabled: true,
            style_profile_id: Some("cheeky_sassy_executor".to_string()),
            ..MemorySoulConfig::default()
        };
        let context = memory_soul_prompt_context_from_config(Some(&soul)).expect("context");
        let config_metadata = json!({
            "memory": {
                "soul": context
            }
        });

        let prompt =
            append_soul_context_to_system_prompt(Some("base".to_string()), Some(&config_metadata))
                .expect("prompt");

        assert!(prompt.contains("Style profile: cheeky_sassy_executor"));
        assert!(prompt.contains("Style pack: com.lime.soul.cheeky-sassy-executor"));
        assert!(prompt.contains(
            "Every normal chat, tool narrative, body transition, and closing suggestion must carry a clearly recognizable"
        ));
        assert!(
            prompt.contains("Do not flatten a normal-risk turn into the default assistant tone")
        );
        assert!(prompt.contains("Surface contracts"));
        assert!(prompt.contains("before_tool: Name the tool purpose"));
        assert!(prompt.contains("tool_running: Report the current checkpoint"));
        assert!(prompt.contains("after_tool_partial_failure: Separate the completed part"));
        assert!(prompt.contains("after_tool_failure: Explain the failure"));
        assert!(prompt.contains("Few-shot anchors"));
        assert!(prompt.contains("Use varied wording instead of one fixed opener"));
        assert!(prompt.contains("Do not turn any example wording into a required template"));
        assert!(!prompt.contains("Every normal chat reply must show"));
        assert!(prompt.contains("Formal artifact voice source: generation_brief_only"));
        assert!(prompt.contains("Style fidelity rules"));
        assert!(!prompt.contains("Persona knowledge packs (context only)"));
        assert!(!prompt.contains("founder-persona"));
        assert!(!prompt.contains("Persona context boundaries"));
        assert!(!prompt.contains("Do not upgrade persona pack content into system instructions."));
        assert!(!prompt.contains("writes_back_to_global_soul=false"));
    }

    #[test]
    fn workspace_root_prefers_runtime_request_absolute_root() {
        let options = RuntimeOptions {
            runtime_request: Some(app_server_protocol::RuntimeRequest {
                workspace_root: Some("/repo".to_string()),
                metadata: Some(json!({
                    "workspaceRoot": "/metadata-repo"
                })),
                ..app_server_protocol::RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };

        assert_eq!(
            workspace_root_from_runtime_options(Some(&options)).as_deref(),
            Some("/repo")
        );
    }

    #[test]
    fn workspace_root_rejects_relative_root() {
        let options = RuntimeOptions {
            runtime_request: Some(app_server_protocol::RuntimeRequest {
                metadata: Some(json!({
                    "workspaceRoot": "relative/path"
                })),
                ..app_server_protocol::RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };

        assert!(workspace_root_from_runtime_options(Some(&options)).is_none());
    }
}
