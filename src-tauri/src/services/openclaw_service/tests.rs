use super::{
    apply_gateway_runtime_defaults, build_environment_status, build_openclaw_cleanup_command,
    build_openclaw_install_command, build_openclaw_pnpm_install_command,
    build_winget_install_command, command_bin_dir_for, determine_api_type,
    extract_gateway_auth_token, find_installed_openclaw_package,
    format_gateway_start_failure_message, format_openclaw_update_failure_message,
    format_provider_base_url, gateway_start_args, has_api_version,
    infer_openclaw_package_name_from_path, npm_global_command_dirs_for,
    npm_global_node_modules_dirs_for, package_registry_for_package_spec, parse_semver_from_text,
    resolve_openclaw_cli_entry_from_package_manifest,
    resolve_openclaw_command_from_runtime_candidate,
    resolve_openclaw_command_from_runtime_candidate_for, resolve_windows_dependency_install_plan,
    runtime_candidate_matches_install_root, sanitize_runtime_config, select_best_git_candidate,
    select_best_semver_candidate, select_gateway_start_failure_detail,
    select_openclaw_update_failure_detail, select_preferred_path_candidate,
    shell_command_escape_for, shell_command_invocation_prefix_for, shell_npm_prefix_assignment_for,
    shell_path_assignment_for, trim_trailing_slash, windows_dependency_action_result,
    windows_dependency_setup_message, windows_git_install_dir_variants,
    windows_install_block_result, windows_manual_install_message, DependencyKind, DependencyStatus,
    EnvironmentDiagnostics, OpenClawRuntimeCandidate, ResolvedOpenClawCommand, ShellPlatform,
    WindowsDependencyInstallPlan, NPM_MIRROR_CN, OPENCLAW_CN_PACKAGE, OPENCLAW_DEFAULT_PACKAGE,
};
use crate::database::dao::api_key_provider::{ApiKeyProvider, ApiProviderType, ProviderGroup};
use chrono::Utc;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn build_provider(provider_type: ApiProviderType, api_host: &str) -> ApiKeyProvider {
    ApiKeyProvider {
        id: "provider-1".to_string(),
        name: "Provider 1".to_string(),
        provider_type,
        api_host: api_host.to_string(),
        is_system: false,
        group: ProviderGroup::Custom,
        enabled: true,
        sort_order: 0,
        api_version: None,
        project: None,
        location: None,
        region: None,
        prompt_cache_mode: None,
        custom_models: Vec::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn build_unique_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间应晚于 Unix epoch")
        .as_nanos();

    std::env::temp_dir().join(format!(
        "lime-openclaw-{prefix}-{}-{nanos}",
        std::process::id()
    ))
}

#[test]
fn trims_trailing_slash() {
    assert_eq!(
        trim_trailing_slash("https://api.openai.com/"),
        "https://api.openai.com"
    );
}

#[test]
fn detects_version_segment() {
    assert!(has_api_version("https://api.openai.com/v1"));
    assert!(!has_api_version("https://api.openai.com"));
}

#[test]
fn maps_api_type_correctly() {
    assert_eq!(
        determine_api_type(ApiProviderType::Openai).unwrap(),
        "openai-completions"
    );
    assert_eq!(
        determine_api_type(ApiProviderType::OpenaiResponse).unwrap(),
        "openai-responses"
    );
    assert_eq!(
        determine_api_type(ApiProviderType::Anthropic).unwrap(),
        "anthropic-messages"
    );
}

#[test]
fn formats_openai_url() {
    let provider = build_provider(ApiProviderType::Openai, "https://api.openai.com");
    assert_eq!(
        format_provider_base_url(&provider).unwrap(),
        "https://api.openai.com/v1"
    );
}

#[test]
fn keeps_existing_version_url() {
    let provider = build_provider(ApiProviderType::Openai, "https://example.com/v2");
    assert_eq!(
        format_provider_base_url(&provider).unwrap(),
        "https://example.com/v2"
    );
}

#[test]
fn formats_gemini_url() {
    let provider = build_provider(
        ApiProviderType::Gemini,
        "https://generativelanguage.googleapis.com",
    );
    assert_eq!(
        format_provider_base_url(&provider).unwrap(),
        "https://generativelanguage.googleapis.com/v1beta/openai"
    );
}

#[test]
fn formats_gateway_url() {
    let provider = build_provider(
        ApiProviderType::Gateway,
        "https://gateway.example.com/v1/ai",
    );
    assert_eq!(
        format_provider_base_url(&provider).unwrap(),
        "https://gateway.example.com/v1"
    );
}

#[test]
fn rejects_unsupported_provider_types() {
    let provider = build_provider(ApiProviderType::AzureOpenai, "https://example.com");
    assert!(format_provider_base_url(&provider).is_err());
}

#[test]
fn extracts_gateway_auth_token_from_config() {
    let config = json!({
        "gateway": {
            "auth": {
                "token": "lime-token"
            }
        }
    });

    assert_eq!(
        extract_gateway_auth_token(&config).as_deref(),
        Some("lime-token")
    );
}

#[test]
fn ignores_empty_gateway_auth_token() {
    let config = json!({
        "gateway": {
            "auth": {
                "token": "   "
            }
        }
    });

    assert_eq!(extract_gateway_auth_token(&config), None);
}

#[test]
fn applies_gateway_runtime_defaults_for_current_openclaw() {
    let mut config = json!({});

    apply_gateway_runtime_defaults(&mut config, 18790, "lime-token");

    assert_eq!(
        config.pointer("/gateway/mode").and_then(Value::as_str),
        Some("local")
    );
    assert_eq!(
        config.pointer("/gateway/bind").and_then(Value::as_str),
        Some("loopback")
    );
    assert_eq!(
        config.pointer("/gateway/auth/mode").and_then(Value::as_str),
        Some("token")
    );
    assert_eq!(
        config
            .pointer("/gateway/auth/token")
            .and_then(Value::as_str),
        Some("lime-token")
    );
    assert_eq!(
        config
            .pointer("/gateway/remote/token")
            .and_then(Value::as_str),
        Some("lime-token")
    );
    assert_eq!(
        config.pointer("/gateway/port").and_then(Value::as_u64),
        Some(18_790)
    );
}

#[test]
fn gateway_start_args_include_new_runtime_guards() {
    assert_eq!(
        gateway_start_args(18790, "lime-token"),
        vec![
            "gateway",
            "--allow-unconfigured",
            "--bind",
            "loopback",
            "--auth",
            "token",
            "--token",
            "lime-token",
            "--port",
            "18790",
        ]
    );
}

#[test]
fn parses_lsof_listener_pid_output() {
    assert_eq!(
        super::parse_lsof_listener_pids("1201\n1202\nbad\n1201\n"),
        vec![1201, 1202]
    );
}

#[test]
fn parses_windows_netstat_listener_pid_output() {
    let output = "\
  TCP    127.0.0.1:18790      0.0.0.0:0      LISTENING      31234\n\
  TCP    [::]:18790           [::]:0         LISTENING      31235\n\
  TCP    127.0.0.1:18791      0.0.0.0:0      LISTENING      39999\n";

    assert_eq!(
        super::parse_windows_netstat_listener_pids(output, 18790),
        vec![31234, 31235]
    );
}

#[test]
fn detects_openclaw_process_from_node_command_line() {
    let args = vec![
        OsString::from("/Users/demo/.nvm/versions/node/v23.4.0/bin/.openclaw-a1b2c3/openclaw"),
        OsString::from("gateway"),
        OsString::from("--port"),
        OsString::from("18790"),
    ];
    let node_path = PathBuf::from("/Users/demo/.nvm/versions/node/v23.4.0/bin/node");

    assert!(super::process_looks_like_openclaw_process(
        "node",
        Some(node_path.as_path()),
        &args,
    ));
}

#[test]
fn ignores_unrelated_listener_process() {
    let args = vec![
        OsString::from("/usr/local/bin/python3"),
        OsString::from("-m"),
        OsString::from("http.server"),
        OsString::from("18790"),
    ];
    let python_path = PathBuf::from("/usr/local/bin/python3");

    assert!(!super::process_looks_like_openclaw_process(
        "python3",
        Some(python_path.as_path()),
        &args,
    ));
}

#[test]
fn formats_gateway_start_failure_for_missing_config() {
    assert_eq!(
        format_gateway_start_failure_message(Some(
            "Missing config. Run `openclaw setup` or set gateway.mode=local."
        )),
        "Gateway 启动失败：OpenClaw 本地网关配置缺失，已自动补齐默认配置，请重试。"
    );
}

#[test]
fn formats_gateway_start_failure_for_loopback_bind_error() {
    assert_eq!(
        format_gateway_start_failure_message(Some(
            "gateway bind=loopback resolved to non-loopback host 0.0.0.0"
        )),
        "Gateway 启动失败：当前环境无法绑定到本地回环地址 127.0.0.1，请检查本机网络或代理配置。"
    );
}

#[test]
fn sanitizes_null_context_window_from_runtime_config() {
    let mut config = json!({
        "models": {
            "providers": {
                "lime-openai": {
                    "models": [
                        {
                            "id": "gpt-5",
                            "name": "GPT-5",
                            "contextWindow": null
                        },
                        {
                            "id": "gpt-5-mini",
                            "name": "GPT-5 mini",
                            "contextWindow": 400000
                        }
                    ]
                }
            }
        }
    });

    sanitize_runtime_config(&mut config);

    assert!(config
        .pointer("/models/providers/lime-openai/models/0/contextWindow")
        .is_none());
    assert_eq!(
        config
            .pointer("/models/providers/lime-openai/models/1/contextWindow")
            .and_then(Value::as_u64),
        Some(400_000)
    );
}

#[test]
fn selects_specific_gateway_failure_detail_over_doctor_hint() {
    let lines = vec![
            "Config invalid".to_string(),
            "Run: openclaw doctor --fix".to_string(),
            "Invalid config at /Users/demo/.openclaw/openclaw.lime.json:\\n- models.providers.lime-openai.models.0.contextWindow: Invalid input: expected number, received null".to_string(),
        ];

    assert_eq!(
            select_gateway_start_failure_detail(&lines),
            Some(
                "Invalid config at /Users/demo/.openclaw/openclaw.lime.json:\\n- models.providers.lime-openai.models.0.contextWindow: Invalid input: expected number, received null"
            )
        );
}

#[test]
fn formats_gateway_start_failure_for_invalid_context_window_config() {
    assert_eq!(
            format_gateway_start_failure_message(Some(
                "Invalid config at /Users/demo/.openclaw/openclaw.lime.json:\\n- models.providers.lime-openai.models.0.contextWindow: Invalid input: expected number, received null"
            )),
            "Gateway 启动失败：当前 OpenClaw 配置包含空的 contextWindow 字段。Lime 已修正后续配置写入，请重新启动；如仍失败，请重新同步模型配置。"
        );
}

#[test]
fn selects_update_failure_reason_from_json_payload() {
    let payload = json!({
        "status": "error",
        "reason": "not-openclaw-root",
        "root": "/Users/demo/.nvm"
    });

    assert_eq!(
        select_openclaw_update_failure_detail(Some(&payload), &[], &[]),
        Some("not-openclaw-root (/Users/demo/.nvm)".to_string())
    );
}

#[test]
fn formats_openclaw_update_failure_for_invalid_root() {
    assert_eq!(
            format_openclaw_update_failure_message(Some(
                "not-openclaw-root (/Users/demo/.nvm)"
            )),
            "OpenClaw 升级失败：未在 OpenClaw 安装根目录执行更新。Lime 会优先切换到安装目录；如仍失败，请重新检测安装状态后重试。"
        );
}

#[test]
fn formats_openclaw_update_failure_for_node_version_requirement() {
    assert_eq!(
            format_openclaw_update_failure_message(Some(
                "openclaw: Node.js v22.12+ is required (current: v18.20.2)."
            )),
            "OpenClaw 升级失败：当前用于执行 openclaw 的 Node.js 版本过低，需要 22.12.0+。请切换到满足要求的 Node.js 后重试。"
        );
}

#[test]
fn parses_semver_from_git_version_text() {
    assert_eq!(
        parse_semver_from_text("git version 2.39.5 (Apple Git-154)"),
        Some((2, 39, 5))
    );
}

#[test]
fn environment_status_prioritizes_missing_node() {
    let env = build_environment_status(
        DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "missing node".to_string(),
            auto_install_supported: true,
        },
        DependencyStatus {
            status: "ok".to_string(),
            version: Some("2.43.0".to_string()),
            path: Some("/usr/bin/git".to_string()),
            message: "git ok".to_string(),
            auto_install_supported: true,
        },
        DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "openclaw missing".to_string(),
            auto_install_supported: false,
        },
        EnvironmentDiagnostics::default(),
    );

    assert_eq!(env.recommended_action, "install_node");
    assert_eq!(env.openclaw.auto_install_supported, false);
}

