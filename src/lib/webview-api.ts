/**
 * Webview 管理 API
 *
 * 提供与 Tauri 后端 webview 命令交互的 TypeScript 接口。
 * 使用 Tauri 2.x 的 multiwebview 功能创建独立的浏览器窗口。
 *
 * @module lib/webview-api
 */

import { safeInvoke } from "@/lib/dev-bridge";

/**
 * Webview 面板信息
 */
export interface WebviewPanelInfo {
  /** 面板 ID */
  id: string;
  /** 当前 URL */
  url: string;
  /** 面板标题 */
  title: string;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/**
 * 创建 webview 面板的请求参数
 */
export interface CreateWebviewRequest {
  /** 面板 ID（唯一标识） */
  panel_id: string;
  /** 要加载的 URL */
  url: string;
  /** 面板标题（可选） */
  title?: string;
  /** X 坐标（相对于主窗口） */
  x: number;
  /** Y 坐标（相对于主窗口） */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** Profile 隔离键（可选） */
  profile_key?: string;
  /** 是否启用持久化 profile（可选） */
  persistent_profile?: boolean;
}

/**
 * 创建 webview 面板的响应
 */
export interface CreateWebviewResponse {
  /** 是否成功 */
  success: boolean;
  /** 面板 ID */
  panel_id: string;
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * 启动外部 Chrome Profile 的请求参数
 */
export interface OpenChromeProfileRequest {
  /** Profile 隔离键 */
  profile_key: string;
  /** 要打开的 URL */
  url: string;
  /** 浏览器启动级选项 */
  launch_options?: ChromeProfileLaunchOptions;
}

export interface ChromeProfileLaunchOptions {
  proxy_server?: string;
  language?: string;
}

/**
 * 启动外部 Chrome Profile 的响应
 */
export interface OpenChromeProfileResponse {
  /** 是否成功 */
  success: boolean;
  /** 是否复用已存在会话 */
  reused?: boolean;
  /** 浏览器来源 */
  browser_source?: "system" | "playwright";
  /** 浏览器可执行文件路径 */
  browser_path?: string;
  /** Profile 目录 */
  profile_dir?: string;
  /** 远程调试端口 */
  remote_debugging_port?: number;
  /** Chrome 进程 PID */
  pid?: number;
  /** DevTools HTTP URL */
  devtools_http_url?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * Chrome Profile 会话信息
 */
export interface ChromeProfileSessionInfo {
  profile_key: string;
  browser_source: "system" | "playwright";
  browser_path: string;
  profile_dir: string;
  remote_debugging_port: number;
  pid: number;
  started_at: string;
  last_url: string;
}

export type BrowserProfileTransportKind = "managed_cdp" | "existing_session";

export interface BrowserProfileRecord {
  id: string;
  profile_key: string;
  name: string;
  description: string | null;
  site_scope: string | null;
  launch_url: string | null;
  transport_kind: BrowserProfileTransportKind;
  profile_dir: string;
  managed_profile_dir: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
}

export interface SaveBrowserProfileRequest {
  id?: string;
  profile_key: string;
  name: string;
  description?: string;
  site_scope?: string;
  launch_url?: string;
  transport_kind?: BrowserProfileTransportKind;
}

export interface BrowserEnvironmentPresetRecord {
  id: string;
  name: string;
  description: string | null;
  proxy_server: string | null;
  timezone_id: string | null;
  locale: string | null;
  accept_language: string | null;
  geolocation_lat: number | null;
  geolocation_lng: number | null;
  geolocation_accuracy_m: number | null;
  user_agent: string | null;
  platform: string | null;
  viewport_width: number | null;
  viewport_height: number | null;
  device_scale_factor: number | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
}

export interface SaveBrowserEnvironmentPresetRequest {
  id?: string;
  name: string;
  description?: string;
  proxy_server?: string;
  timezone_id?: string;
  locale?: string;
  accept_language?: string;
  geolocation_lat?: number;
  geolocation_lng?: number;
  geolocation_accuracy_m?: number;
  user_agent?: string;
  platform?: string;
  viewport_width?: number;
  viewport_height?: number;
  device_scale_factor?: number;
}

export interface BrowserEnvironmentLaunchConfig {
  preset_id?: string;
  preset_name?: string;
  proxy_server?: string;
  timezone_id?: string;
  locale?: string;
  accept_language?: string;
  geolocation_lat?: number;
  geolocation_lng?: number;
  geolocation_accuracy_m?: number;
  user_agent?: string;
  platform?: string;
  viewport_width?: number;
  viewport_height?: number;
  device_scale_factor?: number;
}

export interface ChromeBridgeEndpointInfo {
  server_running: boolean;
  host: string;
  port: number;
  observer_ws_url: string;
  control_ws_url: string;
  bridge_key: string;
}

export interface ChromeBridgePageInfo {
  title?: string;
  url?: string;
  markdown: string;
  updated_at: string;
}

export interface ChromeBridgeObserverSnapshot {
  client_id: string;
  profile_key: string;
  connected_at: string;
  user_agent?: string;
  last_heartbeat_at?: string;
  last_page_info?: ChromeBridgePageInfo;
}

export interface ChromeBridgeControlSnapshot {
  client_id: string;
  connected_at: string;
  user_agent?: string;
}

export interface ChromeBridgePendingCommandSnapshot {
  request_id: string;
  source_type: "api" | "control";
  command: string;
  observer_client_id: string;
  wait_for_page_info: boolean;
  command_completed: boolean;
  created_at: string;
}

export interface ChromeBridgeStatusSnapshot {
  observer_count: number;
  control_count: number;
  pending_command_count: number;
  observers: ChromeBridgeObserverSnapshot[];
  controls: ChromeBridgeControlSnapshot[];
  pending_commands: ChromeBridgePendingCommandSnapshot[];
}

export interface ChromeBridgeCommandRequest {
  profile_key?: string;
  command: string;
  target?: string;
  text?: string;
  url?: string;
  payload?: unknown;
  wait_for_page_info?: boolean;
  timeout_ms?: number;
}

export interface ChromeBridgeCommandResult {
  success: boolean;
  request_id: string;
  command: string;
  message?: string;
  error?: string;
  page_info?: ChromeBridgePageInfo;
  data?: unknown;
}

export type BrowserBackendType =
  | "aster_compat"
  | "lime_extension_bridge"
  | "cdp_direct";

export interface BrowserBackendPolicy {
  priority: BrowserBackendType[];
  auto_fallback: boolean;
}

export interface BrowserBackendStatusItem {
  backend: BrowserBackendType;
  available: boolean;
  reason?: string;
  capabilities: string[];
}

export interface BrowserBackendsStatusSnapshot {
  policy: BrowserBackendPolicy;
  bridge_observer_count: number;
  bridge_control_count: number;
  running_profile_count: number;
  cdp_alive_profile_count: number;
  aster_native_host_supported: boolean;
  aster_native_host_configured: boolean;
  backends: BrowserBackendStatusItem[];
}

export interface BrowserActionRequest {
  profile_key?: string;
  backend?: BrowserBackendType;
  action: string;
  args?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface BrowserActionAttempt {
  backend: BrowserBackendType;
  success: boolean;
  message: string;
}

export interface BrowserActionResult {
  success: boolean;
  backend?: BrowserBackendType;
  session_id?: string;
  target_id?: string;
  action: string;
  request_id: string;
  data?: unknown;
  error?: string;
  attempts: BrowserActionAttempt[];
}

export interface SiteAdapterDefinition {
  name: string;
  domain: string;
  description: string;
  read_only: boolean;
  capabilities: string[];
  input_schema: Record<string, unknown>;
  example_args: Record<string, unknown>;
  example: string;
  auth_hint?: string;
  source_kind?: "bundled" | "server_synced";
  source_version?: string;
}

export interface SiteAdapterRecommendation {
  adapter: SiteAdapterDefinition;
  reason: string;
  profile_key?: string;
  target_id?: string;
  entry_url: string;
  score: number;
}

export interface SiteAdapterCatalogStatus {
  exists: boolean;
  source_kind: "bundled" | "server_synced";
  registry_version: number;
  directory?: string;
  catalog_version?: string;
  tenant_id?: string;
  synced_at?: string;
  adapter_count: number;
}

export interface RunSiteAdapterRequest {
  adapter_name: string;
  args?: Record<string, unknown>;
  profile_key?: string;
  target_id?: string;
  timeout_ms?: number;
  content_id?: string;
  project_id?: string;
  save_title?: string;
}

export interface SiteAdapterRunResult {
  ok: boolean;
  adapter: string;
  domain: string;
  profile_key: string;
  session_id?: string;
  target_id?: string;
  entry_url: string;
  source_url?: string;
  data?: unknown;
  error_code?: string;
  error_message?: string;
  auth_hint?: string;
  report_hint?: string;
  saved_content?: SavedSiteAdapterContent;
  saved_project_id?: string;
  saved_by?:
    | "explicit_project"
    | "context_project"
    | "explicit_content"
    | "context_content";
  save_skipped_project_id?: string;
  save_skipped_by?:
    | "explicit_project"
    | "context_project"
    | "explicit_content"
    | "context_content";
  save_error_message?: string;
}

export interface SaveSiteAdapterResultRequest {
  project_id?: string;
  content_id?: string;
  save_title?: string;
  run_request: RunSiteAdapterRequest;
  result: SiteAdapterRunResult;
}

export interface SavedSiteAdapterContent {
  content_id: string;
  project_id: string;
  title: string;
}

export type BrowserRuntimeAuditKind = "action" | "launch";

export interface BrowserRuntimeAuditRecord {
  id: string;
  created_at: string;
  kind: BrowserRuntimeAuditKind;
  action?: string;
  profile_key?: string;
  profile_id?: string;
  requested_backend?: BrowserBackendType;
  selected_backend?: BrowserBackendType;
  success: boolean;
  error?: string;
  attempts?: BrowserActionAttempt[];
  environment_preset_id?: string;
  environment_preset_name?: string;
  target_id?: string;
  session_id?: string;
  url?: string;
  reused?: boolean;
  open_window?: boolean;
  stream_mode?: BrowserStreamMode;
  browser_source?: string;
  remote_debugging_port?: number;
}

export type BrowserActionAuditRecord = BrowserRuntimeAuditRecord;

export interface CdpTargetInfo {
  id: string;
  title: string;
  url: string;
  target_type: string;
  web_socket_debugger_url?: string;
  devtools_frontend_url?: string;
}

export interface BrowserPageInfo {
  title: string;
  url: string;
  markdown: string;
  updated_at: string;
}

export type BrowserStreamMode = "events" | "frames" | "both";
export type BrowserSessionLifecycleState =
  | "launching"
  | "live"
  | "waiting_for_human"
  | "human_controlling"
  | "agent_resuming"
  | "closed"
  | "failed";
export type BrowserControlMode = "agent" | "human" | "shared";
export type BrowserTransportKind = "cdp_frames";

export interface CdpSessionState {
  session_id: string;
  profile_key: string;
  environment_preset_id?: string;
  environment_preset_name?: string;
  target_id: string;
  target_title: string;
  target_url: string;
  remote_debugging_port: number;
  ws_debugger_url: string;
  devtools_frontend_url?: string;
  stream_mode?: BrowserStreamMode;
  transport_kind: BrowserTransportKind;
  lifecycle_state: BrowserSessionLifecycleState;
  control_mode: BrowserControlMode;
  human_reason?: string;
  last_page_info?: BrowserPageInfo;
  last_event_at?: string;
  last_frame_at?: string;
  last_error?: string;
  created_at: string;
  connected: boolean;
}

export type BrowserEvent =
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "session_opened";
      profile_key: string;
      target_id: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "session_closed";
      reason: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "session_error";
      error: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "session_state_changed";
      lifecycle_state: BrowserSessionLifecycleState;
      control_mode: BrowserControlMode;
      human_reason?: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "page_info_changed";
      title: string;
      url: string;
      markdown: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "console_message";
      level: string;
      text: string;
      timestamp: number;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "network_request";
      request_id: string;
      url: string;
      method: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "network_response";
      request_id: string;
      url: string;
      status: number;
      mime_type: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "network_failed";
      request_id: string;
      error_text: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "frame_chunk";
      data: string;
      metadata: {
        width: number;
        height: number;
        timestamp: number;
        sequence: number;
      };
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "frame_dropped";
      reason: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "command_started";
      command_id: number;
      action: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "command_completed";
      command_id: number;
      action: string;
    }
  | {
      session_id: string;
      sequence: number;
      occurred_at: string;
      type: "command_failed";
      command_id: number;
      action: string;
      error: string;
    };

export interface BrowserEventBufferSnapshot {
  events: BrowserEvent[];
  next_cursor: number;
}

export interface LaunchBrowserSessionRequest {
  profile_id?: string;
  profile_key?: string;
  url?: string;
  environment_preset_id?: string;
  environment?: BrowserEnvironmentLaunchConfig;
  target_id?: string;
  open_window?: boolean;
  stream_mode?: BrowserStreamMode;
}

export interface LaunchBrowserProfileRuntimeAssistRequest {
  id: string;
  url?: string;
  environment_preset_id?: string;
  target_id?: string;
  open_window?: boolean;
  stream_mode?: BrowserStreamMode;
}

export interface LaunchBrowserRuntimeAssistRequest {
  profile_key: string;
  url: string;
  profile_id?: string;
  environment?: BrowserEnvironmentLaunchConfig;
  target_id?: string;
  open_window?: boolean;
  stream_mode?: BrowserStreamMode;
}

export interface BrowserSessionLaunchResponse {
  profile: OpenChromeProfileResponse;
  session: CdpSessionState;
}

export type BrowserRuntimeAssistLaunchResponse = BrowserSessionLaunchResponse;

export interface UpdateBrowserSessionControlRequest {
  session_id: string;
  human_reason?: string;
}

/**
 * 创建一个新的 webview 窗口来显示外部 URL
 *
 * @param request - 创建请求参数
 * @returns 创建结果
 */
export async function createWebviewPanel(
  request: CreateWebviewRequest,
): Promise<CreateWebviewResponse> {
  return safeInvoke<CreateWebviewResponse>("create_webview_panel", { request });
}

/**
 * 使用外部 Chrome + 独立 Profile 打开 URL
 */
export async function openChromeProfileWindow(
  request: OpenChromeProfileRequest,
): Promise<OpenChromeProfileResponse> {
  return safeInvoke<OpenChromeProfileResponse>("open_chrome_profile_window", {
    request,
  });
}

/**
 * 获取当前运行中的 Chrome Profile 会话
 */
export async function getChromeProfileSessions(): Promise<
  ChromeProfileSessionInfo[]
> {
  return safeInvoke<ChromeProfileSessionInfo[]>("get_chrome_profile_sessions");
}

/**
 * 关闭指定的 Chrome Profile 会话
 */
export async function closeChromeProfileSession(
  profileKey: string,
): Promise<boolean> {
  return safeInvoke<boolean>("close_chrome_profile_session", {
    profileKey,
  });
}

export async function listBrowserProfiles(params?: {
  include_archived?: boolean;
}): Promise<BrowserProfileRecord[]> {
  return safeInvoke<BrowserProfileRecord[]>("list_browser_profiles_cmd", {
    request: {
      include_archived: params?.include_archived ?? false,
    },
  });
}

export async function saveBrowserProfile(
  request: SaveBrowserProfileRequest,
): Promise<BrowserProfileRecord> {
  return safeInvoke<BrowserProfileRecord>("save_browser_profile_cmd", {
    request,
  });
}

export async function listBrowserEnvironmentPresets(params?: {
  include_archived?: boolean;
}): Promise<BrowserEnvironmentPresetRecord[]> {
  return safeInvoke<BrowserEnvironmentPresetRecord[]>(
    "list_browser_environment_presets_cmd",
    {
      request: {
        include_archived: params?.include_archived ?? false,
      },
    },
  );
}

export async function saveBrowserEnvironmentPreset(
  request: SaveBrowserEnvironmentPresetRequest,
): Promise<BrowserEnvironmentPresetRecord> {
  return safeInvoke<BrowserEnvironmentPresetRecord>(
    "save_browser_environment_preset_cmd",
    {
      request,
    },
  );
}

export async function archiveBrowserEnvironmentPreset(
  id: string,
): Promise<boolean> {
  return safeInvoke<boolean>("archive_browser_environment_preset_cmd", {
    request: { id },
  });
}

export async function restoreBrowserEnvironmentPreset(
  id: string,
): Promise<boolean> {
  return safeInvoke<boolean>("restore_browser_environment_preset_cmd", {
    request: { id },
  });
}

export async function archiveBrowserProfile(id: string): Promise<boolean> {
  return safeInvoke<boolean>("archive_browser_profile_cmd", {
    request: { id },
  });
}

export async function restoreBrowserProfile(id: string): Promise<boolean> {
  return safeInvoke<boolean>("restore_browser_profile_cmd", {
    request: { id },
  });
}

/**
 * 获取 ChromeBridge 端点信息（用于扩展配置）
 */
export async function getChromeBridgeEndpointInfo(): Promise<ChromeBridgeEndpointInfo> {
  return safeInvoke<ChromeBridgeEndpointInfo>(
    "get_chrome_bridge_endpoint_info",
  );
}

/**
 * 获取 ChromeBridge 当前连接状态
 */
export async function getChromeBridgeStatus(): Promise<ChromeBridgeStatusSnapshot> {
  return safeInvoke<ChromeBridgeStatusSnapshot>("get_chrome_bridge_status");
}

/**
 * 通过 ChromeBridge 发送测试命令
 */
export async function chromeBridgeExecuteCommand(
  request: ChromeBridgeCommandRequest,
): Promise<ChromeBridgeCommandResult> {
  return safeInvoke<ChromeBridgeCommandResult>(
    "chrome_bridge_execute_command",
    {
      request,
    },
  );
}

export async function getBrowserBackendPolicy(): Promise<BrowserBackendPolicy> {
  return safeInvoke<BrowserBackendPolicy>("get_browser_backend_policy");
}

export async function setBrowserBackendPolicy(
  policy: BrowserBackendPolicy,
): Promise<BrowserBackendPolicy> {
  return safeInvoke<BrowserBackendPolicy>("set_browser_backend_policy", {
    policy,
  });
}

export async function getBrowserBackendsStatus(): Promise<BrowserBackendsStatusSnapshot> {
  return safeInvoke<BrowserBackendsStatusSnapshot>(
    "get_browser_backends_status",
  );
}

export async function listCdpTargets(
  profileKey?: string,
): Promise<CdpTargetInfo[]> {
  return safeInvoke<CdpTargetInfo[]>("list_cdp_targets", {
    request: {
      profile_key: profileKey,
    },
  });
}

export async function openCdpSession(params: {
  profile_key: string;
  target_id?: string;
}): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("open_cdp_session", {
    request: params,
  });
}

export async function closeCdpSession(sessionId: string): Promise<boolean> {
  return safeInvoke<boolean>("close_cdp_session", {
    request: {
      session_id: sessionId,
    },
  });
}

export async function startBrowserStream(params: {
  session_id: string;
  mode: BrowserStreamMode;
}): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("start_browser_stream", {
    request: params,
  });
}

export async function stopBrowserStream(
  sessionId: string,
): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("stop_browser_stream", {
    request: {
      session_id: sessionId,
    },
  });
}

