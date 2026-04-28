import {
  getConfig,
  type Config,
  type CrashReportingConfig,
} from "@/lib/api/appConfig";
import { clearDiagnosticLogHistory, type LogEntry } from "@/lib/api/logs";
import type {
  LogStorageDiagnostics,
  ServerDiagnostics,
  WindowsStartupDiagnostics,
} from "@/lib/api/serverRuntime";
import {
  apiKeyProviderApi,
  type ProviderWithKeysDisplay,
} from "@/lib/api/apiKeyProvider";
import { mcpApi, type McpServerInfo } from "@/lib/api/mcp";
import {
  getGeneralWorkbenchDocumentState,
  type GeneralWorkbenchDocumentState,
} from "@/lib/api/project";
import { getActiveContentTarget } from "@/lib/activeContentTarget";
import { getRuntimeAppVersion } from "@/lib/appVersion";
import {
  clearFrontendCrashBuffer,
  getFrontendCrashBuffer,
  type FrontendCrashBufferEntry,
} from "@/lib/crashReporting";
import {
  clearInvokeErrorBuffer,
  clearInvokeTraceBuffer,
  getInvokeErrorBuffer,
  getInvokeTraceBuffer,
  safeInvoke,
  type InvokeErrorBufferEntry,
  type InvokeTraceBufferEntry,
} from "@/lib/dev-bridge";
import { revealPathInFinder } from "@/lib/api/fileSystem";
import {
  clearWorkspaceRepairHistory,
  getWorkspaceRepairHistory,
  type WorkspaceRepairRecord,
} from "@/lib/workspaceHealthTelemetry";

export interface CrashDiagnosticPayload {
  generated_at: string;
  app_version: string;
  platform: string;
  user_agent: string;
  locale: string;
  timezone: string;
  page_url: string;
  runtime: "tauri" | "browser";
  crash_reporting: CrashReportingConfig;
  frontend_crash_logs: LogEntry[];
  frontend_crash_buffer?: FrontendCrashBufferEntry[];
  invoke_error_buffer?: InvokeErrorBufferEntry[];
  invoke_trace_buffer?: InvokeTraceBufferEntry[];
  persisted_log_tail?: LogEntry[];
  server_diagnostics?: ServerDiagnostics | null;
  log_storage_diagnostics?: LogStorageDiagnostics | null;
  windows_startup_diagnostics?: WindowsStartupDiagnostics | null;
  runtime_snapshot?: RuntimeDiagnosticSnapshot | null;
  workspace_repair_history?: WorkspaceRepairRecord[];
  general_workbench_document_state?: GeneralWorkbenchDocumentState | null;
  diagnostic_collection_notes?: string[];
}

export interface RuntimeConfigSummary {
  default_provider: string;
  server_host: string;
  server_port: number;
  tls_enabled: boolean;
  response_cache_enabled: boolean;
  remote_management_allow_remote: boolean;
  minimize_to_tray: boolean;
  language: string;
  proxy_configured: boolean;
  gateway_tunnel_enabled: boolean;
  crash_reporting_enabled: boolean;
}

export interface ApiKeyProviderEntrySummary {
  id: string;
  type: string;
  enabled: boolean;
  is_system: boolean;
  api_key_count: number;
  enabled_api_key_count: number;
  custom_model_count: number;
}

export interface ApiKeyProviderDiagnosticSummary {
  total_providers: number;
  enabled_providers: number;
  system_providers: number;
  custom_providers: number;
  total_api_keys: number;
  enabled_api_keys: number;
  disabled_api_keys: number;
  providers: ApiKeyProviderEntrySummary[];
}

export interface McpServerEntrySummary {
  name: string;
  is_running: boolean;
  enabled_lime: boolean;
  enabled_claude: boolean;
  enabled_codex: boolean;
  enabled_gemini: boolean;
}

export interface McpDiagnosticSummary {
  total_servers: number;
  running_servers: number;
  enabled_lime: number;
  enabled_claude: number;
  enabled_codex: number;
  enabled_gemini: number;
  servers: McpServerEntrySummary[];
}

export interface RuntimeDiagnosticSnapshot {
  config_summary?: RuntimeConfigSummary | null;
  api_key_provider_summary?: ApiKeyProviderDiagnosticSummary | null;
  mcp_summary?: McpDiagnosticSummary | null;
}

export interface RuntimeDiagnosticCollectionResult {
  runtimeSnapshot: RuntimeDiagnosticSnapshot | null;
  collectionNotes: string[];
}

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

