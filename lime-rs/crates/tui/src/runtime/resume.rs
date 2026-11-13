use super::connection::TuiOptions;
use super::run_tui;
use crate::resume_picker::run_resume_picker_with_app_server;
use anyhow::Result;

/// Resume without an explicit id using the same canonical thread picker as 上游.
/// The picker session is short-lived; the selected thread is then resumed by the
/// normal TUI runtime so there is only one conversation owner.
pub async fn run_resume(mut options: TuiOptions) -> Result<()> {
    if options.resume_thread.is_none() {
        let selected = run_resume_picker_with_app_server(&options).await?;
        let Some(thread_id) = selected else {
            return Ok(());
        };
        options.resume_thread = Some(thread_id);
    }
    run_tui(options).await
}