export async function getBrowserSessionState(
  sessionId: string,
): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("get_browser_session_state", {
    request: {
      session_id: sessionId,
    },
  });
}

export async function takeOverBrowserSession(
  request: UpdateBrowserSessionControlRequest,
): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("take_over_browser_session", {
    request,
  });
}

export async function releaseBrowserSession(
  request: UpdateBrowserSessionControlRequest,
): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("release_browser_session", {
    request,
  });
}

export async function resumeBrowserSession(
  request: UpdateBrowserSessionControlRequest,
): Promise<CdpSessionState> {
  return safeInvoke<CdpSessionState>("resume_browser_session", {
    request,
  });
}

export async function getBrowserEventBuffer(params: {
  session_id: string;
  cursor?: number;
}): Promise<BrowserEventBufferSnapshot> {
  return safeInvoke<BrowserEventBufferSnapshot>("get_browser_event_buffer", {
    request: params,
  });
}

export async function openBrowserRuntimeDebuggerWindow(request?: {
  session_id?: string;
  profile_key?: string;
}): Promise<void> {
  return safeInvoke<void>("open_browser_runtime_debugger_window", {
    request,
  });
}

export async function closeBrowserRuntimeDebuggerWindow(): Promise<void> {
  return safeInvoke<void>("close_browser_runtime_debugger_window");
}

