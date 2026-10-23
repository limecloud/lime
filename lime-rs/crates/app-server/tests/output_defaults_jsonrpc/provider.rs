use super::{call, initialize, provider, support, turn};
use app_server::{AppServer, EventLogWriter};
use lime_core::database::dao::api_key_provider::ApiProviderType;
use serde_json::json;

#[tokio::test]
async fn real_provider_requests_use_thread_defaults_and_selected_model_output_capabilities() {
    for supported in [true, false] {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.yaml");
        std::fs::write(&config, "server:\n  api_key: output-test\nmodel_verbosity: high\nmodel_reasoning_summary: detailed\n").unwrap();
        let provider = provider::Provider::start().await;
        let server = AppServer::with_runtime(
            support::runtime_core_with_chat_providers_and_output_at(
                &temp,
                &[(
                    "history-provider",
                    "history-model",
                    ApiProviderType::OpenaiResponse,
                    &provider.url,
                    "history-fixture-key",
                )],
                supported,
            )
            .with_app_config_path(config)
            .with_event_log_writer(std::sync::Arc::new(
                EventLogWriter::new(temp.path().join("events")).unwrap(),
            )),
        );
        initialize(&server).await;
        let start = || json!({"cwd":temp.path(),"modelProvider":"history-provider","model":"history-model"});
        let first = call(&server, "thread/start", start()).await;
        let thread = &first["thread"]["id"];
        turn(&server, thread, None).await;
        turn(&server, thread, Some("none")).await;
        call(
            &server,
            "config/batchWrite",
            json!({"edits":[
                {"keyPath":"model_verbosity","value":"low","mergeStrategy":"replace"},
                {"keyPath":"model_reasoning_summary","value":"concise","mergeStrategy":"replace"}
            ]}),
        )
        .await;
        turn(&server, thread, None).await;
        let second = call(&server, "thread/start", start()).await;
        turn(&server, &second["thread"]["id"], None).await;
        let requests = provider.requests();
        assert_eq!(requests.len(), 4);
        for (request, (summary, verbosity)) in requests.iter().zip([
            (Some("detailed"), "high"),
            (None, "high"),
            (None, "high"),
            (Some("concise"), "low"),
        ]) {
            assert_eq!(
                request
                    .pointer("/reasoning/summary")
                    .and_then(|value| value.as_str()),
                if supported { summary } else { None }
            );
            assert_eq!(
                request
                    .pointer("/text/verbosity")
                    .and_then(|value| value.as_str()),
                supported.then_some(verbosity)
            );
        }
    }
}
