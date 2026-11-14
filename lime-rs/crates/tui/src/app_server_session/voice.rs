//! Voice dictation transport: audio bytes are transcribed by App Server ASR.

use anyhow::{Context, Result};
use app_server_protocol::protocol::v0::{
    VoiceTranscriptionTranscribeAudioParams, VoiceTranscriptionTranscribeAudioResponse,
    METHOD_VOICE_TRANSCRIPTION_TRANSCRIBE_AUDIO,
};

use super::AppServerSession;

impl AppServerSession {
    pub(crate) async fn transcribe_audio(
        &self,
        audio_base64: String,
        mime_type: String,
    ) -> Result<VoiceTranscriptionTranscribeAudioResponse> {
        self.request_handle
            .request(
                METHOD_VOICE_TRANSCRIPTION_TRANSCRIBE_AUDIO,
                VoiceTranscriptionTranscribeAudioParams {
                    audio_base64,
                    mime_type,
                    credential_id: None,
                },
            )
            .await
            .context("failed to transcribe recorded audio")
    }
}
