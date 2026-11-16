use crate::skill_gate::{
    check_skill_tool_access, evaluate_skill_tool_policy, normalize_skill_invocation_params,
    workspace_skill_source_for_invocation_params,
};
use crate::skill_result::{
    skill_preflight_failure_projection, skill_runtime_contract_metadata_map,
    workspace_skill_source_metadata_map,
};
use crate::skill_runtime_contract::build_skill_runtime_contract_metadata;
use async_trait::async_trait;
use lime_skills::{LlmProvider, SkillError, SkillRunResult, SkillRunner, find_skill_by_name};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct RuntimeSkillExecutionRequest {
    pub session_id: String,
    pub params: Value,
}

impl RuntimeSkillExecutionRequest {
    pub fn new(session_id: impl Into<String>, params: Value) -> Self {
        Self {
            session_id: session_id.into(),
            params,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeSkillBackendRequest {
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeSkillExecutionResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub metadata: HashMap<String, Value>,
}

impl RuntimeSkillExecutionResult {
    pub fn new(
        success: bool,
        output: Option<String>,
        error: Option<String>,
        metadata: HashMap<String, Value>,
    ) -> Self {
        Self {
            success,
            output,
            error,
            metadata,
        }
    }

    pub fn success(output: impl Into<String>) -> Self {
        Self::new(true, Some(output.into()), None, HashMap::new())
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self::new(false, None, Some(error.into()), HashMap::new())
    }

    pub fn with_metadata(mut self, metadata: HashMap<String, Value>) -> Self {
        self.metadata.extend(metadata);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeSkillExecutionError {
    message: String,
}

impl RuntimeSkillExecutionError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

#[async_trait]
pub trait RuntimeSkillExecutionBackend: Send + Sync {
    async fn execute_skill(
        &self,
        request: RuntimeSkillBackendRequest,
    ) -> Result<RuntimeSkillExecutionResult, RuntimeSkillExecutionError>;
}

pub struct RuntimeSkillDefinitionBackend<P>
where
    P: LlmProvider + Send + Sync,
{
    provider: P,
}

impl<P> RuntimeSkillDefinitionBackend<P>
where
    P: LlmProvider + Send + Sync,
{
    pub fn new(provider: P) -> Self {
        Self { provider }
    }
}

#[async_trait]
impl<P> RuntimeSkillExecutionBackend for RuntimeSkillDefinitionBackend<P>
where
    P: LlmProvider + Send + Sync,
{
    async fn execute_skill(
        &self,
        request: RuntimeSkillBackendRequest,
    ) -> Result<RuntimeSkillExecutionResult, RuntimeSkillExecutionError> {
        let skill_name = read_skill_name(&request.params)?;
        let args = read_skill_args(&request.params);
        let skill = find_skill_by_name(skill_name).map_err(RuntimeSkillExecutionError::new)?;
        let runner = SkillRunner::new(&self.provider);
        let result = runner
            .run(&skill, &args, None)
            .await
            .map_err(runtime_skill_error)?;
        Ok(runtime_result_from_skill_run(result))
    }
}

pub async fn run_skill_execution<B>(
    backend: &B,
    request: RuntimeSkillExecutionRequest,
) -> Result<RuntimeSkillExecutionResult, RuntimeSkillExecutionError>
where
    B: RuntimeSkillExecutionBackend + ?Sized,
{
    let policy_evaluation = evaluate_skill_tool_policy(&request.session_id, &request.params);
    check_skill_tool_access(&request.session_id, &request.params)
        .map_err(|error| RuntimeSkillExecutionError::new(error.message()))?;

    let workspace_skill_source =
        workspace_skill_source_for_invocation_params(&request.session_id, &request.params);
    let runtime_contract_metadata = match build_skill_runtime_contract_metadata(&request.params) {
        Ok(metadata) => metadata,
        Err(error) => {
            let failure = skill_preflight_failure_projection(error);
            let mut result =
                RuntimeSkillExecutionResult::error(failure.message).with_metadata(failure.metadata);
            if let Some(source) = workspace_skill_source.as_ref() {
                result = result.with_metadata(workspace_skill_source_metadata_map(source));
            }
            result = result.with_metadata(skill_policy_metadata(&policy_evaluation));
            return Ok(result);
        }
    };

    let params = normalize_skill_invocation_params(request.params);
    let mut result = backend
        .execute_skill(RuntimeSkillBackendRequest { params })
        .await?;

    if let Some(metadata) = runtime_contract_metadata.as_ref() {
        result = result.with_metadata(skill_runtime_contract_metadata_map(metadata));
    }
    if let Some(source) = workspace_skill_source.as_ref() {
        result = result.with_metadata(workspace_skill_source_metadata_map(source));
    }
    result = result.with_metadata(skill_policy_metadata(&policy_evaluation));
    Ok(result)
}

fn skill_policy_metadata(
    evaluation: &crate::skill_gate::SkillPolicyEvaluation,
) -> HashMap<String, Value> {
    HashMap::from([(
        "policy".to_string(),
        serde_json::to_value(evaluation).expect("skill policy evaluation is serializable"),
    )])
}

fn read_skill_name(params: &Value) -> Result<&str, RuntimeSkillExecutionError> {
    params
        .get("skill")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RuntimeSkillExecutionError::new("Missing required parameter: skill"))
}

fn read_skill_args(params: &Value) -> String {
    params
        .get("args")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn runtime_skill_error(error: SkillError) -> RuntimeSkillExecutionError {
    RuntimeSkillExecutionError::new(error.to_string())
}

fn runtime_result_from_skill_run(result: SkillRunResult) -> RuntimeSkillExecutionResult {
    RuntimeSkillExecutionResult::new(
        result.success,
        result.output.clone(),
        result.error.clone(),
        skill_run_metadata(result),
    )
}

fn skill_run_metadata(result: SkillRunResult) -> HashMap<String, Value> {
    let mut metadata = HashMap::from([(
        "skill".to_string(),
        serde_json::json!({
            "success": result.success,
            "stepsCompleted": result.steps_completed,
            "output": result.output,
            "error": result.error,
        }),
    )]);
    if let Some(command_name) = result.command_name {
        metadata.insert("command_name".to_string(), serde_json::json!(command_name));
    }
    if let Some(allowed_tools) = result.allowed_tools {
        metadata.insert(
            "allowed_tools".to_string(),
            serde_json::json!(allowed_tools),
        );
    }
    if let Some(model) = result.model {
        metadata.insert("model".to_string(), serde_json::json!(model));
    }
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_gate::{
        SkillToolSessionSkillSource, clear_skill_tool_session_access,
        set_skill_tool_session_access, set_skill_tool_session_allowed_skill_sources,
    };
    use crate::skill_runtime_contract::PDF_EXTRACT_CONTRACT_KEY;
    use serde_json::json;
    use std::sync::Mutex;

    struct RecordingBackend {
        last_params: Mutex<Option<Value>>,
    }

    impl RecordingBackend {
        fn new() -> Self {
            Self {
                last_params: Mutex::new(None),
            }
        }

        fn last_params(&self) -> Option<Value> {
            self.last_params
                .lock()
                .expect("backend params lock should not be poisoned")
                .clone()
        }
    }

    #[async_trait]
    impl RuntimeSkillExecutionBackend for RecordingBackend {
        async fn execute_skill(
            &self,
            request: RuntimeSkillBackendRequest,
        ) -> Result<RuntimeSkillExecutionResult, RuntimeSkillExecutionError> {
            *self
                .last_params
                .lock()
                .expect("backend params lock should not be poisoned") = Some(request.params);
            Ok(RuntimeSkillExecutionResult::success("done"))
        }
    }

    #[tokio::test]
    async fn disabled_session_fails_before_backend() {
        let session_id = "skill-execute-current-disabled";
        clear_skill_tool_session_access(session_id);
        let backend = RecordingBackend::new();

        let error = run_skill_execution(
            &backend,
            RuntimeSkillExecutionRequest::new(session_id, json!({ "skill": "research" })),
        )
        .await
        .expect_err("disabled session should fail before backend");

        assert!(error.message().contains("未启用技能自动调用"));
        assert_eq!(backend.last_params(), None);
    }

    #[tokio::test]
    async fn normalizes_params_and_attaches_runtime_contract_metadata() {
        let session_id = "skill-execute-current-normalize";
        set_skill_tool_session_access(session_id, true);
        let backend = RecordingBackend::new();

        let result = run_skill_execution(
            &backend,
            RuntimeSkillExecutionRequest::new(
                session_id,
                json!({
                    "skill": "site_search",
                    "args": {
                        "query": "codex skills"
                    }
                }),
            ),
        )
        .await
        .expect("skill execution should pass");

        clear_skill_tool_session_access(session_id);

        assert_eq!(result.success, true);
        assert_eq!(
            backend
                .last_params()
                .and_then(|params| params.get("args").cloned())
                .and_then(|args| args.as_str().map(ToString::to_string))
                .as_deref(),
            Some("{\"query\":\"codex skills\"}")
        );
        assert_eq!(
            result.metadata.get("modality_contract_key"),
            Some(&json!("web_research"))
        );
        assert_eq!(
            result.metadata.get("entry_source"),
            Some(&json!("at_site_search_command"))
        );
        assert_eq!(
            result
                .metadata
                .get("policy")
                .and_then(|value| value.get("decision")),
            Some(&json!("allow"))
        );
        assert_eq!(
            result
                .metadata
                .get("policy")
                .and_then(|value| value.get("source")),
            Some(&json!("session_skill_gate"))
        );
    }

    #[tokio::test]
    async fn runtime_preflight_failure_returns_projected_result_without_backend() {
        let session_id = "skill-execute-current-preflight";
        set_skill_tool_session_access(session_id, true);
        let backend = RecordingBackend::new();

        let result = run_skill_execution(
            &backend,
            RuntimeSkillExecutionRequest::new(
                session_id,
                json!({
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
                }),
            ),
        )
        .await
        .expect("preflight failure should materialize as tool result");

        clear_skill_tool_session_access(session_id);

        assert!(!result.success);
        assert_eq!(backend.last_params(), None);
        assert_eq!(
            result.metadata.get("preflight_check"),
            Some(&json!("pdf_extract_executor_adapter_mismatch"))
        );
    }

    #[tokio::test]
    async fn workspace_skill_source_metadata_is_attached_to_backend_result() {
        let session_id = "skill-execute-current-source";
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
            permission_summary: vec!["Level 0 read only discovery".to_string()],
        };
        set_skill_tool_session_allowed_skill_sources(session_id, [source]);
        let backend = RecordingBackend::new();

        let result = run_skill_execution(
            &backend,
            RuntimeSkillExecutionRequest::new(
                session_id,
                json!({ "skill": "project:capability-report" }),
            ),
        )
        .await
        .expect("skill execution should pass");

        clear_skill_tool_session_access(session_id);

        assert_eq!(
            result
                .metadata
                .get("workspace_skill_source")
                .and_then(|value| value.get("sourceDraftId")),
            Some(&json!("capdraft-1"))
        );
    }
}
