use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::*;

impl RuntimeCore {
    pub async fn create_image_media_task_artifact(
        &self,
        params: MediaTaskArtifactImageCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .create_image_media_task_artifact(params)
            .await
    }

    pub async fn create_audio_media_task_artifact(
        &self,
        params: MediaTaskArtifactAudioCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .create_audio_media_task_artifact(params)
            .await
    }

    pub async fn create_transcription_media_task_artifact(
        &self,
        params: MediaTaskArtifactTranscriptionCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .create_transcription_media_task_artifact(params)
            .await
    }

    pub async fn create_video_media_task_artifact(
        &self,
        params: MediaTaskArtifactVideoCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .create_video_media_task_artifact(params)
            .await
    }

    pub async fn complete_audio_media_task_artifact(
        &self,
        params: MediaTaskArtifactAudioCompleteParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .complete_audio_media_task_artifact(params, self.sidecar_store.clone())
            .await
    }

    pub async fn complete_image_media_task_artifact(
        &self,
        params: MediaTaskArtifactImageCompleteParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .complete_image_media_task_artifact(params, self.sidecar_store.clone())
            .await
    }

    pub async fn get_media_task_artifact(
        &self,
        params: MediaTaskArtifactLookupParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source.get_media_task_artifact(params).await
    }

    pub async fn list_media_task_artifacts(
        &self,
        params: MediaTaskArtifactListParams,
    ) -> Result<MediaTaskArtifactListResponse, RuntimeCoreError> {
        self.app_data_source.list_media_task_artifacts(params).await
    }

    pub async fn cancel_media_task_artifact(
        &self,
        params: MediaTaskArtifactLookupParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        self.app_data_source
            .cancel_media_task_artifact(params)
            .await
    }
}
