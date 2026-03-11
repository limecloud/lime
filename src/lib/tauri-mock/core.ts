/**
 * Mock for @tauri-apps/api/core
 */

import {
  invokeViaHttp,
  isDevBridgeAvailable,
  normalizeDevBridgeError,
} from "../dev-bridge/http-client";
import { shouldPreferMockInBrowser } from "../dev-bridge/mockPriorityCommands";

// 模拟的命令处理器
const mockCommands = new Map<string, (...args: any[]) => any>();

const createDeprecatedCommandMock =
  (command: string, replacement: string) => () => {
    throw new Error(
      `命令 ${command} 已废弃，请迁移到 ${replacement}。Mock 不再为旧链路伪造成功结果。`,
    );
  };

// 默认 mock 数据
const defaultMocks: Record<string, any> = {
  // 配置相关
  get_config: () => ({
    server: {
      host: "127.0.0.1",
      port: 8787,
      api_key: "",
      response_cache: {
        enabled: true,
        ttl_secs: 600,
        max_entries: 200,
        max_body_bytes: 1048576,
        cacheable_status_codes: [200],
      },
      tls: {
        enable: false,
        cert_path: null,
        key_path: null,
      },
    },
    providers: {
      kiro: {
        enabled: false,
        credentials_path: null,
        region: null,
      },
      gemini: {
        enabled: false,
        credentials_path: null,
      },
      qwen: {
        enabled: false,
        credentials_path: null,
      },
      openai: {
        enabled: false,
        api_key: null,
        base_url: null,
      },
      claude: {
        enabled: false,
        api_key: null,
        base_url: null,
      },
    },
    default_provider: "kiro",
    remote_management: {
      allow_remote: false,
      secret_key: null,
      disable_control_panel: false,
    },
    quota_exceeded: {
      switch_project: true,
      switch_preview_model: false,
      cooldown_seconds: 60,
    },
    ampcode: {
      upstream_url: null,
      model_mappings: [],
      restrict_management_to_localhost: true,
    },
    credential_pool: {
      kiro: [],
      gemini: [],
      qwen: [],
      openai: [],
      claude: [],
      gemini_api_keys: [],
      vertex_api_keys: [],
      codex: [],
      iflow: [],
    },
    proxy_url: null,
    minimize_to_tray: false,
    language: "zh",
    experimental: {
      screenshot_chat: {
        enabled: false,
        shortcut: "",
      },
    },
    tool_calling: {
      enabled: true,
      dynamic_filtering: true,
      native_input_examples: false,
    },
    web_search: {
      engine: "google",
      provider: "duckduckgo_instant",
      provider_priority: [
        "duckduckgo_instant",
        "tavily",
        "multi_search_engine",
        "bing_search_api",
        "google_custom_search",
      ],
      tavily_api_key: "",
      bing_search_api_key: "",
      google_search_api_key: "",
      google_search_engine_id: "",
      multi_search: {
        priority: [],
        engines: [],
        max_results_per_engine: 5,
        max_total_results: 20,
        timeout_ms: 4000,
      },
    },
    image_gen: {
      default_service: "dall_e",
      default_count: 1,
      default_size: "1024x1024",
      default_quality: "standard",
      default_style: "vivid",
      enable_enhancement: false,
      auto_download: false,
      image_search_pexels_api_key: "",
      image_search_pixabay_api_key: "",
    },
    crash_reporting: {
      enabled: true,
      dsn: null,
      environment: "development",
      sample_rate: 1.0,
      send_pii: false,
    },
  }),

  save_config: (config: any) => {
    console.log("[Mock] Config saved:", config);
    return { success: true };
  },

  // Provider 相关
  get_providers: () => [],
  get_credentials: () => [],
  get_default_provider: () => "kiro",
  set_default_provider: (args: any) => {
    const provider = args?.provider ?? args;
    console.log("[Mock] Default provider set to:", provider);
    return provider;
  },
  get_available_models: () => [],
  get_hint_routes: () => [],
  get_windows_startup_diagnostics: () => ({
    platform: "mock-web",
    app_data_dir: null,
    legacy_proxycast_dir: null,
    db_path: null,
    webview2_version: null,
    current_exe: null,
    current_dir: null,
    resource_dir: null,
    home_dir: null,
    shell_env: null,
    comspec_env: null,
    resolved_terminal_shell: null,
    installation_kind_guess: null,
    checks: [],
    has_blocking_issues: false,
    has_warnings: false,
    summary_message: null,
  }),

  // 服务器相关
  get_server_status: () => ({
    running: false,
    host: "127.0.0.1",
    port: 8787,
    requests: 0,
    uptime_secs: 0,
    error_rate_1m: 0,
    p95_latency_ms_1m: null,
    open_circuit_count: 0,
    active_requests: 0,
    capability_routing: {
      filter_eval_total: 0,
      filter_excluded_total: 0,
      filter_excluded_tools_total: 0,
      filter_excluded_vision_total: 0,
      filter_excluded_context_total: 0,
      provider_fallback_total: 0,
      model_fallback_total: 0,
      all_candidates_excluded_total: 0,
    },
    response_cache: {
      size: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
    },
    request_dedup: {
      inflight_size: 0,
      completed_size: 0,
      check_new_total: 0,
      check_in_progress_total: 0,
      check_completed_total: 0,
      wait_success_total: 0,
      wait_timeout_total: 0,
      wait_no_result_total: 0,
      complete_total: 0,
      remove_total: 0,
    },
    idempotency: {
      entries_size: 0,
      in_progress_size: 0,
      completed_size: 0,
      check_new_total: 0,
      check_in_progress_total: 0,
      check_completed_total: 0,
      complete_total: 0,
      remove_total: 0,
    },
  }),
  get_server_diagnostics: () => ({
    generated_at: new Date().toISOString(),
    running: false,
    host: "127.0.0.1",
    port: 8787,
    telemetry_summary: {
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      timeout_requests: 0,
      success_rate: 0,
      avg_latency_ms: 0,
      min_latency_ms: null,
      max_latency_ms: null,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
    },
    capability_routing: {
      filter_eval_total: 0,
      filter_excluded_total: 0,
      filter_excluded_tools_total: 0,
      filter_excluded_vision_total: 0,
      filter_excluded_context_total: 0,
      provider_fallback_total: 0,
      model_fallback_total: 0,
      all_candidates_excluded_total: 0,
    },
    response_cache: {
      config: {
        enabled: true,
        ttl_secs: 600,
        max_entries: 200,
        max_body_bytes: 1048576,
        cacheable_status_codes: [200],
      },
      stats: {
        size: 0,
        hits: 0,
        misses: 0,
        evictions: 0,
      },
      hit_rate_percent: 0,
    },
    request_dedup: {
      config: {
        enabled: true,
        ttl_secs: 30,
        wait_timeout_ms: 15000,
      },
      stats: {
        inflight_size: 0,
        completed_size: 0,
        check_new_total: 0,
        check_in_progress_total: 0,
        check_completed_total: 0,
        wait_success_total: 0,
        wait_timeout_total: 0,
        wait_no_result_total: 0,
        complete_total: 0,
        remove_total: 0,
      },
      replay_rate_percent: 0,
    },
    idempotency: {
      config: {
        enabled: false,
        ttl_secs: 86400,
        header_name: "Idempotency-Key",
      },
      stats: {
        entries_size: 0,
        in_progress_size: 0,
        completed_size: 0,
        check_new_total: 0,
        check_in_progress_total: 0,
        check_completed_total: 0,
        complete_total: 0,
        remove_total: 0,
      },
      replay_rate_percent: 0,
    },
  }),
  check_server_status: () => ({
    running: false,
    host: "127.0.0.1",
    port: 8787,
    requests: 0,
    uptime_secs: 0,
    error_rate_1m: 0,
    p95_latency_ms_1m: null,
    open_circuit_count: 0,
    active_requests: 0,
    capability_routing: {
      filter_eval_total: 0,
      filter_excluded_total: 0,
      filter_excluded_tools_total: 0,
      filter_excluded_vision_total: 0,
      filter_excluded_context_total: 0,
      provider_fallback_total: 0,
      model_fallback_total: 0,
      all_candidates_excluded_total: 0,
    },
    response_cache: {
      size: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
    },
    request_dedup: {
      inflight_size: 0,
      completed_size: 0,
      check_new_total: 0,
      check_in_progress_total: 0,
      check_completed_total: 0,
      wait_success_total: 0,
      wait_timeout_total: 0,
      wait_no_result_total: 0,
      complete_total: 0,
      remove_total: 0,
    },
    idempotency: {
      entries_size: 0,
      in_progress_size: 0,
      completed_size: 0,
      check_new_total: 0,
      check_in_progress_total: 0,
      check_completed_total: 0,
      complete_total: 0,
      remove_total: 0,
    },
  }),
  get_log_storage_diagnostics: () => ({
    log_directory: "/tmp/proxycast/logs",
    current_log_path: "/tmp/proxycast/logs/proxycast.log",
    current_log_exists: true,
    current_log_size_bytes: 1024,
    in_memory_log_count: 0,
    related_log_files: [],
    raw_response_files: [],
  }),
  start_server: () => "Server started (mock)",
  stop_server: () => "Server stopped (mock)",

  // 网络相关
  get_network_info: () => ({
    localhost: "127.0.0.1",
    lan_ip: "192.168.1.100",
    all_ips: ["127.0.0.1", "192.168.1.100"],
  }),
  get_chrome_profile_sessions: () => [],
  close_chrome_profile_session: () => true,
  open_chrome_profile_window: () => ({
    success: true,
    reused: false,
    browser_source: "system",
    browser_path:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    profile_dir: "/tmp/proxycast/chrome_profiles/search_google",
    remote_debugging_port: 13001,
    pid: 12345,
    devtools_http_url: "http://127.0.0.1:13001/json/version",
  }),
  get_chrome_bridge_endpoint_info: () => ({
    server_running: true,
    host: "127.0.0.1",
    port: 8999,
    observer_ws_url:
      "ws://127.0.0.1:8999/proxycast-chrome-observer/Proxycast_Key=proxy_cast",
    control_ws_url:
      "ws://127.0.0.1:8999/proxycast-chrome-control/Proxycast_Key=proxy_cast",
    bridge_key: "proxy_cast",
  }),
  get_chrome_bridge_status: () => ({
    observer_count: 0,
    control_count: 0,
    pending_command_count: 0,
    observers: [],
    controls: [],
    pending_commands: [],
  }),
  chrome_bridge_execute_command: (args: any) => ({
    success: true,
    request_id: `mock-${Date.now()}`,
    command: args?.request?.command ?? "get_page_info",
    message: "mock command result",
    page_info: {
      title: "Mock Page",
      url: "https://example.com",
      markdown: "# Mock Page\nURL: https://example.com",
      updated_at: new Date().toISOString(),
    },
  }),
  get_browser_backend_policy: () => ({
    priority: ["aster_compat", "proxycast_extension_bridge", "cdp_direct"],
    auto_fallback: true,
  }),
  set_browser_backend_policy: (args: any) => ({
    priority: args?.policy?.priority ?? [
      "aster_compat",
      "proxycast_extension_bridge",
      "cdp_direct",
    ],
    auto_fallback: args?.policy?.auto_fallback ?? true,
  }),
  get_browser_backends_status: () => ({
    policy: {
      priority: ["aster_compat", "proxycast_extension_bridge", "cdp_direct"],
      auto_fallback: true,
    },
    bridge_observer_count: 1,
    bridge_control_count: 0,
    running_profile_count: 1,
    cdp_alive_profile_count: 1,
    aster_native_host_supported: true,
    aster_native_host_configured: false,
    backends: [
      {
        backend: "aster_compat",
        available: true,
        capabilities: ["navigate", "read_page", "tabs_context_mcp"],
      },
      {
        backend: "proxycast_extension_bridge",
        available: true,
        capabilities: ["open_url", "click", "type", "get_page_info"],
      },
      {
        backend: "cdp_direct",
        available: true,
        capabilities: ["tabs_context_mcp", "navigate", "read_page"],
      },
    ],
  }),
  browser_execute_action: (args: any) => ({
    success: true,
    backend: args?.request?.backend ?? "aster_compat",
    action: args?.request?.action ?? "navigate",
    request_id: `browser-mock-${Date.now()}`,
    data: {
      message: "mock browser action executed",
    },
    attempts: [
      {
        backend: args?.request?.backend ?? "aster_compat",
        success: true,
        message: "执行成功",
      },
    ],
  }),
  get_browser_action_audit_logs: (args: any) => {
    const now = new Date().toISOString();
    const count = Math.min(Number(args?.limit ?? 20), 200);
    return Array.from({ length: Math.max(1, count) }, (_, idx) => ({
      id: `audit-mock-${idx + 1}`,
      created_at: now,
      action: "navigate",
      profile_key: "default",
      requested_backend: "aster_compat",
      selected_backend: "aster_compat",
      success: true,
      attempts: [
        {
          backend: "aster_compat",
          success: true,
          message: "执行成功",
        },
      ],
    }));
  },
  read_file_preview_cmd: (args: any) => ({
    path: args?.path ?? "/mock/file.txt",
    content: "mock file preview",
    isBinary: false,
    size: 17,
    error: null,
  }),

  // Agent 相关
  list_agent_sessions: () => [],
  agent_list_sessions: () => [],
  get_agent_process_status: () => ({ running: false }),
  agent_get_process_status: () => ({ running: false }),
  agent_start_process: () => ({ success: true }),
  agent_stop_process: () => ({ success: true }),
  agent_create_session: () => ({ session_id: "mock-session-id" }),
  agent_send_message: createDeprecatedCommandMock(
    "agent_send_message",
    "aster_agent_chat_stream",
  ),
  agent_get_session: () => ({ session: null }),
  agent_delete_session: () => ({ success: true }),
  agent_get_session_messages: () => [],
  agent_chat_stream: createDeprecatedCommandMock(
    "agent_chat_stream",
    "aster_agent_chat_stream",
  ),
  agent_terminal_command_response: () => ({}),
  agent_term_scrollback_response: () => ({}),

  // Aster Agent
  aster_agent_init: () => ({ initialized: true, provider_configured: false }),
  aster_agent_status: () => ({
    initialized: false,
    provider_configured: false,
  }),
  aster_agent_configure_provider: () => ({
    initialized: true,
    provider_configured: true,
  }),
  aster_agent_configure_from_pool: () => ({
    initialized: true,
    provider_configured: true,
  }),
  aster_agent_chat_stream: () => ({}),
  aster_agent_stop: () => true,
  aster_session_create: () => "mock-aster-session",
  aster_session_set_execution_strategy: () => ({}),
  aster_session_list: () => [],
  aster_session_get: () => ({ id: "mock", messages: [] }),
  aster_agent_confirm: () => ({}),
  aster_agent_submit_elicitation_response: () => ({}),

  // 终端相关
  create_terminal_session: () => ({ uuid: "mock-terminal-uuid" }),
  terminal_create_session: () => ({ uuid: "mock-terminal-uuid" }),
  terminal_write: () => ({}),
  terminal_resize: () => ({}),
  terminal_close: () => ({}),
  read_terminal_output: () => [],
  list_terminal_sessions: () => [],

  // 技能相关
  get_all_skills: () => [],
  get_skills_for_app: () => [],
  get_skill_repos: () => [],
  add_skill_repo: () => ({ success: true }),
  remove_skill_repo: () => ({ success: true }),
  get_installed_proxycast_skills: () => [],
  install_skill_for_app: () => ({ success: true }),
  uninstall_skill_for_app: () => ({ success: true }),
  enable_skill: () => ({ success: true }),
  disable_skill: () => ({ success: true }),

  // 插件相关
  get_plugins_with_ui: () => [],
  get_plugin_status: () => ({
    enabled: true,
    plugin_count: 0,
    plugins_dir: "/mock/plugins",
  }),
  get_plugins: () => [],
  list_installed_plugins: () => [],
  enable_plugin: () => ({ success: true }),
  disable_plugin: () => ({ success: true }),
  reload_plugins: () => ({ success: true }),
  unload_plugin: () => ({ success: true }),
  uninstall_plugin: () => ({ success: true }),
  launch_plugin_ui: () => ({}),
  list_plugin_tasks: () => [],
  get_plugin_task: () => null,
  cancel_plugin_task: () => true,
  get_plugin_queue_stats: () => [],

  // 凭证池相关
  get_relay_providers: () => [],
  list_relay_providers: () => [],
  get_system_provider_catalog: () => [],
  get_pool_overview: () => [],
  get_provider_pool_overview: () => [],
  get_provider_pool_credentials: () => [],
  add_provider_pool_credential: () => ({ success: true }),
  update_provider_pool_credential: () => ({ success: true }),
  delete_provider_pool_credential: () => ({ success: true }),
  toggle_provider_pool_credential: () => ({ success: true }),
  reset_provider_pool_credential: () => ({ success: true }),
  reset_provider_pool_health: () => ({ success: true }),
  check_provider_pool_credential_health: () => ({ healthy: false }),
  check_provider_pool_type_health: () => ({ healthy: false }),

  // API Key Provider 相关
  get_api_key_providers: () => [],
  get_api_key_provider: () => null,
  add_custom_api_key_provider: () => ({ success: true }),
  update_api_key_provider: () => ({ success: true }),
  delete_custom_api_key_provider: () => ({ success: true }),
  add_api_key: () => ({ success: true }),
  delete_api_key: () => ({ success: true }),
  toggle_api_key: () => ({ success: true }),
  update_api_key_alias: () => ({ success: true }),
  get_next_api_key: () => null,
  record_api_key_usage: () => ({}),
  record_api_key_error: () => ({}),
  get_provider_ui_state: () => null,
  set_provider_ui_state: () => ({}),
  update_provider_sort_orders: () => ({ success: true }),
  export_api_key_providers: () => ({ config: "{}" }),
  import_api_key_providers: () => ({ success: true }),
  get_legacy_api_key_credentials: () => [],
  migrate_legacy_api_key_credentials: () => ({ success: true }),
  delete_legacy_api_key_credential: () => ({ success: true }),
  get_local_kiro_credential_uuid: () => null,
  create_video_generation_task: (args: any) => {
    const request = args?.request ?? {};
    return {
      id: "mock-video-task-id",
      projectId: request.projectId ?? "mock-project-id",
      providerId: request.providerId ?? "doubao",
      model: request.model ?? "seedance-1-5-pro-251215",
      prompt: request.prompt ?? "mock",
      requestPayload: JSON.stringify(request),
      providerTaskId: "mock-provider-task-id",
      status: "processing",
      progress: 0,
      resultUrl: null,
      errorMessage: null,
      metadataJson: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
    };
  },
  get_video_generation_task: () => null,
  list_video_generation_tasks: () => [],
  cancel_video_generation_task: () => null,
  search_pixabay_images: () => ({
    total: 0,
    total_hits: 0,
    hits: [],
  }),
  search_web_images: () => ({
    total: 0,
    provider: "pexels",
    hits: [],
  }),
  import_material_from_url: () => ({
    id: "mock-material-id",
  }),

  list_materials: () => [],
  project_memory_get: () => ({
    characters: [],
    world_building: null,
    style_guide: null,
    outline: [],
  }),
  get_conversation_memory_overview: () => ({
    stats: { total_entries: 0, storage_used: 0, memory_count: 0 },
    entries: [],
  }),
  get_conversation_memory_stats: () => ({
    total_entries: 0,
    storage_used: 0,
    memory_count: 0,
  }),

  session_files_get_or_create: (args: any) => ({
    sessionId: args?.sessionId ?? "mock-session",
    title: "",
    theme: null,
    creationMode: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileCount: 0,
    totalSize: 0,
  }),
  session_files_update_meta: (args: any) => ({
    sessionId: args?.sessionId ?? "mock-session",
    title: args?.title ?? "",
    theme: args?.theme ?? null,
    creationMode: args?.creationMode ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileCount: 0,
    totalSize: 0,
  }),
  session_files_list_files: () => [],
  session_files_save_file: (args: any) => ({
    name: args?.fileName ?? "mock.txt",
    fileType: "text/plain",
    size: typeof args?.content === "string" ? args.content.length : 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  session_files_read_file: () => "",
  session_files_delete_file: () => undefined,

  // OAuth 凭证相关
  add_kiro_oauth_credential: () => ({ success: true }),
  add_kiro_from_json: () => ({ success: true }),
  add_gemini_oauth_credential: () => ({ success: true }),
  add_qwen_oauth_credential: () => ({ success: true }),
  add_openai_key_credential: () => ({ success: true }),
  add_claude_key_credential: () => ({ success: true }),
  add_gemini_api_key_credential: () => ({ success: true }),
  add_antigravity_oauth_credential: () => ({ success: true }),
  add_codex_oauth_credential: () => ({ success: true }),
  add_claude_oauth_credential: () => ({ success: true }),
  add_iflow_oauth_credential: () => ({ success: true }),
  add_iflow_cookie_credential: () => ({ success: true }),
  start_kiro_builder_id_login: () => ({ success: true }),
  poll_kiro_builder_id_auth: () => ({ status: "pending" }),
  cancel_kiro_builder_id_login: () => ({ success: true }),
  add_kiro_from_builder_id_auth: () => ({ success: true }),
  start_kiro_social_auth_login: () => ({ success: true }),
  exchange_kiro_social_auth_token: () => ({ success: true }),
  cancel_kiro_social_auth_login: () => ({ success: true }),
  start_kiro_social_auth_callback_server: () => ({ success: true }),
  refresh_pool_credential_token: () => ({ success: true }),
  get_pool_credential_oauth_status: () => ({ status: "unknown" }),
  migrate_private_config_to_pool: () => ({ success: true }),
  get_credential_health: () => ({ healthy: false }),
  get_all_credential_health: () => [],
  get_kiro_credential_fingerprint: () => ({ fingerprint: "" }),
  switch_kiro_to_local: () => ({ success: true }),

  // Playwright 相关
  check_playwright_available: () => ({ available: false }),
  install_playwright: () => ({ success: true }),
  start_kiro_playwright_login: () => ({ success: true }),
  cancel_kiro_playwright_login: () => ({ success: true }),

  // 连接相关
  list_connections: () => [],
  connection_list: () => [],
  get_oauth_url: () => ({ url: "https://example.com/oauth" }),
  save_oauth_credential: () => ({ success: true }),
  get_oauth_credentials: () => [],
  get_all_oauth_credentials: () => [],
  reload_oauth_credentials: () => ({ success: true }),
  refresh_oauth_token: () => ({ success: true }),
  get_oauth_env_variables: () => [],
  get_oauth_token_file_hash: () => ({ hash: "" }),
  check_and_reload_oauth_credentials: () => ({
    changed: false,
    new_hash: "",
    reloaded: false,
  }),

  // 模型相关
  get_model_registry: () => [],
  get_model_registry_provider_ids: () => [],
  refresh_model_registry: () => ({ success: true }),
  search_models: () => [],
  get_all_provider_models: () => ({}),
  get_model_preferences: () => [],
  toggle_model_favorite: () => ({ success: true }),
  hide_model: () => ({ success: true }),
  record_model_usage: () => ({}),
  get_model_sync_state: () => ({ syncing: false, last_sync_at: null }),
  get_models_for_provider: () => [],
  get_models_by_tier: () => [],
  get_provider_alias_config: () => ({ alias: {} }),
  get_all_alias_configs: () => ({}),

  // Orchestrator 相关
  init_orchestrator: () => ({}),
  get_orchestrator_config: () => ({ config: {} }),
  update_orchestrator_config: () => ({ success: true }),
  get_pool_stats: () => ({ stats: {} }),
  get_tier_models: () => [],
  get_all_models: () => [],
  update_orchestrator_credentials: () => ({ success: true }),
  add_orchestrator_credential: () => ({ success: true }),
  remove_orchestrator_credential: () => ({ success: true }),
  mark_credential_unhealthy: () => ({ success: true }),
  mark_credential_healthy: () => ({ success: true }),
  update_credential_load: () => ({ success: true }),
  select_model: () => ({ model: "" }),
  quick_select_model: () => ({ model: "" }),
  select_model_for_task: () => ({ model: "" }),
  list_strategies: () => [],
  list_service_tiers: () => [],
  list_task_hints: () => [],

  // MCP 相关
  get_mcp_servers: () => [],
  add_mcp_server: () => ({ success: true }),
  update_mcp_server: () => ({ success: true }),
  delete_mcp_server: () => ({ success: true }),
  toggle_mcp_server: () => ({ success: true }),
  import_mcp_from_app: () => ({ success: true }),
  sync_all_mcp_to_live: () => ({ success: true }),
  sync_from_external_config: () => ({ success: true }),
  mcp_list_servers_with_status: () => [],
  mcp_start_server: () => ({ success: true }),
  mcp_stop_server: () => ({ success: true }),
  mcp_list_tools: () => [],
  mcp_list_tools_for_context: () => [],
  mcp_search_tools: () => [],
  mcp_call_tool: () => ({ content: [], is_error: false }),
  mcp_call_tool_with_caller: () => ({ content: [], is_error: false }),
  mcp_list_prompts: () => [],
  mcp_get_prompt: () => ({ description: "", messages: [] }),
  mcp_list_resources: () => [],
  mcp_read_resource: () => ({}),

  // Switch Provider 相关
  get_switch_providers: () => [],
  add_switch_provider: () => ({ success: true }),
  delete_switch_provider: () => ({ success: true }),
  update_switch_provider: () => ({ success: true }),
  get_current_switch_provider: () => null,
  read_live_provider_settings: () => ({}),

  // 系统信息相关
  subscribe_sysinfo: () => ({ success: true }),
  unsubscribe_sysinfo: () => ({ success: true }),

  // Session 相关
  update_session: () => ({ success: true }),
  add_flow_to_session: () => ({ success: true }),
  remove_flow_from_session: () => ({ success: true }),
  unarchive_session: () => ({ success: true }),
  archive_session: () => ({ success: true }),
  delete_session: () => ({ success: true }),

  // Bookmark 相关
  remove_bookmark: () => ({ success: true }),

  // Intercept 相关
  intercept_config_set: () => ({ success: true }),
  intercept_continue: () => ({ success: true }),
  intercept_cancel: () => ({ success: true }),

  // Quick Filter 相关
  delete_quick_filter: () => ({ success: true }),

  // Telemetry 相关
  get_request_logs: () => ({ logs: [] }),
  get_request_log_detail: () => ({ log: null }),
  clear_request_logs: () => ({ success: true }),
  report_frontend_crash: () => ({ success: true }),
  get_stats_summary: () => ({ summary: {} }),
  get_stats_by_provider: () => ({ stats: [] }),
  get_stats_by_model: () => ({ stats: [] }),
  get_token_summary: () => ({ summary: {} }),
  get_token_stats_by_provider: () => ({ stats: [] }),
  get_token_stats_by_model: () => ({ stats: [] }),
  get_token_stats_by_day: () => ({ stats: [] }),

  // Routes 相关
  get_available_routes: () => ({ routes: [] }),
  get_route_curl_examples: () => ({ examples: [] }),

  // Prompts 相关
  get_prompts: () => [],
  upsert_prompt: () => ({ success: true }),
  add_prompt: () => ({ success: true }),
  update_prompt: () => ({ success: true }),
  delete_prompt: () => ({ success: true }),
  enable_prompt: () => ({ success: true }),
  import_prompt_from_file: () => ({ success: true }),
  get_current_prompt_file_content: () => ({ content: "" }),
  auto_import_prompt: () => ({ success: true }),
  switch_prompt: () => ({ success: true }),

  // Window 相关
  get_window_size: () => ({ width: 1280, height: 800 }),
  set_window_size: () => ({}),
  get_window_size_options: () => ({ options: [] }),
  set_window_size_by_option: () => ({}),
  toggle_fullscreen: () => ({}),
  is_fullscreen: () => ({ fullscreen: false }),
  resize_for_flow_monitor: () => ({}),
  restore_window_size: () => ({}),
  toggle_window_size: () => ({}),
  center_window: () => ({}),

  // Usage 相关
  get_kiro_usage: () => ({ usage: {} }),

  // Resilience 相关
  get_retry_config: () => ({ config: {} }),
  update_retry_config: () => ({ success: true }),
  get_failover_config: () => ({ config: {} }),
  update_failover_config: () => ({ success: true }),
  get_switch_log: () => ({ logs: [] }),
  clear_switch_log: () => ({ success: true }),

  // Machine ID 相关
  get_current_machine_id: () => ({ machine_id: "" }),
  set_machine_id: () => ({ success: true }),
  generate_random_machine_id: () => ({ machine_id: "" }),
  validate_machine_id: () => ({ valid: true }),
  check_admin_privileges: () => ({ is_admin: false }),
  get_os_type: () => ({ os_type: "linux" }),
  backup_machine_id_to_file: () => ({ success: true }),
  restore_machine_id_from_file: () => ({ success: true }),
  format_machine_id: () => ({ formatted: "" }),
  detect_machine_id_format: () => ({ format: "unknown" }),
  convert_machine_id_format: () => ({ converted: "" }),
  get_machine_id_history: () => ({ history: [] }),
  clear_machine_id_override: () => ({ success: true }),
  copy_machine_id_to_clipboard: () => ({ success: true }),
  paste_machine_id_from_clipboard: () => ({ machine_id: "" }),
  get_system_info: () => ({ info: {} }),

  // Injection 相关
  get_injection_config: () => ({ config: {} }),
  set_injection_enabled: () => ({ success: true }),
  add_injection_rule: () => ({ success: true }),
  remove_injection_rule: () => ({ success: true }),
  update_injection_rule: () => ({ success: true }),
  get_injection_rules: () => ({ rules: [] }),

  // OAuth 登录相关
  start_antigravity_oauth_login: () => ({ success: true }),
  get_antigravity_auth_url_and_wait: () => ({ url: "" }),
  start_codex_oauth_login: () => ({ success: true }),
  get_codex_auth_url_and_wait: () => ({ url: "" }),
  start_claude_oauth_login: () => ({ success: true }),
  get_claude_oauth_auth_url_and_wait: () => ({ url: "" }),
  claude_oauth_with_cookie: () => ({ success: true }),
  start_qwen_device_code_login: () => ({ success: true }),
  get_qwen_device_code_and_wait: () => ({ code: "" }),
  start_iflow_oauth_login: () => ({ success: true }),
  get_iflow_auth_url_and_wait: () => ({ url: "" }),
  start_gemini_oauth_login: () => ({ success: true }),
  get_gemini_auth_url_and_wait: () => ({ url: "" }),
  exchange_gemini_code: () => ({ success: true }),

  // File System 相关
  reveal_in_finder: () => ({}),
  open_with_default_app: () => ({}),
  delete_file: () => ({ success: true }),
  create_file: () => ({ success: true }),
  create_directory: () => ({ success: true }),
  rename_file: () => ({ success: true }),
  list_dir: (args: any) => ({
    path: args?.path ?? "~",
    parentPath: null,
    entries: [],
    error: null,
  }),

  // Log 相关
  get_logs: () => [],
  get_persisted_logs_tail: () => [],
  export_support_bundle: () => ({
    bundle_path: "mock://ProxyCast-Support.zip",
    output_directory: "mock://",
    generated_at: new Date().toISOString(),
    platform: "mock-web",
    included_sections: ["meta/manifest.json"],
    omitted_sections: ["config 内容", "数据库内容"],
  }),
  clear_logs: () => ({}),
  clear_diagnostic_log_history: () => ({}),

  // Test 相关
  test_api: () => ({
    success: true,
    status: 200,
    body: "",
    time_ms: 0,
    response_headers: {
      "x-proxycast-request-id": "mock-request-id",
      "x-proxycast-cache": "store",
      "x-proxycast-dedup": "new",
      "x-proxycast-idempotency": "new",
      "x-proxycast-requested-provider": "openai",
      "x-proxycast-effective-provider": "openai",
      "x-proxycast-model": "gpt-4o-mini",
    },
  }),

  // Kiro Credentials 相关
  get_kiro_credentials: () => ({ loaded: false }),
  refresh_kiro_token: () => ({ success: true }),
  reload_credentials: () => ({ success: true }),
  get_env_variables: () => [],
  get_token_file_hash: () => ({ hash: "" }),
  check_and_reload_credentials: () => ({
    changed: false,
    new_hash: "",
    reloaded: false,
  }),

  // Gemini Credentials 相关
  get_gemini_credentials: () => ({ loaded: false }),
  reload_gemini_credentials: () => ({ success: true }),
  refresh_gemini_token: () => ({ success: true }),
  get_gemini_env_variables: () => [],
  get_gemini_token_file_hash: () => ({ hash: "" }),
  check_and_reload_gemini_credentials: () => ({
    changed: false,
    new_hash: "",
    reloaded: false,
  }),

  // Qwen Credentials 相关
  get_qwen_credentials: () => ({ loaded: false }),
  reload_qwen_credentials: () => ({ success: true }),
  refresh_qwen_token: () => ({ success: true }),
  get_qwen_env_variables: () => [],
  get_qwen_token_file_hash: () => ({ hash: "" }),
  check_and_reload_qwen_credentials: () => ({
    changed: false,
    new_hash: "",
    reloaded: false,
  }),

  // OpenAI Custom 相关
  get_openai_custom_status: () => ({
    enabled: false,
    has_api_key: false,
    base_url: "",
  }),
  set_openai_custom_config: () => ({ success: true }),

  // Claude Custom 相关
  get_claude_custom_status: () => ({
    enabled: false,
    has_api_key: false,
    base_url: "",
  }),
  set_claude_custom_config: () => ({ success: true }),

  // API Compatibility Check 相关
  check_api_compatibility: () => ({
    provider: "",
    overall_status: "ok",
    checked_at: "",
    results: [],
    warnings: [],
  }),

  // Endpoint Providers 相关
  get_endpoint_providers: () => ({}),
  set_endpoint_provider: () => ({ provider: "" }),

  // Experimental Features 相关
  get_experimental_config: () => ({
    screenshot_chat: { enabled: false, shortcut: "" },
  }),
  save_experimental_config: () => ({}),
  validate_shortcut: () => ({ valid: true }),
  update_screenshot_shortcut: () => ({ success: true }),

  // Screenshot Chat 相关
  send_screenshot_chat: () => ({ success: true }),
  close_screenshot_chat_window: () => ({}),

  // Update 相关
  get_update_check_settings: () => ({
    enabled: true,
    check_interval_hours: 24,
    show_notification: true,
    last_check_timestamp: 0,
    skipped_version: null,
    remind_later_until: null,
  }),
  get_update_notification_metrics: () => ({
    shown_count: 0,
    update_now_count: 0,
    remind_later_count: 0,
    skip_version_count: 0,
    dismiss_count: 0,
    update_now_rate: 0,
    remind_later_rate: 0,
    skip_version_rate: 0,
    dismiss_rate: 0,
  }),
  record_update_notification_action: () => ({}),
  download_update: () => ({ success: true }),
  skip_update_version: () => ({}),
  remind_update_later: () => Math.floor(Date.now() / 1000) + 24 * 3600,
  dismiss_update_notification: () => Math.floor(Date.now() / 1000) + 24 * 3600,
  close_update_window: () => ({}),
  set_update_check_settings: () => ({ success: true }),
  test_update_window: () => ({}),

  // Auto Fix 相关
  auto_fix_configuration: () => ({ success: true }),

  // Check Config Sync 相关
  check_config_sync_status: () => ({ status: "synced" }),

  // 心跳引擎相关
  get_heartbeat_config: () => ({
    enabled: false,
    interval_secs: 300,
    task_file: "HEARTBEAT.md",
    execution_mode: "intelligent",
    enable_history: true,
    max_retries: 3,
  }),
  update_heartbeat_config: () => ({ success: true }),
  get_heartbeat_status: () => ({
    running: false,
    last_run: null,
    last_task_count: 0,
    total_executions: 0,
    current_task: null,
  }),
  get_heartbeat_tasks: () => [],
  add_heartbeat_task: () => {},
  delete_heartbeat_task: () => {},
  update_heartbeat_task: () => {},
  get_heartbeat_history: () => [],
  get_heartbeat_execution_detail: () => null,
  get_heartbeat_task_health: () => ({
    totalTasks: 0,
    pendingTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    cooldownTasks: 0,
    staleRunningTasks: 0,
    failedLast24h: 0,
    failureTrend24h: [],
    alerts: [],
    topRiskyTasks: [],
    generatedAt: new Date().toISOString(),
  }),
  deliver_heartbeat_task_health_alerts: () => ({
    delivered: false,
    alert_count: 0,
    message: "当前无告警，未触发投递",
  }),
  trigger_heartbeat_now: () => ({
    task_count: 0,
    success_count: 0,
    failed_count: 0,
    timeout_count: 0,
  }),
  get_task_templates: () => [],
  apply_task_template: () => ({ success: true }),
  generate_content_creator_tasks: () => 0,
  execution_run_list: () => [],
  execution_run_get: () => null,
  execution_run_get_theme_workbench_state: () => ({
    run_state: "idle",
    current_gate_key: "idle",
    queue_items: [],
    latest_terminal: null,
    updated_at: new Date().toISOString(),
  }),
  content_workflow_get_by_content: () => null,
  content_workflow_create: () => null,
  content_get_theme_workbench_document_state: () => null,

  // Workspace 相关
  workspace_list: () => [],
  workspace_get: (args: any) => ({
    id: args?.id ?? "mock-workspace",
    name: args?.id ?? "Mock Workspace",
    workspaceType: "general",
    rootPath: `/mock/workspace/${args?.id ?? "mock-workspace"}`,
    isDefault: false,
    settings: {},
    isFavorite: false,
    isArchived: false,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  workspace_get_default: () => null,
  workspace_set_default: () => ({}),
  workspace_get_by_path: () => null,
  workspace_ensure_default_ready: () => null,
  workspace_ensure_ready: (args: any) => ({
    workspaceId: args?.id ?? "mock-workspace",
    rootPath: "~/mock-workspace",
    existed: true,
    created: false,
    repaired: false,
    relocated: false,
    previousRootPath: null,
    warning: null,
  }),
  workspace_get_projects_root: () => "/mock/workspace/projects",
  workspace_resolve_project_path: (args: any) =>
    `/mock/workspace/projects/${args?.name ?? "untitled"}`,
  workspace_create: (args: any) => ({
    id: `mock-project-${Date.now()}`,
    name: args?.request?.name ?? "Mock Project",
    rootPath:
      args?.request?.rootPath ?? "/mock/workspace/projects/mock-project",
    workspaceType: args?.request?.workspaceType ?? "general",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isArchived: false,
  }),
};

/**
 * Mock invoke function
 */
export async function invoke<T = any>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  console.log(`[Mock] invoke: ${cmd}`, args);

  // 检查是否有自定义 mock
  if (mockCommands.has(cmd)) {
    const handler = mockCommands.get(cmd)!;
    return handler(args);
  }

  if (isDevBridgeAvailable() && !shouldPreferMockInBrowser(cmd)) {
    try {
      return await invokeViaHttp<T>(cmd, args);
    } catch (error) {
      if (cmd in defaultMocks) {
        console.warn(
          `[Mock] Bridge unavailable or unsupported, fallback to mock: ${cmd}`,
        );
        return defaultMocks[cmd](args);
      }
      throw normalizeDevBridgeError(cmd, error);
    }
  }

  // 使用默认 mock
  if (cmd in defaultMocks) {
    return defaultMocks[cmd](args);
  }

  console.warn(`[Mock] Unhandled command: ${cmd}`);
  return undefined as T;
}

/**
 * Register a mock command handler
 */
export function mockCommand(cmd: string, handler: (...args: any[]) => any) {
  mockCommands.set(cmd, handler);
}

/**
 * Clear all mock commands
 */
export function clearMocks() {
  mockCommands.clear();
}

/**
 * Mock convertFileSrc function
 * 在真实 Tauri 环境中，这个函数将本地文件路径转换为可在 webview 中使用的 URL
 * 在 mock 环境中，直接返回原始路径（或 blob URL 如果需要）
 */
export function convertFileSrc(filePath: string, _protocol?: string): string {
  // 在 mock 环境中，返回一个占位符或原始路径
  // 实际图片无法在 web 环境中显示，但不会导致构建错误
  console.log(`[Mock] convertFileSrc: ${filePath}`);
  return filePath;
}

// 导出类型以保持兼容
export type { InvokeOptions } from "@tauri-apps/api/core";
