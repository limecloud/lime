import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

const legacyChatRestrictedPatterns = [
  "@/components/chat",
  "@/components/chat/*",
  "@/components/chat/**",
  "**/components/chat",
  "**/components/chat/*",
  "**/components/chat/**",
];

const generalChatRestrictedPaths = [
  {
    name: "@/components/general-chat",
    importNames: ["useChat"],
    message:
      "general-chat 的 useChat 属于旧路径，请优先使用 @/hooks/useUnifiedChat 或当前现役聊天入口。",
  },
  {
    name: "@/components/general-chat",
    importNames: ["useSession", "useStreaming"],
    message:
      "general-chat 当前属于兼容链路，请不要在新代码中继续引入页面入口或旧 Hook。",
  },
  {
    name: "@/components/general-chat",
    importNames: ["GeneralChatPage"],
    message:
      "general-chat 当前属于兼容链路，请不要在新代码中继续引入页面入口或旧 Hook。",
  },
  {
    name: "@/components/general-chat/hooks",
    importNames: ["useChat"],
    message:
      "general-chat/hooks/useChat 属于旧路径，请优先使用 @/hooks/useUnifiedChat 或当前现役聊天入口。",
  },
  {
    name: "@/components/general-chat/hooks",
    importNames: ["useSession", "useStreaming"],
    message:
      "general-chat/hooks 下的 useSession/useStreaming 属于兼容实现，请优先接入统一对话链路。",
  },
  {
    name: "@/components/general-chat/hooks/useChat",
    message:
      "general-chat/hooks/useChat 属于旧路径，请优先使用 @/hooks/useUnifiedChat 或当前现役聊天入口。",
  },
  {
    name: "@/components/general-chat/GeneralChatPage",
    message:
      "GeneralChatPage 属于旧版 general-chat 入口，请不要在新代码中继续引入。",
  },
  {
    name: "@/components/general-chat/hooks/useSession",
    message:
      "general-chat/hooks/useSession 属于旧版会话兼容 Hook，请优先接入统一对话链路。",
  },
  {
    name: "@/components/general-chat/hooks/useStreaming",
    message:
      "general-chat/hooks/useStreaming 依赖旧流事件协议，请优先接入统一对话链路。",
  },
  {
    name: "@/components/general-chat/canvas",
    message:
      "请不要直接深导入 general-chat/canvas；跨模块复用请改用 @/components/general-chat/bridge。",
  },
  {
    name: "@/components/general-chat/types",
    message:
      "请不要直接深导入 general-chat/types；跨模块复用请改用 @/components/general-chat/bridge 或现役共享类型。",
  },
  {
    name: "@/components/general-chat/store/useGeneralChatStore",
    message:
      "请不要直接深导入 general-chat 内部 store；如需兼容桥接，请显式放在 compat 层。",
  },
  {
    name: "@/lib/api/generalChatCompat",
    message:
      "generalChatCompat 属于兼容网关，请仅在 general-chat store 中消费，避免 compat 逻辑再次向业务层扩散。",
  },
  {
    name: "@/lib/api/agent",
    message:
      "agent.ts 现在只是兼容门面；新代码请改用 @/lib/api/agentRuntime、@/lib/api/agentStream 或 @/lib/api/agentCompat。",
  },
  {
    name: "@/lib/terminal-api",
    message: "terminal-api 现在只是兼容门面；新代码请改用 @/lib/api/terminal。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "startServer",
      "stopServer",
      "getServerStatus",
      "getServerDiagnostics",
      "getLogStorageDiagnostics",
      "exportSupportBundle",
      "getWindowsStartupDiagnostics",
      "ServerStatus",
      "ServerDiagnostics",
      "LogStorageDiagnostics",
      "SupportBundleExportResult",
      "WindowsStartupDiagnostics",
    ],
    message:
      "server/diagnostics 相关能力已迁移到 @/lib/api/serverRuntime，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "getLogs",
      "getPersistedLogsTail",
      "clearLogs",
      "clearDiagnosticLogHistory",
      "LogEntry",
    ],
    message:
      "日志相关能力已迁移到 @/lib/api/logs，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "getConfig",
      "saveConfig",
      "getEnvironmentPreview",
      "getDefaultProvider",
      "setDefaultProvider",
      "updateProviderEnvVars",
      "Config",
      "EnvironmentPreview",
    ],
    message:
      "配置/环境预览相关能力已迁移到 @/lib/api/appConfig，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "ChannelsConfig",
      "GatewayConfig",
      "TelegramBotConfig",
      "DiscordBotConfig",
      "FeishuBotConfig",
      "GatewayChannelStatusResponse",
      "TelegramProbeResult",
      "FeishuProbeResult",
      "DiscordProbeResult",
      "GatewayTunnelStatus",
      "GatewayTunnelProbeResult",
      "CloudflaredInstallStatus",
      "CloudflaredInstallResult",
      "GatewayTunnelCreateResponse",
      "GatewayTunnelSyncWebhookResponse",
      "gatewayChannelStart",
      "gatewayChannelStop",
      "gatewayChannelStatus",
      "telegramChannelProbe",
      "feishuChannelProbe",
      "discordChannelProbe",
      "gatewayTunnelProbe",
      "gatewayTunnelDetectCloudflared",
      "gatewayTunnelInstallCloudflared",
      "gatewayTunnelCreate",
      "gatewayTunnelStart",
      "gatewayTunnelStop",
      "gatewayTunnelRestart",
      "gatewayTunnelStatus",
      "gatewayTunnelSyncWebhookUrl",
    ],
    message:
      "channels/gateway 相关能力已迁移到 @/lib/api/channelsRuntime，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "getExperimentalConfig",
      "saveExperimentalConfig",
      "validateShortcut",
      "updateScreenshotShortcut",
      "ExperimentalFeatures",
      "SmartInputConfig",
    ],
    message:
      "实验室配置/截图快捷键相关能力已迁移到 @/lib/api/experimentalFeatures，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "getMemoryOverview",
      "getMemoryEffectiveSources",
      "getMemoryAutoIndex",
      "toggleMemoryAuto",
      "updateMemoryAutoNote",
      "MemoryOverviewResponse",
      "EffectiveMemorySourcesResponse",
      "AutoMemoryIndexResponse",
      "MemoryAutoConfig",
      "MemoryAutoToggleResponse",
      "MemoryConfig",
      "MemoryProfileConfig",
      "MemoryResolveConfig",
      "MemorySourcesConfig",
    ],
    message:
      "记忆运行时相关能力已迁移到 @/lib/api/memoryRuntime，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: ["getAvailableModels", "ModelInfo"],
    message:
      "模型列表查询已迁移到 @/lib/api/modelCatalog，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "getUsageStats",
      "getModelUsageRanking",
      "getDailyUsageTrends",
      "UsageStatsResponse",
      "ModelUsage",
      "DailyUsage",
    ],
    message:
      "使用统计查询已迁移到 @/lib/api/usageStats，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: [
      "reloadCredentials",
      "refreshKiroToken",
      "getKiroCredentials",
      "getEnvVariables",
      "getTokenFileHash",
      "checkAndReloadCredentials",
      "getGeminiCredentials",
      "reloadGeminiCredentials",
      "refreshGeminiToken",
      "getGeminiEnvVariables",
      "getGeminiTokenFileHash",
      "checkAndReloadGeminiCredentials",
      "getQwenCredentials",
      "reloadQwenCredentials",
      "refreshQwenToken",
      "getQwenEnvVariables",
      "getQwenTokenFileHash",
      "checkAndReloadQwenCredentials",
      "getOpenAICustomStatus",
      "setOpenAICustomConfig",
      "getClaudeCustomStatus",
      "setClaudeCustomConfig",
      "KiroCredentialStatus",
      "EnvVariable",
      "CheckResult",
      "GeminiCredentialStatus",
      "QwenCredentialStatus",
      "OpenAICustomStatus",
      "ClaudeCustomStatus",
      "CredentialEntry",
      "GeminiApiKeyEntry",
      "VertexApiKeyEntry",
      "VertexModelAlias",
      "AmpConfig",
      "AmpModelMapping",
    ],
    message:
      "provider 凭证/自定义状态相关能力已迁移到 @/lib/api/providerRuntime，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/hooks/useTauri",
    importNames: ["testApi", "TestResult", "getNetworkInfo", "NetworkInfo"],
    message:
      "API 测试/网络信息相关能力已迁移到 @/lib/api/serverTools，请不要继续从 useTauri 聚合层引入。",
  },
  {
    name: "@/stores/agentStore",
    message:
      "agentStore 属于遗留状态容器，请改用现役 useAgentChat / useAsterAgentChat 链路。",
  },
  {
    name: "@/stores",
    importNames: [
      "useAgentStore",
      "useAgentMessages",
      "useAgentStreaming",
      "useAgentSessions",
      "usePendingActions",
    ],
    message:
      "agentStore 相关导出属于遗留状态容器，请改用现役 useAgentChat / useAsterAgentChat 链路。",
  },
  {
    name: "@/lib/api/agentCompat",
    message:
      "agentCompat 属于遗留兼容层，请仅在历史桥接或兼容测试中使用，避免继续向业务层扩散。",
  },
  {
    name: "@/lib/api/agent",
    importNames: ["sendAgentMessage", "sendAgentMessageStream"],
    message: "旧 Agent 发送 API 已废弃，请优先使用 sendAsterMessageStream。",
  },
  {
    name: "@/lib/api/agent",
    importNames: [
      "initasterAgent",
      "getasterAgentStatus",
      "resetasterAgent",
      "createasterSession",
      "sendasterMessage",
      "listasterProviders",
    ],
    message:
      "旧 aster 命名 API 已废弃，请使用现役 Aster API 或 Provider 配置流程。",
  },
];

