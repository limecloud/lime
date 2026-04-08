//! Property-based tests for MCP Connection Manager
//!
//! These tests validate the correctness properties defined in the design document.
//!
//! **Feature: mcp-alignment**

#[cfg(test)]
mod property_tests {
    use crate::mcp::connection_manager::McpConnectionManager;
    use crate::mcp::types::{ConnectionOptions, McpServerInfo, TransportType};
    use proptest::prelude::*;
    use std::collections::HashMap;
    use std::time::Duration;

    // Strategy for generating valid transport types
    fn transport_type_strategy() -> impl Strategy<Value = TransportType> {
        prop_oneof![
            Just(TransportType::Stdio),
            Just(TransportType::Http),
            Just(TransportType::Sse),
            Just(TransportType::WebSocket),
        ]
    }

    // Strategy for generating server names
    fn server_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_-]{0,20}".prop_map(|s| s.to_string())
    }

    // Strategy for generating URLs
    fn url_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("http://localhost:8080".to_string()),
            Just("https://example.com/mcp".to_string()),
            Just("ws://localhost:9000".to_string()),
            Just("wss://example.com/ws".to_string()),
        ]
    }

    // Strategy for generating commands
    fn command_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("node".to_string()),
            Just("python".to_string()),
            Just("npx".to_string()),
        ]
    }

    // Strategy for generating McpServerInfo
    fn server_info_strategy() -> impl Strategy<Value = McpServerInfo> {
        (
            server_name_strategy(),
            transport_type_strategy(),
            command_strategy(),
            url_strategy(),
        )
            .prop_map(|(name, transport_type, command, url)| {
                let (command, url) = match transport_type {
                    TransportType::Stdio => (Some(command), None),
                    TransportType::Http | TransportType::Sse | TransportType::WebSocket => {
                        (None, Some(url))
                    }
                };

                McpServerInfo {
                    name,
                    transport_type,
                    command,
                    args: Some(vec!["--version".to_string()]),
                    env: Some(HashMap::new()),
                    url,
                    headers: Some(HashMap::new()),
                    options: ConnectionOptions::default(),
                }
            })
    }

    // Strategy for generating connection options
    fn connection_options_strategy() -> impl Strategy<Value = ConnectionOptions> {
        (
            1u64..120u64,      // timeout in seconds
            0u32..10u32,       // max_retries
            5u64..120u64,      // heartbeat_interval in seconds
            100u64..5000u64,   // reconnect_delay_base in ms
            1000u64..60000u64, // reconnect_delay_max in ms
        )
            .prop_map(|(timeout, max_retries, heartbeat, delay_base, delay_max)| {
                ConnectionOptions {
                    timeout: Duration::from_secs(timeout),
                    max_retries,
                    heartbeat_interval: Duration::from_secs(heartbeat),
                    reconnect_delay_base: Duration::from_millis(delay_base),
                    reconnect_delay_max: Duration::from_millis(delay_max.max(delay_base + 1)),
                    queue_max_size: 100,
                }
            })
    }

    // **Property 1: Transport Type Support**
    //
    // *For any* valid transport type (stdio, HTTP, SSE, WebSocket), the MCP_Connection_Manager
    // SHALL successfully create a transport configuration when provided with valid configuration parameters.
    //
    // **Validates: Requirements 1.1**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_1_transport_type_support(server_info in server_info_strategy()) {
            // Test that transport config can be created for any valid transport type
            let result = McpConnectionManager::create_transport_config(&server_info);

            // Should succeed for properly configured server info
            prop_assert!(result.is_ok(), "Failed to create transport config for {:?}: {:?}",
                server_info.transport_type, result.err());

            // Verify the transport type matches
            let config = result.unwrap();
            prop_assert_eq!(config.transport_type(), server_info.transport_type);
        }
    }

    // **Property 2: Reconnection with Exponential Backoff**
    //
    // *For any* sequence of connection failures, the MCP_Connection_Manager SHALL increase
    // the delay between reconnection attempts exponentially up to a maximum limit.
    //
    // **Validates: Requirements 1.3**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_2_reconnection_exponential_backoff(
            options in connection_options_strategy(),
            attempts in prop::collection::vec(0u32..20u32, 2..10)
        ) {
            let manager = McpConnectionManager::with_options(options.clone());

            // Calculate delays for each attempt
            let delays: Vec<Duration> = attempts
                .iter()
                .map(|&attempt| manager.calculate_reconnect_delay(attempt))
                .collect();

            // Verify exponential growth (each delay should be >= previous, up to max)
            for i in 1..delays.len() {
                let prev_attempt = attempts[i - 1];
                let curr_attempt = attempts[i];

                if curr_attempt > prev_attempt {
                    // Delay should increase or stay at max
                    prop_assert!(
                        delays[i] >= delays[i - 1] || delays[i] == options.reconnect_delay_max,
                        "Delay did not increase: attempt {} -> {}, delay {:?} -> {:?}",
                        prev_attempt, curr_attempt, delays[i - 1], delays[i]
                    );
                }
            }

            // Verify no delay exceeds the maximum
            for (i, delay) in delays.iter().enumerate() {
                prop_assert!(
                    *delay <= options.reconnect_delay_max,
                    "Delay {} ({:?}) exceeds max ({:?})",
                    i, delay, options.reconnect_delay_max
                );
            }
        }
    }

    // **Property 3: Heartbeat Interval Consistency**
    //
    // *For any* connection options with heartbeat enabled, the configured heartbeat interval
    // SHALL be preserved and accessible.
    //
    // **Validates: Requirements 1.4**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_3_heartbeat_interval_consistency(options in connection_options_strategy()) {
            let manager = McpConnectionManager::with_options(options.clone());

            // Verify the heartbeat interval is preserved
            prop_assert_eq!(
                manager.default_options.heartbeat_interval,
                options.heartbeat_interval,
                "Heartbeat interval not preserved"
            );

            // Verify heartbeat interval is positive
            prop_assert!(
                options.heartbeat_interval.as_millis() > 0,
                "Heartbeat interval should be positive"
            );
        }
    }

    // **Property 4: Request Timeout and Retry**
    //
    // *For any* request with configured timeout and retry settings, the MCP_Connection_Manager
    // SHALL respect the timeout duration and retry up to the configured maximum attempts.
    //
    // **Validates: Requirements 1.6**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_4_request_timeout_and_retry(options in connection_options_strategy()) {
            let manager = McpConnectionManager::with_options(options.clone());

            // Verify timeout is preserved
            prop_assert_eq!(
                manager.default_options.timeout,
                options.timeout,
                "Timeout not preserved"
            );

            // Verify max_retries is preserved
            prop_assert_eq!(
                manager.default_options.max_retries,
                options.max_retries,
                "Max retries not preserved"
            );

            // Verify timeout is positive
            prop_assert!(
                options.timeout.as_millis() > 0,
                "Timeout should be positive"
            );
        }
    }

    // **Property 5: Request-Response Matching**
    //
    // *For any* set of request IDs generated by the connection manager, each ID SHALL be unique.
    //
    // **Validates: Requirements 1.7**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_5_request_response_matching(count in 1usize..100usize) {
            let manager = McpConnectionManager::new();

            // Generate multiple request IDs
            let ids: Vec<String> = (0..count)
                .map(|_| manager.next_request_id())
                .collect();

            // Verify all IDs are unique
            let unique_ids: std::collections::HashSet<_> = ids.iter().collect();
            prop_assert_eq!(
                unique_ids.len(),
                ids.len(),
                "Generated request IDs are not unique"
            );

            // Verify IDs have expected format
            for id in &ids {
                prop_assert!(
                    id.starts_with("mcp-req-"),
                    "Request ID does not have expected format: {}",
                    id
                );
            }
        }
    }

    // Additional test: Connection ID uniqueness
    //
    // *For any* number of connection ID generations, each ID SHALL be unique.
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_connection_id_uniqueness(count in 1usize..50usize) {
            // Generate multiple connection IDs
            let ids: Vec<String> = (0..count)
                .map(|_| McpConnectionManager::generate_connection_id())
                .collect();

            // Verify all IDs are unique
            let unique_ids: std::collections::HashSet<_> = ids.iter().collect();
            prop_assert_eq!(
                unique_ids.len(),
                ids.len(),
                "Generated connection IDs are not unique"
            );

            // Verify IDs are valid UUIDs
            for id in &ids {
                prop_assert!(
                    uuid::Uuid::parse_str(id).is_ok(),
                    "Connection ID is not a valid UUID: {}",
                    id
                );
            }
        }
    }

    // Additional test: Transport config validation
    //
    // *For any* server info with missing required fields, transport config creation SHALL fail.
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_transport_config_validation(transport_type in transport_type_strategy()) {
            // Create server info with missing required fields
            let server_info = McpServerInfo {
                name: "test".to_string(),
                transport_type,
                command: None, // Missing for stdio
                args: None,
                env: None,
                url: None, // Missing for HTTP/WS
                headers: None,
                options: ConnectionOptions::default(),
            };

            let result = McpConnectionManager::create_transport_config(&server_info);

            // Should fail for all transport types due to missing required fields
            prop_assert!(
                result.is_err(),
                "Should fail for {:?} with missing fields",
                transport_type
            );
        }
    }
}