export interface ClipboardPermissionGuide {
  platform: DesktopPlatform;
  title: string;
  steps: string[];
  settingsUrl?: string;
}

export interface CrashDiagnosticExportResult {
  fileName: string;
  locationHint: string;
}

export interface CrashDiagnosticExportOptions {
  sceneTag?: string;
  timestamp?: number;
}

export interface OpenDownloadDirectoryResult {
  openedPath: string;
}

export interface ClipboardCopyMessages {
  fallbackErrorMessage?: string;
  permissionDeniedMessage?: string;
  inactiveWindowMessage?: string;
}

export const CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT = [
  "确认清空旧诊断信息吗？",
  "这会删除本地崩溃缓存、调用轨迹、Workspace 修复记录，以及历史日志文件与原始响应文件。",
  "此操作不可恢复。",
].join("\n");

export const DEFAULT_CRASH_REPORTING_CONFIG: CrashReportingConfig = {
  enabled: true,
  dsn: null,
  environment: "production",
  sample_rate: 1,
  send_pii: false,
};

export function normalizeCrashReportingConfig(
  config?: CrashReportingConfig,
): CrashReportingConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_CRASH_REPORTING_CONFIG.enabled,
    dsn: config?.dsn ?? DEFAULT_CRASH_REPORTING_CONFIG.dsn,
    environment:
      config?.environment?.trim() || DEFAULT_CRASH_REPORTING_CONFIG.environment,
    sample_rate:
      typeof config?.sample_rate === "number" &&
      Number.isFinite(config.sample_rate)
        ? Math.min(1, Math.max(0, config.sample_rate))
        : DEFAULT_CRASH_REPORTING_CONFIG.sample_rate,
    send_pii: config?.send_pii ?? DEFAULT_CRASH_REPORTING_CONFIG.send_pii,
  };
}

export function maskCrashReportingDsn(dsn?: string | null): string | null {
  if (!dsn) return null;
  const trimmed = dsn.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 12) return "***";
  return `${trimmed.slice(0, 10)}***${trimmed.slice(-6)}`;
}

export function pickFrontendCrashLogs(
  logs: LogEntry[],
  limit = 30,
): LogEntry[] {
  return logs
    .filter((entry) => entry.message.includes("[FrontendCrash]"))
    .slice(0, limit);
}

interface BuildCrashDiagnosticPayloadParams {
  crashConfig: CrashReportingConfig;
  logs: LogEntry[];
  persistedLogTail?: LogEntry[];
  collectionNotes?: string[];
  appVersion?: string;
  platform: string;
  userAgent: string;
  maxCrashLogs?: number;
  maxInvokeErrors?: number;
  maxInvokeTraces?: number;
  maxPersistedLogs?: number;
  maxWorkspaceRepairs?: number;
  generalWorkbenchDocumentState?: GeneralWorkbenchDocumentState | null;
  serverDiagnostics?: ServerDiagnostics | null;
  logStorageDiagnostics?: LogStorageDiagnostics | null;
  windowsStartupDiagnostics?: WindowsStartupDiagnostics | null;
  runtimeSnapshot?: RuntimeDiagnosticSnapshot | null;
}

function buildRuntimeConfigSummary(config: Config): RuntimeConfigSummary {
  return {
    default_provider: config.default_provider,
    server_host: config.server.host,
    server_port: config.server.port,
    tls_enabled: Boolean(config.server.tls?.enable),
    response_cache_enabled: Boolean(config.server.response_cache?.enabled),
    remote_management_allow_remote: Boolean(
      config.remote_management?.allow_remote,
    ),
    minimize_to_tray: Boolean(config.minimize_to_tray),
    language: config.language || "unknown",
    proxy_configured: Boolean(config.proxy_url?.trim()),
    gateway_tunnel_enabled: Boolean(config.gateway?.tunnel?.enabled),
    crash_reporting_enabled: Boolean(
      config.crash_reporting?.enabled ?? DEFAULT_CRASH_REPORTING_CONFIG.enabled,
    ),
  };
}

