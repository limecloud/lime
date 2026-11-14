//! Voice dictation state: the default macOS input device, recorded off the async thread.

use std::fmt;

use voice_core::{AudioData, RecordingService};

#[derive(Default)]
pub(crate) struct VoiceState {
    recorder: Option<RecordingService>,
}

impl fmt::Debug for VoiceState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VoiceState")
            .field(
                "recording",
                &self
                    .recorder
                    .as_ref()
                    .is_some_and(RecordingService::is_recording),
            )
            .finish()
    }
}

impl VoiceState {
    pub(crate) fn is_recording(&self) -> bool {
        self.recorder
            .as_ref()
            .is_some_and(RecordingService::is_recording)
    }

    /// Starts the default input device. The macOS permission prompt is owned by the terminal app.
    pub(crate) fn start(&mut self) -> Result<(), String> {
        let recorder = self.recorder.get_or_insert_with(RecordingService::new);
        recorder.start(None)
    }

    pub(crate) fn stop(&mut self) -> Result<AudioData, String> {
        let Some(recorder) = self.recorder.as_mut() else {
            return Err("no active recording".to_string());
        };
        recorder.stop()
    }

    pub(crate) fn cancel(&mut self) {
        if let Some(recorder) = self.recorder.as_mut() {
            recorder.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_state_is_not_recording() {
        let state = VoiceState::default();
        assert!(!state.is_recording());
        assert_eq!(format!("{state:?}"), "VoiceState { recording: false }");
    }
}
