//! Property-based tests for MCP Configuration Manager
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.

use proptest::prelude::*;
use std::collections::HashMap;
use std::time::Duration;

use crate::mcp::config_manager::{merge_configs, ConfigManager, McpConfigManager};
use crate::mcp::types::{ConfigManagerOptions, ConfigScope, McpServerConfig, TransportType};

/// Strategy for generating random transport types
fn transport_type_strategy() -> impl Strategy<Value = TransportType> {
    prop_oneof![
        Just(TransportType::Stdio),
        Just(TransportType::Http),
        Just(TransportType::Sse),
        Just(TransportType::WebSocket),
    ]
}

/// Strategy for generating random server names
fn server_name_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,20}".prop_map(|s| s.to_string())
}

/// Strategy for generating random environment variable keys
fn env_key_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("API_KEY".to_string()),
        Just("SECRET_TOKEN".to_string()),
        Just("PASSWORD".to_string()),
        Just("AUTH_TOKEN".to_string()),
        Just("DEBUG".to_string()),
        Just("PORT".to_string()),
        Just("HOST".to_string()),
        Just("LOG_LEVEL".to_string()),
    ]
}

/// Strategy for generating random environment variable values
fn env_value_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9_-]{1,50}".prop_map(|s| s.to_string())
}

/// Strategy for generating random environment maps
fn env_map_strategy() -> impl Strategy<Value = Option<HashMap<String, String>>> {
    prop_oneof![
        Just(None),
        prop::collection::hash_map(env_key_strategy(), env_value_strategy(), 0..5).prop_map(Some),
    ]
}