#[test]
fn environment_status_uses_reload_summary_when_openclaw_command_not_ready() {
    let env = build_environment_status(
        DependencyStatus {
            status: "ok".to_string(),
            version: Some("22.12.0".to_string()),
            path: Some("/usr/local/bin/node".to_string()),
            message: "node ok".to_string(),
            auto_install_supported: true,
        },
        DependencyStatus {
            status: "ok".to_string(),
            version: Some("2.44.0".to_string()),
            path: Some("/usr/bin/git".to_string()),
            message: "git ok".to_string(),
            auto_install_supported: true,
        },
        DependencyStatus {
            status: "needs_reload".to_string(),
            version: Some("0.3.0".to_string()),
            path: Some("/mock/prefix".to_string()),
            message: "reload openclaw".to_string(),
            auto_install_supported: false,
        },
        EnvironmentDiagnostics::default(),
    );

    assert_eq!(env.recommended_action, "refresh_openclaw_env");
    assert!(env.summary.contains("重新检测"));
}

#[test]
fn semver_selection_prefers_windows_launcher_over_bare_file_when_versions_equal() {
    let preferred = select_best_semver_candidate(vec![
        (PathBuf::from(r"C:\nvm4w\nodejs\openclaw"), Some((23, 1, 0))),
        (
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"),
            Some((23, 1, 0)),
        ),
    ]);

    assert_eq!(
        preferred,
        Some(PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"))
    );
}

#[test]
fn windows_command_bin_dir_supports_backslash_paths() {
    assert_eq!(
        command_bin_dir_for(ShellPlatform::Windows, r"C:\Program Files\nodejs\npm.cmd"),
        Some(r"C:\Program Files\nodejs".to_string())
    );
}

#[test]
fn windows_shell_command_escape_keeps_cmd_compatible_quotes() {
    assert_eq!(
        shell_command_escape_for(ShellPlatform::Windows, r#"C:\Program Files\nodejs\npm.cmd"#),
        r#""C:\Program Files\nodejs\npm.cmd""#
    );
    assert_eq!(
        shell_command_escape_for(ShellPlatform::Windows, "C:\\demo\\na\"me\\npm.cmd"),
        r#""C:\demo\na""me\npm.cmd""#
    );
}

#[test]
fn windows_shell_npm_prefix_assignment_uses_set_syntax() {
    assert_eq!(
        shell_npm_prefix_assignment_for(
            ShellPlatform::Windows,
            r"C:\Users\demo\AppData\Roaming\npm"
        ),
        r#"set "NPM_CONFIG_PREFIX=C:\Users\demo\AppData\Roaming\npm" && "#
    );
}

#[test]
fn windows_shell_path_assignment_prepends_binary_directory() {
    assert_eq!(
        shell_path_assignment_for(ShellPlatform::Windows, r"C:\Program Files\nodejs\npm.cmd"),
        r#"set "PATH=C:\Program Files\nodejs;%PATH%" && "#
    );
}

#[test]
fn windows_cmd_scripts_use_call_invocation_prefix() {
    assert_eq!(
        shell_command_invocation_prefix_for(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd"
        ),
        "call "
    );
    assert!(shell_command_invocation_prefix_for(
        ShellPlatform::Windows,
        r"C:\Users\demo\AppData\Local\Microsoft\WindowsApps\winget.exe"
    )
    .is_empty());
}

#[test]
fn windows_cleanup_command_uses_cmd_compatible_syntax_without_true_fallback() {
    let command = build_openclaw_cleanup_command(
        ShellPlatform::Windows,
        r"C:\Program Files\nodejs\npm.cmd",
        Some(r"C:\Users\demo\AppData\Roaming\npm"),
    );

    assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "set \"NPM_CONFIG_PREFIX=C:\\Users\\demo\\AppData\\Roaming\\npm\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" uninstall -g openclaw @qingchencloud/openclaw-zh"
            )
        );
    assert!(!command.contains("|| true"));
}

