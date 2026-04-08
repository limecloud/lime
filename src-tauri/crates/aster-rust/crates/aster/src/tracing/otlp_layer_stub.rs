use std::io;
use std::time::Duration;
use tracing::Metadata;
use tracing_subscriber::filter::{filter_fn, FilterFn};
use tracing_subscriber::layer::Identity;

pub type OtlpTracingLayer = Identity;
pub type OtlpMetricsLayer = Identity;
pub type OtlpLogsLayer = Identity;
pub type OtlpLayers = (OtlpTracingLayer, OtlpMetricsLayer, OtlpLogsLayer);
pub type OtlpResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct OtlpConfig {
    pub endpoint: String,
    pub timeout: Duration,
}

impl Default for OtlpConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://localhost:4318".to_string(),
            timeout: Duration::from_secs(10),
        }
    }
}

impl OtlpConfig {
    pub fn from_config() -> Option<Self> {
        None
    }
}

fn feature_disabled_error() -> Box<dyn std::error::Error + Send + Sync> {
    io::Error::new(
        io::ErrorKind::Other,
        "telemetry-otlp feature is disabled at compile time",
    )
    .into()
}

pub fn init_otlp_tracing(_config: &OtlpConfig) -> OtlpResult<()> {
    Err(feature_disabled_error())
}

pub fn init_otlp_metrics(_config: &OtlpConfig) -> OtlpResult<()> {
    Err(feature_disabled_error())
}

pub fn create_otlp_tracing_layer() -> OtlpResult<OtlpTracingLayer> {
    Err(feature_disabled_error())
}

pub fn create_otlp_metrics_layer() -> OtlpResult<OtlpMetricsLayer> {
    Err(feature_disabled_error())
}

pub fn create_otlp_logs_layer() -> OtlpResult<OtlpLogsLayer> {
    Err(feature_disabled_error())
}

pub fn init_otlp() -> OtlpResult<OtlpLayers> {
    Err(feature_disabled_error())
}

pub fn init_otlp_tracing_only() -> OtlpResult<OtlpTracingLayer> {
    Err(feature_disabled_error())
}

pub fn create_otlp_tracing_filter() -> FilterFn<impl Fn(&Metadata<'_>) -> bool> {
    filter_fn(|_| false)
}

pub fn create_otlp_metrics_filter() -> FilterFn<impl Fn(&Metadata<'_>) -> bool> {
    filter_fn(|_| false)
}

pub fn create_otlp_logs_filter() -> FilterFn<impl Fn(&Metadata<'_>) -> bool> {
    filter_fn(|_| false)
}

pub fn shutdown_otlp() {}