export async function launchBrowserSession(
  request: LaunchBrowserSessionRequest,
): Promise<BrowserSessionLaunchResponse> {
  return safeInvoke<BrowserSessionLaunchResponse>("launch_browser_session", {
    request,
  });
}

export async function launchBrowserProfileRuntimeAssist(
  request: LaunchBrowserProfileRuntimeAssistRequest,
): Promise<BrowserRuntimeAssistLaunchResponse> {
  return launchBrowserSession({
    profile_id: request.id,
    url: request.url,
    environment_preset_id: request.environment_preset_id,
    target_id: request.target_id,
    open_window: request.open_window,
    stream_mode: request.stream_mode,
  });
}

export async function launchBrowserRuntimeAssist(
  request: LaunchBrowserRuntimeAssistRequest,
): Promise<BrowserRuntimeAssistLaunchResponse> {
  return launchBrowserSession({
    profile_id: request.profile_id,
    profile_key: request.profile_key,
    url: request.url,
    environment: request.environment,
    target_id: request.target_id,
    open_window: request.open_window,
    stream_mode: request.stream_mode,
  });
}

export async function browserExecuteAction(
  request: BrowserActionRequest,
): Promise<BrowserActionResult> {
  return safeInvoke<BrowserActionResult>("browser_execute_action", { request });
}

