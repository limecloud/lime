use lime_utils_absolute_path::test_support::PathExt;
use pretty_assertions::assert_eq;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use uuid::Uuid;

use super::*;

#[tokio::test]
async fn sqlite_sink_filters_noisy_targets_without_dropping_useful_diagnostics() {
    let lime_home =
        std::env::temp_dir().join(format!("lime-state-log-db-filter-{}", Uuid::new_v4()));
    let _cleanup = scopeguard::guard(lime_home.clone(), |lime_home| {
        let _ = std::fs::remove_dir_all(lime_home);
    });
    let runtime = StateRuntime::init(
        crate::SqliteConfig::new_for_testing(lime_home.as_path().abs()),
        "test-provider".to_string(),
    )
    .await
    .expect("initialize runtime");
    let layer = start(
        runtime.clone(),
        Arc::new(super::tests::SharedWriter::default()),
    );

    let guard = tracing_subscriber::registry()
        .with(layer.clone().with_filter(default_filter()))
        .set_default();

    tracing::trace!(target: "opentelemetry_sdk", "dropped-trace");
    tracing::debug!(target: "opentelemetry_sdk", "dropped-debug");
    tracing::info!(target: "opentelemetry_sdk", "retained-info");
    tracing::warn!(target: "sqlx::query", "dropped-slow-query-warning");
    tracing::warn!(target: "sqlx::pool::acquire", "dropped-slow-acquire-warning");
    tracing::warn!(target: "sqlx::other", "dropped-sqlx-warning");
    tracing::info!(target: "sqlx_application", "retained-unrelated-target");
    tracing::debug!(target: "opentelemetry-otlp", "dropped-otlp-export");
    tracing::error!(target: "opentelemetry-http", "dropped-http-export");
    tracing::trace!(target: "h2::proto::streams", "dropped-http2-trace");
    tracing::debug!(target: "tonic::transport::channel", "dropped-grpc-transport-debug");
    tracing::debug!(target: "tower::buffer::worker", "dropped-grpc-buffer-debug");
    tracing::warn!(
        target: "h2::proto::ping_pong",
        "recv PING ack that we never sent: {:?}",
        "synthetic-ack"
    );
    tracing::warn!(target: "h2::proto::ping_pong", "retained-http2-ping-warning");
    tracing::warn!(target: "h2::proto::streams", "retained-http2-warning");
    tracing::debug!(target: "rmcp::transport", "dropped-rmcp-debug");
    tracing::info!(target: "rmcp::transport", "retained-rmcp-info");
    tracing::trace!(target: "tokio_graceful::guard", "dropped-guard-trace");
    tracing::debug!(target: "tokio_graceful::guard", "retained-guard-debug");
    tracing::trace!(target: "tokio_graceful::trigger", "dropped-trigger-trace");
    tracing::debug!(target: "tokio_graceful::trigger", "retained-trigger-debug");
    tracing::trace!(target: "tokio_graceful::shutdown", "retained-shutdown-trace");
    tracing::debug!(
        target: "lime_rmcp_client::oauth",
        "dropped-lime-rmcp-client-debug"
    );
    tracing::info!(
        target: "lime_rmcp_client::oauth",
        "retained-lime-rmcp-client-info"
    );
    tracing::trace!(target: "lime_http_client::transport", "dropped-request-body");
    tracing::debug!(target: "lime_http_client::transport", "retained-request-diagnostic");
    tracing::trace!(target: "lime_api::sse", "dropped-sse-parent");
    tracing::trace!(target: "lime_api::sse::responses", "dropped-sse-payload");
    tracing::debug!(target: "lime_api::sse::responses", "retained-sse-diagnostic");
    tracing::trace!(target: "state", "retained-trace");
    tracing::trace!(
        target: "lime_tui::streaming::controller",
        "dropped-controller-trace"
    );
    tracing::debug!(
        target: "lime_tui::streaming::controller",
        "retained-controller-debug"
    );
    tracing::trace!(
        target: "lime_tui::streaming::table_holdback",
        "dropped-table-holdback-trace"
    );
    tracing::debug!(
        target: "lime_tui::streaming::table_holdback",
        "retained-table-holdback-debug"
    );
    tracing::trace!(
        target: "lime_tui::streaming::commit_tick",
        "retained-commit-tick-trace"
    );
    tracing::trace!(
        target: "lime_api::responses_websocket_timing",
        payload = "complete timing payload",
        "dropped-websocket-timing"
    );

    layer.flush().await;
    drop(guard);

    let logs = runtime
        .query_logs(&crate::LogQuery::default())
        .await
        .expect("query logs after flush");
    assert_eq!(
        logs.iter()
            .map(|row| (
                row.level.as_str(),
                row.target.as_str(),
                row.message.as_deref()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("INFO", "opentelemetry_sdk", Some("retained-info")),
            (
                "INFO",
                "sqlx_application",
                Some("retained-unrelated-target")
            ),
            (
                "WARN",
                "h2::proto::ping_pong",
                Some("retained-http2-ping-warning")
            ),
            ("WARN", "h2::proto::streams", Some("retained-http2-warning")),
            ("INFO", "rmcp::transport", Some("retained-rmcp-info")),
            (
                "DEBUG",
                "tokio_graceful::guard",
                Some("retained-guard-debug")
            ),
            (
                "DEBUG",
                "tokio_graceful::trigger",
                Some("retained-trigger-debug")
            ),
            (
                "TRACE",
                "tokio_graceful::shutdown",
                Some("retained-shutdown-trace")
            ),
            (
                "INFO",
                "lime_rmcp_client::oauth",
                Some("retained-lime-rmcp-client-info")
            ),
            (
                "DEBUG",
                "lime_http_client::transport",
                Some("retained-request-diagnostic")
            ),
            (
                "DEBUG",
                "lime_api::sse::responses",
                Some("retained-sse-diagnostic")
            ),
            ("TRACE", "state", Some("retained-trace")),
            (
                "DEBUG",
                "lime_tui::streaming::controller",
                Some("retained-controller-debug"),
            ),
            (
                "DEBUG",
                "lime_tui::streaming::table_holdback",
                Some("retained-table-holdback-debug"),
            ),
            (
                "TRACE",
                "lime_tui::streaming::commit_tick",
                Some("retained-commit-tick-trace"),
            ),
        ]
    );
}
