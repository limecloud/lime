use crate::app_event::AppEvent;
use tokio::sync::mpsc::UnboundedSender;

/// A metadata-free composer can work without a host. Persistent lookups fail closed until wired.
#[derive(Clone, Debug, Default)]
pub(crate) struct AppEventSender {
    tx: Option<UnboundedSender<AppEvent>>,
}

impl AppEventSender {
    pub(crate) fn new(tx: UnboundedSender<AppEvent>) -> Self {
        Self { tx: Some(tx) }
    }

    pub(crate) fn send(&self, event: AppEvent) -> bool {
        self.tx.as_ref().is_some_and(|tx| tx.send(event).is_ok())
    }
}
