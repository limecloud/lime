use std::sync::{Arc, Mutex};

use app_server::{
    AppServer, AutomationManagementAppDataSource, AutomationOverviewAppDataSource,
    ConnectAppDataSource, DiagnosticsAppDataSource, GatewayAppDataSource, MarketDataSource,
    McpAppDataSource, MediaAppDataSource, MemoryAppDataSource, MockBackend,
    ModelProviderAppDataSource, PluginDataSource, RealtimeVoiceProviderSnapshot,
    RightSurfaceAppDataSource, RuntimeCore, RuntimeCoreError, SessionAppDataSource,
    SkillAppDataSource, VoiceAppDataSource, WorkspaceAppDataSource,
    WorkspaceSkillBindingAppDataSource,
};
use app_server_protocol::{
    METHOD_INITIALIZE, METHOD_INITIALIZED, METHOD_MODEL_PROVIDER_CAPABILITIES_READ,
    VoiceRealtimeClientSecretResponse, PROTOCOL_VERSION,
};
use async_trait::async_trait;
use lime_core::config::{Config, ConfigManager};
use serde_json::{json, Value};
use tempfile::TempDir;

#[derive(Default)]
struct RealtimeTestDataSource {
    snapshot: Mutex<Option<RealtimeVoiceProviderSnapshot>>,
    minted: Mutex<Vec<(String, String, String)>>,
}

impl RealtimeTestDataSource {
    fn with_snapshot(snapshot: RealtimeVoiceProviderSnapshot) -> Self {
        Self {
            snapshot: Mutex::new(Some(snapshot)),
            minted: Mutex::new(Vec::new()),
        }
    }
}

impl SessionAppDataSource for RealtimeTestDataSource {}
impl WorkspaceAppDataSource for RealtimeTestDataSource {}
impl SkillAppDataSource for RealtimeTestDataSource {}
impl WorkspaceSkillBindingAppDataSource for RealtimeTestDataSource {}
impl GatewayAppDataSource for RealtimeTestDataSource {}
impl MediaAppDataSource for RealtimeTestDataSource {}
impl MarketDataSource for RealtimeTestDataSource {}
impl PluginDataSource for RealtimeTestDataSource {}
impl AutomationOverviewAppDataSource for RealtimeTestDataSource {}
impl McpAppDataSource for RealtimeTestDataSource {}
impl AutomationManagementAppDataSource for RealtimeTestDataSource {}
impl MemoryAppDataSource for RealtimeTestDataSource {}
impl DiagnosticsAppDataSource for RealtimeTestDataSource {}
impl ModelProviderAppDataSource for RealtimeTestDataSource {}
impl ConnectAppDataSource for RealtimeTestDataSource {}
impl RightSurfaceAppDataSource for RealtimeTestDataSource {}

#[async_trait]
impl VoiceAppDataSource for RealtimeTestDataSource {
    async fn realtime_voice_provider_snapshot(
        &self,
        _provider_id: &str,
    ) -> Result<Option<RealtimeVoiceProviderSnapshot>, RuntimeCoreError> {
        Ok(self.snapshot.lock().expect("snapshot lock").clone())
    }

    async fn create_realtime_voice_client_secret(
        &self,
        provider_id: &str,
        model: &str,
        voice: &str,
    ) -> Result<VoiceRealtimeClientSecretResponse, RuntimeCoreError> {
        self.minted.lock().expect("minted lock").push((
            provider_id.to_string(),
            model.to_string(),
            voice.to_string(),
        ));
        Ok(VoiceRealtimeClientSecretResponse {
            client_secret: "ek_test_ephemeral".to_string(),
            expires_at: Some(1_893_456_000),
            model: model.to_string(),
            voice: voice.to_string(),
            calls_url: "https://api.openai.com/v1/realtime/calls".to_string(),
            provider_id: provider_id.to_string(),
        })
    }
}

fn test_server(
    data_source: Arc<RealtimeTestDataSource>,
    temp: &TempDir,
) -> AppServer {
    let config_path = temp.path().join("config.yaml");
    let mut config = Config::default();
    config.default_provider = "openai".to_string();
    config.experimental.voice_input.realtime_model = Some("gpt-realtime-2.1".to_string());
    config.experimental.voice_input.realtime_voice = Some("marin".to_string());
    ConfigManager::with_config(config, config_path.clone())
        .save()
        .expect("write realtime config");
    let runtime = RuntimeCore::with_backend(Arc::new(MockBackend))
        .with_app_data_source(data_source)
        .with_app_config_path(config_path);
    AppServer::with_runtime(runtime)
}