const generalChatRestrictedPathsWithoutPage = generalChatRestrictedPaths.filter(
  (entry) =>
    !(
      entry.name === "@/components/general-chat" &&
      Array.isArray(entry.importNames) &&
      entry.importNames.includes("GeneralChatPage")
    ),
);

const generalChatRestrictedPathsWithoutPageAndStore =
  generalChatRestrictedPathsWithoutPage.filter(
    (entry) =>
      entry.name !== "@/components/general-chat/store/useGeneralChatStore",
  );

const generalChatRestrictedPathsWithoutCompatApi =
  generalChatRestrictedPaths.filter(
    (entry) => entry.name !== "@/lib/api/generalChatCompat",
  );

const createLegacyChatImportRule = (paths) => [
  "error",
  {
    paths,
    patterns: [
      {
        group: legacyChatRestrictedPatterns,
        message:
          "components/chat 为遗留聊天模块，禁止新增依赖；请优先使用现役聊天入口。",
      },
    ],
  },
];

const generalChatCompatCommandSelectors = [
  "general_chat_get_session",
  "general_chat_list_sessions",
  "general_chat_create_session",
  "general_chat_delete_session",
  "general_chat_rename_session",
  "general_chat_get_messages",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "general_chat_* compat 命令只允许集中放在 src/lib/api/generalChatCompat.ts，禁止在业务层直接扩散。",
}));

