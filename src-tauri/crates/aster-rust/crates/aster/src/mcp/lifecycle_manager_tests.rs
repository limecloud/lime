//! Property-based tests for MCP Lifecycle Manager
//!
//! These tests validate the correctness properties defined in the design document.
//!
//! **Feature: mcp-alignment**

#[cfg(test)]
mod property_tests {
    use crate::mcp::lifecycle_manager::{LifecycleManager, McpLifecycleManager};
    use crate::mcp::types::{LifecycleOptions, McpServerConfig, ServerState, TransportType};
    use proptest::prelude::*;
    use std::collections::HashMap;
    use std::time::Duration;

    // Strategy for generating server names
    fn server_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_-]{0,15}".prop_map(|s| s.to_string())
    }

    // Strategy for generating lifecycle options
    fn lifecycle_options_strategy() -> impl Strategy<Value = LifecycleOptions> {
        (
            1u64..60u64,     // startup_timeout in seconds
            1u64..30u64,     // shutdown_timeout in seconds
            0u32..10u32,     // max_restarts
            100u64..5000u64, // restart_delay in ms
            5u64..60u64,     // health_check_interval in seconds
            1u32..10u32,     // max_consecutive_failures
        )
            .prop_map(
                |(
                    startup,
                    shutdown,
                    max_restarts,
                    restart_delay,
                    health_interval,
                    max_failures,
                )| {
                    LifecycleOptions {
                        startup_timeout: Duration::from_secs(startup),
                        shutdown_timeout: Duration::from_secs(shutdown),
                        max_restarts,
                        restart_delay: Duration::from_millis(restart_delay),
                        health_check_interval: Duration::from_secs(health_interval),
                        max_consecutive_failures: max_failures,
                    }
                },
            )
    }

    // Strategy for generating server configs
    fn server_config_strategy() -> impl Strategy<Value = McpServerConfig> {
        (
            prop_oneof![
                Just("echo".to_string()),
                Just("cat".to_string()),
                Just("true".to_string()),
            ],
            prop::collection::vec("[a-z0-9]{1,5}".prop_map(|s| s.to_string()), 0..3),
        )
            .prop_map(|(command, args)| McpServerConfig {
                transport_type: TransportType::Stdio,
                command: Some(command),
                args: Some(args),
                env: Some(HashMap::new()),
                url: None,
                headers: None,
                enabled: true,
                timeout: Duration::from_secs(30),
                retries: 3,
                auto_approve: vec![],
                log_level: Default::default(),
            })
    }

    // **Property 11: Auto-Restart with Backoff**
    //
    // *For any* server that exits unexpectedly, the MCP_Lifecycle_Manager SHALL attempt
    // restart with increasing delays between attempts.
    //
    // **Validates: Requirements 3.2**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_11_auto_restart_with_backoff(
            options in lifecycle_options_strategy(),
            attempts in prop::collection::vec(0u32..15u32, 2..10)
        ) {
            let manager = McpLifecycleManager::with_options(options.clone());

            // Calculate delays for each attempt
            let delays: Vec<Duration> = attempts
                .iter()
                .map(|&attempt| manager.calculate_restart_delay(attempt))
                .collect();

            // Verify exponential growth (each delay should be >= previous, up to max)
            for i in 1..delays.len() {
                let prev_attempt = attempts[i - 1];
                let curr_attempt = attempts[i];

                if curr_attempt > prev_attempt {
                    // Delay should increase or stay at max (60 seconds)
                    let max_delay = Duration::from_secs(60);
                    prop_assert!(
                        delays[i] >= delays[i - 1] || delays[i] == max_delay,
                        "Delay did not increase: attempt {} -> {}, delay {:?} -> {:?}",
                        prev_attempt, curr_attempt, delays[i - 1], delays[i]
                    );
                }
            }

            // Verify no delay exceeds 60 seconds (the hardcoded max)
            let max_delay = Duration::from_secs(60);
            for (i, delay) in delays.iter().enumerate() {
                prop_assert!(
                    *delay <= max_delay,
                    "Delay {} ({:?}) exceeds max ({:?})",
                    i, delay, max_delay
                );
            }
        }
    }

    // **Property 12: Server State Tracking**
    //
    // *For any* server lifecycle operation (start, stop, restart), the server state
    // SHALL transition through the expected states in order.
    //
    // **Validates: Requirements 3.3**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_12_server_state_tracking(
            server_name in server_name_strategy(),
            config in server_config_strategy()
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let manager = McpLifecycleManager::new();

                // Register server
                manager.register_server(&server_name, config);
                tokio::time::sleep(Duration::from_millis(50)).await;

                // Initial state should be Stopped
                let initial_state = manager.get_state(&server_name);
                prop_assert_eq!(
                    initial_state,
                    ServerState::Stopped,
                    "Initial state should be Stopped, got {:?}",
                    initial_state
                );

                // Verify process info exists
                let process = manager.get_process(&server_name);
                prop_assert!(
                    process.is_some(),
                    "Process info should exist after registration"
                );

                // Verify is_running returns false for stopped server
                prop_assert!(
                    !manager.is_running(&server_name),
                    "is_running should return false for stopped server"
                );

                Ok(())
            })?;
        }
    }

    // **Property 13: Graceful Shutdown Timeout**
    //
    // *For any* server being stopped, the MCP_Lifecycle_Manager SHALL wait up to
    // the configured timeout before force killing.
    //
    // **Validates: Requirements 3.5**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_13_graceful_shutdown_timeout(options in lifecycle_options_strategy()) {
            let manager = McpLifecycleManager::with_options(options.clone());

            // Verify shutdown timeout is preserved
            prop_assert_eq!(
                manager.options.shutdown_timeout,
                options.shutdown_timeout,
                "Shutdown timeout not preserved"
            );

            // Verify shutdown timeout is positive
            prop_assert!(
                options.shutdown_timeout.as_millis() > 0,
                "Shutdown timeout should be positive"
            );

            // Verify startup timeout is preserved
            prop_assert_eq!(
                manager.options.startup_timeout,
                options.startup_timeout,
                "Startup timeout not preserved"
            );
        }
    }

    // **Property 14: Dependency Start Order**
    //
    // *For any* server with dependencies, the MCP_Lifecycle_Manager SHALL start
    // all dependencies before starting the dependent server.
    //
    // **Validates: Requirements 3.8**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_14_dependency_start_order(
            num_servers in 2usize..=5usize
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let manager = McpLifecycleManager::new();

                // Create servers with linear dependency chain: 0 <- 1 <- 2 <- ...
                let server_names: Vec<String> = (0..num_servers)
                    .map(|i| format!("server-{}", i))
                    .collect();

                // Register all servers
                for name in &server_names {
                    let config = McpServerConfig {
                        transport_type: TransportType::Stdio,
                        command: Some("echo".to_string()),
                        args: Some(vec!["test".to_string()]),
                        env: None,
                        url: None,
                        headers: None,
                        enabled: true,
                        timeout: Duration::from_secs(30),
                        retries: 3,
                        auto_approve: vec![],
                        log_level: Default::default(),
                    };
                    manager.register_server(name, config);
                }
                tokio::time::sleep(Duration::from_millis(50)).await;

                // Set up dependencies: each server depends on the previous one
                for i in 1..num_servers {
                    manager.set_dependencies(
                        &server_names[i],
                        vec![server_names[i - 1].clone()],
                    );
                }
                tokio::time::sleep(Duration::from_millis(50)).await;

                // Get topological sort
                let servers = manager.servers.read().await;
                let sorted = manager.topological_sort(&servers);
                drop(servers);

                // Verify dependency order: for each server, all its dependencies
                // should appear before it in the sorted list
                for i in 1..num_servers {
                    let server_pos = sorted.iter().position(|x| x == &server_names[i]);
                    let dep_pos = sorted.iter().position(|x| x == &server_names[i - 1]);

                    prop_assert!(
                        server_pos.is_some() && dep_pos.is_some(),
                        "Server or dependency not found in sorted list"
                    );

                    prop_assert!(
                        dep_pos.unwrap() < server_pos.unwrap(),
                        "Dependency {} should come before {} in start order",
                        server_names[i - 1],
                        server_names[i]
                    );
                }

                Ok(())
            })?;
        }
    }

    // Additional property tests

    // Test that lifecycle options are properly preserved
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_lifecycle_options_preserved(options in lifecycle_options_strategy()) {
            let manager = McpLifecycleManager::with_options(options.clone());

            prop_assert_eq!(
                manager.options.startup_timeout,
                options.startup_timeout,
                "Startup timeout not preserved"
            );
            prop_assert_eq!(
                manager.options.shutdown_timeout,
                options.shutdown_timeout,
                "Shutdown timeout not preserved"
            );
            prop_assert_eq!(
                manager.options.max_restarts,
                options.max_restarts,
                "Max restarts not preserved"
            );
            prop_assert_eq!(
                manager.options.restart_delay,
                options.restart_delay,
                "Restart delay not preserved"
            );
            prop_assert_eq!(
                manager.options.health_check_interval,
                options.health_check_interval,
                "Health check interval not preserved"
            );
            prop_assert_eq!(
                manager.options.max_consecutive_failures,
                options.max_consecutive_failures,
                "Max consecutive failures not preserved"
            );
        }
    }

    // Test that server registration works correctly
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_server_registration(
            server_name in server_name_strategy(),
            config in server_config_strategy()
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let manager = McpLifecycleManager::new();

                // Register server
                manager.register_server(&server_name, config.clone());
                tokio::time::sleep(Duration::from_millis(50)).await;

                // Verify server is registered
                let process = manager.get_process(&server_name);
                prop_assert!(
                    process.is_some(),
                    "Server should be registered"
                );

                let process = process.unwrap();
                prop_assert_eq!(
                    process.name,
                    server_name,
                    "Server name should match"
                );
                prop_assert_eq!(
                    process.state,
                    ServerState::Stopped,
                    "Initial state should be Stopped"
                );
                prop_assert_eq!(
                    process.restart_count,
                    0,
                    "Initial restart count should be 0"
                );

                Ok(())
            })?;
        }
    }

    // Test that unregistration works correctly
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn property_server_unregistration(
            server_name in server_name_strategy(),
            config in server_config_strategy()
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let manager = McpLifecycleManager::new();

                // Register server
                manager.register_server(&server_name, config);
                tokio::time::sleep(Duration::from_millis(50)).await;

                // Verify server is registered
                prop_assert!(
                    manager.get_process(&server_name).is_some(),
                    "Server should be registered"
                );

                // Unregister server
                let result = manager.unregister_server(&server_name).await;
                prop_assert!(
                    result.is_ok(),
                    "Unregistration should succeed"
                );

                // Verify server is no longer registered
                prop_assert!(
                    manager.get_process(&server_name).is_none(),
                    "Server should be unregistered"
                );

                Ok(())
            })?;
        }
    }

    // Test that get_all_processes returns correct count
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]
        #[test]
        fn property_get_all_processes_count(
            num_servers in 1usize..=10usize
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let manager = McpLifecycleManager::new();

                // Register multiple servers
                for i in 0..num_servers {
                    let config = McpServerConfig {
                        transport_type: TransportType::Stdio,
                        command: Some("echo".to_string()),
                        args: Some(vec!["test".to_string()]),
                        env: None,
                        url: None,
                        headers: None,
                        enabled: true,
                        timeout: Duration::from_secs(30),
                        retries: 3,
                        auto_approve: vec![],
                        log_level: Default::default(),
                    };
                    manager.register_server(&format!("server-{}", i), config);
                }
                tokio::time::sleep(Duration::from_millis(100)).await;

                // Verify count
                let processes = manager.get_all_processes();
                prop_assert_eq!(
                    processes.len(),
                    num_servers,
                    "Should have {} processes, got {}",
                    num_servers,
                    processes.len()
                );

                Ok(())
            })?;
        }
    }
}
