use crate::skill_gate::{IMAGE_GENERATE_SKILL_NAME, IMAGE_GENERATION_CONTRACT_KEY};
use serde_json::{Map, Value, json};
use std::sync::OnceLock;

const MODALITY_RUNTIME_CONTRACTS_JSON: &str =
    include_str!("../../../../src/lib/governance/modalityRuntimeContracts.json");
const MODALITY_EXECUTION_PROFILES_JSON: &str =
    include_str!("../../../../src/lib/governance/modalityExecutionProfiles.json");

pub const PDF_EXTRACT_CONTRACT_KEY: &str = "pdf_extract";
pub const AUDIO_TRANSCRIPTION_CONTRACT_KEY: &str = "audio_transcription";
pub const WEB_RESEARCH_CONTRACT_KEY: &str = "web_research";
pub const TEXT_TRANSFORM_CONTRACT_KEY: &str = "text_transform";

const POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED: &str = "local_defaults_evaluated";
const POLICY_DECISION_ALLOW: &str = "allow";
const POLICY_DECISION_ASK: &str = "ask";
const POLICY_DECISION_SOURCE_LOCAL_DEFAULT: &str = "local_default_policy";
const POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR: &str = "policy_input_evaluator";
const POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY: &str = "local_defaults_only";
const POLICY_DECISION_REASON_NO_LOCAL_DENY: &str = "declared_policy_refs_with_no_local_deny_rule";
const POLICY_DECISION_REASON_POLICY_INPUTS_MISSING: &str = "declared_policy_refs_missing_inputs";
const POLICY_INPUT_STATUS_DECLARED_ONLY: &str = "declared_only";
const POLICY_INPUT_VALUE_SOURCE_PENDING: &str = "limecore_pending";

#[derive(Debug, Clone, Copy)]
struct SkillRuntimeContractSpec {
    contract_key: &'static str,
    default_entry_source: &'static str,
}

#[derive(Debug, Clone)]
pub struct SkillRuntimeContractMetadata {
    pub contract_key: String,
    pub modality: String,
    pub required_capabilities: Vec<String>,
    pub routing_slot: String,
    pub runtime_contract: Value,
    pub entry_source: Option<String>,
}

impl SkillRuntimeContractMetadata {
    pub fn metadata_value(&self) -> Value {
        json!({
            "contractKey": self.contract_key,
            "modality": self.modality,
            "requiredCapabilities": self.required_capabilities,
            "routingSlot": self.routing_slot,
            "runtimeContract": self.runtime_contract,
            "entrySource": self.entry_source,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SkillRuntimeContractPreflightError {
    pub metadata: Box<SkillRuntimeContractMetadata>,
    pub skill_name: String,
    pub suffix: String,
    pub message: String,
}

impl SkillRuntimeContractPreflightError {
    pub fn code(&self) -> String {
        format!("{}_{}", self.metadata.contract_key, self.suffix)
    }

    pub fn result_payload(&self) -> Value {
        json!({
            "success": false,
            "skill": self.skill_name,
            "error": {
                "code": self.code(),
                "message": self.message,
                "stage": "runtime_preflight",
                "retryable": false,
            }
        })
    }
}

fn governance_runtime_contracts() -> &'static Value {
    static REGISTRY: OnceLock<Value> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        serde_json::from_str(MODALITY_RUNTIME_CONTRACTS_JSON)
            .expect("modalityRuntimeContracts.json should be valid JSON")
    })
}

fn governance_execution_profiles() -> &'static Value {
    static REGISTRY: OnceLock<Value> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        serde_json::from_str(MODALITY_EXECUTION_PROFILES_JSON)
            .expect("modalityExecutionProfiles.json should be valid JSON")
    })
}

fn normalize_skill_name(skill_name: &str) -> String {
    skill_name
        .trim()
        .trim_start_matches('/')
        .rsplit(':')
        .next()
        .unwrap_or(skill_name)
        .trim()
        .to_ascii_lowercase()
}