#[test]
fn windows_install_command_adds_registry_when_using_china_package() {
    let command = build_openclaw_install_command(
        ShellPlatform::Windows,
        r"C:\Program Files\nodejs\npm.cmd",
        Some(r"C:\Users\demo\AppData\Roaming\npm"),
        OPENCLAW_CN_PACKAGE,
        Some(NPM_MIRROR_CN),
    );

    assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "set \"NPM_CONFIG_PREFIX=C:\\Users\\demo\\AppData\\Roaming\\npm\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" install -g @qingchencloud/openclaw-zh@latest ",
                "--registry=https://registry.npmmirror.com"
            )
        );
}

#[test]
fn windows_install_command_omits_registry_for_default_package() {
    let command = build_openclaw_install_command(
        ShellPlatform::Windows,
        r"C:\Program Files\nodejs\npm.cmd",
        None,
        OPENCLAW_DEFAULT_PACKAGE,
        None,
    );

    assert_eq!(
        command,
        concat!(
            "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
            "call \"C:\\Program Files\\nodejs\\npm.cmd\" install -g openclaw@latest"
        )
    );
    assert!(!command.contains("--registry="));
}

#[test]
fn windows_pnpm_install_command_uses_global_add_syntax() {
    let command = build_openclaw_pnpm_install_command(
        ShellPlatform::Windows,
        r"C:\Users\demo\AppData\Local\pnpm\pnpm.cmd",
        "@qingchencloud/openclaw-zh@latest",
        Some(NPM_MIRROR_CN),
    );

    assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Users\\demo\\AppData\\Local\\pnpm;%PATH%\" && ",
                "call \"C:\\Users\\demo\\AppData\\Local\\pnpm\\pnpm.cmd\" add -g \"@qingchencloud/openclaw-zh@latest\" ",
                "--registry=\"https://registry.npmmirror.com\""
            )
        );
}