function buildApiKeyProviderSummary(
  providers: ProviderWithKeysDisplay[],
): ApiKeyProviderDiagnosticSummary {
  const providerSummaries = providers.map((provider) => {
    const enabledApiKeyCount = provider.api_keys.filter(
      (item) => item.enabled,
    ).length;
    return {
      id: provider.id,
      type: provider.type,
      enabled: provider.enabled,
      is_system: provider.is_system,
      api_key_count: provider.api_keys.length,
      enabled_api_key_count: enabledApiKeyCount,
      custom_model_count: provider.custom_models?.length ?? 0,
    };
  });

  const totalApiKeys = providerSummaries.reduce(
    (sum, item) => sum + item.api_key_count,
    0,
  );
  const enabledApiKeys = providerSummaries.reduce(
    (sum, item) => sum + item.enabled_api_key_count,
    0,
  );

  return {
    total_providers: providerSummaries.length,
    enabled_providers: providerSummaries.filter((item) => item.enabled).length,
    system_providers: providerSummaries.filter((item) => item.is_system).length,
    custom_providers: providerSummaries.filter((item) => !item.is_system)
      .length,
    total_api_keys: totalApiKeys,
    enabled_api_keys: enabledApiKeys,
    disabled_api_keys: totalApiKeys - enabledApiKeys,
    providers: providerSummaries,
  };
}

function buildMcpSummary(servers: McpServerInfo[]): McpDiagnosticSummary {
  const serverSummaries = servers.map((server) => ({
    name: server.name,
    is_running: server.is_running,
    enabled_lime: server.enabled_lime,
    enabled_claude: server.enabled_claude,
    enabled_codex: server.enabled_codex,
    enabled_gemini: server.enabled_gemini,
  }));

  return {
    total_servers: serverSummaries.length,
    running_servers: serverSummaries.filter((item) => item.is_running).length,
    enabled_lime: serverSummaries.filter((item) => item.enabled_lime).length,
    enabled_claude: serverSummaries.filter((item) => item.enabled_claude)
      .length,
    enabled_codex: serverSummaries.filter((item) => item.enabled_codex).length,
    enabled_gemini: serverSummaries.filter((item) => item.enabled_gemini)
      .length,
    servers: serverSummaries,
  };
}

function normalizeDiagnosticErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const compactMessage = rawMessage.replace(/\s+/g, " ").trim();
  if (!compactMessage) {
    return "未知错误";
  }
  if (compactMessage.length <= 160) {
    return compactMessage;
  }
  return `${compactMessage.slice(0, 157)}...`;
}

function buildCollectionFailureNote(
  fieldName: string,
  commandName: string,
  error: unknown,
): string {
  return `${fieldName}（${commandName}）未采集到：${normalizeDiagnosticErrorMessage(error)}。`;
}

function hasRuntimeSnapshotData(snapshot: RuntimeDiagnosticSnapshot): boolean {
  return Boolean(
    snapshot.config_summary ||
    snapshot.api_key_provider_summary ||
    snapshot.mcp_summary,
  );
}

export async function collectRuntimeSnapshotForDiagnostic(
  config?: Config | null,
): Promise<RuntimeDiagnosticCollectionResult> {
  const configTask = config ? Promise.resolve(config) : getConfig();
  const [configResult, apiKeyProviderResult, mcpResult] =
    await Promise.allSettled([
    configTask,
    apiKeyProviderApi.getProviders(),
    mcpApi.listServersWithStatus(),
  ]);

  const snapshot: RuntimeDiagnosticSnapshot = {};
  const collectionNotes: string[] = [];

  if (configResult.status === "fulfilled") {
    snapshot.config_summary = buildRuntimeConfigSummary(configResult.value);
  } else {
    snapshot.config_summary = null;
    collectionNotes.push(
      buildCollectionFailureNote(
        "runtime_snapshot.config_summary",
        "get_config",
        configResult.reason,
      ),
    );
  }

  if (apiKeyProviderResult.status === "fulfilled") {
    snapshot.api_key_provider_summary = buildApiKeyProviderSummary(
      apiKeyProviderResult.value,
    );
  } else {
    snapshot.api_key_provider_summary = null;
    collectionNotes.push(
      buildCollectionFailureNote(
        "runtime_snapshot.api_key_provider_summary",
        "get_api_key_providers",
        apiKeyProviderResult.reason,
      ),
    );
  }

  if (mcpResult.status === "fulfilled") {
    snapshot.mcp_summary = buildMcpSummary(mcpResult.value);
  } else {
    snapshot.mcp_summary = null;
    collectionNotes.push(
      buildCollectionFailureNote(
        "runtime_snapshot.mcp_summary",
        "mcp_list_servers_with_status",
        mcpResult.reason,
      ),
    );
  }

  return {
    runtimeSnapshot: hasRuntimeSnapshotData(snapshot) ? snapshot : null,
    collectionNotes,
  };
}