fn current_skill_runtime_contract_spec(skill_name: &str) -> Option<SkillRuntimeContractSpec> {
    match normalize_skill_name(skill_name).as_str() {
        IMAGE_GENERATE_SKILL_NAME => Some(SkillRuntimeContractSpec {
            contract_key: IMAGE_GENERATION_CONTRACT_KEY,
            default_entry_source: "at_image_command",
        }),
        "pdf_read" => Some(SkillRuntimeContractSpec {
            contract_key: PDF_EXTRACT_CONTRACT_KEY,
            default_entry_source: "at_pdf_read_command",
        }),
        "transcription_generate" => Some(SkillRuntimeContractSpec {
            contract_key: AUDIO_TRANSCRIPTION_CONTRACT_KEY,
            default_entry_source: "at_transcription_command",
        }),
        "research" => Some(SkillRuntimeContractSpec {
            contract_key: WEB_RESEARCH_CONTRACT_KEY,
            default_entry_source: "at_search_command",
        }),
        "report_generate" => Some(SkillRuntimeContractSpec {
            contract_key: WEB_RESEARCH_CONTRACT_KEY,
            default_entry_source: "at_report_command",
        }),
        "site_search" => Some(SkillRuntimeContractSpec {
            contract_key: WEB_RESEARCH_CONTRACT_KEY,
            default_entry_source: "at_site_search_command",
        }),
        "summary" => Some(SkillRuntimeContractSpec {
            contract_key: TEXT_TRANSFORM_CONTRACT_KEY,
            default_entry_source: "at_summary_command",
        }),
        "translation" => Some(SkillRuntimeContractSpec {
            contract_key: TEXT_TRANSFORM_CONTRACT_KEY,
            default_entry_source: "at_translation_command",
        }),
        "analysis" => Some(SkillRuntimeContractSpec {
            contract_key: TEXT_TRANSFORM_CONTRACT_KEY,
            default_entry_source: "at_analysis_command",
        }),
        _ => None,
    }
}

fn read_trimmed_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_string_from_object(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| read_trimmed_string(object.get(*key)))
}

fn read_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn find_contract_record(contract_key: &str) -> Option<&'static Map<String, Value>> {
    governance_runtime_contracts()
        .get("contracts")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_object)
        .find(|contract| {
            read_string_from_object(contract, &["contract_key", "contractKey"]).as_deref()
                == Some(contract_key)
        })
}

fn find_execution_profile_for_contract(contract_key: &str) -> Option<&'static Map<String, Value>> {
    governance_execution_profiles()
        .get("profiles")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_object)
        .find(|profile| {
            read_string_array(profile.get("supported_contracts"))
                .iter()
                .any(|supported| supported == contract_key)
        })
}

fn find_executor_adapter(adapter_key: &str) -> Option<&'static Map<String, Value>> {
    governance_execution_profiles()
        .get("executor_adapters")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_object)
        .find(|adapter| {
            read_string_from_object(adapter, &["adapter_key", "adapterKey"]).as_deref()
                == Some(adapter_key)
        })
}

fn resolve_executor_adapter_key(
    executor_binding: Option<&Value>,
    execution_profile: Option<&Map<String, Value>>,
) -> Option<String> {
    let from_binding = executor_binding
        .and_then(Value::as_object)
        .and_then(|binding| {
            let kind = read_string_from_object(binding, &["executor_kind", "executorKind"])?;
            let binding_key = read_string_from_object(binding, &["binding_key", "bindingKey"])?;
            Some(format!("{kind}:{binding_key}"))
        });
    from_binding.or_else(|| {
        execution_profile.and_then(|profile| {
            read_string_array(profile.get("executor_adapter_keys"))
                .into_iter()
                .next()
        })
    })
}

fn policy_snapshot(policy_refs: &[String]) -> Value {
    json!({
        "status": POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED,
        "decision": POLICY_DECISION_ALLOW,
        "source": "modality_runtime_contract",
        "decision_source": POLICY_DECISION_SOURCE_LOCAL_DEFAULT,
        "decision_scope": POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY,
        "decision_reason": POLICY_DECISION_REASON_NO_LOCAL_DENY,
        "refs": policy_refs,
        "evaluated_refs": [],
        "unresolved_refs": policy_refs,
        "missing_inputs": policy_refs,
        "policy_inputs": policy_refs
            .iter()
            .map(|policy_ref| {
                json!({
                    "ref_key": policy_ref,
                    "status": POLICY_INPUT_STATUS_DECLARED_ONLY,
                    "source": "modality_runtime_contract",
                    "value_source": POLICY_INPUT_VALUE_SOURCE_PENDING,
                })
            })
            .collect::<Vec<_>>(),
        "pending_hit_refs": policy_refs,
        "policy_value_hits": [],
        "policy_value_hit_count": 0,
        "policy_evaluation": {
            "status": "input_gap",
            "decision": POLICY_DECISION_ASK,
            "decision_source": POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
            "decision_scope": "pending_policy_inputs",
            "decision_reason": POLICY_DECISION_REASON_POLICY_INPUTS_MISSING,
            "blocking_refs": [],
            "ask_refs": policy_refs,
            "pending_refs": policy_refs,
        },
    })
}