export async function siteListAdapters(): Promise<SiteAdapterDefinition[]> {
  return safeInvoke<SiteAdapterDefinition[]>("site_list_adapters");
}

export async function siteRecommendAdapters(
  limit?: number,
): Promise<SiteAdapterRecommendation[]> {
  return safeInvoke<SiteAdapterRecommendation[]>("site_recommend_adapters", {
    request: { limit },
  });
}

export async function siteSearchAdapters(
  query: string,
): Promise<SiteAdapterDefinition[]> {
  return safeInvoke<SiteAdapterDefinition[]>("site_search_adapters", {
    request: { query },
  });
}

export async function siteGetAdapterInfo(
  name: string,
): Promise<SiteAdapterDefinition> {
  return safeInvoke<SiteAdapterDefinition>("site_get_adapter_info", {
    request: { name },
  });
}

export async function siteGetAdapterCatalogStatus(): Promise<SiteAdapterCatalogStatus> {
  return safeInvoke<SiteAdapterCatalogStatus>(
    "site_get_adapter_catalog_status",
  );
}

export async function siteApplyAdapterCatalogBootstrap(
  payload: unknown,
): Promise<SiteAdapterCatalogStatus> {
  return safeInvoke<SiteAdapterCatalogStatus>(
    "site_apply_adapter_catalog_bootstrap",
    {
      request: {
        payload,
      },
    },
  );
}