function buildAutoCollectionNotes(params: {
  frontendCrashBuffer: FrontendCrashBufferEntry[];
  invokeErrorBuffer: InvokeErrorBufferEntry[];
  invokeTraceBuffer: InvokeTraceBufferEntry[];
  persistedLogTail: LogEntry[];
  platform: string;
  serverDiagnostics?: ServerDiagnostics | null;
  logStorageDiagnostics?: LogStorageDiagnostics | null;
  windowsStartupDiagnostics?: WindowsStartupDiagnostics | null;
  runtimeSnapshot?: RuntimeDiagnosticSnapshot | null;
}): string[] {
  const notes: string[] = [];

  if (params.frontendCrashBuffer.length === 0) {
    notes.push(
      "frontend_crash_buffer 为空：当前没有检测到未捕获前端异常；已被界面正常处理的业务报错不会出现在这里。",
    );
  }

  if (
    params.invokeErrorBuffer.length <= 1 &&
    params.invokeTraceBuffer.length > 0
  ) {
    notes.push(
      "invoke_error_buffer 只记录失败调用；更多上下文请结合 invoke_trace_buffer 查看最近成功/失败命令轨迹。",
    );
  }

  if (params.persistedLogTail.length < 20) {
    notes.push(
      `persisted_log_tail 当前仅收集到 ${params.persistedLogTail.length} 行；这通常表示本次会话内写入业务日志较少。`,
    );
  }

  if (!params.serverDiagnostics) {
    notes.push(
      "server_diagnostics 未采集到：若后端命令失败或服务尚未初始化，需结合 persisted_log_tail 与 invoke_trace_buffer 一起排查。",
    );
  }

  if (!params.logStorageDiagnostics?.current_log_path) {
    notes.push(
      "log_storage_diagnostics 未提供当前日志文件路径：可能是文件日志关闭、初始化失败或当前运行环境不支持。",
    );
  } else if (
    (params.logStorageDiagnostics.related_log_files?.length ?? 0) > 1
  ) {
    notes.push(
      `已检测到 ${params.logStorageDiagnostics.related_log_files.length} 个关联日志文件；persisted_log_tail 已按时间顺序合并最近日志上下文。`,
    );
  }

  if (!params.runtimeSnapshot) {
    notes.push(
      "runtime_snapshot 未采集到：本次导出仍可用于分析日志与调用轨迹，但无法反映配置、API Key Provider、MCP 与终端运行态。",
    );
  } else if (
    (params.runtimeSnapshot.api_key_provider_summary?.total_api_keys ?? 0) === 0
  ) {
    notes.push(
      "运行时快照显示 API Key 数为 0；首次安装或初始化未完成时，很多操作不会继续产生更多下游错误与日志。",
    );
  }

  if (detectDesktopPlatform(params.platform, "") === "windows") {
    if (!params.windowsStartupDiagnostics) {
      notes.push(
        "windows_startup_diagnostics 未采集到：当前无法判断 WebView2、终端默认 Shell、安装目录与资源目录是否异常。",
      );
    } else {
      if (params.windowsStartupDiagnostics.summary_message) {
        notes.push(
          `Windows 启动自检提示：${params.windowsStartupDiagnostics.summary_message}`,
        );
      }
      if (params.windowsStartupDiagnostics.shell_env?.trim().startsWith("/")) {
        notes.push(
          `检测到 Unix 风格 SHELL 环境变量：${params.windowsStartupDiagnostics.shell_env}；Windows 初装环境里这很容易诱发 /bin/bash 相关启动失败。`,
        );
      }
    }
  }

  return notes;
}