fn build_current_runtime_contract(contract_key: &str) -> Option<Value> {
    let contract = find_contract_record(contract_key)?;
    let execution_profile = find_execution_profile_for_contract(contract_key);
    let executor_binding = contract.get("executor_binding").cloned();
    let executor_adapter =
        resolve_executor_adapter_key(executor_binding.as_ref(), execution_profile).and_then(
            |adapter_key| {
                find_executor_adapter(&adapter_key).map(|adapter| Value::Object(adapter.clone()))
            },
        );
    let policy_refs = read_string_array(contract.get("limecore_policy_refs"));
    let policy_snapshot = policy_snapshot(&policy_refs);

    Some(json!({
        "contract_key": read_string_from_object(contract, &["contract_key", "contractKey"])
            .unwrap_or_else(|| contract_key.to_string()),
        "modality": read_string_from_object(contract, &["modality"]).unwrap_or_default(),
        "required_capabilities": read_string_array(contract.get("required_capabilities")),
        "routing_slot": read_string_from_object(contract, &["routing_slot", "routingSlot"])
            .unwrap_or_default(),
        "executor_binding": executor_binding,
        "execution_profile": execution_profile.map(|profile| Value::Object(profile.clone())),
        "executor_adapter": executor_adapter,
        "limecore_policy_refs": policy_refs,
        "limecore_policy_snapshot": policy_snapshot,
        "truth_source": contract.get("truth_source").cloned().unwrap_or_else(|| json!([])),
        "artifact_kinds": contract.get("artifact_kinds").cloned().unwrap_or_else(|| json!([])),
        "viewer_surface": contract.get("viewer_surface").cloned().unwrap_or_else(|| json!([])),
        "owner_surface": read_string_from_object(contract, &["owner_surface", "ownerSurface"])
            .unwrap_or_else(|| "agent_runtime".to_string()),
    }))
}

