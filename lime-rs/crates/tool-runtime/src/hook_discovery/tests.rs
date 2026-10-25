use super::*;
use std::fs;

fn setup() -> (tempfile::TempDir, tempfile::TempDir) {
    (
        tempfile::TempDir::new().expect("codex home"),
        tempfile::TempDir::new().expect("cwd"),
    )
}

#[test]
fn discovers_user_toml_with_exact_metadata_and_untrusted_default() {
    let (home, cwd) = setup();
    fs::write(
        home.path().join("config.toml"),
        r#"[hooks]

[[hooks.PreToolUse]]
matcher = "Bash"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "python3 /tmp/listed-hook.py"
timeout = 5
statusMessage = "checking"
additionalContextLimit = 4096
"#,
    )
    .expect("write config");

    let report = discover_hooks(&HookDiscoveryInput {
        lime_home: home.path().to_path_buf(),
        cwd: cwd.path().to_path_buf(),
        plugins: Vec::new(),
    });

    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.hooks.len(), 1);
    let hook = &report.hooks[0];
    assert_eq!(hook.snapshot.event_name, RuntimeHookEventName::PreToolUse);
    assert_eq!(hook.snapshot.matcher.as_deref(), Some("Bash"));
    assert_eq!(hook.snapshot.timeout_sec, 5);
    assert_eq!(hook.snapshot.additional_context_limit, Some(4096));
    assert_eq!(
        hook.snapshot.trust_status,
        RuntimeHookTrustStatus::Untrusted
    );
    assert!(!hook.is_executable());
    assert!(hook.snapshot.current_hash.starts_with("sha256:"));
}

#[test]
fn discovers_async_command_with_async_execution_mode() {
    let (home, cwd) = setup();
    fs::write(
        home.path().join("config.toml"),
        r#"[hooks]
[[hooks.PostToolUse]]
[[hooks.PostToolUse.hooks]]
type = "command"
command = "echo background"
async = true
"#,
    )
    .expect("write config");

    let report = discover_hooks(&HookDiscoveryInput {
        lime_home: home.path().to_path_buf(),
        cwd: cwd.path().to_path_buf(),
        plugins: Vec::new(),
    });

    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.hooks.len(), 1);
    assert_eq!(
        report.hooks[0].snapshot.execution_mode,
        RuntimeHookExecutionMode::Async
    );
}

#[test]
fn discovers_mcp_tool_with_codex_handler_metadata() {
    let (home, cwd) = setup();
    fs::write(
        home.path().join("config.toml"),
        r#"[hooks]
[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "mcp_tool"
server = "security"
tool = "scan"
input = { severity = "high" }
timeout = 12
"#,
    )
    .expect("write config");

    let report = discover_hooks(&HookDiscoveryInput {
        lime_home: home.path().to_path_buf(),
        cwd: cwd.path().to_path_buf(),
        plugins: Vec::new(),
    });

    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.hooks.len(), 1);
    let hook = &report.hooks[0];
    assert_eq!(hook.snapshot.handler_type, RuntimeHookHandlerType::McpTool);
    assert_eq!(hook.snapshot.mcp_server.as_deref(), Some("security"));
    assert_eq!(hook.snapshot.mcp_tool.as_deref(), Some("scan"));
    assert_eq!(hook.snapshot.timeout_sec, 12);
    assert!(!hook.is_executable());
}

#[test]
fn trusted_hash_enables_same_normalized_definition_and_changes_fail_closed() {
    let (home, cwd) = setup();
    let config_path = home.path().join("config.toml");
    fs::write(
        &config_path,
        r#"[hooks]
[[hooks.PreToolUse]]
matcher = "Bash"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "echo trusted"
"#,
    )
    .expect("write config");
    let input = HookDiscoveryInput {
        lime_home: home.path().to_path_buf(),
        cwd: cwd.path().to_path_buf(),
        plugins: Vec::new(),
    };
    let first = discover_hooks(&input);
    let hook = &first.hooks[0].snapshot;
    let key = hook.key.clone();
    let hash = hook.current_hash.clone();
    fs::write(
        &config_path,
        format!(
            r#"[hooks]
[[hooks.PreToolUse]]
matcher = "Bash"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "echo trusted"

[hooks.state."{key}"]
enabled = true
trusted_hash = "{hash}"
"#
        ),
    )
    .expect("trust config");
    let trusted = discover_hooks(&input);
    assert_eq!(
        trusted.hooks[0].snapshot.trust_status,
        RuntimeHookTrustStatus::Trusted
    );
    assert!(trusted.hooks[0].is_executable());

    let changed = fs::read_to_string(&config_path)
        .expect("read config")
        .replace("echo trusted", "echo modified");
    fs::write(&config_path, changed).expect("modify config");
    let modified = discover_hooks(&input);
    assert_eq!(
        modified.hooks[0].snapshot.trust_status,
        RuntimeHookTrustStatus::Modified
    );
    assert!(!modified.hooks[0].is_executable());
}

#[test]
fn discovers_active_plugin_hooks_with_plugin_stable_key() {
    let (home, cwd) = setup();
    let plugin_root = home.path().join("plugins/demo");
    fs::create_dir_all(plugin_root.join("hooks")).expect("hooks dir");
    fs::write(
            plugin_root.join("hooks/hooks.json"),
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo plugin","timeout":7}]}]}}"#,
        )
        .expect("plugin hooks");

    let report = discover_hooks(&HookDiscoveryInput {
        lime_home: home.path().to_path_buf(),
        cwd: cwd.path().to_path_buf(),
        plugins: vec![PluginHookSource {
            plugin_id: "demo@test".to_string(),
            source_path: plugin_root.join("hooks/hooks.json"),
            source_relative_path: "hooks/hooks.json".to_string(),
            plugin_data_root: home.path().join("data"),
            hooks: serde_json::from_str::<crate::hook_config::HooksFile>(
                &fs::read_to_string(plugin_root.join("hooks/hooks.json")).unwrap(),
            )
            .unwrap()
            .hooks,
            plugin_root,
        }],
    });

    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(
        report.hooks[0].snapshot.key,
        "demo@test:hooks/hooks.json:pre_tool_use:0:0"
    );
    assert_eq!(
        report.hooks[0].snapshot.plugin_id.as_deref(),
        Some("demo@test")
    );
    assert_eq!(report.hooks[0].snapshot.source, RuntimeHookSource::Plugin);
}

#[test]
fn session_end_timeout_is_clamped_and_standard_default_is_ten_minutes() {
    let (home, cwd) = setup();
    fs::write(
        home.path().join("config.toml"),
        r#"[hooks]
[[hooks.PreToolUse]]
[[hooks.PreToolUse.hooks]]
type = "command"
command = "echo pre"
[[hooks.SessionEnd]]
[[hooks.SessionEnd.hooks]]
type = "command"
command = "echo end"
timeout = 30
"#,
    )
    .expect("config");
    let report = discover_hooks(&HookDiscoveryInput {
        lime_home: home.path().to_path_buf(),
        cwd: cwd.path().to_path_buf(),
        plugins: Vec::new(),
    });
    assert_eq!(report.hooks[0].snapshot.timeout_sec, 600);
    assert_eq!(report.hooks[1].snapshot.timeout_sec, 3);
    assert_eq!(report.warnings.len(), 1);
}