export function buildCrashDiagnosticPayload(
  params: BuildCrashDiagnosticPayloadParams,
): CrashDiagnosticPayload {
  const {
    crashConfig,
    logs,
    persistedLogTail = [],
    collectionNotes = [],
    appVersion,
    platform,
    userAgent,
    maxCrashLogs = 30,
    maxInvokeErrors = 40,
    maxInvokeTraces = 80,
    maxPersistedLogs = 200,
    maxWorkspaceRepairs = 50,
    generalWorkbenchDocumentState = null,
    serverDiagnostics = null,
    logStorageDiagnostics = null,
    windowsStartupDiagnostics = null,
    runtimeSnapshot = null,
  } = params;

  const frontendCrashBuffer = getFrontendCrashBuffer(maxCrashLogs);
  const invokeErrorBuffer = getInvokeErrorBuffer(maxInvokeErrors);
  const invokeTraceBuffer = getInvokeTraceBuffer(maxInvokeTraces);
  const persistedTail = persistedLogTail.slice(-maxPersistedLogs);
  const autoCollectionNotes = buildAutoCollectionNotes({
    frontendCrashBuffer,
    invokeErrorBuffer,
    invokeTraceBuffer,
    persistedLogTail: persistedTail,
    platform,
    serverDiagnostics,
    logStorageDiagnostics,
    windowsStartupDiagnostics,
    runtimeSnapshot,
  });

  return {
    generated_at: new Date().toISOString(),
    app_version: getRuntimeAppVersion(appVersion),
    platform,
    user_agent: userAgent,
    locale:
      (typeof navigator !== "undefined" && navigator.language) || "unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
    page_url:
      (typeof window !== "undefined" && window.location?.href) || "unknown",
    runtime: isTauriRuntime() ? "tauri" : "browser",
    crash_reporting: {
      ...normalizeCrashReportingConfig(crashConfig),
      dsn: maskCrashReportingDsn(crashConfig.dsn),
    },
    frontend_crash_logs: pickFrontendCrashLogs(logs, maxCrashLogs),
    frontend_crash_buffer: frontendCrashBuffer,
    invoke_error_buffer: invokeErrorBuffer,
    invoke_trace_buffer: invokeTraceBuffer,
    persisted_log_tail: persistedTail,
    server_diagnostics: serverDiagnostics,
    log_storage_diagnostics: logStorageDiagnostics,
    windows_startup_diagnostics: windowsStartupDiagnostics,
    runtime_snapshot: runtimeSnapshot,
    workspace_repair_history: getWorkspaceRepairHistory(maxWorkspaceRepairs),
    general_workbench_document_state: generalWorkbenchDocumentState,
    diagnostic_collection_notes: Array.from(
      new Set(
        [...autoCollectionNotes, ...collectionNotes].filter(
          (item) => typeof item === "string" && item.trim().length > 0,
        ),
      ),
    ),
  };
}

export async function collectGeneralWorkbenchDocumentStateForDiagnostic(): Promise<GeneralWorkbenchDocumentState | null> {
  const activeTarget = getActiveContentTarget();
  if (!activeTarget?.contentId || activeTarget.canvasType !== "document") {
    return null;
  }

  try {
    return await getGeneralWorkbenchDocumentState(activeTarget.contentId);
  } catch (error) {
    console.warn("[crashDiagnostic] 获取工作区文稿状态失败:", error);
    return null;
  }
}

export async function clearCrashDiagnosticHistory(): Promise<void> {
  clearFrontendCrashBuffer();
  clearInvokeErrorBuffer();
  clearInvokeTraceBuffer();
  clearWorkspaceRepairHistory();

  try {
    await clearDiagnosticLogHistory();
  } catch (error) {
    console.error("[crashDiagnostic] 清空诊断日志历史失败:", error);
    throw new Error(
      "本地诊断缓存已清空，但历史日志文件清理失败，请重试或稍后重新导出诊断信息确认",
    );
  }
}

export async function copyCrashDiagnosticToClipboard(
  payload: CrashDiagnosticPayload,
): Promise<void> {
  const text = buildCrashDiagnosticClipboardText(payload);
  await copyTextToClipboard(text, {
    fallbackErrorMessage: "复制诊断信息失败，请重试或使用“导出诊断 JSON”",
    permissionDeniedMessage:
      "剪贴板权限被系统拒绝，请允许权限后重试，或使用“导出诊断 JSON”",
    inactiveWindowMessage:
      "当前窗口未激活，先点击应用窗口后重试，或使用“导出诊断 JSON”",
  });
}

export async function copyCrashDiagnosticJsonToClipboard(
  payload: CrashDiagnosticPayload,
): Promise<void> {
  const text = JSON.stringify(payload, null, 2);
  await copyTextToClipboard(text, {
    fallbackErrorMessage: "复制诊断信息失败，请重试或使用“导出诊断 JSON”",
    permissionDeniedMessage:
      "剪贴板权限被系统拒绝，请允许权限后重试，或使用“导出诊断 JSON”",
    inactiveWindowMessage:
      "当前窗口未激活，先点击应用窗口后重试，或使用“导出诊断 JSON”",
  });
}

export async function copyTextToClipboard(
  text: string,
  messages: ClipboardCopyMessages = {},
): Promise<void> {
  let lastError: unknown;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      lastError = error;
      if (copyTextWithExecCommand(text)) {
        return;
      }
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  if (await copyTextViaTauriClipboard(text)) {
    return;
  }

  if (lastError) {
    throw new Error(formatClipboardCopyError(lastError, messages));
  }

  throw new Error(messages.fallbackErrorMessage || "复制内容失败，请重试");
}