#[test]
fn infers_openclaw_package_name_from_manifest_path() {
    assert_eq!(
        infer_openclaw_package_name_from_path(
            PathBuf::from(
                "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/openclaw/package.json",
            )
            .as_path()
        ),
        Some("openclaw")
    );
    assert_eq!(
            infer_openclaw_package_name_from_path(PathBuf::from(
                "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json",
            )
            .as_path()),
            Some("@qingchencloud/openclaw-zh")
        );
}

#[test]
fn china_package_upgrade_uses_npmmirror_registry() {
    assert_eq!(
        package_registry_for_package_spec("@qingchencloud/openclaw-zh@latest"),
        Some(NPM_MIRROR_CN)
    );
    assert_eq!(package_registry_for_package_spec("openclaw@latest"), None);
}

#[test]
fn runtime_candidate_prefers_install_root_match_over_current_binary_hint() {
    let candidate = OpenClawRuntimeCandidate {
            id: "/Users/demo/.nvm/versions/node/v23.4.0/bin".to_string(),
            source: "nvm".to_string(),
            bin_dir: "/Users/demo/.nvm/versions/node/v23.4.0/bin".to_string(),
            node_path: "/Users/demo/.nvm/versions/node/v23.4.0/bin/node".to_string(),
            node_version: Some("23.4.0".to_string()),
            npm_path: Some("/Users/demo/.nvm/versions/node/v23.4.0/bin/npm".to_string()),
            npm_global_prefix: Some("/Users/demo/.nvm/versions/node/v23.4.0".to_string()),
            openclaw_path: Some("/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw".to_string()),
            openclaw_version: Some("2026.3.8".to_string()),
            openclaw_package_path: Some(
                "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json"
                    .to_string(),
            ),
            is_active: false,
            is_preferred: false,
        };

    assert!(runtime_candidate_matches_install_root(
        &candidate,
        PathBuf::from("/Users/demo/.nvm").as_path()
    ));
    assert!(!runtime_candidate_matches_install_root(
        &candidate,
        PathBuf::from("/Users/demo/Library/PhpWebStudy").as_path()
    ));
}

