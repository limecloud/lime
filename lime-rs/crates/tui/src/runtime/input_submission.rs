//! Transport acknowledgement preserves the complete composer draft on every failed submission.

use agent_protocol::TextElement;
use anyhow::{anyhow, Result};
use app_server_protocol::protocol::v2::QueuedSubmission;

use crate::app::input_submission::{history_text, submission_input};
use crate::app::App;
use crate::app_server_session::AppServerSession;

#[cfg(test)]
#[path = "input_submission_tests.rs"]
mod tests;

enum SubmissionOutcome {
    Started(String),
    Steered,
    Queued(QueuedSubmission),
}

pub(super) async fn handle_submission(
    app: &mut App,
    session: &AppServerSession,
    prompt: String,
    text_elements: Vec<TextElement>,
    should_queue: bool,
) {
    if !app.can_accept_direct_input() {
        return;
    }
    let images = app.take_recent_submission_images_with_placeholders();
    let remote_images = app.take_remote_images();
    let mention_bindings = app.take_recent_submission_mention_bindings();
    let input = submission_input(
        prompt.clone(),
        &images,
        &remote_images,
        app.chat_widget.bottom_pane.skills(),
        text_elements.clone(),
        &mention_bindings,
    );
    let outcome: Result<SubmissionOutcome> = if should_queue {
        session
            .queue_input(input)
            .await
            .map(SubmissionOutcome::Queued)
    } else if let Some(turn_id) = app.projection.active_turn_id() {
        match session.steer_turn_input(turn_id, input.clone()).await {
            Ok(_) => Ok(SubmissionOutcome::Steered),
            Err(steer_error) => session
                .queue_input(input)
                .await
                .map(SubmissionOutcome::Queued)
                .map_err(|queue_error| anyhow!("{steer_error}; queue failed: {queue_error}")),
        }
    } else {
        session
            .start_turn_input(input)
            .await
            .map(SubmissionOutcome::Started)
    };
    match outcome {
        Ok(outcome) => {
            match outcome {
                SubmissionOutcome::Started(turn_id) => app.start_turn(turn_id),
                SubmissionOutcome::Steered => app.projection.set_status("steering"),
                SubmissionOutcome::Queued(submission) => {
                    app.upsert_queued_submission(submission);
                    app.projection.set_status("queued");
                }
            }
            persist_prompt(
                session,
                app,
                history_text(&prompt, &text_elements, &mention_bindings),
            )
            .await;
        }
        Err(error) => {
            app.restore_submission_draft(
                prompt,
                text_elements,
                images,
                remote_images,
                mention_bindings,
            );
            app.projection.set_status(error.to_string());
        }
    }
}

async fn persist_prompt(session: &AppServerSession, app: &mut App, prompt: String) {
    if prompt.trim().is_empty() {
        return;
    }
    if let Err(error) = session.append_prompt_history(prompt).await {
        app.projection
            .set_status(format!("prompt history unavailable: {error:#}"));
    }
}