/// Strategy for generating valid McpServerConfig
fn server_config_strategy() -> impl Strategy<Value = McpServerConfig> {
    (
        transport_type_strategy(),
        prop::bool::ANY,
        env_map_strategy(),
    )
        .prop_map(|(transport_type, enabled, env)| {
            let (command, url) = match transport_type {
                TransportType::Stdio => (Some("test-cmd".to_string()), None),
                TransportType::Http => (None, Some("http://localhost:8080".to_string())),
                TransportType::Sse => (None, Some("http://localhost:8080/sse".to_string())),
                TransportType::WebSocket => (None, Some("ws://localhost:8080".to_string())),
            };

            McpServerConfig {
                transport_type,
                command,
                args: Some(vec!["arg1".to_string()]),
                env,
                url,
                headers: None,
                enabled,
                timeout: Duration::from_secs(30),
                retries: 3,
                auto_approve: vec![],
                log_level: Default::default(),
            }
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property 6: Configuration Merge Precedence**
    ///
    /// *For any* configuration key that exists in both global and project-level configs,
    /// the merged result SHALL contain the project-level value.
    ///
    /// **Validates: Requirements 2.2**
    #[test]
    fn prop_config_merge_precedence(
        server_name in server_name_strategy(),
        global_config in server_config_strategy(),
        project_config in server_config_strategy(),
    ) {
        // Feature: mcp-alignment, Property 6: Configuration Merge Precedence
        let mut global = HashMap::new();
        global.insert(server_name.clone(), global_config);

        let mut project = HashMap::new();
        project.insert(server_name.clone(), project_config.clone());

        let merged = merge_configs(&global, &project);

        // Project config should take precedence
        let merged_config = merged.get(&server_name).unwrap();
        prop_assert_eq!(merged_config.transport_type, project_config.transport_type);
        prop_assert_eq!(merged_config.enabled, project_config.enabled);
        prop_assert_eq!(merged_config.timeout, project_config.timeout);
    }

    /// **Property 7: Schema Validation**
    ///
    /// *For any* server configuration, the MCP_Config_Manager SHALL correctly identify
    /// valid configurations as valid and invalid configurations as invalid according
    /// to the defined schema.
    ///
    /// **Validates: Requirements 2.3**
    #[test]
    fn prop_schema_validation(
        config in server_config_strategy(),
    ) {
        // Feature: mcp-alignment, Property 7: Schema Validation
        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            validate_commands: false,
            ..Default::default()
        });

        let result = manager.validate(&config);

        // Valid configs (with proper command/url) should pass validation
        let has_required_fields = match config.transport_type {
            TransportType::Stdio => config.command.is_some(),
            TransportType::Http | TransportType::Sse | TransportType::WebSocket => config.url.is_some(),
        };

        prop_assert_eq!(result.valid, has_required_fields);
    }


    /// **Property 8: Server Enable/Disable State**
    ///
    /// *For any* server, after calling enable_server or disable_server,
    /// the server's enabled state SHALL reflect the requested state.
    ///
    /// **Validates: Requirements 2.6**
    #[test]
    fn prop_server_enable_disable_state(
        server_name in server_name_strategy(),
        initial_enabled in prop::bool::ANY,
        target_enabled in prop::bool::ANY,
    ) {
        // Feature: mcp-alignment, Property 8: Server Enable/Disable State
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = tempfile::tempdir().unwrap();
            let config_path = temp_dir.path().join("settings.yaml");

            let manager = McpConfigManager::with_options(ConfigManagerOptions {
                project_config_path: Some(config_path),
                auto_save: false,
                validate_commands: false,
                ..Default::default()
            });

            // Add server with initial state
            let config = McpServerConfig {
                transport_type: TransportType::Stdio,
                command: Some("test-cmd".to_string()),
                enabled: initial_enabled,
                ..Default::default()
            };

            manager.add_server(&server_name, config).await.unwrap();

            // Change state
            if target_enabled {
                manager.enable_server(&server_name).await.unwrap();
            } else {
                manager.disable_server(&server_name).await.unwrap();
            }

            // Verify state
            let server = manager.get_server(&server_name).unwrap();
            assert_eq!(server.enabled, target_enabled);
        });
    }


    /// **Property 9: Sensitive Data Masking**
    ///
    /// *For any* configuration containing sensitive keys (API keys, tokens, passwords),
    /// the exported configuration SHALL have those values masked.
    ///
    /// **Validates: Requirements 2.7**
    #[test]
    fn prop_sensitive_data_masking(
        server_name in server_name_strategy(),
        secret_value in "[a-zA-Z0-9]{10,30}",
    ) {
        // Feature: mcp-alignment, Property 9: Sensitive Data Masking
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = tempfile::tempdir().unwrap();
            let config_path = temp_dir.path().join("settings.yaml");

            let manager = McpConfigManager::with_options(ConfigManagerOptions {
                project_config_path: Some(config_path),
                auto_save: false,
                validate_commands: false,
                ..Default::default()
            });

            // Add server with sensitive data
            let config = McpServerConfig {
                transport_type: TransportType::Stdio,
                command: Some("test-cmd".to_string()),
                env: Some(HashMap::from([
                    ("API_KEY".to_string(), secret_value.clone()),
                    ("SECRET_TOKEN".to_string(), secret_value.clone()),
                ])),
                ..Default::default()
            };

            manager.add_server(&server_name, config).await.unwrap();

            // Export with masking
            let exported = manager.export(true);

            // Original secret should not appear in masked export
            // (unless it's very short, which our strategy prevents)
            if secret_value.len() > 8 {
                assert!(!exported.contains(&secret_value),
                    "Secret value should be masked in export");
            }

            // Export without masking should contain the secret
            let unmasked = manager.export(false);
            assert!(unmasked.contains(&secret_value),
                "Secret value should appear in unmasked export");
        });
    }


    /// **Property 10: Configuration Backup Round-Trip**
    ///
    /// *For any* valid configuration, backing up and then restoring SHALL result
    /// in an equivalent configuration.
    ///
    /// **Validates: Requirements 2.8**
    #[test]
    fn prop_config_backup_roundtrip(
        server_name in server_name_strategy(),
        config in server_config_strategy(),
    ) {
        // Feature: mcp-alignment, Property 10: Configuration Backup Round-Trip
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = tempfile::tempdir().unwrap();
            let config_path = temp_dir.path().join("settings.yaml");

            let manager = McpConfigManager::with_options(ConfigManagerOptions {
                project_config_path: Some(config_path.clone()),
                auto_save: false,
                validate_commands: false,
                ..Default::default()
            });

            // Add server and save
            manager.add_server(&server_name, config.clone()).await.unwrap();
            manager.save(ConfigScope::Project).await.unwrap();

            // Create backup
            let backup_path = manager.backup().await.unwrap();

            // Modify the config
            let modified_config = McpServerConfig {
                transport_type: TransportType::Stdio,
                command: Some("modified-cmd".to_string()),
                enabled: !config.enabled,
                ..Default::default()
            };
            manager.update_server(&server_name, modified_config).await.unwrap();
            manager.save(ConfigScope::Project).await.unwrap();

            // Restore from backup
            manager.restore(&backup_path).await.unwrap();

            // Verify restoration
            let restored = manager.get_server(&server_name).unwrap();
            assert_eq!(restored.transport_type, config.transport_type);
            assert_eq!(restored.enabled, config.enabled);
            assert_eq!(restored.command, config.command);
        });
    }
}
