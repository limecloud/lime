use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use crate::tool_definition::RuntimeToolDefinition;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const IMAGE_GENERATION_CONTRACT_KEY: &str = "image_generation";
pub const IMAGE_GENERATE_SKILL_NAME: &str = "image_generate";
pub const SKILL_TOOL_NAME: &str = "Skill";
pub const SKILL_TOOL_DESCRIPTION: &str = "在显式启用的工作流中执行技能。通用对话默认不会暴露技能自动调用能力；专家绑定或 workspace runtime enable 的候选技能必须先调用 skill_search 记录 selector 证据，再调用 Skill。";

pub fn skill_tool_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "skill": {
                "type": "string",
                "description": "The skill name. E.g., 'pdf', 'user:my-skill'"
            },
            "args": {
                "type": "string",
                "description": "Optional arguments for the skill"
            }
        },
        "required": ["skill"]
    })
}

pub fn skill_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        SKILL_TOOL_NAME,
        SKILL_TOOL_DESCRIPTION,
        skill_tool_input_schema(),
    )
}

pub fn normalize_skill_invocation_params(mut params: Value) -> Value {
    if let Some(object) = params.as_object_mut() {
        let should_stringify_args = object
            .get("args")
            .is_some_and(|args| args.is_object() || args.is_array());
        if should_stringify_args {
            if let Some(args) = object.get("args").cloned() {
                object.insert(
                    "args".to_string(),
                    Value::String(
                        serde_json::to_string(&args).unwrap_or_else(|_| args.to_string()),
                    ),
                );
            }
        }
    }
    params
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillToolAccessError {
    Disabled,
    NotAllowed { skill_name: String },
}

impl SkillToolAccessError {
    pub fn message(&self) -> String {
        match self {
            SkillToolAccessError::Disabled => skill_tool_disabled_message().to_string(),
            SkillToolAccessError::NotAllowed { skill_name } => {
                skill_tool_not_allowed_message(skill_name)
            }
        }
    }
}

#[derive(Debug, Clone, Default)]
struct SkillToolSessionAccess {
    enabled: bool,
    allowed_skills: Option<HashSet<String>>,
    skill_sources: HashMap<String, SkillToolSessionSkillSource>,
    allowed_capabilities: HashSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillPolicyDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillTokenBudgetDecision {
    NotEvaluated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPolicyEvaluation {
    pub decision: SkillPolicyDecision,
    pub reason: String,
    pub source: String,
    pub authority: String,
    pub skill_name: String,
    pub required_capabilities: Vec<String>,
    pub missing_capabilities: Vec<String>,
    pub estimated_tokens: Option<u32>,
    pub max_visible_tokens: Option<u32>,
    pub token_budget: SkillTokenBudgetDecision,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillToolSessionSkillSource {
    pub workspace_root: String,
    pub source: String,
    pub approval: String,
    pub directory: String,
    pub registered_skill_directory: String,
    pub skill_name: String,
    pub source_draft_id: String,
    pub source_verification_report_id: String,
    pub permission_summary: Vec<String>,
}

fn session_access_store() -> &'static Mutex<HashMap<String, SkillToolSessionAccess>> {
    static STORE: OnceLock<Mutex<HashMap<String, SkillToolSessionAccess>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn set_skill_tool_session_access(session_id: &str, enabled: bool) {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let store = session_access_store();
    let mut guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    guard.insert(
        session_id.to_string(),
        SkillToolSessionAccess {
            enabled,
            allowed_skills: None,
            skill_sources: HashMap::new(),
            allowed_capabilities: HashSet::new(),
        },
    );
}

pub fn set_skill_tool_session_allowed_skills<I, S>(session_id: &str, allowed_skills: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let allowed = allowed_skills
        .into_iter()
        .flat_map(|skill| skill_name_gate_aliases(skill.as_ref()))
        .collect::<HashSet<_>>();
    let store = session_access_store();
    let mut guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    guard.insert(
        session_id.to_string(),
        SkillToolSessionAccess {
            enabled: !allowed.is_empty(),
            allowed_skills: Some(allowed),
            skill_sources: HashMap::new(),
            allowed_capabilities: HashSet::new(),
        },
    );
}

pub fn add_skill_tool_session_allowed_capabilities<I, S>(session_id: &str, capabilities: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let capabilities = capabilities
        .into_iter()
        .map(|capability| capability.as_ref().trim().to_ascii_lowercase())
        .filter(|capability| !capability.is_empty())
        .collect::<HashSet<_>>();
    if capabilities.is_empty() {
        return;
    }

    let store = session_access_store();
    let mut guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    let access = guard
        .entry(session_id.to_string())
        .or_insert_with(|| SkillToolSessionAccess {
            enabled: true,
            allowed_skills: Some(HashSet::new()),
            skill_sources: HashMap::new(),
            allowed_capabilities: HashSet::new(),
        });
    access.enabled = true;
    access.allowed_capabilities.extend(capabilities);
}

pub fn set_skill_tool_session_allowed_skill_sources<I>(session_id: &str, sources: I)
where
    I: IntoIterator<Item = SkillToolSessionSkillSource>,
{
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let mut allowed = HashSet::new();
    let mut skill_sources = HashMap::new();
    for source in sources {
        for alias in skill_name_gate_aliases(&source.skill_name)
            .into_iter()
            .chain(skill_name_gate_aliases(&source.directory))
        {
            allowed.insert(alias.clone());
            skill_sources.insert(alias, source.clone());
        }
    }

    let store = session_access_store();
    let mut guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    guard.insert(
        session_id.to_string(),
        SkillToolSessionAccess {
            enabled: !allowed.is_empty(),
            allowed_skills: Some(allowed),
            skill_sources,
            allowed_capabilities: HashSet::new(),
        },
    );
}

pub fn clear_skill_tool_session_access(session_id: &str) {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let store = session_access_store();
    let mut guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    guard.remove(session_id);
}

pub fn is_skill_tool_session_skill_allowed(session_id: &str, skill_name: &str) -> bool {
    is_skill_allowed_for_session(session_id, skill_name)
}

pub fn check_skill_tool_access(
    session_id: &str,
    params: &Value,
) -> Result<(), SkillToolAccessError> {
    let evaluation = evaluate_skill_tool_policy(session_id, params);
    if evaluation.decision == SkillPolicyDecision::Deny {
        if evaluation.reason == "session_skill_runtime_disabled" {
            return Err(SkillToolAccessError::Disabled);
        }
        return Err(SkillToolAccessError::NotAllowed {
            skill_name: evaluation.skill_name,
        });
    }

    Ok(())
}

pub fn evaluate_skill_tool_policy(session_id: &str, params: &Value) -> SkillPolicyEvaluation {
    let skill_name = params
        .get("skill")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string();
    let mut evaluation = SkillPolicyEvaluation {
        decision: SkillPolicyDecision::Deny,
        reason: "session_skill_runtime_disabled".to_string(),
        source: "session_skill_gate".to_string(),
        authority: "session_runtime".to_string(),
        skill_name: skill_name.clone(),
        required_capabilities: skill_required_turn_capability(&skill_name)
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        missing_capabilities: Vec::new(),
        estimated_tokens: None,
        max_visible_tokens: None,
        token_budget: SkillTokenBudgetDecision::NotEvaluated,
    };

    let session_id = session_id.trim();
    let store = session_access_store();
    let guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    let Some(access) = guard.get(session_id) else {
        return evaluation;
    };
    if !access.enabled {
        return evaluation;
    }
    evaluation.reason = "skill_allowlist_checked".to_string();

    let allowed_by_capability =
        is_skill_allowed_by_turn_capability(&skill_name, &access.allowed_capabilities);
    let allowed_by_name = access.allowed_skills.as_ref().is_none_or(|allowed| {
        skill_name_gate_aliases(&skill_name)
            .iter()
            .any(|alias| allowed.contains(alias))
    });
    if !allowed_by_capability && !allowed_by_name {
        evaluation.missing_capabilities = evaluation.required_capabilities.clone();
        evaluation.reason = "skill_not_allowlisted".to_string();
        return evaluation;
    }

    if let Some(source) = skill_name_gate_aliases(&skill_name)
        .iter()
        .find_map(|alias| access.skill_sources.get(alias))
    {
        evaluation.source = source.source.clone();
        evaluation.authority = source.approval.clone();
    }

    evaluation.decision = SkillPolicyDecision::Allow;
    evaluation.reason = "skill_allowlisted".to_string();
    evaluation
}

pub fn is_skill_tool_enabled_for_session(session_id: &str) -> bool {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return false;
    }

    let store = session_access_store();
    let guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    guard
        .get(session_id)
        .map(|access| access.enabled)
        .unwrap_or(false)
}

pub fn skill_tool_disabled_message() -> &'static str {
    "当前会话未启用技能自动调用。请改用显式 /skill-name 指令，或切换到需要技能编排的工作流。"
}

fn skill_name_gate_aliases(skill_name: &str) -> Vec<String> {
    let full = skill_name
        .trim()
        .trim_start_matches('/')
        .to_ascii_lowercase();
    if full.is_empty() {
        return Vec::new();
    }

    let short = full
        .rsplit(':')
        .next()
        .unwrap_or(full.as_str())
        .trim()
        .to_string();
    if short.is_empty() || short == full {
        vec![full]
    } else {
        vec![full, short]
    }
}

fn skill_required_turn_capability(skill_name: &str) -> Option<&'static str> {
    match normalize_skill_name(skill_name).as_str() {
        IMAGE_GENERATE_SKILL_NAME => Some(IMAGE_GENERATION_CONTRACT_KEY),
        _ => None,
    }
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

fn is_skill_allowed_by_turn_capability(
    skill_name: &str,
    allowed_capabilities: &HashSet<String>,
) -> bool {
    skill_required_turn_capability(skill_name).is_some_and(|required| {
        allowed_capabilities
            .iter()
            .any(|capability| capability.eq_ignore_ascii_case(required))
    })
}

pub fn is_skill_allowed_for_session(session_id: &str, skill_name: &str) -> bool {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return false;
    }

    let store = session_access_store();
    let guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    let Some(access) = guard.get(session_id) else {
        return false;
    };
    if !access.enabled {
        return false;
    }

    if is_skill_allowed_by_turn_capability(skill_name, &access.allowed_capabilities) {
        return true;
    }

    let Some(allowed_skills) = access.allowed_skills.as_ref() else {
        return true;
    };
    skill_name_gate_aliases(skill_name)
        .iter()
        .any(|alias| allowed_skills.contains(alias))
}

pub fn workspace_skill_source_for_session_skill(
    session_id: &str,
    skill_name: &str,
) -> Option<SkillToolSessionSkillSource> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return None;
    }

    let store = session_access_store();
    let guard = match store.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    let access = guard.get(session_id)?;
    if !access.enabled {
        return None;
    }
    skill_name_gate_aliases(skill_name)
        .iter()
        .find_map(|alias| access.skill_sources.get(alias).cloned())
}