#[test]
fn preferred_path_candidate_prioritizes_windows_executable_extensions() {
    let preferred = select_preferred_path_candidate(vec![
        PathBuf::from(r"C:\nvm4w\nodejs\openclaw"),
        PathBuf::from(r"C:\nvm4w\nodejs\openclaw.bat"),
        PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"),
        PathBuf::from(r"C:\nvm4w\nodejs\openclaw.exe"),
    ]);

    assert_eq!(
        preferred,
        Some(PathBuf::from(r"C:\nvm4w\nodejs\openclaw.exe"))
    );
}

#[test]
fn git_candidate_selection_prefers_executable_extension() {
    let preferred = select_best_git_candidate(vec![
        PathBuf::from(r"C:\Program Files\Git\cmd\git.cmd"),
        PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"),
    ]);

    assert_eq!(
        preferred,
        Some(PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"))
    );
}

#[test]
fn windows_git_install_dir_variants_cover_common_layouts() {
    let git_root = build_unique_temp_dir("git-layout-root");
    let cmd_dir = git_root.join("cmd");
    let bin_dir = git_root.join("bin");
    fs::create_dir_all(&cmd_dir).unwrap();
    fs::create_dir_all(&bin_dir).unwrap();
    fs::write(cmd_dir.join("git.exe"), "").unwrap();
    fs::write(bin_dir.join("git.cmd"), "").unwrap();

    let matches = super::find_all_commands_in_paths_for(
        ShellPlatform::Windows,
        "git",
        &windows_git_install_dir_variants(git_root.clone()),
    );

    let _ = fs::remove_dir_all(&git_root);

    assert_eq!(
        matches,
        vec![cmd_dir.join("git.exe"), bin_dir.join("git.cmd")]
    );
}

#[test]
fn windows_npm_global_command_dirs_use_prefix_root() {
    assert_eq!(
        npm_global_command_dirs_for(ShellPlatform::Windows, r"C:\Users\demo\AppData\Roaming\npm"),
        vec![PathBuf::from(r"C:\Users\demo\AppData\Roaming\npm")]
    );
}

#[test]
fn unix_npm_global_command_dirs_include_bin_directory() {
    assert_eq!(
        npm_global_command_dirs_for(ShellPlatform::Unix, "/Users/demo/.npm-global"),
        vec![
            PathBuf::from("/Users/demo/.npm-global/bin"),
            PathBuf::from("/Users/demo/.npm-global")
        ]
    );
}

#[test]
fn windows_npm_global_node_modules_dirs_use_prefix_node_modules() {
    assert_eq!(
        npm_global_node_modules_dirs_for(
            ShellPlatform::Windows,
            r"C:\Users\demo\AppData\Roaming\npm"
        ),
        vec![PathBuf::from(r"C:\Users\demo\AppData\Roaming\npm").join("node_modules")]
    );
}

#[test]
fn finds_openclaw_package_from_global_npm_prefix() {
    let temp_dir = std::env::temp_dir().join(format!("lime-openclaw-test-{}", std::process::id()));
    let package_dir = temp_dir.join("node_modules").join("openclaw");
    fs::create_dir_all(&package_dir).unwrap();
    fs::write(
        package_dir.join("package.json"),
        r#"{"name":"openclaw","version":"0.4.1"}"#,
    )
    .unwrap();

    let detected = find_installed_openclaw_package(temp_dir.to_str().unwrap());

    fs::remove_dir_all(&temp_dir).unwrap();

    assert_eq!(detected, Some(("openclaw", Some("0.4.1".to_string()))));
}

#[test]
fn resolves_openclaw_cli_entry_from_dist_index_when_bin_target_missing() {
    let temp_dir = build_unique_temp_dir("cli-entry");
    let package_dir = temp_dir
        .join("node_modules")
        .join("@qingchencloud/openclaw-zh");
    let dist_dir = package_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();
    fs::write(
        package_dir.join("package.json"),
        r#"{
                "name":"@qingchencloud/openclaw-zh",
                "version":"2026.3.13-zh.1",
                "bin":{"openclaw":"openclaw.mjs"}
            }"#,
    )
    .unwrap();
    fs::write(dist_dir.join("index.js"), "console.log('openclaw');").unwrap();

    let resolved =
        resolve_openclaw_cli_entry_from_package_manifest(&package_dir.join("package.json"));

    let _ = fs::remove_dir_all(&temp_dir);

    assert_eq!(resolved, Some(package_dir.join("dist").join("index.js")));
}