const agentRuntimeCommandSelectors = [
  "agent_start_process",
  "agent_stop_process",
  "agent_get_process_status",
  "agent_create_session",
  "agent_list_sessions",
  "agent_get_session",
  "agent_delete_session",
  "agent_get_session_messages",
  "agent_rename_session",
  "agent_generate_title",
  "agent_terminal_command_response",
  "agent_term_scrollback_response",
  "aster_agent_init",
  "aster_agent_status",
  "aster_agent_chat_stream",
  "aster_agent_stop",
  "aster_agent_confirm",
  "aster_agent_submit_elicitation_response",
  "aster_agent_configure_provider",
  "aster_agent_reset",
  "aster_session_create",
  "aster_session_list",
  "aster_session_get",
  "aster_session_rename",
  "aster_session_set_execution_strategy",
  "aster_session_delete",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "agent_/aster_ 命令只允许集中放在 `src/lib/api/agentRuntime.ts` / `src/lib/api/agentCompat.ts` 或历史兼容 store 中，禁止在其他业务模块直接扩散。",
}));

const projectGatewayCommandSelectors = [
  "workspace_create",
  "workspace_get_projects_root",
  "workspace_resolve_project_path",
  "workspace_list",
  "workspace_get_default",
  "workspace_ensure_default_ready",
  "workspace_set_default",
  "workspace_get_by_path",
  "workspace_get",
  "workspace_update",
  "workspace_delete",
  "workspace_ensure_ready",
  "get_or_create_default_project",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "workspace/project 相关后端命令请统一通过 `src/lib/api/project.ts` 暴露的网关函数调用，避免业务层继续拼接命令名并扩散兼容逻辑。",
}));

