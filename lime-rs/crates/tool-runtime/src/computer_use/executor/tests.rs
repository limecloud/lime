use super::*;
use crate::gateway_dispatch_execution::{
    execute_runtime_gateway_dispatch_tool, RuntimeGatewayDispatchToolRequest,
    RuntimeGatewayToolExecutionRegistration, RuntimeGatewayToolExecutionRegistry,
};
use crate::native_dispatch::NativeDispatch;
use crate::tool_executor::RuntimeToolExecutionIdentity;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

#[derive(Default)]
struct Gateway {
    calls: AtomicUsize,
    scope: Mutex<Option<(String, String, String)>>,
}

#[async_trait]
impl ComputerUseGateway for Gateway {
    async fn execute(
        &self,
        scope: ComputerUseToolScope<'_>,
        _: ComputerUseToolInput,
    ) -> ComputerUseResult<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.scope.lock().unwrap() = Some((
            scope.session_id.into(),
            scope.turn_id.into(),
            scope.call_id.into(),
        ));
        Ok(
            json!({"format":"png","width":1,"height":1,"data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII="}),
        )
    }
}

fn input() -> Value {
    json!({"target":{"type":"native","appId":"com.example.Editor","processId":42,"windowId":"12"},
        "operation":{"action":"screenshot"}})
}

fn registry(gateway: Arc<Gateway>) -> RuntimeGatewayToolExecutionRegistry {
    let dispatch = NativeDispatch::builder()
        .with_computer_use_gateway(gateway)
        .build();
    let registry = RuntimeGatewayToolExecutionRegistry::default();
    let executor = RuntimeToolExecutorHandle::new(Arc::new(dispatch.clone()));
    for surface in dispatch.surfaces() {
        registry.register(RuntimeGatewayToolExecutionRegistration::new(
            surface.definition(),
            executor.clone(),
            surface.aliases(),
        ));
    }
    registry
}

async fn call(
    registry: &RuntimeGatewayToolExecutionRegistry,
    input: &Value,
    identity: bool,
) -> crate::gateway_dispatch_execution::RuntimeGatewayDispatchToolResult {
    execute_runtime_gateway_dispatch_tool(
        registry,
        RuntimeGatewayDispatchToolRequest {
            tool_name: COMPUTER_USE_TOOL_NAME,
            params: input,
            working_directory: ".".into(),
            session_id: "canonical-session".into(),
            tool_identity: identity
                .then(|| RuntimeToolExecutionIdentity::new("canonical-call", "canonical-turn")),
            cancel_token: None,
            turn_context: None,
        },
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn native_gateway_preserves_trusted_identity_and_model_visible_screenshot() {
    let gateway = Arc::new(Gateway::default());
    let registry = registry(gateway.clone());
    let result = call(&registry, &input(), true).await.unwrap();
    assert_eq!(
        *gateway.scope.lock().unwrap(),
        Some((
            "canonical-session".into(),
            "canonical-turn".into(),
            "canonical-call".into()
        ))
    );
    assert!(result
        .content
        .iter()
        .any(|content| content.as_image().is_some()));
    let text = result
        .content
        .iter()
        .filter_map(|content| content.as_text())
        .map(|text| text.text.as_str())
        .collect::<String>();
    assert!(
        !text.contains("iVBOR"),
        "PNG must be image content, not tool text"
    );
    assert_eq!(
        result.structured_content,
        Some(json!({"format":"png","width":1,"height":1})),
        "Code Mode must receive the observation, without PNG transport data"
    );
    assert_eq!(gateway.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn model_authority_and_missing_identity_are_rejected_before_gateway() {
    let gateway = Arc::new(Gateway::default());
    let registry = registry(gateway.clone());
    assert!(call(&registry, &input(), false).await.is_err());
    for field in [
        "connection",
        "grant_id",
        "lease_id",
        "epoch",
        "fence",
        "consent",
        "thread_id",
        "turn_id",
    ] {
        let mut spoofed = input();
        spoofed[field] = json!("spoofed-authority");
        assert!(call(&registry, &spoofed, true).await.is_err(), "{field}");
    }
    let mut spoofed = input();
    spoofed["operation"]["consent"] = json!(true);
    assert!(call(&registry, &spoofed, true).await.is_err());
    assert!(call(
        &registry,
        &json!({"operation":{"action":"status","consent":true}}),
        true
    )
    .await
    .is_err());
    assert_eq!(gateway.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn tool_schema_accepts_native_action_and_readiness_discovery_but_rejects_authority() {
    let definition = computer_use_tool_definition();
    let validator = jsonschema::validator_for(&definition.input_schema).unwrap();
    assert!(validator.is_valid(&input()));
    assert!(validator.is_valid(&json!({"operation":{"action":"status"}})));
    let mut spoofed = input();
    spoofed["grant_id"] = json!("not-model-authority");
    assert!(!validator.is_valid(&spoofed));
}

#[tokio::test]
async fn invalid_action_is_rejected_before_gateway() {
    let gateway = Arc::new(Gateway::default());
    let registry = registry(gateway.clone());
    let mut input = input();
    input["operation"] = json!({"action":"drag","x":0,"y":0,"to_x":1,"to_y":1,"duration_ms":65000});
    assert!(call(&registry, &input, true).await.is_err());
    assert_eq!(gateway.calls.load(Ordering::SeqCst), 0);
}
