use crate::AppDataSource;
use app_server_protocol::{
    MediaTaskArtifactImageCreateParams, MediaTaskArtifactLookupParams, MediaTaskArtifactResponse,
};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tool_runtime::image_task::{
    image_task_tool_result_projection, ImageTaskGateway, ImageTaskToolResultProjection,
};

pub(crate) fn image_task_gateway(
    app_data_source: Arc<dyn AppDataSource>,
) -> Arc<dyn ImageTaskGateway> {
    Arc::new(AppServerImageTaskGateway { app_data_source })
}

pub(super) fn tool_result_from_response(
    response: MediaTaskArtifactResponse,
) -> ImageTaskToolResultProjection {
    image_task_tool_result_projection(response)
}

struct AppServerImageTaskGateway {
    app_data_source: Arc<dyn AppDataSource>,
}

#[async_trait]
impl ImageTaskGateway for AppServerImageTaskGateway {
    async fn create_image_media_task_artifact(
        &self,
        params: MediaTaskArtifactImageCreateParams,
        cancel_token: Option<CancellationToken>,
    ) -> Result<MediaTaskArtifactResponse, String> {
        let project_root_path = params.project_root_path.clone();
        let mut response = self
            .app_data_source
            .create_image_media_task_artifact(params)
            .await
            .map_err(|error| error.to_string())?;
        let lookup = MediaTaskArtifactLookupParams {
            project_root_path,
            task_ref: response.task_id.clone(),
        };
        let cancelled = cancel_token.unwrap_or_default();
        let deadline = tokio::time::sleep(Duration::from_secs(600));
        tokio::pin!(deadline);
        // A queued task is not a completed model tool. Keep the same call open
        // until its durable result (including sidecar refs) can be projected.
        loop {
            let terminal_failure = matches!(
                response.normalized_status.as_str(),
                "failed" | "cancelled" | "canceled"
            );
            let completed_media =
                matches!(response.normalized_status.as_str(), "succeeded" | "partial")
                    && crate::media_task::image_outputs_are_ready(&response.record);
            if terminal_failure || completed_media {
                return Ok(response);
            }
            tokio::select! {
                _ = cancelled.cancelled() => {
                    self.app_data_source.cancel_media_task_artifact(lookup.clone()).await
                        .map_err(|error| error.to_string())?;
                    return Err("image task cancelled".to_string());
                }
                _ = &mut deadline => {
                    self.app_data_source.cancel_media_task_artifact(lookup.clone()).await
                        .map_err(|error| error.to_string())?;
                    return Err("image task timed out".to_string());
                }
                _ = tokio::time::sleep(Duration::from_millis(250)) => {}
            }
            response = self
                .app_data_source
                .get_media_task_artifact(lookup.clone())
                .await
                .map_err(|error| error.to_string())?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeCoreError;
    use crate::WorkspaceSkillBindingAppDataSource;
    use crate::{AutomationManagementAppDataSource, PluginDataSource};
    use crate::{AutomationOverviewAppDataSource, ConnectAppDataSource, DiagnosticsAppDataSource};
    use crate::{GatewayAppDataSource, McpAppDataSource};
    use crate::{MediaAppDataSource, MemoryAppDataSource, ModelProviderAppDataSource};
    use crate::{RightSurfaceAppDataSource, SessionAppDataSource, SkillAppDataSource};
    use crate::{VoiceAppDataSource, WorkspaceAppDataSource};
    use app_server_protocol::{MediaTaskArtifactImageCreateParams, MediaTaskArtifactResponse};
    use async_trait::async_trait;
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    struct ImageToolTestDataSource {
        terminal_status: &'static str,
        reads: AtomicUsize,
        cancels: AtomicUsize,
        created: tokio::sync::Notify,
    }

    impl Default for ImageToolTestDataSource {
        fn default() -> Self {
            Self {
                terminal_status: "succeeded",
                reads: AtomicUsize::new(0),
                cancels: AtomicUsize::new(0),
                created: tokio::sync::Notify::new(),
            }
        }
    }

    impl SessionAppDataSource for ImageToolTestDataSource {}
    impl WorkspaceAppDataSource for ImageToolTestDataSource {}
    impl SkillAppDataSource for ImageToolTestDataSource {}
    impl WorkspaceSkillBindingAppDataSource for ImageToolTestDataSource {}
    impl GatewayAppDataSource for ImageToolTestDataSource {}
    impl VoiceAppDataSource for ImageToolTestDataSource {}
    impl PluginDataSource for ImageToolTestDataSource {}
    impl AutomationOverviewAppDataSource for ImageToolTestDataSource {}
    impl McpAppDataSource for ImageToolTestDataSource {}
    impl AutomationManagementAppDataSource for ImageToolTestDataSource {}
    impl MemoryAppDataSource for ImageToolTestDataSource {}
    impl DiagnosticsAppDataSource for ImageToolTestDataSource {}
    impl ModelProviderAppDataSource for ImageToolTestDataSource {}
    impl ConnectAppDataSource for ImageToolTestDataSource {}
    impl RightSurfaceAppDataSource for ImageToolTestDataSource {}

    #[async_trait]
    impl MediaAppDataSource for ImageToolTestDataSource {
        async fn create_image_media_task_artifact(
            &self,
            params: MediaTaskArtifactImageCreateParams,
        ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
            let response = crate::media_task::create_image_generation_task_artifact(params, None)
                .map_err(RuntimeCoreError::Backend)?;
            self.created.notify_one();
            Ok(response)
        }

        async fn get_media_task_artifact(
            &self,
            params: MediaTaskArtifactLookupParams,
        ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
            let mut response = crate::media_task::get_media_task_artifact(params)
                .map_err(RuntimeCoreError::Backend)?;
            if self.reads.fetch_add(1, Ordering::SeqCst) > 0 {
                response.normalized_status = self.terminal_status.to_string();
                response.status = self.terminal_status.to_string();
                response.record["result"] =
                    json!({"images": [{"sidecarRef": {"ref": "sidecar://media/result"}}]});
            }
            Ok(response)
        }

        async fn cancel_media_task_artifact(
            &self,
            params: MediaTaskArtifactLookupParams,
        ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
            self.cancels.fetch_add(1, Ordering::SeqCst);
            crate::media_task::cancel_media_task_artifact(params).map_err(RuntimeCoreError::Backend)
        }
    }

    #[tokio::test]
    async fn image_tool_creates_standard_image_task_artifact() {
        let workspace = TempDir::new().expect("workspace");
        let source = Arc::new(ImageToolTestDataSource::default());
        let response = image_task_gateway(source.clone())
            .create_image_media_task_artifact(
                MediaTaskArtifactImageCreateParams {
                    project_root_path: workspace.path().to_string_lossy().to_string(),
                    prompt: "生成一张青柠实验室封面".to_string(),
                    provider_id: Some("openai".to_string()),
                    model: Some("gpt-image-2".to_string()),
                    executor_mode: Some("images_api".to_string()),
                    session_id: Some("session-image-1".to_string()),
                    thread_id: Some("thread-image-1".to_string()),
                    turn_id: Some("turn-image-1".to_string()),
                    content_id: Some("content-image-1".to_string()),
                    entry_source: Some("at_image_command".to_string()),
                    modality_contract_key: Some("image_generation".to_string()),
                    modality: Some("image".to_string()),
                    routing_slot: Some("image_generation_model".to_string()),
                    runtime_contract: Some(json!({
                        "contract_key": "image_generation",
                        "routing_slot": "image_generation_model"
                    })),
                    usage: Some("document-inline".to_string()),
                    slot_id: Some("document-image-slot-1".to_string()),
                    anchor_section_title: Some("产品愿景".to_string()),
                    anchor_text: Some("给这一段生成配图".to_string()),
                    ..MediaTaskArtifactImageCreateParams::default()
                },
                None,
            )
            .await
            .expect("image task gateway should create task artifact");
        let result = tool_result_from_response(response);

        assert_eq!(
            result.metadata.get("task_type"),
            Some(&json!("image_generate"))
        );
        assert_eq!(result.metadata.get("task_family"), Some(&json!("image")));
        assert_eq!(
            result.metadata.get("normalized_status"),
            Some(&json!("succeeded"))
        );
        assert_eq!(source.reads.load(Ordering::SeqCst), 2);
        assert!(result.metadata["record"]["result"]["images"][0]["sidecarRef"].is_object());
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

        let absolute_artifact_path = workspace.path().join(artifact_path);
        assert!(
            absolute_artifact_path.exists(),
            "standard image task artifact should exist at {}",
            absolute_artifact_path.display()
        );
    }

    fn task_params(workspace: &TempDir) -> MediaTaskArtifactImageCreateParams {
        MediaTaskArtifactImageCreateParams {
            project_root_path: workspace.path().to_string_lossy().to_string(),
            prompt: "image task lifecycle".to_string(),
            provider_id: Some("openai".to_string()),
            model: Some("gpt-image-2".to_string()),
            session_id: Some("session-image".to_string()),
            thread_id: Some("thread-image".to_string()),
            turn_id: Some("turn-image".to_string()),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn image_tool_cancels_the_durable_task_when_its_turn_is_cancelled() {
        let workspace = TempDir::new().unwrap();
        let source = Arc::new(ImageToolTestDataSource::default());
        let gateway = image_task_gateway(source.clone());
        let token = CancellationToken::new();
        let params = task_params(&workspace);
        let worker_token = token.clone();
        let call = tokio::spawn(async move {
            gateway
                .create_image_media_task_artifact(params, Some(worker_token))
                .await
        });
        source.created.notified().await;
        assert!(!call.is_finished());
        token.cancel();
        assert!(call.await.unwrap().unwrap_err().contains("cancelled"));
        assert_eq!(source.cancels.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn image_tool_returns_failed_task_without_claiming_a_generated_result() {
        let workspace = TempDir::new().unwrap();
        let source = Arc::new(ImageToolTestDataSource {
            terminal_status: "failed",
            ..Default::default()
        });
        let result = image_task_gateway(source.clone())
            .create_image_media_task_artifact(task_params(&workspace), None)
            .await
            .unwrap();
        assert_eq!(result.normalized_status, "failed");
        assert_eq!(source.reads.load(Ordering::SeqCst), 2);
    }
}
