//! Test-only utilities for the scheduler
#![cfg(test)]

use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Mutex;

use aster::providers::base::Provider as AsterProvider;

static TEST_PROVIDER: Lazy<Mutex<Option<Arc<dyn AsterProvider>>>> = Lazy::new(|| Mutex::new(None));

/// Register a default provider for scheduler job executions when running under tests.
/// The provider will be used by [`Scheduler`] when no provider_override is supplied.
pub async fn set_test_provider(p: Arc<dyn AsterProvider>) {
    let mut guard = TEST_PROVIDER.lock().await;
    *guard = Some(p);
}

pub async fn get_test_provider() -> Option<Arc<dyn AsterProvider>> {
    TEST_PROVIDER.lock().await.clone()
}
