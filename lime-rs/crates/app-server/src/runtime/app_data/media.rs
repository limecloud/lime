use super::unavailable;
use super::NoopAppDataSource;
use super::RuntimeCoreError;
use crate::runtime::SidecarStore;
use app_server_protocol::*;
use async_trait::async_trait;
use std::sync::Arc;

#[async_trait]
pub trait MediaAppDataSource: Send + Sync {
    async fn create_image_media_task_artifact(
        &self,
        _params: MediaTaskArtifactImageCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/image/create"))
    }

    async fn create_audio_media_task_artifact(
        &self,
        _params: MediaTaskArtifactAudioCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/audio/create"))
    }

    async fn create_transcription_media_task_artifact(
        &self,
        _params: MediaTaskArtifactTranscriptionCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/transcription/create"))
    }

    async fn create_video_media_task_artifact(
        &self,
        _params: MediaTaskArtifactVideoCreateParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/video/create"))
    }

    async fn complete_audio_media_task_artifact(
        &self,
        _params: MediaTaskArtifactAudioCompleteParams,
        _sidecar_store: Option<Arc<SidecarStore>>,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/audio/complete"))
    }

    async fn complete_image_media_task_artifact(
        &self,
        _params: MediaTaskArtifactImageCompleteParams,
        _sidecar_store: Option<Arc<SidecarStore>>,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/image/complete"))
    }

    async fn get_media_task_artifact(
        &self,
        _params: MediaTaskArtifactLookupParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/get"))
    }

    async fn list_media_task_artifacts(
        &self,
        _params: MediaTaskArtifactListParams,
    ) -> Result<MediaTaskArtifactListResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/list"))
    }

    async fn cancel_media_task_artifact(
        &self,
        _params: MediaTaskArtifactLookupParams,
    ) -> Result<MediaTaskArtifactResponse, RuntimeCoreError> {
        Err(unavailable("mediaTaskArtifact/cancel"))
    }
}

impl MediaAppDataSource for NoopAppDataSource {}