export function buildCrashDiagnosticClipboardText(
  payload: CrashDiagnosticPayload,
): string {
  const json = JSON.stringify(payload, null, 2);
  const summary = buildDiagnosticSummary(payload);
  return `# Lime 故障诊断请求（可直接给 AI）

请你扮演资深全栈工程师，基于下方诊断数据定位问题并给出可落地修复方案。

## 自动摘要
${summary}

## 你的任务
1. 先判断最可能的根因（按概率排序，至少 3 条）
2. 给出最小改动修复方案（前端/后端分别说明）
3. 提供可直接执行的验证步骤（手工 + 自动化）
4. 标注高风险改动点与回滚方案
5. 如果信息不足，请列出最小补充信息清单

## 输出格式要求
- 根因分析
- 修复方案（含关键代码位置）
- 验证步骤
- 风险与回滚
- 仍需补充的信息

## 诊断数据（JSON）
\`\`\`json
${json}
\`\`\`

## 复现补充（请按需补充）
- 操作路径：
- 期望结果：
- 实际结果：
- 首次出现版本：
- 发生频率：
`;
}

function formatOptionalSummaryValue(
  value: number | string | null | undefined,
): string {
  return value == null ? "未采集" : String(value);
}

function countStartupChecks(
  diagnostics: WindowsStartupDiagnostics | null | undefined,
  status: "ok" | "warning" | "error",
): number {
  return (
    diagnostics?.checks.filter((item) => item.status === status).length ?? 0
  );
}

function buildDiagnosticSummary(payload: CrashDiagnosticPayload): string {
  const crashLogCount = payload.frontend_crash_logs.length;
  const localCrashCount = payload.frontend_crash_buffer?.length ?? 0;
  const invokeErrorCount = payload.invoke_error_buffer?.length ?? 0;
  const invokeTraceCount = payload.invoke_trace_buffer?.length ?? 0;
  const persistedLogCount = payload.persisted_log_tail?.length ?? 0;
  const relatedLogFileCount =
    payload.log_storage_diagnostics?.related_log_files?.length ?? 0;
  const rawResponseFileCount =
    payload.log_storage_diagnostics?.raw_response_files?.length ?? 0;
  const workspaceRepairCount = payload.workspace_repair_history?.length ?? 0;
  const versionCount =
    payload.general_workbench_document_state?.version_count ?? 0;
  const dsnConfigured = payload.crash_reporting.dsn ? "是" : "否";
  const serverDiagnosticsCollected = payload.server_diagnostics ? "是" : "否";
  const runtimeSnapshotCollected = payload.runtime_snapshot ? "是" : "否";
  const isWindowsPayload =
    detectDesktopPlatform(payload.platform, payload.user_agent) === "windows";
  const windowsStartupDiagnostics = payload.windows_startup_diagnostics;
  const windowsStartupCollected = windowsStartupDiagnostics ? "是" : "否";
  const windowsStartupErrorCount = countStartupChecks(
    windowsStartupDiagnostics,
    "error",
  );
  const windowsStartupWarningCount = countStartupChecks(
    windowsStartupDiagnostics,
    "warning",
  );
  const apiKeyProviderSummary =
    payload.runtime_snapshot?.api_key_provider_summary;
  const mcpSummary = payload.runtime_snapshot?.mcp_summary;
  const summaryLines = [
    `- 版本：${payload.app_version}`,
    `- 平台：${payload.platform}（${payload.runtime}）`,
    `- 语言/时区：${payload.locale} / ${payload.timezone}`,
    `- 页面：${payload.page_url}`,
    `- 崩溃日志条数：${crashLogCount}`,
    `- 本地崩溃缓存条数：${localCrashCount}`,
    `- 命令调用失败缓存条数：${invokeErrorCount}`,
    `- 最近调用轨迹条数：${invokeTraceCount}`,
    `- 持久化日志尾部行数：${persistedLogCount}`,
    `- 服务端诊断已采集：${serverDiagnosticsCollected}`,
    `- 运行时快照已采集：${runtimeSnapshotCollected}`,
    `- API Key Provider / Key 数：${
      apiKeyProviderSummary
        ? `${apiKeyProviderSummary.total_providers} / ${apiKeyProviderSummary.total_api_keys}`
        : "未采集"
    }`,
    `- MCP 服务器数 / 运行中数：${
      mcpSummary
        ? `${mcpSummary.total_servers} / ${mcpSummary.running_servers}`
        : "未采集"
    }`,
    `- 关联日志文件数：${relatedLogFileCount}`,
    `- 原始响应文件数：${rawResponseFileCount}`,
    `- Workspace 自动修复记录条数：${workspaceRepairCount}`,
    `- 工作区文稿版本数：${versionCount}`,
    `- 崩溃上报已启用：${payload.crash_reporting.enabled ? "是" : "否"}（DSN 已配置：${dsnConfigured}）`,
  ];

  if (isWindowsPayload) {
    summaryLines.splice(
      11,
      0,
      `- Windows 启动自检已采集：${windowsStartupCollected}`,
      `- Windows 启动阻塞 / 警告：${
        windowsStartupDiagnostics
          ? `${windowsStartupErrorCount} / ${windowsStartupWarningCount}`
          : "未采集"
      }`,
      `- Windows 终端默认 Shell：${formatOptionalSummaryValue(
        windowsStartupDiagnostics?.resolved_terminal_shell,
      )}`,
    );
  }

  return summaryLines.join("\n");
}