pub fn workspace_skill_source_for_invocation_params(
    session_id: &str,
    params: &Value,
) -> Option<SkillToolSessionSkillSource> {
    params
        .get("skill")
        .and_then(Value::as_str)
        .and_then(|skill_name| workspace_skill_source_for_session_skill(session_id, skill_name))
}

pub fn skill_tool_not_allowed_message(skill_name: &str) -> String {
    format!(
        "当前会话未授权执行 Skill({})；请先通过 workspace skill runtime enable gate 显式启用该能力。",
        skill_name.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlisted_session_allows_short_alias() {
        let session_id = "skill-gate-alias-session";
        set_skill_tool_session_allowed_skills(session_id, ["project:capability-report"]);

        assert!(is_skill_allowed_for_session(
            session_id,
            "capability-report"
        ));
        assert!(is_skill_allowed_for_session(
            session_id,
            "project:capability-report"
        ));
        assert!(!is_skill_allowed_for_session(session_id, "other-skill"));

        clear_skill_tool_session_access(session_id);
    }

    #[test]
    fn turn_capability_allows_mapped_skill_only() {
        let session_id = "skill-gate-capability-session";
        add_skill_tool_session_allowed_capabilities(session_id, [IMAGE_GENERATION_CONTRACT_KEY]);

        assert!(is_skill_allowed_for_session(
            session_id,
            IMAGE_GENERATE_SKILL_NAME
        ));
        assert!(!is_skill_allowed_for_session(session_id, "research"));

        clear_skill_tool_session_access(session_id);
    }

    #[test]
    fn skill_tool_access_check_materializes_disabled_and_allowlist_errors() {
        let session_id = "skill-gate-access-session";
        clear_skill_tool_session_access(session_id);

        let disabled = check_skill_tool_access(
            session_id,
            &serde_json::json!({ "skill": "project:capability-report" }),
        )
        .expect_err("disabled session should fail");
        assert_eq!(disabled, SkillToolAccessError::Disabled);
        assert!(disabled.message().contains("未启用技能自动调用"));

        set_skill_tool_session_allowed_skills(session_id, ["project:capability-report"]);
        assert!(
            check_skill_tool_access(
                session_id,
                &serde_json::json!({ "skill": "capability-report" }),
            )
            .is_ok()
        );
        let denied =
            check_skill_tool_access(session_id, &serde_json::json!({ "skill": "other-skill" }))
                .expect_err("unlisted skill should fail");
        assert_eq!(
            denied,
            SkillToolAccessError::NotAllowed {
                skill_name: "other-skill".to_string()
            }
        );
        assert!(denied.message().contains("未授权执行 Skill"));

        clear_skill_tool_session_access(session_id);
    }

    #[test]
    fn workspace_skill_source_can_be_resolved_from_invocation_params() {
        let session_id = "skill-gate-source-params-session";
        let source = SkillToolSessionSkillSource {
            workspace_root: "/tmp/workspace".to_string(),
            source: "manual_session_enable".to_string(),
            approval: "manual".to_string(),
            directory: "capability-report".to_string(),
            registered_skill_directory: "/tmp/workspace/.agents/skills/capability-report"
                .to_string(),
            skill_name: "project:capability-report".to_string(),
            source_draft_id: "capdraft-1".to_string(),
            source_verification_report_id: "capver-1".to_string(),
            permission_summary: vec!["Level 0 只读发现".to_string()],
        };
        set_skill_tool_session_allowed_skill_sources(session_id, [source.clone()]);

        let restored = workspace_skill_source_for_invocation_params(
            session_id,
            &serde_json::json!({ "skill": "capability-report" }),
        )
        .expect("source should resolve from short skill name");
        let evaluation = evaluate_skill_tool_policy(
            session_id,
            &serde_json::json!({ "skill": "capability-report" }),
        );

        clear_skill_tool_session_access(session_id);

        assert_eq!(restored, source);
        assert_eq!(evaluation.source, "manual_session_enable");
        assert_eq!(evaluation.authority, "manual");
    }

    #[test]
    fn skill_tool_surface_matches_current_contract() {
        let definition = skill_tool_definition();
        let schema = skill_tool_input_schema();

        assert_eq!(SKILL_TOOL_NAME, "Skill");
        assert!(SKILL_TOOL_DESCRIPTION.contains("skill_search"));
        assert_eq!(definition.name, SKILL_TOOL_NAME);
        assert_eq!(definition.description, SKILL_TOOL_DESCRIPTION);
        assert_eq!(definition.input_schema, schema);
        assert_eq!(schema.get("type"), Some(&serde_json::json!("object")));
        assert_eq!(
            schema.pointer("/properties/skill/type"),
            Some(&serde_json::json!("string"))
        );
        assert_eq!(
            schema.pointer("/properties/args/type"),
            Some(&serde_json::json!("string"))
        );
        assert_eq!(schema.get("required"), Some(&serde_json::json!(["skill"])));
    }

    #[test]
    fn skill_invocation_params_stringify_structured_args() {
        let params = normalize_skill_invocation_params(serde_json::json!({
            "skill": "content-reviewer",
            "args": {
                "projectId": "project-1"
            }
        }));

        assert!(
            params
                .get("args")
                .and_then(Value::as_str)
                .is_some_and(|args| args.contains("project-1"))
        );
    }

    #[test]
    fn policy_evaluation_exposes_reason_capability_and_pending_body_budget() {
        let session_id = "skill-gate-policy-session";
        set_skill_tool_session_allowed_skills(session_id, ["project:research"]);

        let allowed = evaluate_skill_tool_policy(
            session_id,
            &serde_json::json!({ "skill": "research", "args": "cite sources" }),
        );
        assert_eq!(allowed.decision, SkillPolicyDecision::Allow);
        assert_eq!(allowed.reason, "skill_allowlisted");
        assert_eq!(allowed.source, "session_skill_gate");
        assert_eq!(allowed.estimated_tokens, None);
        assert_eq!(allowed.max_visible_tokens, None);
        assert_eq!(allowed.token_budget, SkillTokenBudgetDecision::NotEvaluated);

        let capability_denied = evaluate_skill_tool_policy(
            session_id,
            &serde_json::json!({ "skill": IMAGE_GENERATE_SKILL_NAME }),
        );
        assert_eq!(
            capability_denied.missing_capabilities,
            vec![IMAGE_GENERATION_CONTRACT_KEY.to_string()]
        );

        clear_skill_tool_session_access(session_id);
    }
}
