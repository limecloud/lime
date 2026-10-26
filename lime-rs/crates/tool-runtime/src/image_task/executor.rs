use super::definition::IMAGE_TASK_TOOL_NAME;
use super::params::{build_create_params, parse_image_task_input, runtime_image_task_error};
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
};
use app_server_protocol::{MediaTaskArtifactImageCreateParams, MediaTaskArtifactResponse};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

#[async_trait]
pub trait ImageTaskGateway: Send + Sync {
    async fn create_image_media_task_artifact(
        &self,
        params: MediaTaskArtifactImageCreateParams,
        cancel_token: Option<CancellationToken>,
    ) -> Result<MediaTaskArtifactResponse, String>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageTaskToolResultProjection {
    pub output: Option<String>,
    pub metadata: HashMap<String, Value>,
}

pub struct RuntimeImageTaskExecutor {
    gateway: Arc<dyn ImageTaskGateway>,
}

impl RuntimeImageTaskExecutor {
    pub fn new(gateway: Arc<dyn ImageTaskGateway>) -> Self {
        Self { gateway }
    }

    pub fn handle(gateway: Arc<dyn ImageTaskGateway>) -> RuntimeToolExecutorHandle {
        RuntimeToolExecutorHandle::new(Arc::new(Self::new(gateway)))
    }

    async fn execute_image_task(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        if request.tool_name != IMAGE_TASK_TOOL_NAME {
            return Err(runtime_image_task_error(format!(
                "image task executor cannot run tool '{}'",
                request.tool_name
            )));
        }
        if request
            .context
            .cancel_token()
            .is_some_and(|token| token.is_cancelled())
        {
            return Err(runtime_image_task_error("image task cancelled"));
        }

        let input = parse_image_task_input(
            request.params,
            request.context.working_directory(),
            request.context.session_id(),
            request.turn_context,
        )?;
        let response = self
            .gateway
            .create_image_media_task_artifact(
                build_create_params(input),
                request.context.cancel_token().cloned(),
            )
            .await
            .map_err(runtime_image_task_error)?;
        let success = response.success
            && matches!(response.normalized_status.as_str(), "succeeded" | "partial");
        let projection = image_task_tool_result_projection(response);
        Ok(RuntimeToolExecutionResult::new(
            success,
            projection.output.unwrap_or_default(),
            None,
            projection.metadata,
        ))
    }
}

impl RuntimeToolExecutor for RuntimeImageTaskExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move { self.execute_image_task(request).await })
    }
}

pub fn runtime_image_task_executor_handle(
    gateway: Arc<dyn ImageTaskGateway>,
) -> RuntimeToolExecutorHandle {
    RuntimeImageTaskExecutor::handle(gateway)
}