function copyTextWithExecCommand(text: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function formatClipboardCopyError(
  error: unknown,
  messages: ClipboardCopyMessages,
): string {
  if (isClipboardPermissionDeniedError(error)) {
    return (
      messages.permissionDeniedMessage ||
      "剪贴板权限被系统拒绝，请允许权限后重试"
    );
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.toLowerCase();

  if (normalizedMessage.includes("document is not focused")) {
    return (
      messages.inactiveWindowMessage || "当前窗口未激活，先点击应用窗口后重试"
    );
  }

  return messages.fallbackErrorMessage || "复制内容失败，请重试";
}

export function isClipboardPermissionDeniedError(error: unknown): boolean {
  const rawMessage = collectErrorMessages(error);
  const normalizedMessage = rawMessage.toLowerCase();
  return (
    normalizedMessage.includes("not allowed by the user agent") ||
    normalizedMessage.includes("denied permission") ||
    normalizedMessage.includes("notallowederror") ||
    normalizedMessage.includes("权限被系统拒绝") ||
    normalizedMessage.includes("权限拒绝")
  );
}

function collectErrorMessages(error: unknown): string {
  const rootMessage = error instanceof Error ? error.message : String(error);
  if (
    error instanceof Error &&
    "cause" in error &&
    error.cause instanceof Error
  ) {
    return `${rootMessage} ${error.cause.message}`;
  }
  return rootMessage;
}

export function detectDesktopPlatform(
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): DesktopPlatform {
  const platformText = `${platform} ${userAgent}`.toLowerCase();
  if (platformText.includes("mac")) return "macos";
  if (platformText.includes("win")) return "windows";
  if (platformText.includes("linux") || platformText.includes("x11")) {
    return "linux";
  }
  return "unknown";
}

export function getClipboardPermissionGuide(
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): ClipboardPermissionGuide {
  const detectedPlatform = detectDesktopPlatform(platform, userAgent);

  if (detectedPlatform === "macos") {
    return {
      platform: detectedPlatform,
      title: "macOS 剪贴板权限指引",
      steps: [
        "先点击 Lime 窗口任意区域，再重试复制。",
        "打开“系统设置 → 隐私与安全性 → 辅助功能”，确认 Lime 已启用。",
        "若仍失败，请使用“导出诊断 JSON”并发送给开发者。",
      ],
      settingsUrl:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    };
  }

  if (detectedPlatform === "windows") {
    return {
      platform: detectedPlatform,
      title: "Windows 剪贴板权限指引",
      steps: [
        "先点击 Lime 窗口任意区域，再重试复制。",
        "打开“设置 → 隐私和安全性 → 剪贴板”，确认系统剪贴板功能可用。",
        "若企业策略限制剪贴板访问，请改用“导出诊断 JSON”。",
      ],
      settingsUrl: "ms-settings:clipboard",
    };
  }

  if (detectedPlatform === "linux") {
    return {
      platform: detectedPlatform,
      title: "Linux 剪贴板权限指引",
      steps: [
        "先点击 Lime 窗口任意区域，再重试复制。",
        "请在桌面环境隐私设置中确认应用未被限制访问剪贴板。",
        "Wayland 环境若仍失败，建议使用“导出诊断 JSON”。",
      ],
    };
  }

  return {
    platform: detectedPlatform,
    title: "剪贴板权限指引",
    steps: [
      "先点击 Lime 窗口任意区域，再重试复制。",
      "请在系统隐私设置中确认未禁止应用访问剪贴板。",
      "若仍失败，请使用“导出诊断 JSON”。",
    ],
  };
}

export function exportCrashDiagnosticToJson(
  payload: CrashDiagnosticPayload,
  options: CrashDiagnosticExportOptions = {},
): CrashDiagnosticExportResult {
  const fileName = buildCrashDiagnosticFileName(payload, options);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return {
    fileName,
    locationHint: getDefaultDownloadDirectoryHint(),
  };
}

export function buildCrashDiagnosticFileName(
  payload: CrashDiagnosticPayload,
  options: CrashDiagnosticExportOptions = {},
): string {
  const sceneTag =
    sanitizeDiagnosticSceneTag(options.sceneTag) ||
    inferDiagnosticSceneTag(payload) ||
    "manual-export";
  const appVersionTag =
    sanitizeDiagnosticSceneTag(`v-${payload.app_version || "unknown"}`) ||
    "v-unknown";
  const timestamp = formatDiagnosticTimestamp(options.timestamp ?? Date.now());
  return `lime-crash-${sceneTag}-${appVersionTag}-${timestamp}.json`;
}

export async function openCrashDiagnosticDownloadDirectory(): Promise<OpenDownloadDirectoryResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前环境不支持自动打开下载目录，请手动前往系统下载目录");
  }

  const platform = detectDesktopPlatform();
  const homeDir = await safeInvoke<string>("get_home_dir").catch(() => "");
  const candidates = buildDownloadDirectoryCandidates(platform, homeDir);

  for (const path of candidates) {
    try {
      await revealPathInFinder(path);
      return { openedPath: path };
    } catch {
      // continue
    }
  }

  throw new Error(
    `无法自动打开下载目录，请手动前往 ${getDefaultDownloadDirectoryHint()}`,
  );
}