export async function siteClearAdapterCatalogCache(): Promise<SiteAdapterCatalogStatus> {
  return safeInvoke<SiteAdapterCatalogStatus>(
    "site_clear_adapter_catalog_cache",
  );
}

export async function siteRunAdapter(
  request: RunSiteAdapterRequest,
): Promise<SiteAdapterRunResult> {
  return safeInvoke<SiteAdapterRunResult>("site_run_adapter", { request });
}

export async function siteDebugRunAdapter(
  request: RunSiteAdapterRequest,
): Promise<SiteAdapterRunResult> {
  return safeInvoke<SiteAdapterRunResult>("site_debug_run_adapter", {
    request,
  });
}

export async function siteSaveAdapterResult(
  request: SaveSiteAdapterResultRequest,
): Promise<SavedSiteAdapterContent> {
  return safeInvoke<SavedSiteAdapterContent>("site_save_adapter_result", {
    request,
  });
}

export async function getBrowserRuntimeAuditLogs(
  limit?: number,
): Promise<BrowserRuntimeAuditRecord[]> {
  return safeInvoke<BrowserRuntimeAuditRecord[]>(
    "get_browser_action_audit_logs",
    {
      limit,
    },
  );
}

export async function getBrowserActionAuditLogs(
  limit?: number,
): Promise<BrowserActionAuditRecord[]> {
  return getBrowserRuntimeAuditLogs(limit);
}