pub fn image_task_tool_result_projection(
    response: MediaTaskArtifactResponse,
) -> ImageTaskToolResultProjection {
    let text = serde_json::to_string_pretty(&response).unwrap_or_else(|_| "{}".to_string());
    let mut metadata = HashMap::from([
        ("task_id".to_string(), json!(response.task_id)),
        ("task_type".to_string(), json!(response.task_type)),
        ("task_family".to_string(), json!(response.task_family)),
        ("status".to_string(), json!(response.status)),
        (
            "normalized_status".to_string(),
            json!(response.normalized_status),
        ),
        ("path".to_string(), json!(response.path)),
        ("artifact_path".to_string(), json!(response.artifact_path)),
        (
            "reused_existing".to_string(),
            json!(response.reused_existing),
        ),
        ("record".to_string(), json!(response.record)),
    ]);
    if let Some(idempotency_key) = response.idempotency_key {
        metadata.insert("idempotency_key".to_string(), json!(idempotency_key));
    }
    ImageTaskToolResultProjection {
        output: Some(text),
        metadata,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_executor::{RuntimeToolExecutionContext, RuntimeToolExecutionContextInput};
    use agent_protocol::turn_context::TurnContextOverride;
    use serde_json::json;
    use tempfile::TempDir;
    use tokio::sync::Mutex;

    #[derive(Default)]
    struct ImageToolTestGateway {
        last_params: Mutex<Option<MediaTaskArtifactImageCreateParams>>,
    }

    #[async_trait]
    impl ImageTaskGateway for ImageToolTestGateway {
        async fn create_image_media_task_artifact(
            &self,
            params: MediaTaskArtifactImageCreateParams,
            _cancel_token: Option<CancellationToken>,
        ) -> Result<MediaTaskArtifactResponse, String> {
            *self.last_params.lock().await = Some(params.clone());
            Ok(MediaTaskArtifactResponse {
                success: true,
                task_id: "task-image-1".to_string(),
                task_type: "image_generate".to_string(),
                task_family: "image".to_string(),
                status: "succeeded".to_string(),
                normalized_status: "succeeded".to_string(),
                artifact_path: ".lime/tasks/image_generate/task-image-1.json".to_string(),
                record: json!({
                    "task_type": "image_generate",
                    "payload": {
                        "provider_id": params.provider_id,
                        "model": params.model,
                        "executor_mode": params.executor_mode,
                        "entry_source": params.entry_source,
                        "modality_contract_key": params.modality_contract_key,
                        "routing_slot": params.routing_slot,
                        "usage": params.usage,
                        "slot_id": params.slot_id,
                        "anchor_section_title": params.anchor_section_title,
                        "anchor_text": params.anchor_text,
                        "model_task_request": {
                            "taskKind": "image_generate"
                        },
                        "runtime_contract": params.runtime_contract,
                    }
                }),
                ..MediaTaskArtifactResponse::default()
            })
        }
    }

    #[tokio::test]
    async fn image_tool_builds_standard_image_task_request() {
        let workspace = TempDir::new().expect("workspace");
        let gateway = Arc::new(ImageToolTestGateway::default());
        let executor = RuntimeImageTaskExecutor::new(gateway.clone());
        let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: workspace.path().to_path_buf(),
            session_id: "session-image-1".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        });
        let turn_context = TurnContextOverride {
            metadata: HashMap::from([
                ("thread_id".to_string(), json!("thread-image-1")),
                ("turn_id".to_string(), json!("turn-image-1")),
            ]),
            ..TurnContextOverride::default()
        };
        let result = executor
            .execute_image_task(RuntimeToolExecutionRequest {
                tool_name: IMAGE_TASK_TOOL_NAME,
                params: &json!({
                    "project_root_path": workspace.path().to_string_lossy(),
                    "prompt": "生成一张青柠实验室封面",
                    "provider_id": "openai",
                    "model": "gpt-image-2",
                    "executor_mode": "images_api",
                    "content_id": "content-image-1",
                    "entry_source": "at_image_command",
                    "modality_contract_key": "image_generation",
                    "modality": "image",
                    "routing_slot": "image_generation_model",
                    "runtime_contract": {
                        "contract_key": "image_generation",
                        "routing_slot": "image_generation_model"
                    },
                    "usage": "document-inline",
                    "slot_id": "document-image-slot-1",
                    "anchor_section_title": "产品愿景",
                    "anchor_text": "给这一段生成配图"
                }),
                context: &context,
                turn_context: Some(&turn_context),
            })
            .await
            .expect("image tool should call gateway");

        assert_eq!(
            result.metadata.get("task_type"),
            Some(&json!("image_generate"))
        );
        assert_eq!(result.metadata.get("task_family"), Some(&json!("image")));
        assert_eq!(
            result.metadata.get("normalized_status"),
            Some(&json!("succeeded"))
        );
        let artifact_path = result
            .metadata
            .get("artifact_path")
            .and_then(Value::as_str)
            .expect("artifact path");
        assert!(artifact_path.starts_with(".lime/tasks/image_generate/"));
        assert!(artifact_path.ends_with(".json"));

        let record = result.metadata.get("record").expect("record metadata");
        assert_eq!(record["task_type"].as_str(), Some("image_generate"));
        let payload = &record["payload"];
        assert_eq!(payload["provider_id"].as_str(), Some("openai"));
        assert_eq!(payload["model"].as_str(), Some("gpt-image-2"));
        assert_eq!(payload["executor_mode"].as_str(), Some("images_api"));
        assert_eq!(payload["entry_source"].as_str(), Some("at_image_command"));
        assert_eq!(
            payload["modality_contract_key"].as_str(),
            Some("image_generation")
        );
        assert_eq!(
            payload["routing_slot"].as_str(),
            Some("image_generation_model")
        );
        assert_eq!(payload["usage"].as_str(), Some("document-inline"));
        assert_eq!(payload["slot_id"].as_str(), Some("document-image-slot-1"));
        assert_eq!(payload["anchor_section_title"].as_str(), Some("产品愿景"));
        assert_eq!(payload["anchor_text"].as_str(), Some("给这一段生成配图"));
        assert_eq!(
            payload["model_task_request"]["taskKind"].as_str(),
            Some("image_generate")
        );
        assert_eq!(
            payload["runtime_contract"]["contract_key"].as_str(),
            Some("image_generation")
        );

        let params = gateway
            .last_params
            .lock()
            .await
            .clone()
            .expect("gateway params");
        assert_eq!(params.project_root_path, workspace.path().to_string_lossy());
        assert_eq!(params.session_id.as_deref(), Some("session-image-1"));
        assert_eq!(params.thread_id.as_deref(), Some("thread-image-1"));
        assert_eq!(params.turn_id.as_deref(), Some("turn-image-1"));
    }
}