#[test]
fn resolves_openclaw_command_from_runtime_candidate_as_node_cli() {
    let temp_dir = build_unique_temp_dir("runtime-candidate");
    let node_bin_dir = temp_dir.join("bin");
    let package_dir = temp_dir
        .join("node_modules")
        .join("@qingchencloud/openclaw-zh");
    let dist_dir = package_dir.join("dist");
    fs::create_dir_all(&node_bin_dir).unwrap();
    fs::create_dir_all(&dist_dir).unwrap();

    let node_path = node_bin_dir.join("node");
    fs::write(&node_path, "").unwrap();
    fs::write(
        package_dir.join("package.json"),
        r#"{
                "name":"@qingchencloud/openclaw-zh",
                "version":"2026.3.13-zh.1",
                "bin":{"openclaw":"openclaw.mjs"}
            }"#,
    )
    .unwrap();
    fs::write(dist_dir.join("index.js"), "console.log('openclaw');").unwrap();

    let candidate = OpenClawRuntimeCandidate {
        id: temp_dir.display().to_string(),
        source: "nvm".to_string(),
        bin_dir: node_bin_dir.display().to_string(),
        node_path: node_path.display().to_string(),
        node_version: Some("23.4.0".to_string()),
        npm_path: None,
        npm_global_prefix: None,
        openclaw_path: None,
        openclaw_version: Some("2026.3.13-zh.1".to_string()),
        openclaw_package_path: Some(package_dir.join("package.json").display().to_string()),
        is_active: true,
        is_preferred: true,
    };

    let resolved = resolve_openclaw_command_from_runtime_candidate(&candidate);

    let _ = fs::remove_dir_all(&temp_dir);

    assert_eq!(
        resolved,
        Some(ResolvedOpenClawCommand::NodeCli {
            node_path,
            cli_path: package_dir.join("dist").join("index.js"),
            package_version: Some("2026.3.13-zh.1".to_string()),
        })
    );
}