fn runtime_contract_string(
    runtime_contract: &Value,
    snake_path: &[&str],
    camel_path: &[&str],
) -> Option<String> {
    runtime_contract
        .pointer(&format!("/{}", snake_path.join("/")))
        .or_else(|| runtime_contract.pointer(&format!("/{}", camel_path.join("/"))))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn looks_like_runtime_contract(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    [
        "contract_key",
        "contractKey",
        "executor_binding",
        "executorBinding",
        "execution_profile",
        "executionProfile",
        "executor_adapter",
        "executorAdapter",
        "routing_slot",
        "routingSlot",
    ]
    .iter()
    .any(|key| object.contains_key(*key))
}

fn extract_runtime_contract_from_value(value: &Value, depth: usize) -> Option<Value> {
    if depth > 8 {
        return None;
    }
    let object = value.as_object()?;

    for key in [
        "runtime_contract",
        "runtimeContract",
        "modality_runtime_contract",
        "modalityRuntimeContract",
    ] {
        let Some(candidate) = object.get(key) else {
            continue;
        };
        if let Some(runtime_contract) = candidate
            .get("runtimeContract")
            .or_else(|| candidate.get("runtime_contract"))
            .filter(|nested| nested.is_object())
        {
            return Some(runtime_contract.clone());
        }
        if candidate.is_object() && looks_like_runtime_contract(candidate) {
            return Some(candidate.clone());
        }
    }

    object
        .values()
        .find_map(|nested| extract_runtime_contract_from_value(nested, depth + 1))
}

fn parse_skill_args_value(params: &Value) -> Option<Value> {
    match params.get("args") {
        Some(Value::String(args)) => serde_json::from_str::<Value>(args).ok(),
        Some(value) if value.is_object() || value.is_array() => Some(value.clone()),
        _ => None,
    }
}

fn extract_runtime_contract_from_params(params: &Value) -> Option<Value> {
    extract_runtime_contract_from_value(params, 0).or_else(|| {
        parse_skill_args_value(params)
            .and_then(|args| extract_runtime_contract_from_value(&args, 0))
    })
}

fn extract_entry_source_from_value(value: &Value, depth: usize) -> Option<String> {
    if depth > 8 {
        return None;
    }
    let object = value.as_object()?;
    if let Some(entry_source) = read_string_from_object(object, &["entry_source", "entrySource"]) {
        return Some(entry_source);
    }
    object
        .values()
        .find_map(|nested| extract_entry_source_from_value(nested, depth + 1))
}

fn extract_entry_source_from_params(params: &Value) -> Option<String> {
    extract_entry_source_from_value(params, 0).or_else(|| {
        parse_skill_args_value(params).and_then(|args| extract_entry_source_from_value(&args, 0))
    })
}

fn expected_runtime_contract_string(
    runtime_contract: &Value,
    snake_path: &[&str],
    camel_path: &[&str],
) -> Option<String> {
    runtime_contract_string(runtime_contract, snake_path, camel_path)
}

fn build_runtime_preflight_error(
    metadata: SkillRuntimeContractMetadata,
    skill_name: &str,
    suffix: &str,
    message: String,
) -> SkillRuntimeContractPreflightError {
    SkillRuntimeContractPreflightError {
        metadata: Box::new(metadata),
        skill_name: skill_name.to_string(),
        suffix: suffix.to_string(),
        message,
    }
}

fn validate_runtime_contract_preflight(
    metadata: &SkillRuntimeContractMetadata,
    skill_name: &str,
) -> Result<(), SkillRuntimeContractPreflightError> {
    let contract_key = runtime_contract_string(
        &metadata.runtime_contract,
        &["contract_key"],
        &["contractKey"],
    )
    .ok_or_else(|| {
        build_runtime_preflight_error(
            metadata.clone(),
            skill_name,
            "contract_key_missing",
            format!(
                "{} runtime_contract 缺少 contract_key，已阻止进入 Skill 执行器。",
                metadata.contract_key
            ),
        )
    })?;
    if contract_key != metadata.contract_key {
        return Err(build_runtime_preflight_error(
            metadata.clone(),
            skill_name,
            "contract_key_mismatch",
            format!(
                "{} runtime_contract contract_key 必须是 {}，收到 {}。",
                metadata.contract_key, metadata.contract_key, contract_key
            ),
        ));
    }

    let expected = build_current_runtime_contract(&metadata.contract_key)
        .unwrap_or_else(|| metadata.runtime_contract.clone());
    for (snake_path, camel_path, suffix, label) in [
        (
            &["execution_profile", "profile_key"][..],
            &["executionProfile", "profileKey"][..],
            "execution_profile",
            "execution_profile.profile_key",
        ),
        (
            &["executor_adapter", "adapter_key"][..],
            &["executorAdapter", "adapterKey"][..],
            "executor_adapter",
            "executor_adapter.adapter_key",
        ),
        (
            &["executor_binding", "executor_kind"][..],
            &["executorBinding", "executorKind"][..],
            "executor_binding_kind",
            "executor_binding.executor_kind",
        ),
        (
            &["executor_binding", "binding_key"][..],
            &["executorBinding", "bindingKey"][..],
            "executor_binding_key",
            "executor_binding.binding_key",
        ),
    ] {
        let expected_value =
            expected_runtime_contract_string(&expected, snake_path, camel_path).unwrap_or_default();
        let actual_value =
            runtime_contract_string(&metadata.runtime_contract, snake_path, camel_path)
                .ok_or_else(|| {
                    build_runtime_preflight_error(
                        metadata.clone(),
                        skill_name,
                        &format!("{suffix}_missing"),
                        format!(
                            "{} runtime_contract 缺少 {label}，已阻止进入 Skill 执行器。",
                            metadata.contract_key
                        ),
                    )
                })?;
        if actual_value != expected_value {
            return Err(build_runtime_preflight_error(
                metadata.clone(),
                skill_name,
                &format!("{suffix}_mismatch"),
                format!(
                    "{} {label} 必须是 {expected_value}，收到 {actual_value}。",
                    metadata.contract_key
                ),
            ));
        }
    }

    Ok(())
}

pub fn build_skill_runtime_contract_metadata(
    params: &Value,
) -> Result<Option<SkillRuntimeContractMetadata>, SkillRuntimeContractPreflightError> {
    let Some(skill_name) = params.get("skill").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(spec) = current_skill_runtime_contract_spec(skill_name) else {
        return Ok(None);
    };
    let Some(default_runtime_contract) = build_current_runtime_contract(spec.contract_key) else {
        return Ok(None);
    };
    let provided_runtime_contract = extract_runtime_contract_from_params(params);
    let runtime_contract = provided_runtime_contract
        .clone()
        .unwrap_or_else(|| default_runtime_contract.clone());
    let metadata = SkillRuntimeContractMetadata {
        contract_key: spec.contract_key.to_string(),
        modality: runtime_contract_string(&runtime_contract, &["modality"], &["modality"])
            .or_else(|| {
                runtime_contract_string(&default_runtime_contract, &["modality"], &["modality"])
            })
            .unwrap_or_default(),
        required_capabilities: runtime_contract
            .get("required_capabilities")
            .or_else(|| runtime_contract.get("requiredCapabilities"))
            .map(|value| read_string_array(Some(value)))
            .filter(|values| !values.is_empty())
            .unwrap_or_else(|| {
                read_string_array(default_runtime_contract.get("required_capabilities"))
            }),
        routing_slot: runtime_contract_string(
            &runtime_contract,
            &["routing_slot"],
            &["routingSlot"],
        )
        .or_else(|| {
            runtime_contract_string(
                &default_runtime_contract,
                &["routing_slot"],
                &["routingSlot"],
            )
        })
        .unwrap_or_default(),
        runtime_contract,
        entry_source: extract_entry_source_from_params(params)
            .or_else(|| Some(spec.default_entry_source.to_string())),
    };

    if provided_runtime_contract.is_some() {
        validate_runtime_contract_preflight(&metadata, skill_name)?;
    }

    Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_skill_should_seed_runtime_contract_metadata_from_governance_registry() {
        let metadata = build_skill_runtime_contract_metadata(&json!({
            "skill": "site_search",
            "args": json!({
                "site_search_request": {
                    "query": "Lime",
                    "entry_source": "at_custom_site_search_command"
                }
            }).to_string()
        }))
        .expect("metadata should build")
        .expect("current skill should have runtime contract metadata");

        assert_eq!(metadata.contract_key, WEB_RESEARCH_CONTRACT_KEY);
        assert_eq!(
            metadata.entry_source.as_deref(),
            Some("at_custom_site_search_command")
        );
        assert_eq!(
            metadata
                .runtime_contract
                .pointer("/execution_profile/profile_key")
                .and_then(Value::as_str),
            Some("web_research_profile")
        );
        assert_eq!(
            metadata
                .runtime_contract
                .pointer("/executor_adapter/adapter_key")
                .and_then(Value::as_str),
            Some("skill:research")
        );
        assert_eq!(
            metadata
                .runtime_contract
                .pointer("/executor_binding/binding_key")
                .and_then(Value::as_str),
            Some("research")
        );
        assert_eq!(
            metadata
                .runtime_contract
                .pointer("/limecore_policy_snapshot/status")
                .and_then(Value::as_str),
            Some(POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED)
        );
    }

    #[test]
    fn provided_runtime_contract_should_block_wrong_executor_adapter() {
        let error = build_skill_runtime_contract_metadata(&json!({
            "skill": "pdf_read",
            "args": json!({
                "pdf_read_request": {
                    "runtime_contract": {
                        "contract_key": PDF_EXTRACT_CONTRACT_KEY,
                        "modality": "document",
                        "required_capabilities": [
                            "text_generation",
                            "local_file_read",
                            "long_context"
                        ],
                        "routing_slot": "base_model",
                        "execution_profile": {
                            "profile_key": "pdf_extract_profile"
                        },
                        "executor_adapter": {
                            "adapter_key": "skill:research"
                        },
                        "executor_binding": {
                            "executor_kind": "skill",
                            "binding_key": "pdf_read"
                        }
                    }
                }
            }).to_string()
        }))
        .expect_err("wrong adapter should return runtime preflight error");

        assert_eq!(error.code(), "pdf_extract_executor_adapter_mismatch");
        assert_eq!(error.result_payload()["success"], json!(false));
        assert_eq!(
            error
                .metadata
                .metadata_value()
                .pointer("/runtimeContract/executor_adapter/adapter_key"),
            Some(&json!("skill:research"))
        );
    }

    #[test]
    fn unknown_skill_should_not_seed_runtime_contract_metadata() {
        let metadata = build_skill_runtime_contract_metadata(&json!({
            "skill": "url_parse"
        }))
        .expect("unknown skill should not fail");

        assert!(metadata.is_none());
    }
}