const materialGatewayCommandSelectors = [
  "list_materials",
  "get_material_count",
  "upload_material",
  "update_material",
  "delete_material",
  "get_material_content",
  "import_material_from_url",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "素材相关后端命令请统一通过 `src/lib/api/materials.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const templateGatewayCommandSelectors = [
  "list_templates",
  "get_default_template",
  "create_template",
  "update_template",
  "delete_template",
  "set_default_template",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "模板相关后端命令请统一通过 `src/lib/api/templates.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const personaGatewayCommandSelectors = [
  "list_personas",
  "get_default_persona",
  "create_persona",
  "update_persona",
  "delete_persona",
  "set_default_persona",
  "list_persona_templates",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "人设相关后端命令请统一通过 `src/lib/api/personas.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const brandPersonaGatewayCommandSelectors = [
  "get_brand_persona",
  "get_brand_extension",
  "save_brand_extension",
  "update_brand_extension",
  "delete_brand_extension",
  "list_brand_persona_templates",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "品牌人设相关后端命令请统一通过 `src/lib/api/brandPersona.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const posterMaterialGatewayCommandSelectors = [
  "get_poster_material",
  "create_poster_metadata",
  "update_poster_metadata",
  "delete_poster_metadata",
  "list_by_image_category",
  "list_by_layout_category",
  "list_by_mood",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "海报素材相关后端命令请统一通过 `src/lib/api/posterMaterials.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const subAgentSchedulerCommandSelectors = [
  "execute_subagent_tasks",
  "cancel_subagent_tasks",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "SubAgent 调度相关后端命令请统一通过 `src/lib/api/subAgentScheduler.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const fileSystemCommandSelectors = [
  "reveal_in_finder",
  "open_with_default_app",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "文件打开/定位相关后端命令请统一通过 `src/lib/api/fileSystem.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const pluginGatewayCommandSelectors = [
  "get_plugin_status",
  "get_plugins",
  "list_installed_plugins",
  "list_plugin_tasks",
  "get_plugin_queue_stats",
  "get_plugin_task",
  "enable_plugin",
  "disable_plugin",
  "reload_plugins",
  "unload_plugin",
  "uninstall_plugin",
  "cancel_plugin_task",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "插件运行态/管理相关后端命令请统一通过 `src/lib/api/plugins.ts` 暴露的网关函数调用，避免在 Hook / 组件中继续直接拼接命令名。",
}));

const fileBrowserCommandSelectors = [
  "list_dir",
  "read_file_preview_cmd",
  "create_file",
  "create_directory",
  "rename_file",
  "delete_file",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "文件浏览/文件树相关后端命令请统一通过 `src/lib/api/fileBrowser.ts` 暴露的网关函数调用，避免在组件中继续直接拼接命令名。",
}));

const appUpdateCommandSelectors = [
  "check_for_updates",
  "download_update",
  "close_update_window",
  "dismiss_update_notification",
  "record_update_notification_action",
  "remind_update_later",
  "skip_update_version",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "更新检查/更新提醒相关后端命令请统一通过 `src/lib/api/appUpdate.ts` 暴露的网关函数调用，避免在页面中继续直接拼接命令名。",
}));

const screenshotChatCommandSelectors = [
  "send_screenshot_chat",
  "close_screenshot_chat_window",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "截图聊天窗口相关后端命令请统一通过 `src/lib/api/screenshotChat.ts` 暴露的网关函数调用，避免在页面/组件中继续直接拼接命令名。",
}));

const systemSupportCommandSelectors = [
  "show_notification",
  "auto_fix_configuration",
  "report_frontend_crash",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "系统支持类后端命令请统一通过对应 API 网关（`src/lib/api/notification.ts` / `autoFix.ts` / `frontendCrash.ts`）调用，避免在 lib / hook 中继续直接拼接命令名。",
}));

const terminalCommandSelectors = [
  "terminal_create_session",
  "terminal_write",
  "terminal_resize",
  "terminal_close",
  "terminal_list_sessions",
  "terminal_get_session",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "终端相关后端命令请统一通过 `src/lib/api/terminal.ts` 暴露的网关函数调用，避免在其他模块中继续直接拼接命令名。",
}));

