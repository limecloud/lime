use app_server_protocol::protocol::v2::{
    CurrentTimeReadParams, CurrentTimeReadResponse, METHOD_CURRENT_TIME_READ,
};
use chrono::{DateTime, Utc};
use std::time::Duration;
use thiserror::Error;
use tokio::time::{timeout_at, Instant};

use crate::host_request::HostRequestRouter;
use crate::{AppServer, AppServerError};

pub(crate) const CURRENT_TIME_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Error)]
pub enum CurrentTimeReadError {
    #[error(transparent)]
    AppServer(#[from] AppServerError),
    #[error("current-time request timed out after {seconds}s")]
    TimedOut { seconds: u64 },
    #[error("invalid current-time response: {source}")]
    InvalidResponse {
        #[source]
        source: serde_json::Error,
    },
    #[error("current-time response is outside the supported range: {current_time_at}")]
    OutOfRange { current_time_at: i64 },
}

#[derive(Clone)]
pub(crate) struct CurrentTimeRequestRouter {
    host: HostRequestRouter,
}

impl CurrentTimeRequestRouter {
    pub(crate) fn new(host: HostRequestRouter) -> Self {
        Self { host }
    }

    async fn read_current_time(
        &self,
        thread_id: String,
        timeout: Duration,
    ) -> Result<DateTime<Utc>, CurrentTimeReadError> {
        let deadline = Instant::now() + timeout;
        let response = timeout_at(
            deadline,
            self.host.request(
                &thread_id,
                METHOD_CURRENT_TIME_READ,
                serde_json::to_value(CurrentTimeReadParams {
                    thread_id: thread_id.clone(),
                })
                .map_err(AppServerError::from)?,
            ),
        )
        .await
        .map_err(|_| CurrentTimeReadError::TimedOut {
            seconds: timeout.as_secs(),
        })??;
        let response: CurrentTimeReadResponse = serde_json::from_value(response)
            .map_err(|source| CurrentTimeReadError::InvalidResponse { source })?;

        DateTime::from_timestamp(response.current_time_at, 0).ok_or(
            CurrentTimeReadError::OutOfRange {
                current_time_at: response.current_time_at,
            },
        )
    }
}

#[async_trait::async_trait]
impl tool_runtime::current_time::CurrentTimeGateway for CurrentTimeRequestRouter {
    async fn read_current_time(&self, thread_id: &str) -> Result<i64, String> {
        self.read_current_time(thread_id.to_string(), CURRENT_TIME_REQUEST_TIMEOUT)
            .await
            .map(|current_time| current_time.timestamp())
            .map_err(|error| error.to_string())
    }
}

impl AppServer {
    pub async fn read_current_time(
        &self,
        thread_id: impl Into<String>,
    ) -> Result<DateTime<Utc>, CurrentTimeReadError> {
        self.current_time_requests
            .read_current_time(thread_id.into(), CURRENT_TIME_REQUEST_TIMEOUT)
            .await
    }

    #[cfg(test)]
    pub(crate) async fn read_current_time_with_timeout(
        &self,
        thread_id: String,
        timeout: Duration,
    ) -> Result<DateTime<Utc>, CurrentTimeReadError> {
        self.current_time_requests
            .read_current_time(thread_id, timeout)
            .await
    }
}