fn official_snapshot(key_available: bool) -> RealtimeVoiceProviderSnapshot {
    RealtimeVoiceProviderSnapshot {
        provider_id: "openai".to_string(),
        provider_type: "openai-response".to_string(),
        api_host: "https://api.openai.com".to_string(),
        key_available,
    }
}

#[tokio::test]
async fn realtime_capability_and_mint_use_only_host_owned_configuration() {
    let temp = TempDir::new().expect("temp config");
    let data_source = Arc::new(RealtimeTestDataSource::with_snapshot(official_snapshot(true)));
    let server = test_server(data_source.clone(), &temp);
    initialize(&server).await;

    let capability = request(
        &server,
        2,
        METHOD_MODEL_PROVIDER_CAPABILITIES_READ,
        json!({}),
    )
    .await;
    assert_eq!(capability.pointer("/result/realtime"), Some(&json!(true)));
    assert_eq!(
        capability.pointer("/result/realtimeBlockers"),
        Some(&json!([]))
    );
    assert_eq!(
        capability.pointer("/result/realtimeModel"),
        Some(&json!("gpt-realtime-2.1"))
    );
    assert_eq!(
        capability.pointer("/result/realtimeVoice"),
        Some(&json!("marin"))
    );
    let models = capability
        .pointer("/result/realtimeModels")
        .and_then(Value::as_array)
        .expect("realtime model options");
    assert!(models.iter().any(|model| model == "gpt-realtime-2.1"));
    let voices = capability
        .pointer("/result/realtimeVoices")
        .and_then(Value::as_array)
        .expect("realtime voice options");
    assert!(voices.iter().any(|voice| voice == "marin"));
    assert!(
        !capability.to_string().contains("sk-"),
        "capability read must never expose a provider key"
    );

    let minted = request(
        &server,
        3,
        "voiceRealtime/clientSecret/create",
        json!({}),
    )
    .await;
    assert_eq!(
        minted.pointer("/result/clientSecret"),
        Some(&json!("ek_test_ephemeral")),
        "renderer receives only the short-lived client secret"
    );
    assert_eq!(
        minted.pointer("/result/callsUrl"),
        Some(&json!("https://api.openai.com/v1/realtime/calls"))
    );
    assert_eq!(minted.pointer("/result/providerId"), Some(&json!("openai")));
    assert!(
        !minted.to_string().contains("sk-"),
        "mint response must never contain the standard provider key"
    );
    assert_eq!(
        data_source.minted.lock().expect("minted lock").as_slice(),
        [(
            "openai".to_string(),
            "gpt-realtime-2.1".to_string(),
            "marin".to_string()
        )]
    );
}

#[tokio::test]
async fn missing_provider_key_blocks_capability_and_mint_without_fake_secret() {
    let temp = TempDir::new().expect("temp config");
    let data_source = Arc::new(RealtimeTestDataSource::with_snapshot(official_snapshot(false)));
    let server = test_server(data_source.clone(), &temp);
    initialize(&server).await;

    let capability = request(
        &server,
        2,
        METHOD_MODEL_PROVIDER_CAPABILITIES_READ,
        json!({}),
    )
    .await;
    assert_eq!(capability.pointer("/result/realtime"), Some(&json!(false)));
    let blockers = capability
        .pointer("/result/realtimeBlockers")
        .and_then(Value::as_array)
        .expect("blockers");
    assert!(blockers.iter().any(|blocker| blocker == "providerKeyMissing"));

    let minted = request(
        &server,
        3,
        "voiceRealtime/clientSecret/create",
        json!({}),
    )
    .await;
    assert_eq!(minted.pointer("/result"), None);
    let error = minted
        .pointer("/error/message")
        .and_then(Value::as_str)
        .expect("mint error");
    assert!(error.contains("providerKeyMissing"), "{error}");
    assert!(data_source.minted.lock().expect("minted lock").is_empty());
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({
            "clientInfo": {
                "name": "realtime-voice-jsonrpc-test",
                "version": "1.0.0"
            }
        }),
    )
    .await;
    assert_eq!(
        response.pointer("/result/serverInfo/protocolVersion"),
        Some(&json!(PROTOCOL_VERSION))
    );
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0",
                "method": METHOD_INITIALIZED,
                "params": {}
            })
            .to_string(),
        )
        .await
        .expect("initialized notification");
    assert!(lines.is_empty());
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            })
            .to_string(),
        )
        .await
        .expect("handle JSON-RPC request");
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("decode JSON-RPC message"))
        .find(|message: &Value| message.get("id") == Some(&json!(id)))
        .expect("matching JSON-RPC response")
}