/**
 * 关闭 webview 面板
 *
 * 尝试多种方法关闭 webview：
 * 1. 使用 Tauri JavaScript API 直接关闭
 * 2. 使用后端命令关闭
 *
 * @param panelId - 面板 ID
 * @returns 是否成功
 */
export async function closeWebviewPanel(panelId: string): Promise<boolean> {
  console.log("[webview-api] 尝试关闭 webview:", panelId);

  // 统一走后端命令，避免前端在启动期提前加载 Tauri webview/window/event 链路。
  try {
    const result = await safeInvoke<boolean>("close_webview_panel", {
      panelId,
    });
    console.log("[webview-api] 后端命令关闭结果:", result);
    return result;
  } catch (e) {
    console.error("[webview-api] 后端命令关闭失败:", e);
    return false;
  }
}

/**
 * 导航到新 URL
 *
 * @param panelId - 面板 ID
 * @param url - 新 URL
 * @returns 是否成功
 */
export async function navigateWebviewPanel(
  panelId: string,
  url: string,
): Promise<boolean> {
  return safeInvoke<boolean>("navigate_webview_panel", {
    panelId,
    url,
  });
}

/**
 * 获取所有活跃的 webview 面板
 *
 * @returns 面板列表
 */
export async function getWebviewPanels(): Promise<WebviewPanelInfo[]> {
  return safeInvoke<WebviewPanelInfo[]>("get_webview_panels");
}

/**
 * 聚焦指定的 webview 面板
 *
 * @param panelId - 面板 ID
 * @returns 是否成功
 */
export async function focusWebviewPanel(panelId: string): Promise<boolean> {
  return safeInvoke<boolean>("focus_webview_panel", { panelId });
}

/**
 * 调整 webview 面板大小和位置
 *
 * @param panelId - 面板 ID
 * @param x - 新的 X 坐标
 * @param y - 新的 Y 坐标
 * @param width - 新的宽度
 * @param height - 新的高度
 * @returns 是否成功
 */
export async function resizeWebviewPanel(
  panelId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<boolean> {
  return safeInvoke<boolean>("resize_webview_panel", {
    panelId,
    x,
    y,
    width,
    height,
  });
}

/**
 * 生成唯一的面板 ID
 *
 * @returns 唯一 ID
 */
export function generatePanelId(): string {
  return `webview-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