#[test]
fn windows_runtime_candidate_prefers_node_cli_over_cmd_shim() {
    let temp_dir = build_unique_temp_dir("runtime-candidate-windows-shim");
    let node_bin_dir = temp_dir.join("nodejs");
    let package_dir = temp_dir
        .join("node_modules")
        .join("@qingchencloud")
        .join("openclaw-zh");
    let dist_dir = package_dir.join("dist");
    fs::create_dir_all(&node_bin_dir).unwrap();
    fs::create_dir_all(&dist_dir).unwrap();

    let node_path = node_bin_dir.join("node.exe");
    let openclaw_cmd = node_bin_dir.join("openclaw.cmd");
    fs::write(&node_path, "").unwrap();
    fs::write(&openclaw_cmd, "@echo off").unwrap();
    fs::write(
        package_dir.join("package.json"),
        r#"{
                "name":"@qingchencloud/openclaw-zh",
                "version":"2026.3.13-zh.1",
                "bin":{"openclaw":"openclaw.mjs"}
            }"#,
    )
    .unwrap();
    fs::write(dist_dir.join("index.js"), "console.log('openclaw');").unwrap();

    let candidate = OpenClawRuntimeCandidate {
        id: temp_dir.display().to_string(),
        source: "system".to_string(),
        bin_dir: node_bin_dir.display().to_string(),
        node_path: node_path.display().to_string(),
        node_version: Some("23.4.0".to_string()),
        npm_path: Some(node_bin_dir.join("npm.cmd").display().to_string()),
        npm_global_prefix: Some(temp_dir.display().to_string()),
        openclaw_path: Some(openclaw_cmd.display().to_string()),
        openclaw_version: Some("2026.3.13-zh.1".to_string()),
        openclaw_package_path: Some(package_dir.join("package.json").display().to_string()),
        is_active: true,
        is_preferred: true,
    };

    let resolved =
        resolve_openclaw_command_from_runtime_candidate_for(ShellPlatform::Windows, &candidate);

    let _ = fs::remove_dir_all(&temp_dir);

    assert_eq!(
        resolved,
        Some(ResolvedOpenClawCommand::NodeCli {
            node_path,
            cli_path: package_dir.join("dist").join("index.js"),
            package_version: Some("2026.3.13-zh.1".to_string()),
        })
    );
}

