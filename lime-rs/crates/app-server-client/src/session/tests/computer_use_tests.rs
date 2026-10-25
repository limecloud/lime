use super::*;
use app_server_protocol::protocol::v2::*;
use serde_json::json;

#[tokio::test]
async fn target_confirmation_requires_same_connection_and_exact_authority() {
    for case in 0..5 {
        let target = ComputerUseTargetIdentity::Native {
            app_id: "com.example.Editor".into(),
            process_id: Some(42),
            window_id: Some("12".into()),
            title: None,
        };
        let expected = target.clone();
        let (transport, mut receiver, sender, _) = transport_pair();
        let server = tokio::spawn(async move {
            complete_handshake(&mut receiver, &sender).await;
            let JsonRpcMessage::Request(request) = receiver.recv().await.unwrap() else {
                panic!("setup")
            };
            assert_eq!(request.method, METHOD_COMPUTER_USE_SETUP);
            let params: ComputerUseSetupParams =
                serde_json::from_value(request.params.unwrap()).unwrap();
            assert_eq!(params.target, Some(expected));
            assert_eq!(params.grant_scope, ComputerUseGrantScope::Session);
            let mut reply = json!({
                "accepted":true,
                "status":{"adapter":"native","readiness":"ready","epoch":1},
                "grant":{"id":"grant","adapter":"native","scope":"session","epoch":1,
                    "target":{"type":"native","appId":"com.example.Editor","processId":42,"windowId":"12","title":"OS-observed label"},
                    "capabilities":["screenshot"]}
            });
            match case {
                1 => reply["accepted"] = json!(false),
                2 => reply["grant"] = Value::Null,
                3 => reply["grant"]["target"]["processId"] = json!(43),
                4 => reply["grant"]["scope"] = json!("persistent"),
                _ => {}
            }
            sender
                .send(JsonRpcMessage::Response(
                    JsonRpcResponse::new(request.id, reply).unwrap(),
                ))
                .unwrap();
            // Keep the transport alive until the client closes it.
            while receiver.recv().await.is_some() {}
        });
        let session = ClientSession::start(transport, initialize_params())
            .await
            .unwrap();
        let result = session
            .request_handle()
            .setup_computer_use_targets(&[target])
            .await;
        assert_eq!(result.is_ok(), case == 0, "case {case}: {result:?}");
        session.shutdown().await.unwrap();
        server.await.unwrap();
    }
}