const serverRuntimeCommandSelectors = [
  "start_server",
  "stop_server",
  "get_server_status",
  "get_server_diagnostics",
  "get_log_storage_diagnostics",
  "export_support_bundle",
  "get_windows_startup_diagnostics",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "服务控制/诊断相关后端命令请统一通过 `src/lib/api/serverRuntime.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const logCommandSelectors = [
  "get_logs",
  "get_persisted_logs_tail",
  "clear_logs",
  "clear_diagnostic_log_history",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "日志相关后端命令请统一通过 `src/lib/api/logs.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const appConfigCommandSelectors = [
  "get_config",
  "save_config",
  "get_environment_preview",
  "get_default_provider",
  "set_default_provider",
  "update_provider_env_vars",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "配置/环境预览相关后端命令请统一通过 `src/lib/api/appConfig.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const channelsRuntimeCommandSelectors = [
  "gateway_channel_start",
  "gateway_channel_stop",
  "gateway_channel_status",
  "telegram_channel_probe",
  "feishu_channel_probe",
  "discord_channel_probe",
  "gateway_tunnel_probe",
  "gateway_tunnel_detect_cloudflared",
  "gateway_tunnel_install_cloudflared",
  "gateway_tunnel_create",
  "gateway_tunnel_start",
  "gateway_tunnel_stop",
  "gateway_tunnel_restart",
  "gateway_tunnel_status",
  "gateway_tunnel_sync_webhook_url",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "channels/gateway 相关后端命令请统一通过 `src/lib/api/channelsRuntime.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const experimentalFeaturesCommandSelectors = [
  "get_experimental_config",
  "save_experimental_config",
  "validate_shortcut",
  "update_screenshot_shortcut",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "实验室配置/截图快捷键相关后端命令请统一通过 `src/lib/api/experimentalFeatures.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const memoryRuntimeCommandSelectors = [
  "get_conversation_memory_overview",
  "memory_get_effective_sources",
  "memory_get_auto_index",
  "memory_toggle_auto",
  "memory_update_auto_note",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "记忆运行时相关后端命令请统一通过 `src/lib/api/memoryRuntime.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const modelCatalogCommandSelectors = ["get_available_models"].map(
  (command) => ({
    selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
    message:
      "模型列表查询命令请统一通过 `src/lib/api/modelCatalog.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
  }),
);

const usageStatsCommandSelectors = [
  "get_usage_stats",
  "get_model_usage_ranking",
  "get_daily_usage_trends",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "使用统计命令请统一通过 `src/lib/api/usageStats.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const providerRuntimeCommandSelectors = [
  "refresh_kiro_token",
  "reload_credentials",
  "get_kiro_credentials",
  "get_env_variables",
  "get_token_file_hash",
  "check_and_reload_credentials",
  "get_gemini_credentials",
  "reload_gemini_credentials",
  "refresh_gemini_token",
  "get_gemini_env_variables",
  "get_gemini_token_file_hash",
  "check_and_reload_gemini_credentials",
  "get_qwen_credentials",
  "reload_qwen_credentials",
  "refresh_qwen_token",
  "get_qwen_env_variables",
  "get_qwen_token_file_hash",
  "check_and_reload_qwen_credentials",
  "get_openai_custom_status",
  "set_openai_custom_config",
  "get_claude_custom_status",
  "set_claude_custom_config",
].map((command) => ({
  selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
  message:
    "provider 凭证/自定义状态相关后端命令请统一通过 `src/lib/api/providerRuntime.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
}));

const serverToolsCommandSelectors = ["test_api", "get_network_info"].map(
  (command) => ({
    selector: `CallExpression[callee.name='safeInvoke'][arguments.0.value='${command}'], CallExpression[callee.name='invoke'][arguments.0.value='${command}']`,
    message:
      "API 测试/网络信息相关后端命令请统一通过 `src/lib/api/serverTools.ts` 暴露的网关函数调用，避免继续在其他模块中直接拼接命令名。",
  }),
);