#[test]
fn windows_node_prefers_winget_when_available() {
    assert_eq!(
        resolve_windows_dependency_install_plan(DependencyKind::Node, true),
        WindowsDependencyInstallPlan::Winget {
            package_id: "OpenJS.NodeJS.LTS"
        }
    );
}

#[test]
fn windows_node_falls_back_to_official_installer_without_winget() {
    assert_eq!(
        resolve_windows_dependency_install_plan(DependencyKind::Node, false),
        WindowsDependencyInstallPlan::OfficialInstaller
    );
}

#[test]
fn windows_git_prefers_winget_when_available() {
    assert_eq!(
        resolve_windows_dependency_install_plan(DependencyKind::Git, true),
        WindowsDependencyInstallPlan::Winget {
            package_id: "Git.Git"
        }
    );
}

#[test]
fn windows_git_requires_manual_download_without_winget() {
    assert_eq!(
        resolve_windows_dependency_install_plan(DependencyKind::Git, false),
        WindowsDependencyInstallPlan::ManualDownload
    );
    assert_eq!(
        windows_manual_install_message(DependencyKind::Git),
        "当前系统缺少 winget，暂时无法一键安装 Git，请点击“手动下载 Git”完成安装后重试。"
    );
}

#[test]
fn windows_git_setup_message_points_to_manual_download() {
    let message = windows_dependency_setup_message(
        DependencyKind::Git,
        &DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 Git。".to_string(),
            auto_install_supported: false,
        },
    );

    assert!(message.contains("git-scm.com"));
    assert!(message.contains("加入 PATH"));
}

#[test]
fn windows_node_setup_message_points_to_nodejs_download() {
    let message = windows_dependency_setup_message(
        DependencyKind::Node,
        &DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 Node.js，需要安装 22.12.0+。".to_string(),
            auto_install_supported: false,
        },
    );

    assert!(message.contains("nodejs.org"));
    assert!(message.contains("Node.js 22+"));
}

#[test]
fn windows_dependency_action_result_returns_failure_message() {
    let result = windows_dependency_action_result(
        DependencyKind::Git,
        &DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 Git。".to_string(),
            auto_install_supported: false,
        },
    );

    assert!(!result.success);
    assert!(result.message.contains("git-scm.com"));
}

#[test]
fn windows_install_block_result_prioritizes_node_before_git() {
    let result = windows_install_block_result(
        &DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 Node.js，需要安装 22.12.0+。".to_string(),
            auto_install_supported: false,
        },
        &DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 Git。".to_string(),
            auto_install_supported: false,
        },
    )
    .expect("应返回 Windows 阻断结果");

    assert!(!result.success);
    assert!(result.message.contains("nodejs.org"));
    assert!(!result.message.contains("git-scm.com"));
}

#[test]
fn windows_install_block_result_returns_none_when_dependencies_ready() {
    let result = windows_install_block_result(
        &DependencyStatus {
            status: "ok".to_string(),
            version: Some("22.12.0".to_string()),
            path: Some("C:\\Program Files\\nodejs\\node.exe".to_string()),
            message: "Node.js 已就绪：22.12.0".to_string(),
            auto_install_supported: false,
        },
        &DependencyStatus {
            status: "ok".to_string(),
            version: Some("2.44.0".to_string()),
            path: Some("C:\\Program Files\\Git\\cmd\\git.exe".to_string()),
            message: "Git 已就绪：2.44.0".to_string(),
            auto_install_supported: false,
        },
    );

    assert!(result.is_none());
}

#[test]
fn winget_install_command_uses_expected_windows_flags() {
    assert_eq!(
        build_winget_install_command(
            r"C:\Users\demo\AppData\Local\Microsoft\WindowsApps\winget.exe",
            "OpenJS.NodeJS.LTS"
        ),
        concat!(
            "set \"PATH=C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps;%PATH%\" && ",
            "\"C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\" install ",
            "--id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements"
        )
    );
}