async function copyTextViaTauriClipboard(text: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const result = await safeInvoke<unknown>("copy_machine_id_to_clipboard", {
      machineId: text,
    });

    if (typeof result === "boolean") {
      return result;
    }
    if (typeof result === "object" && result !== null && "success" in result) {
      return Boolean((result as { success?: boolean }).success);
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

function isTauriRuntime(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
    ((window as any).__TAURI__?.core?.invoke ||
      (window as any).__TAURI__?.invoke),
  );
}

function getDefaultDownloadDirectoryHint(): string {
  const platform = detectDesktopPlatform();
  if (platform === "windows") {
    return "%USERPROFILE%/Downloads";
  }
  if (platform === "macos") {
    return "~/Downloads";
  }
  if (platform === "linux") {
    return "~/Downloads";
  }
  return "系统默认下载目录";
}

export function sanitizeDiagnosticSceneTag(
  input?: string | null,
): string | undefined {
  if (!input) return undefined;
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return normalized || undefined;
}

function inferDiagnosticSceneTag(
  payload: CrashDiagnosticPayload,
): string | undefined {
  const notes = payload.diagnostic_collection_notes ?? [];
  const joined = notes.join(" ").toLowerCase();
  if (joined.includes("workspace") && joined.includes("不存在")) {
    return "workspace-path-missing";
  }
  if (joined.includes("boundary_error")) {
    return "crash-recovery";
  }
  if (joined.includes("clipboard")) {
    return "clipboard-permission";
  }
  return undefined;
}

function formatDiagnosticTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildDownloadDirectoryCandidates(
  platform: DesktopPlatform,
  homeDirRaw: string,
): string[] {
  const homeDir = homeDirRaw.trim();
  const delimiter = platform === "windows" ? "\\" : "/";
  const candidates: string[] = [];

  const pushCandidate = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (homeDir) {
    const hasTrailingDelimiter =
      homeDir.endsWith("/") || homeDir.endsWith("\\");
    const base = hasTrailingDelimiter ? homeDir.slice(0, -1) : homeDir;
    pushCandidate(`${base}${delimiter}Downloads`);
    if (platform === "windows") {
      pushCandidate(`${base}\\downloads`);
    }
    pushCandidate(base);
  }

  if (platform === "windows") {
    pushCandidate("C:\\Users\\Public\\Downloads");
  }
  if (platform === "linux") {
    pushCandidate("/home");
  }
  if (platform === "macos") {
    pushCandidate("/Users");
  }

  return candidates;
}