export default [
  { ignores: ["dist", "src-tauri", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            // AddCustomProviderModal.tsx
            "validateCustomProviderForm",
            "isFormValid",
            "hasRequiredFields",
            // ApiKeyItem.tsx
            "extractApiKeyDisplayInfo",
            // ApiKeyList.tsx
            "getApiKeyListStats",
            // ApiKeyProviderSection.tsx
            "verifyProviderSelectionSync",
            "extractSelectionState",
            // ConnectionTestButton.tsx
            "getConnectionTestStatusInfo",
            // DeleteProviderDialog.tsx
            "canDeleteProvider",
            "isSystemProvider",
            // ProviderConfigForm.tsx
            "getFieldsForProviderType",
            "providerTypeRequiresField",
            // ProviderGroup.tsx
            "getGroupLabel",
            "isProviderInGroup",
            "getGroupOrder",
            // ProviderList.tsx
            "filterProviders",
            "groupProviders",
            "matchesSearchQuery",
            // ProviderListItem.tsx
            "extractListItemDisplayInfo",
            "getApiKeyCount",
            // ProviderSetting.tsx
            "extractProviderSettingInfo",
            // icons/providers/index.tsx
            "iconComponents",
          ],
        },
      ],
      "no-restricted-imports": createLegacyChatImportRule(
        generalChatRestrictedPaths,
      ),
      "no-restricted-syntax": [
        "error",
        ...generalChatCompatCommandSelectors,
        ...agentRuntimeCommandSelectors,
        ...projectGatewayCommandSelectors,
        ...materialGatewayCommandSelectors,
        ...templateGatewayCommandSelectors,
        ...personaGatewayCommandSelectors,
        ...brandPersonaGatewayCommandSelectors,
        ...posterMaterialGatewayCommandSelectors,
        ...subAgentSchedulerCommandSelectors,
        ...fileSystemCommandSelectors,
        ...pluginGatewayCommandSelectors,
        ...fileBrowserCommandSelectors,
        ...appUpdateCommandSelectors,
        ...screenshotChatCommandSelectors,
        ...systemSupportCommandSelectors,
        ...terminalCommandSelectors,
        ...serverRuntimeCommandSelectors,
        ...logCommandSelectors,
        ...appConfigCommandSelectors,
        ...channelsRuntimeCommandSelectors,
        ...experimentalFeaturesCommandSelectors,
        ...memoryRuntimeCommandSelectors,
        ...modelCatalogCommandSelectors,
        ...usageStatsCommandSelectors,
        ...providerRuntimeCommandSelectors,
        ...serverToolsCommandSelectors,
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/components/chat/ChatPage.tsx"],
    rules: {
      "no-restricted-imports": createLegacyChatImportRule(
        generalChatRestrictedPathsWithoutPage,
      ),
    },
  },
  {
    files: ["src/components/chat/hooks/useChat.ts"],
    rules: {
      "no-restricted-imports": createLegacyChatImportRule(
        generalChatRestrictedPathsWithoutPageAndStore,
      ),
    },
  },
  {
    files: ["src/components/general-chat/store/useGeneralChatStore.ts"],
    rules: {
      "no-restricted-imports": createLegacyChatImportRule(
        generalChatRestrictedPathsWithoutCompatApi,
      ),
    },
  },
  {
    files: ["src/lib/api/generalChatCompat.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "src/lib/api/agentRuntime.ts",
      "src/lib/api/agentCompat.ts",
      "src/lib/api/project.ts",
      "src/lib/api/materials.ts",
      "src/lib/api/templates.ts",
      "src/lib/api/personas.ts",
      "src/lib/api/brandPersona.ts",
      "src/lib/api/posterMaterials.ts",
      "src/lib/api/subAgentScheduler.ts",
      "src/lib/api/fileSystem.ts",
      "src/lib/api/plugins.ts",
      "src/lib/api/pluginUI.ts",
      "src/lib/api/fileBrowser.ts",
      "src/lib/api/appUpdate.ts",
      "src/lib/api/screenshotChat.ts",
      "src/lib/api/notification.ts",
      "src/lib/api/autoFix.ts",
      "src/lib/api/frontendCrash.ts",
      "src/lib/api/terminal.ts",
      "src/lib/api/serverRuntime.ts",
      "src/lib/api/logs.ts",
      "src/lib/api/appConfig.ts",
      "src/lib/api/channelsRuntime.ts",
      "src/lib/api/experimentalFeatures.ts",
      "src/lib/api/memoryRuntime.ts",
      "src/lib/api/modelCatalog.ts",
      "src/lib/api/usageStats.ts",
      "src/lib/api/providerRuntime.ts",
      "src/lib/api/serverTools.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
