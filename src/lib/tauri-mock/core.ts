/**
 * Mock for @tauri-apps/api/core
 */

import type { AutomationJobRecord } from "../api/automation";
import type { CompanionPetStatus } from "../api/companion";
import type { AgentRun } from "../api/executionRun";
import type {
  SceneAppCatalog,
  SceneAppDescriptor,
  SceneAppPlanResult,
  SceneAppRuntimeAdapterPlan,
  SceneAppScorecard,
} from "../api/sceneapp";

import {
  invokeViaHttp,
  isDevBridgeAvailable,
  normalizeDevBridgeError,
} from "../dev-bridge/http-client";
import agentCommandCatalog from "../governance/agentCommandCatalog.json";
import { shouldPreferMockInBrowser } from "../dev-bridge/mockPriorityCommands";

// 模拟的命令处理器
const mockCommands = new Map<string, (...args: any[]) => any>();
const shouldLogMockInfo = import.meta.env.MODE !== "test";

function logMockInfo(...args: Parameters<typeof console.log>) {
  if (!shouldLogMockInfo) {
    return;
  }
  console.log(...args);
}

const createDeprecatedCommandMock =
  (command: string, replacement: string) => () => {
    throw new Error(
      `命令 ${command} 已废弃，请迁移到 ${replacement}。Mock 不再为旧链路伪造成功结果。`,
    );
  };

const deprecatedAgentCommandReplacements =
  agentCommandCatalog.deprecatedCommandReplacements as Record<string, string>;

const deprecatedAgentCommandMocks = Object.fromEntries(
  Object.entries(deprecatedAgentCommandReplacements).map(
    ([command, replacement]) => [
      command,
      createDeprecatedCommandMock(command, replacement),
    ],
  ),
) as Record<string, () => never>;

function normalizeMockMediaTaskId(taskRef?: string): string {
  const normalized = (taskRef || "task-image-mock-1")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || "task-image-mock-1";
}

function buildMockMediaTaskOutput(
  args: any,
  overrides?: Partial<Record<string, unknown>>,
) {
  const request = args?.request ?? args ?? {};
  const taskId = normalizeMockMediaTaskId(
    typeof request.taskRef === "string" ? request.taskRef : undefined,
  );
  const projectRootPath =
    typeof request.projectRootPath === "string" &&
    request.projectRootPath.trim()
      ? request.projectRootPath.trim()
      : "/mock/workspace";
  const prompt =
    typeof request.prompt === "string" && request.prompt.trim()
      ? request.prompt.trim()
      : "mock image task";
  const status =
    typeof overrides?.status === "string" ? overrides.status : "pending_submit";
  const normalizedStatus =
    typeof overrides?.normalized_status === "string"
      ? overrides.normalized_status
      : status === "cancelled"
        ? "cancelled"
        : status === "failed"
          ? "failed"
          : "pending";
  const attemptCount =
    typeof overrides?.attempt_count === "number" ? overrides.attempt_count : 1;
  const currentAttemptId =
    typeof overrides?.current_attempt_id === "string"
      ? overrides.current_attempt_id
      : `attempt-${attemptCount}`;
  const createdAt = "2026-04-04T00:00:00.000Z";
  const path = `.lime/tasks/image_generate/${taskId}.json`;
  const record = {
    task_id: taskId,
    task_type: "image_generate",
    task_family: "image",
    title: request.title ?? null,
    summary: "mock media task",
    payload: {
      prompt,
      mode: request.mode ?? "generate",
      size: request.size ?? "1024x1024",
      count: request.count ?? 1,
    },
    status,
    normalized_status: normalizedStatus,
    created_at: createdAt,
    current_attempt_id: currentAttemptId,
    retry_count: Math.max(attemptCount - 1, 0),
    attempts: Array.from({ length: attemptCount }, (_, index) => ({
      attempt_id: `attempt-${index + 1}`,
      attempt_index: index + 1,
      status: index === attemptCount - 1 ? status : "cancelled",
      input_snapshot: {
        prompt,
      },
    })),
  };

  return {
    success: true,
    task_id: taskId,
    task_type: "image_generate",
    task_family: "image",
    status,
    normalized_status: normalizedStatus,
    current_attempt_id: currentAttemptId,
    attempt_count: attemptCount,
    path,
    absolute_path: `${projectRootPath}/${path}`,
    artifact_path: path,
    absolute_artifact_path: `${projectRootPath}/${path}`,
    reused_existing: false,
    record,
    ...overrides,
  };
}

type MockBrowserProfileRecord = {
  id: string;
  profile_key: string;
  name: string;
  description: string | null;
  site_scope: string | null;
  launch_url: string | null;
  transport_kind: "managed_cdp" | "existing_session";
  profile_dir: string;
  managed_profile_dir: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
};

type MockBrowserEnvironmentPresetRecord = {
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
};

type MockBrowserConnectorSettings = {
  enabled: boolean;
  install_root_dir: string | null;
  install_dir: string | null;
  browser_action_capabilities: Array<{
    key: string;
    label: string;
    description: string;
    group: string;
    enabled: boolean;
  }>;
  system_connectors: Array<{
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    available: boolean;
    visible: boolean;
    authorization_status: string;
    last_error: string | null;
    capabilities: string[];
  }>;
};

type MockBrowserConnectorInstallStatus = {
  status: string;
  install_root_dir: string | null;
  install_dir: string | null;
  bundled_name: string;
  bundled_version: string;
  installed_name: string | null;
  installed_version: string | null;
  message: string | null;
};

type MockToolSpec = {
  name: string;
  description: string;
  capabilities: string[];
  source: string;
  tags: string[];
  input_examples_count: number;
  permission_plane?: "session_allowlist" | "parameter_restricted";
  workspace_default_allow?: boolean;
  execution_warning_policy?: string;
  execution_restriction_profile?: string;
  execution_sandbox_profile?: string;
};

const DEFAULT_MOCK_BROWSER_ACTION_CAPABILITIES = [
  {
    key: "tabs_context_mcp",
    label: "标签页概览",
    description: "读取当前已附着标签页的上下文摘要。",
    group: "read",
    enabled: true,
  },
  {
    key: "list_tabs",
    label: "列出标签页",
    description: "列出当前浏览器标签页。",
    group: "read",
    enabled: true,
  },
  {
    key: "tabs_create_mcp",
    label: "新建标签页",
    description: "创建新的浏览器标签页。",
    group: "write",
    enabled: true,
  },
  {
    key: "read_page",
    label: "页面快照",
    description: "抓取当前页面快照。",
    group: "read",
    enabled: true,
  },
  {
    key: "get_page_text",
    label: "页面文本",
    description: "读取当前页面文本内容。",
    group: "read",
    enabled: true,
  },
  {
    key: "get_page_info",
    label: "页面信息",
    description: "读取页面标题、URL 与快照信息。",
    group: "read",
    enabled: true,
  },
  {
    key: "find",
    label: "页面内查找",
    description: "在当前页面中查找文本。",
    group: "read",
    enabled: true,
  },
  {
    key: "read_console_messages",
    label: "控制台消息",
    description: "读取浏览器控制台消息。",
    group: "read",
    enabled: true,
  },
  {
    key: "read_network_requests",
    label: "网络请求",
    description: "读取页面网络请求记录。",
    group: "read",
    enabled: true,
  },
  {
    key: "navigate",
    label: "导航",
    description: "导航到目标地址。",
    group: "write",
    enabled: true,
  },
  {
    key: "open_url",
    label: "打开链接",
    description: "直接打开目标链接。",
    group: "write",
    enabled: true,
  },
  {
    key: "click",
    label: "点击元素",
    description: "点击页面元素。",
    group: "write",
    enabled: true,
  },
  {
    key: "type",
    label: "输入文本",
    description: "向当前页面输入文本。",
    group: "write",
    enabled: true,
  },
  {
    key: "form_input",
    label: "表单输入",
    description: "按字段填写页面表单。",
    group: "write",
    enabled: true,
  },
  {
    key: "switch_tab",
    label: "切换标签页",
    description: "切换当前操作标签页。",
    group: "write",
    enabled: true,
  },
  {
    key: "scroll_page",
    label: "滚动页面",
    description: "滚动当前页面或容器。",
    group: "write",
    enabled: true,
  },
  {
    key: "refresh_page",
    label: "刷新页面",
    description: "刷新当前页面。",
    group: "write",
    enabled: true,
  },
  {
    key: "go_back",
    label: "返回上一页",
    description: "返回上一页。",
    group: "write",
    enabled: true,
  },
  {
    key: "go_forward",
    label: "前进到下一页",
    description: "前进到下一页。",
    group: "write",
    enabled: true,
  },
  {
    key: "javascript",
    label: "执行脚本",
    description: "在当前页面执行脚本。",
    group: "write",
    enabled: true,
  },
] as const;

const mockBrowserProfiles: MockBrowserProfileRecord[] = [
  {
    id: "browser-profile-general",
    profile_key: "general_browser_assist",
    name: "通用浏览器资料",
    description: "默认浏览器协助资料",
    site_scope: "通用",
    launch_url: "https://www.google.com/",
    transport_kind: "managed_cdp",
    profile_dir: "/tmp/lime/chrome_profiles/general_browser_assist",
    managed_profile_dir: "/tmp/lime/chrome_profiles/general_browser_assist",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_used_at: null,
    archived_at: null,
  },
];

const mockBrowserEnvironmentPresets: MockBrowserEnvironmentPresetRecord[] = [
  {
    id: "browser-environment-us-desktop",
    name: "美区桌面",
    description: "美国住宅代理 + 桌面视口",
    proxy_server: "http://127.0.0.1:7890",
    timezone_id: "America/Los_Angeles",
    locale: "en-US",
    accept_language: "en-US,en;q=0.9",
    geolocation_lat: 37.7749,
    geolocation_lng: -122.4194,
    geolocation_accuracy_m: 100,
    user_agent: "Mozilla/5.0",
    platform: "MacIntel",
    viewport_width: 1440,
    viewport_height: 900,
    device_scale_factor: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_used_at: null,
    archived_at: null,
  },
];

let mockBrowserConnectorSettings: MockBrowserConnectorSettings = {
  enabled: true,
  install_root_dir: "/mock/path/to/connectors",
  install_dir: "/mock/path/to/connectors/Lime Browser Connector",
  browser_action_capabilities: DEFAULT_MOCK_BROWSER_ACTION_CAPABILITIES.map(
    (capability) => ({ ...capability }),
  ),
  system_connectors: [
    {
      id: "reminders",
      label: "提醒事项",
      description: "读取和管理你的提醒事项和任务列表。",
      enabled: false,
      available: true,
      visible: true,
      authorization_status: "not_determined",
      last_error: null,
      capabilities: ["list_reminders", "create_reminder", "update_reminder"],
    },
    {
      id: "calendar",
      label: "日历",
      description: "读取和管理你的日历事件。",
      enabled: false,
      available: true,
      visible: true,
      authorization_status: "not_determined",
      last_error: null,
      capabilities: ["list_events", "create_event", "update_event"],
    },
    {
      id: "notes",
      label: "备忘录",
      description: "读取和创建你的备忘录。",
      enabled: false,
      available: true,
      visible: true,
      authorization_status: "not_determined",
      last_error: null,
      capabilities: ["list_notes", "read_note", "create_note"],
    },
    {
      id: "mail",
      label: "邮件",
      description: "读取邮件和创建草稿。",
      enabled: false,
      available: true,
      visible: true,
      authorization_status: "not_determined",
      last_error: null,
      capabilities: ["list_mailboxes", "read_messages", "create_draft"],
    },
    {
      id: "contacts",
      label: "通讯录",
      description: "搜索、读取和创建联系人。",
      enabled: false,
      available: true,
      visible: true,
      authorization_status: "not_determined",
      last_error: null,
      capabilities: ["search_contacts", "read_contact", "create_contact"],
    },
  ],
};

function normalizeMockBrowserActionCapabilityKey(key: string) {
  if (key === "scroll") {
    return "scroll_page";
  }
  if (key === "javascript_tool") {
    return "javascript";
  }
  return key;
}

function filterMockBrowserBackendCapabilities(capabilities: string[]) {
  const enabledCapabilities = new Set(
    mockBrowserConnectorSettings.browser_action_capabilities
      .filter((capability) => capability.enabled)
      .map((capability) => capability.key),
  );
  return capabilities.filter((capability) => {
    const normalized = normalizeMockBrowserActionCapabilityKey(capability);
    return (
      !DEFAULT_MOCK_BROWSER_ACTION_CAPABILITIES.some(
        (item) => item.key === normalized,
      ) || enabledCapabilities.has(normalized)
    );
  });
}

function buildMockBrowserBackendsStatus() {
  return {
    policy: {
      priority: ["aster_compat", "lime_extension_bridge", "cdp_direct"],
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
        capabilities: filterMockBrowserBackendCapabilities([
          "navigate",
          "read_page",
          "tabs_context_mcp",
          "list_tabs",
        ]),
      },
      {
        backend: "lime_extension_bridge",
        available: true,
        capabilities: filterMockBrowserBackendCapabilities([
          "navigate",
          "read_page",
          "get_page_text",
          "find",
          "form_input",
          "tabs_context_mcp",
          "open_url",
          "click",
          "type",
          "scroll",
          "scroll_page",
          "get_page_info",
          "refresh_page",
          "go_back",
          "go_forward",
          "switch_tab",
          "list_tabs",
        ]),
      },
      {
        backend: "cdp_direct",
        available: true,
        capabilities: filterMockBrowserBackendCapabilities([
          "tabs_context_mcp",
          "navigate",
          "read_page",
          "get_page_text",
          "find",
          "click",
          "type",
          "scroll_page",
          "get_page_info",
          "read_console_messages",
          "read_network_requests",
          "javascript",
        ]),
      },
    ],
  };
}

let mockBrowserBackendsStatus = buildMockBrowserBackendsStatus();

let mockBrowserConnectorInstallStatus: MockBrowserConnectorInstallStatus = {
  status: "not_installed",
  install_root_dir: "/mock/path/to/connectors",
  install_dir: "/mock/path/to/connectors/Lime Browser Connector",
  bundled_name: "Lime Browser Connector",
  bundled_version: "0.1.0",
  installed_name: null,
  installed_version: null,
  message: "尚未导出浏览器连接器",
};

let mockChromeBridgeStatus = {
  observer_count: 0,
  control_count: 0,
  pending_command_count: 0,
  observers: [],
  controls: [],
  pending_commands: [],
};

const now = () => new Date().toISOString();
const mockBrowserSessionStates = new Map<string, any>();
let mockExistingSessionTabs = [
  {
    id: 101,
    index: 0,
    active: true,
    title: "微博首页",
    url: "https://weibo.com/home",
  },
  {
    id: 202,
    index: 1,
    active: false,
    title: "微博创作中心",
    url: "https://weibo.com/compose",
  },
];

const mockBundledSiteAdapters = [
  {
    name: "github/search",
    domain: "github.com",
    description: "按关键词采集 GitHub 仓库搜索结果。",
    read_only: true,
    capabilities: ["search", "repository", "research"],
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
        limit: {
          type: "integer",
          description: "返回条目数量上限",
        },
      },
      required: ["query"],
    },
    example_args: {
      query: "model context protocol",
      limit: 5,
    },
    example: 'github/search {"query":"model context protocol","limit":5}',
    auth_hint: "若需要完整结果，请先在浏览器中登录 GitHub。",
  },
  {
    name: "zhihu/hot",
    domain: "www.zhihu.com",
    description: "采集知乎热榜问题列表。",
    read_only: true,
    capabilities: ["hot", "feed", "research"],
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "返回条目数量上限",
        },
      },
      required: [],
    },
    example_args: {
      limit: 5,
    },
    example: 'zhihu/hot {"limit":5}',
    auth_hint: "请先在浏览器中登录知乎，再重试该命令。",
  },
];

const mockSiteRecommendations = [
  {
    adapter: mockBundledSiteAdapters[0],
    reason:
      "已检测到资料 research_attach 当前停留在 github.com，可直接复用已连接的 Chrome 上下文。",
    profile_key: "research_attach",
    target_id: "mock-target-1",
    entry_url:
      "https://github.com/search?q=model%20context%20protocol&type=repositories",
    score: 100,
  },
  {
    adapter: mockBundledSiteAdapters[1],
    reason:
      "资料 通用浏览器资料 已绑定站点范围 www.zhihu.com，可优先作为该适配器的执行上下文。",
    profile_key: "general_browser_assist",
    entry_url: "https://www.zhihu.com/hot",
    score: 72,
  },
];

let mockImportedSiteAdapters: any[] = [];
let mockServerSyncedSiteAdapters: any[] = [];

let mockSiteAdapterCatalogStatus: {
  exists: boolean;
  source_kind: "bundled" | "imported" | "server_synced";
  registry_version: number;
  directory: string;
  catalog_version?: string;
  tenant_id?: string;
  synced_at?: string;
  adapter_count: number;
} = {
  exists: false,
  source_kind: "bundled",
  registry_version: 1,
  directory: "/tmp/lime/site-adapters/server-synced",
  adapter_count: mockBundledSiteAdapters.length,
};

function getMockEffectiveSiteAdapters() {
  const merged = new Map<string, any>();
  for (const adapter of [
    ...mockBundledSiteAdapters,
    ...mockImportedSiteAdapters,
    ...mockServerSyncedSiteAdapters,
  ]) {
    const normalizedName = String(adapter?.name ?? "")
      .trim()
      .toLowerCase();
    if (!normalizedName) {
      continue;
    }
    merged.set(normalizedName, adapter);
  }
  return Array.from(merged.values());
}

function buildMockSiteCatalogStatus(
  sourceKind: "bundled" | "imported" | "server_synced",
  adapterCount: number,
  overrides?: Partial<{
    exists: boolean;
    registry_version: number;
    directory: string;
    catalog_version: string | null;
    tenant_id: string | null;
    synced_at: string | null;
  }>,
) {
  return {
    exists: overrides?.exists ?? sourceKind !== "bundled",
    source_kind: sourceKind,
    registry_version: overrides?.registry_version ?? 1,
    directory:
      overrides?.directory ??
      (sourceKind === "imported"
        ? "/tmp/lime/site-adapters/imported"
        : "/tmp/lime/site-adapters/server-synced"),
    catalog_version: overrides?.catalog_version ?? undefined,
    tenant_id: overrides?.tenant_id ?? undefined,
    synced_at: overrides?.synced_at ?? undefined,
    adapter_count: adapterCount,
  };
}

function normalizeMockSiteAdapterPayload(
  adapter: any,
  sourceKind: "imported" | "server_synced",
) {
  const name = String(adapter?.name ?? "").trim();
  if (!name) {
    return null;
  }
  return {
    name,
    domain: String(adapter?.domain ?? "example.com").trim() || "example.com",
    description:
      String(adapter?.description ?? "导入的站点适配器").trim() ||
      "导入的站点适配器",
    read_only: adapter?.read_only ?? adapter?.readOnly ?? true,
    capabilities: Array.isArray(adapter?.capabilities)
      ? adapter.capabilities.map((item: unknown) => String(item))
      : ["research"],
    input_schema: { type: "object" },
    example_args: {},
    example: String(adapter?.example ?? `${name} {}`),
    auth_hint:
      typeof adapter?.auth_hint === "string" ? adapter.auth_hint : undefined,
    source_kind: sourceKind,
    source_version:
      typeof adapter?.source_version === "string"
        ? adapter.source_version
        : typeof adapter?.sourceVersion === "string"
          ? adapter.sourceVersion
          : undefined,
  };
}

function parseMockImportedYamlBundle(bundle: string, sourceVersion?: string) {
  return bundle
    .split(/^---\s*$/m)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const site = item.match(/(?:^|\n)site:\s*([^\n]+)/)?.[1]?.trim();
      const name = item.match(/(?:^|\n)name:\s*([^\n]+)/)?.[1]?.trim();
      const domain = item.match(/(?:^|\n)domain:\s*([^\n]+)/)?.[1]?.trim();
      const description =
        item.match(/(?:^|\n)description:\s*([^\n]+)/)?.[1]?.trim() ??
        "从外部来源导入的站点适配器";
      if (!site || !name || !domain) {
        throw new Error(`第 ${index + 1} 个 YAML 文档缺少 site/name/domain`);
      }
      return {
        name: `${site}/${name}`,
        domain,
        description,
        read_only: true,
        capabilities: ["research"],
        input_schema: { type: "object" },
        example_args: {},
        example: `${site}/${name} {}`,
        source_kind: "imported",
        source_version: sourceVersion,
      };
    });
}

function upsertMockBrowserSessionState(launchResponse: any) {
  mockBrowserSessionStates.set(
    launchResponse.session.session_id,
    launchResponse.session,
  );
  return launchResponse;
}

function resolveMockBrowserSessionState(
  args: any,
  overrides?: Record<string, any>,
) {
  const sessionId = args?.request?.session_id ?? "mock-cdp-session";
  const existing = mockBrowserSessionStates.get(sessionId);
  if (existing) {
    const next = {
      ...existing,
      ...overrides,
      last_event_at: new Date().toISOString(),
    };
    mockBrowserSessionStates.set(sessionId, next);
    return next;
  }

  const fallback = buildMockBrowserSessionLaunchResponse({
    profile_key: "general_browser_assist",
    stream_mode: "both",
  }).session;
  const next = {
    ...fallback,
    session_id: sessionId,
    ...overrides,
    last_event_at: new Date().toISOString(),
  };
  mockBrowserSessionStates.set(sessionId, next);
  return next;
}

function buildMockBrowserSessionLaunchResponse(request: any) {
  const profile = mockBrowserProfiles.find(
    (item) => item.id === request?.profile_id,
  );
  const environmentPreset = mockBrowserEnvironmentPresets.find(
    (item) => item.id === request?.environment_preset_id,
  );
  const profileKey =
    request?.profile_key ?? profile?.profile_key ?? "general_browser_assist";
  const url = request?.url ?? profile?.launch_url ?? "https://www.google.com/";
  const currentTime = new Date().toISOString();

  if (profile) {
    profile.last_used_at = currentTime;
    profile.updated_at = currentTime;
  }
  if (environmentPreset) {
    environmentPreset.last_used_at = currentTime;
    environmentPreset.updated_at = currentTime;
  }

  const isExistingSession = profile?.transport_kind === "existing_session";

  return upsertMockBrowserSessionState({
    profile: {
      success: true,
      reused: isExistingSession,
      browser_source: "system",
      browser_path:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      profile_dir: isExistingSession
        ? ""
        : `/tmp/lime/chrome_profiles/${profileKey}`,
      remote_debugging_port: 13001,
      pid: 12345,
      devtools_http_url: "http://127.0.0.1:13001/json/version",
    },
    session: {
      session_id: `mock-cdp-session-${profileKey}`,
      profile_key: profileKey,
      environment_preset_id:
        environmentPreset?.id ?? request?.environment?.preset_id,
      environment_preset_name:
        environmentPreset?.name ?? request?.environment?.preset_name,
      target_id: request?.target_id ?? "mock-target-1",
      target_title: profile?.name ?? "Mock Target",
      target_url: url,
      remote_debugging_port: 13001,
      ws_debugger_url: "ws://127.0.0.1:13001/devtools/page/mock-target-1",
      devtools_frontend_url:
        "/devtools/inspector.html?ws=127.0.0.1:13001/devtools/page/mock-target-1",
      stream_mode: request?.stream_mode ?? "both",
      transport_kind: "cdp_frames",
      lifecycle_state: "live",
      control_mode: "agent",
      last_page_info: {
        title: profile?.name ?? "Mock Target",
        url,
        markdown: `# ${profile?.name ?? "Mock Target"}\nURL: ${url}`,
        updated_at: currentTime,
      },
      last_event_at: currentTime,
      created_at: currentTime,
      connected: true,
    },
  });
}

const mockAutomationJobs: AutomationJobRecord[] = [
  {
    id: "automation-job-daily-brief",
    name: "每日线索巡检",
    description: "在品牌工作区中汇总前一日线索、风险和待处理事项",
    enabled: true,
    workspace_id: "workspace-default",
    execution_mode: "intelligent",
    schedule: { kind: "every", every_secs: 1800 },
    payload: {
      kind: "agent_turn",
      prompt:
        "汇总最近 24 小时的重要线索、待回复事项和高风险异常，输出一个给运营负责人的简报。",
      system_prompt: "优先给出结论和下一步动作。",
      web_search: false,
    },
    delivery: {
      mode: "none",
      channel: null,
      target: null,
      best_effort: true,
      output_schema: "text",
      output_format: "text",
    },
    timeout_secs: 300,
    max_retries: 3,
    next_run_at: now(),
    last_status: "success",
    last_error: null,
    last_run_at: now(),
    last_finished_at: now(),
    running_started_at: null,
    consecutive_failures: 0,
    last_retry_count: 0,
    auto_disabled_until: null,
    last_delivery: null,
    created_at: now(),
    updated_at: now(),
  },
  {
    id: "automation-job-browser-check",
    name: "店铺后台浏览器巡检",
    description: "按固定资料和环境预设启动浏览器会话，供后续任务接管或人工排查",
    enabled: true,
    workspace_id: "workspace-default",
    execution_mode: "intelligent",
    schedule: { kind: "every", every_secs: 900 },
    payload: {
      kind: "browser_session",
      profile_id: "browser-profile-general",
      profile_key: "general_browser_assist",
      url: "https://www.google.com/",
      environment_preset_id: "browser-environment-us-desktop",
      target_id: null,
      open_window: false,
      stream_mode: "events",
    },
    delivery: {
      mode: "none",
      channel: null,
      target: null,
      best_effort: true,
      output_schema: "text",
      output_format: "text",
    },
    timeout_secs: 180,
    max_retries: 2,
    next_run_at: now(),
    last_status: null,
    last_error: null,
    last_run_at: null,
    last_finished_at: null,
    running_started_at: null,
    consecutive_failures: 0,
    last_retry_count: 0,
    auto_disabled_until: null,
    last_delivery: {
      success: false,
      message: "写入本地文件失败: permission denied",
      channel: "local_file",
      target: "/tmp/lime/browser-output.json",
      output_kind: "json",
      output_schema: "json",
      output_format: "json",
      output_preview: '{\n  "session_id": "browser-session-1"\n}',
      attempted_at: now(),
    },
    created_at: now(),
    updated_at: now(),
  },
];

const mockAutomationRuns: AgentRun[] = [
  {
    id: "automation-run-1",
    source: "automation",
    source_ref: "automation-job-daily-brief",
    session_id: "session-automation-1",
    status: "success",
    started_at: now(),
    finished_at: now(),
    duration_ms: 1820,
    error_code: null,
    error_message: null,
    metadata: JSON.stringify({
      job_name: "每日线索巡检",
      workspace_id: "workspace-default",
    }),
    created_at: now(),
    updated_at: now(),
  },
];

const mockSceneAppCatalog: SceneAppCatalog = {
  version: "2026-04-15",
  generatedAt: "2026-04-15T00:00:00.000Z",
  items: [
    {
      id: "story-video-suite",
      title: "短视频编排",
      summary: "把文本、线框图、配乐、剧本和短视频草稿收口成一条多模态结果链。",
      category: "Scene Apps",
      sceneappType: "hybrid",
      patternPrimary: "pipeline",
      patternStack: ["pipeline", "inversion", "generator", "reviewer"],
      capabilityRefs: [
        "cloud_scene",
        "native_skill",
        "workspace_storage",
        "artifact_viewer",
      ],
      infraProfile: [
        "composition_blueprint",
        "project_pack",
        "workspace_storage",
        "cloud_runtime",
        "timeline",
      ],
      deliveryContract: "project_pack",
      artifactKind: "artifact_bundle",
      outputHint: "短视频项目包",
      deliveryProfile: {
        artifactProfileRef: "story-video-artifacts",
        viewerKind: "artifact_bundle",
        requiredParts: [
          "brief",
          "storyboard",
          "script",
          "music_refs",
          "video_draft",
          "review_note",
        ],
        primaryPart: "brief",
      },
      compositionProfile: {
        blueprintRef: "story-video-blueprint",
        stepCount: 6,
        steps: [
          {
            id: "brief",
            order: 1,
            bindingProfileRef: "story-video-native-binding",
            bindingFamily: "native_skill",
          },
          {
            id: "storyboard",
            order: 2,
            bindingProfileRef: "story-video-native-binding",
            bindingFamily: "native_skill",
          },
          {
            id: "script",
            order: 3,
            bindingProfileRef: "story-video-native-binding",
            bindingFamily: "native_skill",
          },
          {
            id: "music_refs",
            order: 4,
            bindingProfileRef: "story-video-cloud-binding",
            bindingFamily: "cloud_scene",
          },
          {
            id: "video_draft",
            order: 5,
            bindingProfileRef: "story-video-cloud-binding",
            bindingFamily: "cloud_scene",
          },
          {
            id: "review_note",
            order: 6,
            bindingProfileRef: "story-video-native-binding",
            bindingFamily: "native_skill",
          },
        ],
      },
      scorecardProfile: {
        profileRef: "story-video-scorecard",
        metricKeys: [
          "complete_pack_rate",
          "review_pass_rate",
          "publish_conversion_rate",
        ],
        failureSignals: [
          "pack_incomplete",
          "review_blocked",
          "publish_stalled",
        ],
      },
      entryBindings: [
        {
          kind: "service_skill",
          bindingFamily: "cloud_scene",
          serviceSkillId: "sceneapp-service-story-video",
          skillKey: "story-video-suite",
          aliases: ["story-video", "mv-pipeline"],
        },
        {
          kind: "scene",
          bindingFamily: "cloud_scene",
          sceneKey: "story-video-suite",
          commandPrefix: "/story-video-suite",
          aliases: ["story-video-scene"],
        },
      ],
      launchRequirements: [
        {
          kind: "user_input",
          message: "需要主题、风格或脚本线索作为场景输入。",
        },
        {
          kind: "project",
          message: "需要项目目录承接线框图、脚本和媒体结果。",
        },
        {
          kind: "cloud_session",
          message: "需要可用的云端运行时来完成多模态媒体处理。",
        },
      ],
      linkedServiceSkillId: "sceneapp-service-story-video",
      linkedSceneKey: "story-video-suite",
      aliases: ["story-video", "mv-pipeline", "short-video-suite"],
      sourcePackageId: "lime-core-sceneapps",
      sourcePackageVersion: "2026-04-15",
    },
    {
      id: "x-article-export",
      title: "网页导出",
      summary:
        "在真实浏览器上下文中抓取网页正文、图片与元信息，并沉淀为项目内 Markdown 资料包。",
      category: "Scene Apps",
      sceneappType: "browser_grounded",
      patternPrimary: "pipeline",
      patternStack: ["pipeline", "tool_wrapper", "generator", "inversion"],
      capabilityRefs: [
        "browser_assist",
        "workspace_storage",
        "artifact_viewer",
      ],
      infraProfile: [
        "browser_connector",
        "site_adapter",
        "workspace_storage",
        "artifact_bundle",
      ],
      deliveryContract: "project_pack",
      artifactKind: "document",
      outputHint: "网页资料包",
      deliveryProfile: {
        artifactProfileRef: "article-export-artifacts",
        viewerKind: "document",
        requiredParts: ["index.md", "meta.json"],
        primaryPart: "index.md",
      },
      scorecardProfile: {
        profileRef: "article-export-scorecard",
        metricKeys: ["success_rate", "reuse_rate"],
        failureSignals: ["pack_incomplete"],
      },
      entryBindings: [
        {
          kind: "service_skill",
          bindingFamily: "browser_assist",
          serviceSkillId: "sceneapp-service-article-export",
          skillKey: "x-article-export",
          aliases: ["article-export"],
        },
      ],
      launchRequirements: [
        {
          kind: "browser_session",
          message: "需要真实网页上下文或浏览器附着会话。",
        },
        {
          kind: "project",
          message: "需要项目目录来保存 Markdown 与图片资源。",
        },
      ],
      linkedServiceSkillId: "sceneapp-service-article-export",
      linkedSceneKey: "x-article-export",
      aliases: ["article-export", "web-article-export"],
      sourcePackageId: "lime-core-sceneapps",
      sourcePackageVersion: "2026-04-15",
    },
    {
      id: "daily-trend-briefing",
      title: "每日趋势摘要",
      summary:
        "把研究主题转成可持续运行的本地 durable 场景，并定时回流结果和失败原因。",
      category: "Scene Apps",
      sceneappType: "local_durable",
      patternPrimary: "pipeline",
      patternStack: ["pipeline", "reviewer"],
      capabilityRefs: ["automation_job", "workspace_storage", "timeline"],
      infraProfile: ["automation_schedule", "db_store", "json_snapshot"],
      deliveryContract: "table_report",
      artifactKind: "table_report",
      outputHint: "趋势摘要",
      deliveryProfile: {
        artifactProfileRef: "daily-trend-artifacts",
        viewerKind: "table_report",
        requiredParts: ["brief", "review_note"],
        primaryPart: "brief",
      },
      scorecardProfile: {
        profileRef: "daily-trend-scorecard",
        metricKeys: ["success_rate", "reuse_rate"],
        failureSignals: ["automation_timeout"],
      },
      entryBindings: [
        {
          kind: "service_skill",
          bindingFamily: "automation_job",
          serviceSkillId: "sceneapp-service-daily-trend",
          skillKey: "daily-trend-briefing",
          aliases: ["trend-briefing", "growth-monitor"],
        },
      ],
      launchRequirements: [
        {
          kind: "project",
          message: "需要工作区或项目目录保存运行历史与结果快照。",
        },
        {
          kind: "automation",
          message: "需要可用的自动化调度能力。",
        },
      ],
      linkedServiceSkillId: "sceneapp-service-daily-trend",
      linkedSceneKey: "daily-trend-briefing",
      aliases: ["trend-briefing", "growth-monitor"],
      sourcePackageId: "lime-core-sceneapps",
      sourcePackageVersion: "2026-04-15",
    },
  ],
};

function findMockSceneAppDescriptor(id?: string): SceneAppDescriptor | null {
  if (!id) {
    return null;
  }
  const normalized = id.trim();
  return (
    mockSceneAppCatalog.items.find(
      (item) =>
        item.id === normalized ||
        item.linkedSceneKey === normalized ||
        item.linkedServiceSkillId === normalized ||
        item.aliases?.includes(normalized),
    ) ?? null
  );
}

function extractMockSceneAppUrlCandidate(
  userInput?: string,
): string | undefined {
  if (typeof userInput !== "string") {
    return undefined;
  }

  return userInput
    .split(/\s+/)
    .find(
      (segment) =>
        segment.startsWith("http://") || segment.startsWith("https://"),
    )
    ?.replace(/["')\]},.>，。）]+$/g, "");
}

function buildMockSceneAppAdapterPlan(
  descriptor: SceneAppDescriptor,
  intent: Record<string, unknown>,
): SceneAppRuntimeAdapterPlan {
  const adapterKind =
    descriptor.entryBindings[0]?.bindingFamily ?? "agent_turn";
  const baseRequestMetadata = {
    harness: {
      sceneapp_id: descriptor.id,
      sceneapp_type: descriptor.sceneappType,
      pattern_primary: descriptor.patternPrimary,
      pattern_stack: descriptor.patternStack,
      infra_profile: descriptor.infraProfile,
      entry_source:
        typeof intent.entrySource === "string" ? intent.entrySource : null,
      workspace_id:
        typeof intent.workspaceId === "string" ? intent.workspaceId : null,
      project_id:
        typeof intent.projectId === "string" ? intent.projectId : null,
      sceneapp_launch: {
        sceneapp_id: descriptor.id,
        sceneapp_type: descriptor.sceneappType,
        pattern_primary: descriptor.patternPrimary,
        pattern_stack: descriptor.patternStack,
        infra_profile: descriptor.infraProfile,
        delivery_contract: descriptor.deliveryContract,
        linked_service_skill_id: descriptor.linkedServiceSkillId ?? null,
        linked_scene_key: descriptor.linkedSceneKey ?? null,
        entry_source:
          typeof intent.entrySource === "string" ? intent.entrySource : null,
        workspace_id:
          typeof intent.workspaceId === "string" ? intent.workspaceId : null,
        project_id:
          typeof intent.projectId === "string" ? intent.projectId : null,
      },
    },
    sceneapp: {
      id: descriptor.id,
      title: descriptor.title,
      sceneapp_type: descriptor.sceneappType,
      pattern_primary: descriptor.patternPrimary,
      pattern_stack: descriptor.patternStack,
      infra_profile: descriptor.infraProfile,
      delivery_contract: descriptor.deliveryContract,
      source_package_id: descriptor.sourcePackageId,
      source_package_version: descriptor.sourcePackageVersion,
    },
    ...(descriptor.linkedServiceSkillId || descriptor.linkedSceneKey
      ? {
          service_skill: {
            id: descriptor.linkedServiceSkillId ?? null,
            scene_key: descriptor.linkedSceneKey ?? null,
          },
        }
      : {}),
    ...(intent.slots && typeof intent.slots === "object"
      ? {
          sceneapp_slots: intent.slots,
        }
      : {}),
  };

  if (adapterKind === "browser_assist") {
    const slotValues =
      intent.slots && typeof intent.slots === "object"
        ? (intent.slots as Record<string, unknown>)
        : {};
    const adapterName =
      descriptor.id === "x-article-export"
        ? "x/article-export"
        : (descriptor.linkedSceneKey ?? descriptor.id);
    const args: Record<string, unknown> = {};
    const url =
      (typeof slotValues.article_url === "string" && slotValues.article_url) ||
      (typeof slotValues.url === "string" && slotValues.url) ||
      extractMockSceneAppUrlCandidate(
        typeof intent.userInput === "string" ? intent.userInput : undefined,
      );
    if (url) {
      args.url = url;
    }
    if (typeof slotValues.target_language === "string") {
      args.target_language = slotValues.target_language;
    }
    if (
      Object.keys(args).length === 0 &&
      typeof intent.userInput === "string"
    ) {
      args.prompt = intent.userInput;
    }

    return {
      adapterKind,
      runtimeAction: "launch_browser_assist",
      targetRef: adapterName,
      targetLabel: descriptor.title,
      linkedServiceSkillId: descriptor.linkedServiceSkillId,
      linkedSceneKey: descriptor.linkedSceneKey,
      preferredProfileKey: "general_browser_assist",
      requestMetadata: {
        ...baseRequestMetadata,
        harness: {
          ...baseRequestMetadata.harness,
          browser_requirement: "required",
          browser_requirement_reason:
            "当前 SceneApp 依赖真实浏览器上下文与登录态，不应回退到纯 WebSearch。",
          browser_assist: {
            enabled: true,
            profile_key: "general_browser_assist",
            preferred_backend: "lime_extension_bridge",
            auto_launch: false,
            stream_mode: "both",
          },
          service_skill_launch: {
            kind: "site_adapter",
            skill_id: descriptor.linkedServiceSkillId ?? null,
            skill_title: descriptor.title,
            adapter_name: adapterName,
            args,
            save_mode: "project_resource",
            project_id:
              typeof intent.projectId === "string" ? intent.projectId : null,
          },
        },
      },
      launchPayload: {
        sceneapp_id: descriptor.id,
        service_skill_id: descriptor.linkedServiceSkillId ?? null,
        adapter_name: adapterName,
        profile_key: "general_browser_assist",
        args,
        project_id:
          typeof intent.projectId === "string" ? intent.projectId : null,
        workspace_id:
          typeof intent.workspaceId === "string" ? intent.workspaceId : null,
        save_mode: "project_resource",
      },
      notes: [
        "当前 SceneApp 规划先映射到 browser_assist 主链，再由后续 runtime adapter 负责真实执行。",
        ...(url
          ? []
          : [
              "当前 planner 还无法仅凭 descriptor 判断 article_url 是否齐备；执行前应继续通过 scene gate 补齐目标链接。",
            ]),
      ],
    };
  }

  if (adapterKind === "automation_job") {
    return {
      adapterKind,
      runtimeAction: "create_automation_job",
      targetRef: descriptor.linkedServiceSkillId ?? descriptor.id,
      targetLabel: descriptor.title,
      linkedServiceSkillId: descriptor.linkedServiceSkillId,
      linkedSceneKey: descriptor.linkedSceneKey,
      requestMetadata: {
        ...baseRequestMetadata,
        harness: {
          ...baseRequestMetadata.harness,
          sceneapp_runtime_action: "create_automation_job",
        },
      },
      launchPayload: {
        sceneapp_id: descriptor.id,
        name: `${descriptor.title} 自动化`,
        enabled: true,
        execution_mode: "intelligent",
        schedule: {
          kind: "every",
          every_secs: 3600,
        },
        delivery: {
          mode: "none",
          channel: null,
          target: null,
          best_effort: false,
          output_schema: null,
          output_format: null,
        },
        launch_intent: {
          sceneapp_id: descriptor.id,
          entry_source:
            typeof intent.entrySource === "string" ? intent.entrySource : null,
          workspace_id:
            typeof intent.workspaceId === "string" ? intent.workspaceId : null,
          project_id:
            typeof intent.projectId === "string" ? intent.projectId : null,
          user_input:
            typeof intent.userInput === "string" ? intent.userInput : null,
          slots:
            intent.slots && typeof intent.slots === "object"
              ? intent.slots
              : {},
          runtime_context:
            intent.runtimeContext && typeof intent.runtimeContext === "object"
              ? intent.runtimeContext
              : null,
        },
      },
      notes: [
        "当前 SceneApp 规划先映射到 automation_job 主链，再由后续 runtime adapter 负责真实执行。",
        "当前 planner 只生成 durable automation draft；具体 schedule、delivery 与 run-now 策略可继续由 UI 调整。",
      ],
    };
  }

  if (adapterKind === "cloud_scene") {
    return {
      adapterKind,
      runtimeAction: "launch_cloud_scene",
      targetRef:
        descriptor.linkedServiceSkillId ??
        descriptor.linkedSceneKey ??
        descriptor.id,
      targetLabel: descriptor.title,
      linkedServiceSkillId: descriptor.linkedServiceSkillId,
      linkedSceneKey: descriptor.linkedSceneKey,
      requestMetadata: {
        ...baseRequestMetadata,
        harness: {
          ...baseRequestMetadata.harness,
          service_scene_launch: {
            kind: "cloud_scene",
            service_scene_run: {
              sceneapp_id: descriptor.id,
              scene_key: descriptor.linkedSceneKey ?? null,
              linked_skill_id: descriptor.linkedServiceSkillId ?? null,
              skill_id: descriptor.linkedServiceSkillId ?? null,
              skill_title: descriptor.title,
              skill_summary: descriptor.summary,
              execution_kind: "cloud_scene",
              entry_source:
                typeof intent.entrySource === "string"
                  ? intent.entrySource
                  : "sceneapp_plan",
              workspace_id:
                typeof intent.workspaceId === "string"
                  ? intent.workspaceId
                  : null,
              project_id:
                typeof intent.projectId === "string" ? intent.projectId : null,
              user_input:
                typeof intent.userInput === "string" ? intent.userInput : null,
              slots:
                intent.slots && typeof intent.slots === "object"
                  ? intent.slots
                  : {},
            },
          },
        },
      },
      launchPayload: {
        sceneapp_id: descriptor.id,
        scene_key: descriptor.linkedSceneKey ?? null,
        service_skill_id: descriptor.linkedServiceSkillId ?? null,
        workspace_id:
          typeof intent.workspaceId === "string" ? intent.workspaceId : null,
        project_id:
          typeof intent.projectId === "string" ? intent.projectId : null,
        entry_source:
          typeof intent.entrySource === "string"
            ? intent.entrySource
            : "sceneapp_plan",
        user_input:
          typeof intent.userInput === "string" ? intent.userInput : null,
        slots:
          intent.slots && typeof intent.slots === "object" ? intent.slots : {},
      },
      notes: [
        "当前 SceneApp 规划先映射到 cloud_scene 主链，再由后续 runtime adapter 负责真实执行。",
        ...(descriptor.sceneappType === "hybrid"
          ? [
              "当前 SceneApp 属于 hybrid，但首发执行仍先收敛到 cloud_scene；本地编排步骤由后续 composition blueprint 接续。",
            ]
          : []),
      ],
    };
  }

  if (adapterKind === "native_skill") {
    return {
      adapterKind,
      runtimeAction: "launch_native_skill",
      targetRef:
        descriptor.linkedServiceSkillId ??
        descriptor.linkedSceneKey ??
        descriptor.id,
      targetLabel: descriptor.title,
      linkedServiceSkillId: descriptor.linkedServiceSkillId,
      linkedSceneKey: descriptor.linkedSceneKey,
      requestMetadata: {
        ...baseRequestMetadata,
        harness: {
          ...baseRequestMetadata.harness,
          sceneapp_runtime_action: "launch_native_skill",
          sceneapp_native_skill_launch: {
            skill_id: descriptor.linkedServiceSkillId ?? null,
            skill_key: descriptor.linkedSceneKey ?? null,
            project_id:
              typeof intent.projectId === "string" ? intent.projectId : null,
            workspace_id:
              typeof intent.workspaceId === "string"
                ? intent.workspaceId
                : null,
            user_input:
              typeof intent.userInput === "string" ? intent.userInput : null,
            slots:
              intent.slots && typeof intent.slots === "object"
                ? intent.slots
                : {},
          },
        },
      },
      launchPayload: {
        sceneapp_id: descriptor.id,
        service_skill_id: descriptor.linkedServiceSkillId ?? null,
        skill_key: descriptor.linkedSceneKey ?? null,
        workspace_id:
          typeof intent.workspaceId === "string" ? intent.workspaceId : null,
        project_id:
          typeof intent.projectId === "string" ? intent.projectId : null,
        user_input:
          typeof intent.userInput === "string" ? intent.userInput : null,
        slots:
          intent.slots && typeof intent.slots === "object" ? intent.slots : {},
      },
      notes: [
        "当前 SceneApp 规划先映射到 native_skill 主链，再由后续 runtime adapter 负责真实执行。",
        "native_skill 目前仍建议由统一 SceneApp UI 继续补参后，再把 draft 投递给本地 skill 执行入口。",
      ],
    };
  }

  return {
    adapterKind,
    runtimeAction: "submit_agent_turn",
    targetRef: descriptor.id,
    targetLabel: descriptor.title,
    linkedServiceSkillId: descriptor.linkedServiceSkillId,
    linkedSceneKey: descriptor.linkedSceneKey,
    requestMetadata: {
      ...baseRequestMetadata,
      harness: {
        ...baseRequestMetadata.harness,
        sceneapp_runtime_action: "submit_agent_turn",
      },
    },
    launchPayload: {
      sceneapp_id: descriptor.id,
      message: typeof intent.userInput === "string" ? intent.userInput : "",
      workspace_id:
        typeof intent.workspaceId === "string" ? intent.workspaceId : null,
      project_id:
        typeof intent.projectId === "string" ? intent.projectId : null,
      slots:
        intent.slots && typeof intent.slots === "object" ? intent.slots : {},
    },
    notes: [
      "当前 SceneApp 规划先映射到 agent_turn 主链，再由后续 runtime adapter 负责真实执行。",
      "agent_turn 类型 SceneApp 当前仍建议走统一聊天 turn，并把 sceneapp_launch metadata 合并进 request_metadata。",
    ],
  };
}

function buildMockSceneAppPlanResult(
  descriptor: SceneAppDescriptor | null,
  args?: Record<string, unknown>,
): SceneAppPlanResult {
  const resolvedDescriptor = descriptor ?? mockSceneAppCatalog.items[0]!;
  const intent =
    (args?.intent as Record<string, unknown> | undefined) ?? args ?? {};
  const runtimeContext =
    (intent.runtimeContext as Record<string, unknown> | undefined) ?? {};
  const unmetRequirements = resolvedDescriptor.launchRequirements.filter(
    (requirement) => {
      if (requirement.kind === "user_input") {
        return !(
          typeof intent.userInput === "string" &&
          intent.userInput.trim().length > 0
        );
      }
      if (requirement.kind === "project") {
        return !(
          typeof intent.projectId === "string" &&
          intent.projectId.trim().length > 0
        );
      }
      if (requirement.kind === "browser_session") {
        return runtimeContext.browserSessionAttached !== true;
      }
      if (requirement.kind === "cloud_session") {
        return runtimeContext.cloudSessionReady !== true;
      }
      if (requirement.kind === "automation") {
        return runtimeContext.automationEnabled !== true;
      }
      return false;
    },
  );

  return {
    descriptor: resolvedDescriptor,
    readiness: {
      ready: unmetRequirements.length === 0,
      unmetRequirements,
    },
    plan: {
      sceneappId: resolvedDescriptor.id,
      executorKind:
        resolvedDescriptor.entryBindings[0]?.bindingFamily ?? "agent_turn",
      bindingFamily:
        resolvedDescriptor.entryBindings[0]?.bindingFamily ?? "agent_turn",
      stepPlan: resolvedDescriptor.patternStack.map((pattern, index) => ({
        id: `step-${index + 1}`,
        title: `执行 ${pattern} 阶段`,
        bindingFamily:
          resolvedDescriptor.entryBindings[0]?.bindingFamily ?? "agent_turn",
      })),
      adapterPlan: buildMockSceneAppAdapterPlan(resolvedDescriptor, intent),
      storageStrategy: resolvedDescriptor.infraProfile.includes("db_store")
        ? "db_plus_snapshot"
        : "workspace_bundle",
      artifactContract: resolvedDescriptor.deliveryContract,
      governanceHooks: ["evidence_pack", "scorecard"],
      warnings:
        unmetRequirements.length > 0
          ? ["当前 SceneApp 仍有未满足的启动前置条件。"]
          : [],
    },
  };
}

function buildMockSceneAppScorecard(sceneappId: string): SceneAppScorecard {
  if (sceneappId === "story-video-suite") {
    return {
      sceneappId,
      updatedAt: "2026-04-15T00:00:00.000Z",
      summary:
        "这条多模态项目包样板已具备继续优化价值，重点是提升整包完整度与发布转化。",
      metrics: [
        {
          key: "complete_pack_rate",
          label: "整包交付率",
          value: 78,
          status: "watch",
        },
        {
          key: "review_pass_rate",
          label: "复核通过率",
          value: 84,
          status: "good",
        },
      ],
      recommendedAction: "optimize",
      observedFailureSignals: ["review_blocked", "pack_incomplete"],
      topFailureSignal: "review_blocked",
    };
  }

  return {
    sceneappId,
    updatedAt: "2026-04-15T00:00:00.000Z",
    summary:
      "该 SceneApp 已具备平台化治理入口，下一步重点是继续优化交付稳定性。",
    metrics: [
      {
        key: "delivery_readiness",
        label: "交付就绪度",
        value: 0.78,
        status: "watch",
      },
      {
        key: "reuse_potential",
        label: "结果复用潜力",
        value: 0.84,
        status: "good",
      },
    ],
    recommendedAction: "keep",
    observedFailureSignals: [],
    topFailureSignal: null,
  };
}

function extractMockSceneAppIdFromAutomationJob(
  job?: Partial<AutomationJobRecord> | null,
): string | null {
  const payload =
    (job?.payload as Record<string, unknown> | undefined) ?? undefined;
  const requestMetadata =
    (payload?.request_metadata as Record<string, unknown> | undefined) ??
    (payload?.requestMetadata as Record<string, unknown> | undefined);
  const sceneapp =
    (requestMetadata?.sceneapp as Record<string, unknown> | undefined) ??
    (requestMetadata?.sceneApp as Record<string, unknown> | undefined);
  return typeof sceneapp?.id === "string" ? sceneapp.id : null;
}

function buildMockSceneAppRunSummaries(sceneappId?: string) {
  const seededRuns = [
    {
      runId: "sceneapp-run-story-video-seed",
      sceneappId: "story-video-suite",
      status: "success",
      source: "catalog_seed",
      sourceRef: null,
      startedAt: "2026-04-15T00:00:00.000Z",
      finishedAt: "2026-04-15T00:08:00.000Z",
      artifactCount: 3,
      deliveryArtifactRefs: [
        {
          relativePath: "exports/story-video-suite/latest/brief.md",
          absolutePath: "/workspace/exports/story-video-suite/latest/brief.md",
          partKey: "brief",
          projectId: "project-1",
          workspaceId: "workspace-1",
          source: "runtime_evidence",
        },
        {
          relativePath: "exports/story-video-suite/latest/video_draft.mp4",
          absolutePath:
            "/workspace/exports/story-video-suite/latest/video_draft.mp4",
          partKey: "video_draft",
          projectId: "project-1",
          workspaceId: "workspace-1",
          source: "runtime_evidence",
        },
      ],
      governanceArtifactRefs: [
        {
          kind: "evidence_summary",
          label: "证据摘要",
          relativePath:
            ".lime/harness/sessions/session-story-video-1/evidence/summary.md",
          absolutePath:
            "/workspace/.lime/harness/sessions/session-story-video-1/evidence/summary.md",
          projectId: "project-1",
          workspaceId: "workspace-1",
          source: "session_governance",
        },
        {
          kind: "review_decision_markdown",
          label: "人工复核记录",
          relativePath:
            ".lime/harness/sessions/session-story-video-1/review/review-decision.md",
          absolutePath:
            "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.md",
          projectId: "project-1",
          workspaceId: "workspace-1",
          source: "session_governance",
        },
        {
          kind: "review_decision_json",
          label: "复核 JSON",
          relativePath:
            ".lime/harness/sessions/session-story-video-1/review/review-decision.json",
          absolutePath:
            "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.json",
          projectId: "project-1",
          workspaceId: "workspace-1",
          source: "session_governance",
        },
      ],
      deliveryRequiredParts: [
        "brief",
        "storyboard",
        "script",
        "music_refs",
        "video_draft",
        "review_note",
      ],
      deliveryCompletedParts: ["brief", "storyboard", "script"],
      deliveryMissingParts: ["music_refs", "video_draft", "review_note"],
      deliveryCompletionRate: 50,
      deliveryPartCoverageKnown: true,
      failureSignal: "review_blocked",
    },
    {
      runId: "sceneapp-run-article-export-seed",
      sceneappId: "x-article-export",
      status: "queued",
      source: "catalog_seed",
      sourceRef: null,
      startedAt: "2026-04-15T00:12:00.000Z",
      finishedAt: null,
      artifactCount: 0,
      deliveryArtifactRefs: [],
      deliveryRequiredParts: ["index.md", "meta.json"],
      deliveryCompletedParts: [],
      deliveryMissingParts: [],
      deliveryCompletionRate: null,
      deliveryPartCoverageKnown: false,
      failureSignal: null,
    },
  ];

  const automationRuns = mockAutomationRuns
    .map((run) => {
      const job = mockAutomationJobs.find((item) => item.id === run.source_ref);
      const resolvedSceneAppId = extractMockSceneAppIdFromAutomationJob(job);
      if (!resolvedSceneAppId) {
        return null;
      }
      return {
        runId: run.id,
        sceneappId: resolvedSceneAppId,
        status: run.status,
        source: run.source,
        sourceRef: run.source_ref ?? null,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        artifactCount: 0,
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryCompletionRate: null,
        deliveryPartCoverageKnown: false,
        failureSignal: null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const automationJobOnlyRuns = mockAutomationJobs
    .filter((job) => {
      const resolvedSceneAppId = extractMockSceneAppIdFromAutomationJob(job);
      if (!resolvedSceneAppId) {
        return false;
      }
      const hasRealRun = mockAutomationRuns.some(
        (run) => run.source_ref === job.id,
      );
      return !hasRealRun;
    })
    .map((job) => ({
      runId: `automation-job:${job.id}`,
      sceneappId: extractMockSceneAppIdFromAutomationJob(job)!,
      status: job.last_status ?? "queued",
      source: "automation",
      sourceRef: job.id,
      startedAt: job.last_run_at ?? job.created_at,
      finishedAt: job.last_finished_at ?? null,
      artifactCount: 0,
      deliveryRequiredParts: [],
      deliveryCompletedParts: [],
      deliveryMissingParts: [],
      deliveryCompletionRate: null,
      deliveryPartCoverageKnown: false,
      failureSignal: null,
    }));

  const merged = [...automationRuns, ...automationJobOnlyRuns, ...seededRuns];
  return sceneappId
    ? merged.filter((run) => run.sceneappId === sceneappId)
    : merged;
}

function createMockSceneAppAutomationJob(args?: Record<string, unknown>) {
  const intent =
    (args?.intent as Record<string, unknown> | undefined) ?? args ?? {};
  const launchIntent =
    (intent.launchIntent as Record<string, unknown> | undefined) ??
    (intent.launch_intent as Record<string, unknown> | undefined) ??
    {};
  const descriptor = findMockSceneAppDescriptor(
    (launchIntent.sceneappId as string | undefined) ??
      (launchIntent.sceneapp_id as string | undefined),
  );

  if (!descriptor) {
    throw new Error("未找到 SceneApp，无法创建自动化任务");
  }
  if (descriptor.sceneappType === "browser_grounded") {
    throw new Error(
      "当前 SceneApp 依赖浏览器上下文，暂不支持直接转为 automation job",
    );
  }

  const workspaceId =
    typeof launchIntent.workspaceId === "string"
      ? launchIntent.workspaceId
      : typeof launchIntent.workspace_id === "string"
        ? launchIntent.workspace_id
        : "workspace-default";
  const projectId =
    typeof launchIntent.projectId === "string"
      ? launchIntent.projectId
      : typeof launchIntent.project_id === "string"
        ? launchIntent.project_id
        : null;
  const userInput =
    typeof launchIntent.userInput === "string"
      ? launchIntent.userInput
      : typeof launchIntent.user_input === "string"
        ? launchIntent.user_input
        : "";
  const schedule = (intent.schedule as Record<string, unknown> | undefined) ?? {
    kind: "every",
    every_secs: 3600,
  };

  const requestMetadata = {
    sceneapp: {
      id: descriptor.id,
      title: descriptor.title,
      sceneapp_type: descriptor.sceneappType,
      pattern_primary: descriptor.patternPrimary,
      pattern_stack: descriptor.patternStack,
      infra_profile: descriptor.infraProfile,
    },
    service_skill: {
      id: descriptor.linkedServiceSkillId,
      scene_key: descriptor.linkedSceneKey,
    },
    harness: {
      sceneapp_id: descriptor.id,
      workspace_id: workspaceId,
      project_id: projectId,
      entry_source:
        (launchIntent.entrySource as string | undefined) ??
        (launchIntent.entry_source as string | undefined) ??
        null,
    },
    sceneapp_slots:
      (launchIntent.slots as Record<string, unknown> | undefined) ?? {},
  };

  const jobId = `sceneapp-automation-${Date.now()}`;
  const createdJob: AutomationJobRecord = {
    id: jobId,
    name:
      (typeof intent.name === "string" && intent.name.trim()) ||
      `${descriptor.title} 自动化`,
    description:
      (typeof intent.description === "string" && intent.description.trim()
        ? intent.description
        : `由 SceneApp ${descriptor.title} 派生的自动化任务。`) ?? null,
    enabled: intent.enabled !== false,
    workspace_id: workspaceId,
    execution_mode:
      (intent.executionMode as
        | AutomationJobRecord["execution_mode"]
        | undefined) ??
      (intent.execution_mode as
        | AutomationJobRecord["execution_mode"]
        | undefined) ??
      "intelligent",
    schedule: schedule as AutomationJobRecord["schedule"],
    payload: {
      kind: "agent_turn",
      prompt: userInput
        ? `SceneApp: ${descriptor.title}\n用户目标：${userInput}`
        : `SceneApp: ${descriptor.title}`,
      system_prompt: "你正在执行 SceneApp 自动化任务。",
      web_search: false,
      request_metadata: requestMetadata,
    },
    delivery: (intent.delivery as
      | AutomationJobRecord["delivery"]
      | undefined) ?? {
      mode: "none",
      channel: null,
      target: null,
      best_effort: true,
      output_schema: "text",
      output_format: "text",
    },
    timeout_secs:
      (intent.timeoutSecs as number | undefined) ??
      (intent.timeout_secs as number | undefined) ??
      null,
    max_retries:
      (intent.maxRetries as number | undefined) ??
      (intent.max_retries as number | undefined) ??
      3,
    next_run_at: now(),
    last_status: null,
    last_error: null,
    last_run_at: null,
    last_finished_at: null,
    running_started_at: null,
    consecutive_failures: 0,
    last_retry_count: 0,
    auto_disabled_until: null,
    last_delivery: null,
    created_at: now(),
    updated_at: now(),
  };
  mockAutomationJobs.unshift(createdJob);

  let runNowResult:
    | {
        job_count: number;
        success_count: number;
        failed_count: number;
        timeout_count: number;
      }
    | undefined;
  if (intent.runNow === true || intent.run_now === true) {
    const runId = `sceneapp-run-${Date.now()}`;
    mockAutomationRuns.unshift({
      id: runId,
      source: "automation",
      source_ref: createdJob.id,
      session_id: `session-${Date.now()}`,
      status: "success",
      started_at: now(),
      finished_at: now(),
      duration_ms: 1200,
      error_code: null,
      error_message: null,
      metadata: JSON.stringify({
        job_id: createdJob.id,
        job_name: createdJob.name,
        workspace_id: createdJob.workspace_id,
        sceneapp: {
          id: descriptor.id,
          title: descriptor.title,
        },
        harness: {
          sceneapp_id: descriptor.id,
        },
      }),
      created_at: now(),
      updated_at: now(),
    });
    runNowResult = {
      job_count: 1,
      success_count: 1,
      failed_count: 0,
      timeout_count: 0,
    };
  }

  return {
    sceneappId: descriptor.id,
    jobId: createdJob.id,
    jobName: createdJob.name,
    enabled: createdJob.enabled,
    workspaceId: createdJob.workspace_id,
    nextRunAt: createdJob.next_run_at,
    runNowResult,
  };
}

function buildMockAutomationBrowserMetadata(
  job: any,
  session: any,
  status: string,
  durationMs?: number | null,
) {
  return JSON.stringify({
    job_id: job.id,
    job_name: job.name,
    workspace_id: job.workspace_id,
    schedule:
      job.schedule?.kind === "every"
        ? `every:${job.schedule.every_secs}`
        : job.schedule?.kind === "cron"
          ? `cron:${job.schedule.expr}`
          : `at:${job.schedule?.at ?? ""}`,
    status,
    retry_count: job.last_retry_count ?? 0,
    session_id: session.session_id,
    payload_kind: job.payload?.kind ?? "agent_turn",
    profile_key: job.payload?.profile_key ?? session.profile_key,
    profile_id: job.payload?.profile_id ?? null,
    environment_preset_id:
      job.payload?.environment_preset_id ??
      session.environment_preset_id ??
      null,
    target_id: job.payload?.target_id ?? session.target_id,
    browser_lifecycle_state: session.lifecycle_state,
    control_mode: session.control_mode,
    human_reason: session.human_reason ?? null,
    browser_last_error: session.last_error ?? null,
    browser_target_id: session.target_id,
    browser_target_url: session.target_url,
    connected: session.connected,
    duration_ms: durationMs ?? null,
  });
}

function resolveMockAutomationRunBySession(sessionId: string) {
  return mockAutomationRuns.find(
    (run) => run.source === "automation" && run.session_id === sessionId,
  );
}

function resolveMockAutomationJobByRun(run: any) {
  if (!run?.source_ref) {
    return null;
  }
  return mockAutomationJobs.find((job) => job.id === run.source_ref) ?? null;
}

function finishMockAutomationBrowserRun(
  job: any,
  run: any,
  session: any,
  status: "success" | "error",
) {
  const timestamp = now();
  const durationMs = Math.max(
    0,
    new Date(timestamp).getTime() - new Date(run.started_at).getTime(),
  );
  run.status = status;
  run.finished_at = timestamp;
  run.duration_ms = durationMs;
  run.error_code = status === "success" ? null : "browser_session_failed";
  run.error_message =
    status === "success"
      ? null
      : (session.last_error ?? session.human_reason ?? "浏览器会话执行失败");
  run.updated_at = timestamp;
  run.metadata = buildMockAutomationBrowserMetadata(
    job,
    session,
    status,
    durationMs,
  );

  job.last_status = status;
  job.last_error = run.error_message;
  job.last_run_at = run.started_at;
  job.last_finished_at = timestamp;
  job.running_started_at = null;
  job.updated_at = timestamp;
  job.last_retry_count = job.last_retry_count ?? 0;
  if (status === "success") {
    job.consecutive_failures = 0;
    job.auto_disabled_until = null;
  } else {
    job.consecutive_failures = (job.consecutive_failures ?? 0) + 1;
  }
  if (job.schedule?.kind === "at") {
    job.enabled = false;
    job.next_run_at = null;
  } else {
    job.next_run_at = timestamp;
  }
}

function syncMockAutomationBrowserSessionState(
  session: any,
  options?: { finalize?: boolean },
) {
  const run = resolveMockAutomationRunBySession(session.session_id);
  const job = resolveMockAutomationJobByRun(run);
  if (!run || !job) {
    return session;
  }
  if (["success", "error", "canceled", "timeout"].includes(run.status)) {
    return session;
  }

  if (options?.finalize || session.lifecycle_state === "closed") {
    finishMockAutomationBrowserRun(job, run, session, "success");
    return session;
  }
  if (session.lifecycle_state === "failed") {
    finishMockAutomationBrowserRun(job, run, session, "error");
    return session;
  }

  const timestamp = now();
  const status =
    session.lifecycle_state === "human_controlling"
      ? "human_controlling"
      : session.lifecycle_state === "waiting_for_human"
        ? "waiting_for_human"
        : session.lifecycle_state === "agent_resuming"
          ? "agent_resuming"
          : "running";

  run.status = "running";
  run.finished_at = null;
  run.duration_ms = null;
  run.error_code = null;
  run.error_message = null;
  run.updated_at = timestamp;
  run.metadata = buildMockAutomationBrowserMetadata(job, session, status, null);

  job.last_status = status;
  job.last_error = null;
  job.last_run_at = run.started_at;
  job.last_finished_at = null;
  job.running_started_at = job.running_started_at ?? run.started_at;
  job.next_run_at = null;
  job.updated_at = timestamp;
  return session;
}

type MockReviewDecisionRequest = {
  session_id?: string;
  sessionId?: string;
  decision_status?: string;
  decisionStatus?: string;
  decision_summary?: string;
  decisionSummary?: string;
  chosen_fix_strategy?: string;
  chosenFixStrategy?: string;
  risk_level?: string;
  riskLevel?: string;
  risk_tags?: string[];
  riskTags?: string[];
  human_reviewer?: string;
  humanReviewer?: string;
  reviewed_at?: string | null;
  reviewedAt?: string | null;
  followup_actions?: string[];
  followupActions?: string[];
  regression_requirements?: string[];
  regressionRequirements?: string[];
  notes?: string;
};

const MOCK_PARAMETER_RESTRICTED_TOOL_NAMES = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "NotebookEdit",
  "PowerShell",
  "LSP",
]);

function resolveMockToolPermissionPlane(
  tool: MockToolSpec,
): "session_allowlist" | "parameter_restricted" {
  if (tool.permission_plane) {
    return tool.permission_plane;
  }
  return MOCK_PARAMETER_RESTRICTED_TOOL_NAMES.has(tool.name)
    ? "parameter_restricted"
    : "session_allowlist";
}

function resolveMockWorkspaceDefaultAllow(tool: MockToolSpec): boolean {
  if (typeof tool.workspace_default_allow === "boolean") {
    return tool.workspace_default_allow;
  }
  return resolveMockToolPermissionPlane(tool) === "session_allowlist";
}

function resolveMockExecutionWarningPolicy(tool: MockToolSpec): string {
  if (tool.execution_warning_policy) {
    return tool.execution_warning_policy;
  }
  return ["Bash", "PowerShell"].includes(tool.name)
    ? "shell_command_risk"
    : "none";
}

function resolveMockExecutionRestrictionProfile(tool: MockToolSpec): string {
  if (tool.execution_restriction_profile) {
    return tool.execution_restriction_profile;
  }
  if (["Bash", "PowerShell"].includes(tool.name)) {
    return "workspace_shell_command";
  }
  if (
    ["Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit", "LSP"].includes(
      tool.name,
    )
  ) {
    return "workspace_path_required";
  }
  return "none";
}

function resolveMockExecutionSandboxProfile(tool: MockToolSpec): string {
  if (tool.execution_sandbox_profile) {
    return tool.execution_sandbox_profile;
  }
  return ["Bash", "PowerShell"].includes(tool.name)
    ? "workspace_command"
    : "none";
}

const CORE_MOCK_TOOL_SPECS: MockToolSpec[] = [
  {
    name: "ToolSearch",
    description: "搜索当前会话可用工具与能力清单。",
    capabilities: ["web_search"],
    source: "lime_injected",
    tags: ["search"],
    input_examples_count: 1,
  },
  {
    name: "ListMcpResourcesTool",
    description: "列出当前已连接 MCP 服务暴露的资源。",
    capabilities: ["web_search"],
    source: "lime_injected",
    tags: ["mcp", "resource", "list"],
    input_examples_count: 1,
  },
  {
    name: "ReadMcpResourceTool",
    description: "按 server 与 uri 读取指定 MCP 资源内容。",
    capabilities: ["web_search"],
    source: "lime_injected",
    tags: ["mcp", "resource", "read"],
    input_examples_count: 1,
  },
  {
    name: "Bash",
    description: "执行工作区命令并返回结果。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["command", "workspace"],
    input_examples_count: 1,
  },
  {
    name: "Read",
    description: "读取文件内容。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["read", "file"],
    input_examples_count: 1,
  },
  {
    name: "Write",
    description: "写入文件内容。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["write", "file"],
    input_examples_count: 1,
  },
  {
    name: "Edit",
    description: "按补丁方式编辑文件。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["edit", "file"],
    input_examples_count: 1,
  },
  {
    name: "Glob",
    description: "按模式列出匹配文件。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["search", "file"],
    input_examples_count: 1,
  },
  {
    name: "Grep",
    description: "在工作区中搜索文本。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["search", "text"],
    input_examples_count: 1,
  },
  {
    name: "WebFetch",
    description: "抓取指定网页内容。",
    capabilities: ["web_search"],
    source: "aster_builtin",
    tags: ["web", "fetch"],
    input_examples_count: 1,
    execution_restriction_profile: "safe_https_url_required",
  },
  {
    name: "WebSearch",
    description: "联网检索公开网页信息。",
    capabilities: ["web_search"],
    source: "aster_builtin",
    tags: ["research"],
    input_examples_count: 2,
    execution_restriction_profile: "safe_https_url_required",
  },
  {
    name: "AskUserQuestion",
    description: "向用户发起单轮最小必要澄清。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["clarify"],
    input_examples_count: 1,
  },
  {
    name: "SendUserMessage",
    description: "向用户发送一条主可见消息，可用于回复、进度同步或主动提醒。",
    capabilities: ["session_control"],
    source: "aster_builtin",
    tags: ["message", "user"],
    input_examples_count: 1,
  },
  {
    name: "StructuredOutput",
    description: "输出结构化最终答复。",
    capabilities: ["session_control"],
    source: "aster_builtin",
    tags: ["response", "output"],
    input_examples_count: 1,
    permission_plane: "session_allowlist",
    workspace_default_allow: false,
  },
  {
    name: "Agent",
    description: "在需要并行处理时派生子代理。",
    capabilities: ["delegation"],
    source: "lime_injected",
    tags: ["delegation"],
    input_examples_count: 1,
  },
  {
    name: "SendMessage",
    description: "向已存在的协作成员追加说明或指令。",
    capabilities: ["delegation"],
    source: "aster_builtin",
    tags: ["delegation"],
    input_examples_count: 1,
  },
  {
    name: "TeamCreate",
    description: "创建共享 task board 与 team 协作上下文。",
    capabilities: ["delegation"],
    source: "aster_builtin",
    tags: ["delegation", "team"],
    input_examples_count: 1,
  },
  {
    name: "TeamDelete",
    description: "删除当前 team 协作上下文。",
    capabilities: ["delegation"],
    source: "aster_builtin",
    tags: ["delegation", "team"],
    input_examples_count: 1,
  },
  {
    name: "ListPeers",
    description: "列出当前 team 中可直接通信的协作成员。",
    capabilities: ["delegation"],
    source: "aster_builtin",
    tags: ["delegation", "team"],
    input_examples_count: 1,
  },
  {
    name: "Skill",
    description: "加载并执行当前可用技能。",
    capabilities: ["skill_execution"],
    source: "aster_builtin",
    tags: ["skill"],
    input_examples_count: 1,
  },
  {
    name: "Workflow",
    description: "执行工作流脚本。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["workflow"],
    input_examples_count: 1,
  },
  {
    name: "TaskCreate",
    description: "创建结构化任务。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["task"],
    input_examples_count: 1,
  },
  {
    name: "TaskList",
    description: "查看结构化任务列表。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["task"],
    input_examples_count: 1,
  },
  {
    name: "TaskGet",
    description: "读取单个结构化任务。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["task"],
    input_examples_count: 1,
  },
  {
    name: "TaskUpdate",
    description: "更新结构化任务状态。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["task"],
    input_examples_count: 1,
  },
  {
    name: "TaskOutput",
    description: "读取任务输出结果。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["task", "output"],
    input_examples_count: 1,
  },
  {
    name: "TaskStop",
    description: "停止正在执行的任务。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["task"],
    input_examples_count: 1,
  },
  {
    name: "NotebookEdit",
    description: "编辑 notebook 单元内容。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["notebook"],
    input_examples_count: 1,
  },
  {
    name: "EnterPlanMode",
    description: "进入计划模式以拆解方案。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["planning"],
    input_examples_count: 1,
  },
  {
    name: "ExitPlanMode",
    description: "退出计划模式并继续执行。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["planning"],
    input_examples_count: 1,
  },
  {
    name: "EnterWorktree",
    description: "进入独立工作树执行隔离修改。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["worktree"],
    input_examples_count: 1,
  },
  {
    name: "ExitWorktree",
    description: "退出独立工作树并回到主工作区。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["worktree"],
    input_examples_count: 1,
  },
  {
    name: "Config",
    description: "查看或调整当前运行配置。",
    capabilities: ["session_control"],
    source: "aster_builtin",
    tags: ["config"],
    input_examples_count: 1,
  },
  {
    name: "Sleep",
    description: "等待一段时间后继续执行。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["timing"],
    input_examples_count: 1,
  },
  {
    name: "PowerShell",
    description: "在 PowerShell 环境中执行命令。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["command", "windows"],
    input_examples_count: 1,
  },
  {
    name: "LSP",
    description: "查询语言服务返回的语义信息。",
    capabilities: ["workspace_io"],
    source: "aster_builtin",
    tags: ["code", "lsp"],
    input_examples_count: 1,
  },
  {
    name: "RemoteTrigger",
    description: "管理或触发远程 trigger 执行。",
    capabilities: ["execution"],
    source: "aster_builtin",
    tags: ["trigger", "remote"],
    input_examples_count: 1,
  },
  {
    name: "CronCreate",
    description: "创建新的定时触发器。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["trigger", "schedule"],
    input_examples_count: 1,
  },
  {
    name: "CronList",
    description: "查看当前可用的定时触发器。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["trigger", "schedule"],
    input_examples_count: 1,
  },
  {
    name: "CronDelete",
    description: "删除指定的定时触发器。",
    capabilities: ["planning"],
    source: "aster_builtin",
    tags: ["trigger", "schedule"],
    input_examples_count: 1,
  },
];

const WORKBENCH_MOCK_TOOL_SPECS: MockToolSpec[] = [
  {
    name: "social_generate_cover_image",
    description: "为内容生成封面图片。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "image", "cover"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_video_generation_task",
    description: "创建视频生成任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "video", "task"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_transcription_task",
    description: "创建转写任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "audio", "transcription"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_broadcast_generation_task",
    description: "创建播报生成任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "audio", "broadcast"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_cover_generation_task",
    description: "创建封面生成任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "image", "cover"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_modal_resource_search_task",
    description: "创建素材检索任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "resource", "search"],
    input_examples_count: 1,
  },
  {
    name: "lime_search_web_images",
    description: "联网搜索图片素材。",
    capabilities: ["web_search"],
    source: "lime_injected",
    tags: ["content", "image", "search"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_image_generation_task",
    description: "创建图片生成任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "image", "task"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_url_parse_task",
    description: "创建链接解析任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "url", "task"],
    input_examples_count: 1,
  },
  {
    name: "lime_create_typesetting_task",
    description: "创建排版任务。",
    capabilities: ["content_creation"],
    source: "lime_injected",
    tags: ["content", "typesetting", "task"],
    input_examples_count: 1,
  },
  {
    name: "lime_run_service_skill",
    description: "执行当前绑定的服务型场景技能。",
    capabilities: ["execution"],
    source: "lime_injected",
    tags: ["service_skill", "runtime"],
    input_examples_count: 1,
  },
];

const BROWSER_ASSIST_MOCK_TOOL_SPECS: MockToolSpec[] = [
  {
    name: "lime_site_list",
    description: "列出可用站点能力。",
    capabilities: ["browser_runtime", "web_search"],
    source: "lime_injected",
    tags: ["site", "browser", "list"],
    input_examples_count: 1,
  },
  {
    name: "lime_site_recommend",
    description: "推荐适合当前目标的站点能力。",
    capabilities: ["browser_runtime", "web_search"],
    source: "lime_injected",
    tags: ["site", "browser", "recommend"],
    input_examples_count: 1,
  },
  {
    name: "lime_site_search",
    description: "搜索站点能力。",
    capabilities: ["browser_runtime", "web_search"],
    source: "lime_injected",
    tags: ["site", "browser", "search"],
    input_examples_count: 1,
  },
  {
    name: "lime_site_info",
    description: "查看站点能力详情。",
    capabilities: ["browser_runtime", "web_search"],
    source: "lime_injected",
    tags: ["site", "browser", "info"],
    input_examples_count: 1,
  },
  {
    name: "lime_site_run",
    description: "执行站点能力。",
    capabilities: ["browser_runtime", "web_search"],
    source: "lime_injected",
    tags: ["site", "browser", "run"],
    input_examples_count: 1,
  },
];

const BROWSER_RUNTIME_PREFIX_CATALOG_ENTRY = {
  name: "mcp__lime-browser__",
  profiles: ["browser_assist"],
  capabilities: ["browser_runtime"],
  lifecycle: "current",
  source: "browser_compatibility",
  permission_plane: "caller_filtered",
  workspace_default_allow: false,
  execution_warning_policy: "none",
  execution_warning_policy_source: "default",
  execution_restriction_profile: "none",
  execution_restriction_profile_source: "default",
  execution_sandbox_profile: "none",
  execution_sandbox_profile_source: "default",
} as const;

function listEnabledBrowserAssistCapabilityKeys(): string[] {
  return DEFAULT_MOCK_BROWSER_ACTION_CAPABILITIES.filter(
    (capability) => capability.enabled,
  )
    .map((capability) => capability.key)
    .sort();
}

function isLoadedBrowserAssistCapability(key: string): boolean {
  return key === "navigate";
}

function listEnabledBrowserAssistCapabilities() {
  return [...DEFAULT_MOCK_BROWSER_ACTION_CAPABILITIES]
    .filter((capability) => capability.enabled)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function buildMockAgentRuntimeToolInventory(request?: {
  caller?: string;
  workbench?: boolean;
  browserAssist?: boolean;
}) {
  const caller = request?.caller?.trim() || "assistant";
  const surface = {
    workbench: request?.workbench === true,
    browser_assist: request?.browserAssist === true,
  };
  const toolSpecs: MockToolSpec[] = [
    ...CORE_MOCK_TOOL_SPECS,
    ...(surface.workbench ? WORKBENCH_MOCK_TOOL_SPECS : []),
    ...(surface.browser_assist ? BROWSER_ASSIST_MOCK_TOOL_SPECS : []),
  ];

  const catalogTools = [
    ...toolSpecs.map((tool) => ({
      name: tool.name,
      profiles: [
        surface.workbench &&
        WORKBENCH_MOCK_TOOL_SPECS.some((entry) => entry.name === tool.name)
          ? "workbench"
          : surface.browser_assist &&
              BROWSER_ASSIST_MOCK_TOOL_SPECS.some(
                (entry) => entry.name === tool.name,
              )
            ? "browser_assist"
            : "core",
      ],
      capabilities: [...tool.capabilities],
      lifecycle: "current",
      source: tool.source,
      permission_plane: resolveMockToolPermissionPlane(tool),
      workspace_default_allow: resolveMockWorkspaceDefaultAllow(tool),
      execution_warning_policy: resolveMockExecutionWarningPolicy(tool),
      execution_warning_policy_source: "default",
      execution_restriction_profile:
        resolveMockExecutionRestrictionProfile(tool),
      execution_restriction_profile_source: "default",
      execution_sandbox_profile: resolveMockExecutionSandboxProfile(tool),
      execution_sandbox_profile_source: "default",
    })),
    ...(surface.browser_assist ? [BROWSER_RUNTIME_PREFIX_CATALOG_ENTRY] : []),
  ];

  const registryTools = toolSpecs.map((tool) => ({
    name: tool.name,
    description: tool.description,
    catalog_entry_name: tool.name,
    catalog_source: tool.source,
    catalog_lifecycle: "current",
    catalog_permission_plane: resolveMockToolPermissionPlane(tool),
    catalog_workspace_default_allow: resolveMockWorkspaceDefaultAllow(tool),
    catalog_execution_warning_policy: resolveMockExecutionWarningPolicy(tool),
    catalog_execution_warning_policy_source: "default",
    catalog_execution_restriction_profile:
      resolveMockExecutionRestrictionProfile(tool),
    catalog_execution_restriction_profile_source: "default",
    catalog_execution_sandbox_profile: resolveMockExecutionSandboxProfile(tool),
    catalog_execution_sandbox_profile_source: "default",
    deferred_loading: false,
    always_visible: true,
    allowed_callers: [caller],
    tags: [...tool.tags],
    input_examples_count: tool.input_examples_count,
    caller_allowed: true,
    visible_in_context: true,
  }));
  registryTools.sort((left, right) => left.name.localeCompare(right.name));

  const extensionSurfaces = surface.browser_assist
    ? [
        {
          extension_name: "mcp__lime-browser",
          description: "浏览器协助桥接工具集。",
          source_kind: "mcp_bridge",
          deferred_loading: false,
          allowed_caller: caller,
          available_tools: listEnabledBrowserAssistCapabilityKeys(),
          always_expose_tools: ["navigate"],
          loaded_tools: ["mcp__lime-browser__navigate"],
          searchable_tools: listEnabledBrowserAssistCapabilityKeys().map(
            (key) => `mcp__lime-browser__${key}`,
          ),
        },
      ]
    : [];
  const extensionTools = surface.browser_assist
    ? listEnabledBrowserAssistCapabilityKeys().map((key) => {
        const loaded = isLoadedBrowserAssistCapability(key);
        return {
          name: `mcp__lime-browser__${key}`,
          description:
            DEFAULT_MOCK_BROWSER_ACTION_CAPABILITIES.find(
              (capability) => capability.key === key,
            )?.description || "浏览器协助工具。",
          extension_name: "mcp__lime-browser",
          source_kind: "mcp_bridge",
          deferred_loading: !loaded,
          allowed_caller: caller,
          status: loaded ? "loaded" : "deferred",
          caller_allowed: true,
          visible_in_context: loaded,
        };
      })
    : [];
  const mcpTools = surface.browser_assist
    ? listEnabledBrowserAssistCapabilities().map((capability) => {
        const loaded = isLoadedBrowserAssistCapability(capability.key);
        return {
          server_name: "lime-browser",
          name: `mcp__lime-browser__${capability.key}`,
          description: capability.description,
          deferred_loading: !loaded,
          always_visible: loaded,
          allowed_callers: [caller],
          tags: ["browser", capability.group],
          input_examples_count: 1,
          caller_allowed: true,
          visible_in_context: loaded,
        };
      })
    : [];
  const runtimeTools: Array<{
    name: string;
    description: string;
    source_kind:
      | "registry_native"
      | "current_surface"
      | "runtime_extension"
      | "mcp";
    source_label?: string;
    status?: string;
    catalog_entry_name?: string;
    catalog_source?: string;
    catalog_lifecycle?: string;
    catalog_permission_plane?: string;
    catalog_workspace_default_allow?: boolean;
    deferred_loading: boolean;
    always_visible: boolean;
    allowed_callers: string[];
    tags: string[];
    input_examples_count: number;
    caller_allowed: boolean;
    visible_in_context: boolean;
  }> = [];
  const pushRuntimeTool = (tool: (typeof runtimeTools)[number]) => {
    if (
      runtimeTools.some(
        (entry) => entry.name.toLowerCase() === tool.name.toLowerCase(),
      )
    ) {
      return;
    }
    runtimeTools.push(tool);
  };
  registryTools.forEach((entry) => {
    pushRuntimeTool({
      name: entry.name,
      description: entry.description,
      source_kind: "registry_native",
      catalog_entry_name: entry.catalog_entry_name,
      catalog_source: entry.catalog_source,
      catalog_lifecycle: entry.catalog_lifecycle,
      catalog_permission_plane: entry.catalog_permission_plane,
      catalog_workspace_default_allow: entry.catalog_workspace_default_allow,
      deferred_loading: entry.deferred_loading,
      always_visible: entry.always_visible,
      allowed_callers: entry.allowed_callers,
      tags: entry.tags,
      input_examples_count: entry.input_examples_count,
      caller_allowed: entry.caller_allowed,
      visible_in_context: entry.visible_in_context,
    });
  });
  extensionTools.forEach((entry) => {
    pushRuntimeTool({
      name: entry.name,
      description: entry.description,
      source_kind: "runtime_extension",
      source_label: entry.extension_name,
      status: entry.status,
      deferred_loading: entry.deferred_loading,
      always_visible: false,
      allowed_callers: entry.allowed_caller ? [entry.allowed_caller] : [],
      tags: [],
      input_examples_count: 0,
      caller_allowed: entry.caller_allowed,
      visible_in_context: entry.visible_in_context,
    });
  });
  mcpTools.forEach((entry) => {
    pushRuntimeTool({
      name: entry.name,
      description: entry.description,
      source_kind: "mcp",
      source_label: entry.server_name,
      deferred_loading: entry.deferred_loading,
      always_visible: entry.always_visible,
      allowed_callers: entry.allowed_callers,
      tags: entry.tags,
      input_examples_count: entry.input_examples_count,
      caller_allowed: entry.caller_allowed,
      visible_in_context: entry.visible_in_context,
    });
  });
  runtimeTools.sort((left, right) => left.name.localeCompare(right.name));

  const defaultAllowedTools = registryTools
    .filter((entry) => entry.catalog_workspace_default_allow)
    .map((entry) => entry.name);
  defaultAllowedTools.sort((left, right) => left.localeCompare(right));

  return {
    request: {
      caller,
      surface,
    },
    agent_initialized: false,
    warnings: [
      "当前展示的是浏览器 fallback mock 工具库存；如需完整运行时状态，请保持 DevBridge 后端在线。",
    ],
    mcp_servers: surface.browser_assist ? ["lime-browser"] : [],
    default_allowed_tools: defaultAllowedTools,
    counts: {
      catalog_total: catalogTools.length,
      catalog_current_total: catalogTools.length,
      catalog_compat_total: 0,
      catalog_deprecated_total: 0,
      default_allowed_total: defaultAllowedTools.length,
      runtime_total: runtimeTools.length,
      runtime_visible_total: runtimeTools.filter(
        (entry) => entry.visible_in_context,
      ).length,
      registry_total: registryTools.length,
      registry_visible_total: registryTools.filter(
        (entry) => entry.visible_in_context,
      ).length,
      registry_catalog_unmapped_total: 0,
      extension_surface_total: extensionSurfaces.length,
      extension_mcp_bridge_total: extensionSurfaces.length,
      extension_runtime_total: 0,
      extension_tool_total: extensionTools.length,
      extension_tool_visible_total: extensionTools.filter(
        (entry) => entry.visible_in_context,
      ).length,
      mcp_server_total: surface.browser_assist ? 1 : 0,
      mcp_tool_total: mcpTools.length,
      mcp_tool_visible_total: mcpTools.filter(
        (entry) => entry.visible_in_context,
      ).length,
    },
    catalog_tools: catalogTools,
    registry_tools: registryTools,
    runtime_tools: runtimeTools,
    extension_surfaces: extensionSurfaces,
    extension_tools: extensionTools,
    mcp_tools: mcpTools,
  };
}

function createDefaultCompanionPetStatus(): CompanionPetStatus {
  return {
    endpoint: "ws://127.0.0.1:45554/companion/pet",
    server_listening: true,
    connected: false,
    client_id: null,
    platform: null,
    capabilities: [] as string[],
    last_event: null,
    last_error: null,
    last_state: null as
      | "hidden"
      | "idle"
      | "walking"
      | "thinking"
      | "done"
      | null,
  };
}

let mockCompanionPetStatus = createDefaultCompanionPetStatus();

// 默认 mock 数据
const defaultMocks: Record<string, any> = {
  companion_get_pet_status: () => ({
    ...mockCompanionPetStatus,
    capabilities: [...mockCompanionPetStatus.capabilities],
  }),
  companion_launch_pet: (args?: Record<string, unknown>) => {
    const request =
      (args?.request as Record<string, unknown> | undefined) ?? args ?? {};
    const endpoint =
      typeof request.endpoint === "string" && request.endpoint.trim()
        ? request.endpoint
        : mockCompanionPetStatus.endpoint;

    mockCompanionPetStatus = {
      ...mockCompanionPetStatus,
      endpoint,
      server_listening: true,
      last_event: "pet.launch_requested",
      last_error: null,
    };

    return {
      launched: true,
      resolved_path:
        typeof request.app_path === "string" ? request.app_path : null,
      endpoint,
      message: null,
    };
  },
  companion_send_pet_command: (args?: Record<string, unknown>) => {
    const request =
      (args?.request as Record<string, unknown> | undefined) ?? args ?? {};
    const event =
      typeof request.event === "string" ? request.event : "pet.show_bubble";
    const payload =
      (request.payload as Record<string, unknown> | undefined) ?? {};

    let lastState = mockCompanionPetStatus.last_state;
    if (event === "pet.hide") {
      lastState = "hidden";
    } else if (event === "pet.show") {
      lastState = "walking";
    } else if (
      event === "pet.state_changed" &&
      typeof payload.state === "string"
    ) {
      lastState = payload.state as
        | "hidden"
        | "idle"
        | "walking"
        | "thinking"
        | "done";
    }

    mockCompanionPetStatus = {
      ...mockCompanionPetStatus,
      last_event: event,
      last_error: null,
      last_state: lastState,
    };

    return {
      delivered: true,
      connected: mockCompanionPetStatus.connected,
    };
  },
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
      webmcp: {
        enabled: false,
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
    workspace_preferences: {
      schema_version: 1,
      media_defaults: {},
      companion_defaults: {},
    },
    navigation: {
      schema_version: 1,
      enabled_items: [
        "home-general",
        "claw",
        "video",
        "automation",
        "openclaw",
        "resources",
        "memory",
      ],
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
    logMockInfo("[Mock] Config saved:", config);
    return { success: true };
  },

  // Provider 相关
  get_providers: () => [],
  get_credentials: () => [],
  get_default_provider: () => "kiro",
  set_default_provider: (args: any) => {
    const provider = args?.provider ?? args;
    logMockInfo("[Mock] Default provider set to:", provider);
    return provider;
  },
  get_available_models: () => [],
  get_hint_routes: () => [],
  get_windows_startup_diagnostics: () => ({
    platform: "mock-web",
    app_data_dir: null,
    legacy_lime_dir: null,
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

  // OpenClaw 相关
  openclaw_check_installed: () => ({
    installed: false,
    path: null,
  }),
  openclaw_get_environment_status: () => ({
    node: {
      status: "ok",
      version: "22.12.0",
      path: "/opt/homebrew/bin/node",
      message: "Node.js 已就绪：22.12.0",
      autoInstallSupported: true,
    },
    git: {
      status: "ok",
      version: "2.44.0",
      path: "/usr/bin/git",
      message: "Git 已就绪：2.44.0",
      autoInstallSupported: true,
    },
    openclaw: {
      status: "missing",
      version: null,
      path: null,
      message: "未检测到 OpenClaw，可在环境就绪后一键安装。",
      autoInstallSupported: false,
    },
    recommendedAction: "install_openclaw",
    summary: "运行环境已就绪，可以继续一键安装 OpenClaw。",
    diagnostics: {
      npmPath: "/opt/homebrew/bin/npm",
      npmGlobalPrefix: "/opt/homebrew",
      openclawPackagePath: null,
      whereCandidates: [],
      supplementalSearchDirs: ["/opt/homebrew/bin", "/usr/local/bin"],
      supplementalCommandCandidates: [],
      gitWhereCandidates: [],
      gitSupplementalSearchDirs: [],
      gitSupplementalCommandCandidates: [],
    },
    tempArtifacts: [],
  }),
  openclaw_check_node_version: () => ({
    status: "ok",
    version: "22.12.0",
    path: "/opt/homebrew/bin/node",
  }),
  openclaw_check_git_available: () => ({
    available: true,
    path: "/usr/bin/git",
  }),
  openclaw_get_node_download_url: () => "https://nodejs.org/en/download",
  openclaw_get_git_download_url: () => "https://git-scm.com/downloads",
  openclaw_install: () => ({
    success: true,
    message: "OpenClaw 安装请求已在浏览器 mock 模式下完成。",
  }),
  openclaw_install_dependency: (args: any) => ({
    success: true,
    message: `${args?.kind === "git" ? "Git" : "Node.js"} 安装请求已在浏览器 mock 模式下完成。`,
  }),
  openclaw_get_command_preview: (args: any) => ({
    title: "Mock OpenClaw 命令预览",
    command: `mock ${args?.operation ?? "install"}`,
  }),
  openclaw_uninstall: () => ({
    success: true,
    message: "OpenClaw 卸载请求已在浏览器 mock 模式下完成。",
  }),
  openclaw_cleanup_temp_artifacts: () => ({
    success: true,
    message: "未发现需要清理的 OpenClaw 临时文件。",
  }),
  openclaw_start_gateway: () => ({
    success: true,
    message: "Gateway 已在浏览器 mock 模式下启动。",
  }),
  openclaw_stop_gateway: () => ({
    success: true,
    message: "Gateway 已在浏览器 mock 模式下停止。",
  }),
  openclaw_restart_gateway: () => ({
    success: true,
    message: "Gateway 已在浏览器 mock 模式下重启。",
  }),
  openclaw_get_status: () => ({
    status: "stopped",
    port: 18790,
  }),
  openclaw_check_health: () => ({
    status: "unhealthy",
    gatewayPort: 18790,
    uptime: null,
    version: null,
  }),
  openclaw_get_dashboard_url: () =>
    "http://127.0.0.1:18790/#token=mock-openclaw",
  openclaw_get_channels: () => [],
  openclaw_get_progress_logs: () => [],
  openclaw_sync_provider_config: () => ({
    success: true,
    message: "Provider 配置已同步到浏览器 mock 环境。",
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
  get_log_storage_diagnostics: () => ({
    log_directory: "/tmp/lime/logs",
    current_log_path: "/tmp/lime/logs/lime.log",
    current_log_exists: true,
    current_log_size_bytes: 1024,
    in_memory_log_count: 0,
    related_log_files: [],
    raw_response_files: [],
  }),
  list_browser_environment_presets_cmd: (args: any) => {
    const includeArchived = Boolean(args?.request?.include_archived);
    return mockBrowserEnvironmentPresets.filter(
      (preset) => includeArchived || preset.archived_at === null,
    );
  },
  save_browser_environment_preset_cmd: (args: any) => {
    const request = args?.request ?? {};
    const now = new Date().toISOString();
    const existingIndex = mockBrowserEnvironmentPresets.findIndex(
      (preset) => preset.id === request.id,
    );
    if (existingIndex >= 0) {
      const existing = mockBrowserEnvironmentPresets[existingIndex];
      const next = {
        ...existing,
        name: request.name ?? existing.name,
        description: request.description ?? null,
        proxy_server: request.proxy_server ?? null,
        timezone_id: request.timezone_id ?? null,
        locale: request.locale ?? null,
        accept_language: request.accept_language ?? null,
        geolocation_lat: request.geolocation_lat ?? null,
        geolocation_lng: request.geolocation_lng ?? null,
        geolocation_accuracy_m: request.geolocation_accuracy_m ?? null,
        user_agent: request.user_agent ?? null,
        platform: request.platform ?? null,
        viewport_width: request.viewport_width ?? null,
        viewport_height: request.viewport_height ?? null,
        device_scale_factor: request.device_scale_factor ?? null,
        updated_at: now,
      };
      mockBrowserEnvironmentPresets[existingIndex] = next;
      return next;
    }
    const created = {
      id: request.id ?? `browser-environment-${Date.now()}`,
      name: request.name ?? "未命名环境",
      description: request.description ?? null,
      proxy_server: request.proxy_server ?? null,
      timezone_id: request.timezone_id ?? null,
      locale: request.locale ?? null,
      accept_language: request.accept_language ?? null,
      geolocation_lat: request.geolocation_lat ?? null,
      geolocation_lng: request.geolocation_lng ?? null,
      geolocation_accuracy_m: request.geolocation_accuracy_m ?? null,
      user_agent: request.user_agent ?? null,
      platform: request.platform ?? null,
      viewport_width: request.viewport_width ?? null,
      viewport_height: request.viewport_height ?? null,
      device_scale_factor: request.device_scale_factor ?? null,
      created_at: now,
      updated_at: now,
      last_used_at: null,
      archived_at: null,
    };
    mockBrowserEnvironmentPresets.unshift(created);
    return created;
  },
  archive_browser_environment_preset_cmd: (args: any) => {
    const preset = mockBrowserEnvironmentPresets.find(
      (item) => item.id === args?.request?.id,
    );
    if (!preset || preset.archived_at) {
      return false;
    }
    const now = new Date().toISOString();
    preset.archived_at = now;
    preset.updated_at = now;
    return true;
  },
  restore_browser_environment_preset_cmd: (args: any) => {
    const preset = mockBrowserEnvironmentPresets.find(
      (item) => item.id === args?.request?.id,
    );
    if (!preset || !preset.archived_at) {
      return false;
    }
    preset.archived_at = null;
    preset.updated_at = new Date().toISOString();
    return true;
  },
  list_browser_profiles_cmd: (args: any) => {
    const includeArchived = Boolean(args?.request?.include_archived);
    return mockBrowserProfiles.filter(
      (profile) => includeArchived || profile.archived_at === null,
    );
  },
  save_browser_profile_cmd: (args: any) => {
    const request = args?.request ?? {};
    const now = new Date().toISOString();
    const profileKey = request.profile_key ?? `profile_${Date.now()}`;
    const existingIndex = mockBrowserProfiles.findIndex(
      (profile) => profile.id === request.id,
    );
    if (existingIndex >= 0) {
      const existing = mockBrowserProfiles[existingIndex];
      const nextTransportKind =
        request.transport_kind ?? existing.transport_kind;
      const nextManagedProfileDir =
        nextTransportKind === "existing_session"
          ? null
          : `/tmp/lime/chrome_profiles/${existing.profile_key}`;
      const next = {
        ...existing,
        name: request.name ?? existing.name,
        description: request.description ?? null,
        site_scope: request.site_scope ?? null,
        launch_url: request.launch_url ?? null,
        transport_kind: nextTransportKind,
        profile_dir: nextManagedProfileDir ?? "",
        managed_profile_dir: nextManagedProfileDir,
        updated_at: now,
      };
      mockBrowserProfiles[existingIndex] = next;
      return next;
    }
    const transportKind = request.transport_kind ?? "managed_cdp";
    const managedProfileDir =
      transportKind === "existing_session"
        ? null
        : `/tmp/lime/chrome_profiles/${profileKey}`;
    const created = {
      id: request.id ?? `browser-profile-${Date.now()}`,
      profile_key: profileKey,
      name: request.name ?? "未命名资料",
      description: request.description ?? null,
      site_scope: request.site_scope ?? null,
      launch_url: request.launch_url ?? null,
      transport_kind: transportKind,
      profile_dir: managedProfileDir ?? "",
      managed_profile_dir: managedProfileDir,
      created_at: now,
      updated_at: now,
      last_used_at: null,
      archived_at: null,
    };
    mockBrowserProfiles.unshift(created);
    return created;
  },
  archive_browser_profile_cmd: (args: any) => {
    const profile = mockBrowserProfiles.find(
      (item) => item.id === args?.request?.id,
    );
    if (!profile || profile.archived_at) {
      return false;
    }
    const now = new Date().toISOString();
    profile.archived_at = now;
    profile.updated_at = now;
    return true;
  },
  restore_browser_profile_cmd: (args: any) => {
    const profile = mockBrowserProfiles.find(
      (item) => item.id === args?.request?.id,
    );
    if (!profile || !profile.archived_at) {
      return false;
    }
    profile.archived_at = null;
    profile.updated_at = new Date().toISOString();
    return true;
  },
  launch_browser_session: (args: any) => {
    return buildMockBrowserSessionLaunchResponse(args?.request);
  },
  launch_browser_profile_runtime_assist_cmd: (args: any) =>
    buildMockBrowserSessionLaunchResponse({
      profile_id: args?.request?.id,
      url: args?.request?.url,
      environment_preset_id: args?.request?.environment_preset_id,
      target_id: args?.request?.target_id,
      open_window: args?.request?.open_window,
      stream_mode: args?.request?.stream_mode,
    }),
  get_chrome_profile_sessions: () =>
    mockBrowserProfiles
      .filter((profile) => profile.archived_at === null)
      .map((profile) => ({
        profile_key: profile.profile_key,
        browser_source: "system",
        browser_path:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        profile_dir: profile.profile_dir,
        remote_debugging_port: 13001,
        pid: 12345,
        started_at: now(),
        last_url: profile.launch_url ?? "https://www.google.com/",
      })),
  close_chrome_profile_session: () => true,
  cleanup_gui_smoke_chrome_profiles: () => ({
    matched_profiles: [],
    removed_profiles: [],
    skipped_profiles: [],
    terminated_process_count: 0,
  }),
  open_browser_runtime_debugger_window: () => ({ success: true }),
  close_browser_runtime_debugger_window: () => ({ success: true }),
  launch_browser_runtime_assist: (args: any) =>
    buildMockBrowserSessionLaunchResponse({
      profile_id: args?.request?.profile_id,
      profile_key: args?.request?.profile_key,
      url: args?.request?.url,
      environment_preset_id: args?.request?.environment?.preset_id,
      environment: args?.request?.environment,
      target_id: args?.request?.target_id,
      open_window: args?.request?.open_window,
      stream_mode: args?.request?.stream_mode,
    }),
  site_list_adapters: () => getMockEffectiveSiteAdapters(),
  site_recommend_adapters: (args: any) => {
    const rawLimit = Number(
      args?.request?.limit ?? mockSiteRecommendations.length,
    );
    const limit = Number.isFinite(rawLimit)
      ? Math.max(0, Math.floor(rawLimit))
      : mockSiteRecommendations.length;
    return mockSiteRecommendations.slice(0, limit);
  },
  site_search_adapters: (args: any) => {
    const query = String(args?.request?.query ?? "")
      .trim()
      .toLowerCase();
    const effectiveAdapters = getMockEffectiveSiteAdapters();
    if (!query) {
      return effectiveAdapters;
    }
    return effectiveAdapters.filter(
      (adapter) =>
        adapter.name.toLowerCase().includes(query) ||
        adapter.domain.toLowerCase().includes(query) ||
        adapter.description.toLowerCase().includes(query) ||
        adapter.capabilities.some((item: string) =>
          item.toLowerCase().includes(query),
        ),
    );
  },
  site_get_adapter_info: (args: any) => {
    const name = String(args?.request?.name ?? "");
    const adapter = getMockEffectiveSiteAdapters().find(
      (item) => item.name === name,
    );
    if (!adapter) {
      throw new Error("未找到对应的站点适配器");
    }
    return adapter;
  },
  site_get_adapter_launch_readiness: (args: any) => {
    const request = args?.request ?? {};
    const adapterName = String(request.adapter_name ?? "");
    const adapter = getMockEffectiveSiteAdapters().find(
      (item) => item.name === adapterName,
    );
    if (!adapter) {
      throw new Error("未找到对应的站点适配器");
    }

    const requestedProfileKey =
      typeof request.profile_key === "string" ? request.profile_key.trim() : "";
    const requestedTargetId =
      typeof request.target_id === "string" ? request.target_id.trim() : "";
    const matchingTab = mockExistingSessionTabs.find((tab) =>
      tab.url?.toLowerCase().includes(adapter.domain.replace(/^www\./, "")),
    );

    if (requestedProfileKey === "general_browser_assist") {
      return {
        status: "requires_browser_runtime",
        adapter: adapter.name,
        domain: adapter.domain,
        profile_key: requestedProfileKey,
        message:
          "当前资料属于 Lime 托管浏览器，不允许在 Claw 内静默接管执行；请改走浏览器工作台。",
        report_hint:
          "Claw 不会在后台偷偷启动浏览器；请先进入浏览器工作台连接真实浏览器并打开目标站点页面，再返回 Claw 重试。",
      };
    }

    if (requestedTargetId || matchingTab) {
      return {
        status: "ready",
        adapter: adapter.name,
        domain: adapter.domain,
        profile_key: requestedProfileKey || "attached-site-session",
        target_id:
          requestedTargetId || String(matchingTab?.id ?? "mock-target-1"),
        message: `已检测到 ${adapter.domain} 的真实浏览器页面，Claw 可以直接复用当前会话执行。`,
      };
    }

    return {
      status: "requires_browser_runtime",
      adapter: adapter.name,
      domain: adapter.domain,
      message: `当前没有检测到已附着到真实浏览器的 ${adapter.domain} 页面，请先去浏览器工作台连接浏览器并打开目标页面。`,
      report_hint:
        "Claw 不会在后台偷偷启动浏览器；请先进入浏览器工作台连接真实浏览器并打开目标站点页面，再返回 Claw 重试。",
    };
  },
  site_get_adapter_catalog_status: () => mockSiteAdapterCatalogStatus,
  site_apply_adapter_catalog_bootstrap: (args: any) => {
    const payload =
      args?.request?.payload?.siteAdapterCatalog ??
      args?.request?.payload?.site_adapter_catalog ??
      args?.request?.payload;
    const syncedAdapters: Array<{ name?: unknown }> = Array.isArray(
      payload?.adapters,
    )
      ? payload.adapters
      : [];
    mockServerSyncedSiteAdapters = syncedAdapters
      .map((adapter) =>
        normalizeMockSiteAdapterPayload(adapter, "server_synced"),
      )
      .filter(Boolean);
    mockSiteAdapterCatalogStatus = buildMockSiteCatalogStatus(
      "server_synced",
      mockServerSyncedSiteAdapters.length,
      {
        exists: syncedAdapters.length > 0,
        registry_version:
          Number.isFinite(payload?.registry_version) &&
          payload.registry_version > 0
            ? payload.registry_version
            : 1,
        directory: "/tmp/lime/site-adapters/server-synced",
        catalog_version:
          payload?.catalogVersion ??
          payload?.catalog_version ??
          payload?.version ??
          null,
        tenant_id: payload?.tenantId ?? payload?.tenant_id ?? null,
        synced_at: payload?.syncedAt ?? payload?.synced_at ?? null,
      },
    );
    return mockSiteAdapterCatalogStatus;
  },
  site_import_adapter_yaml_bundle: (args: any) => {
    const yamlBundle = String(args?.request?.yaml_bundle ?? "").trim();
    if (!yamlBundle) {
      throw new Error("请先输入外部来源 YAML");
    }

    mockImportedSiteAdapters = parseMockImportedYamlBundle(
      yamlBundle,
      typeof args?.request?.source_version === "string"
        ? args.request.source_version
        : undefined,
    );
    const catalogVersion =
      typeof args?.request?.catalog_version === "string"
        ? args.request.catalog_version
        : undefined;
    mockSiteAdapterCatalogStatus = buildMockSiteCatalogStatus(
      "imported",
      mockImportedSiteAdapters.length,
      {
        directory: "/tmp/lime/site-adapters/imported",
        catalog_version: catalogVersion ?? null,
      },
    );
    return {
      directory: "/tmp/lime/site-adapters/imported",
      adapter_count: mockImportedSiteAdapters.length,
      catalog_version: catalogVersion,
    };
  },
  site_clear_adapter_catalog_cache: () => {
    mockImportedSiteAdapters = [];
    mockServerSyncedSiteAdapters = [];
    mockSiteAdapterCatalogStatus = buildMockSiteCatalogStatus(
      "bundled",
      mockBundledSiteAdapters.length,
      {
        exists: false,
      },
    );
    return mockSiteAdapterCatalogStatus;
  },
  site_run_adapter: (args: any) => {
    const request = args?.request ?? {};
    const adapterName = String(request.adapter_name ?? "");
    if (
      request.require_attached_session &&
      (!request.profile_key || request.profile_key === "general_browser_assist")
    ) {
      return {
        ok: false,
        adapter: adapterName || "github/search",
        domain: adapterName.startsWith("zhihu")
          ? "www.zhihu.com"
          : "github.com",
        profile_key: request.profile_key ?? "general_browser_assist",
        entry_url: "https://example.com/mock-site",
        error_code: "attached_session_required",
        error_message:
          "当前执行链路没有附着到真实浏览器会话，请先去浏览器工作台连接目标站点后重试。",
        report_hint:
          "Claw 不会在后台偷偷启动浏览器；请先进入浏览器工作台连接真实浏览器并打开目标站点页面，再返回 Claw 重试。",
      };
    }
    const targetContentId =
      typeof request.content_id === "string" && request.content_id.trim()
        ? request.content_id.trim()
        : null;
    const targetProjectId =
      typeof request.project_id === "string" && request.project_id.trim()
        ? request.project_id.trim()
        : null;
    const title =
      typeof request.save_title === "string" && request.save_title.trim()
        ? request.save_title.trim()
        : targetContentId
          ? "当前主稿"
          : `站点采集 ${adapterName || "github/search"} 2026-03-25 12:00:00`;
    const bundleRootDir =
      adapterName === "x/article-export"
        ? "exports/x-article-export/mock-article"
        : undefined;
    return {
      ok: true,
      adapter: adapterName || "github/search",
      domain: adapterName.startsWith("zhihu") ? "www.zhihu.com" : "github.com",
      profile_key: request.profile_key ?? "general_browser_assist",
      session_id: "mock-cdp-session",
      target_id: "mock-target-1",
      entry_url: "https://example.com/mock-site",
      source_url: "https://example.com/mock-site",
      data: {
        items: [
          {
            title: "Mock item 1",
            url: "https://example.com/mock-site/item-1",
          },
          {
            title: "Mock item 2",
            url: "https://example.com/mock-site/item-2",
          },
        ],
        echo_args: request.args ?? {},
      },
      saved_content:
        targetContentId || targetProjectId
          ? {
              content_id: targetContentId || "mock-site-content-1",
              project_id: targetProjectId || "mock-current-project",
              title,
              project_root_path: "/mock/projects/current",
              bundle_relative_dir: bundleRootDir,
              markdown_relative_path: bundleRootDir
                ? `${bundleRootDir}/index.md`
                : undefined,
              images_relative_dir: bundleRootDir
                ? `${bundleRootDir}/images`
                : undefined,
              meta_relative_path: bundleRootDir
                ? `${bundleRootDir}/meta.json`
                : undefined,
              image_count: bundleRootDir ? 3 : undefined,
            }
          : undefined,
      saved_project_id:
        targetContentId || targetProjectId
          ? targetProjectId || "mock-current-project"
          : undefined,
      saved_by: targetContentId
        ? "explicit_content"
        : targetProjectId
          ? "explicit_project"
          : undefined,
    };
  },
  site_debug_run_adapter: (args: any) => {
    const request = args?.request ?? {};
    const adapterName = String(request.adapter_name ?? "");
    return {
      ok: true,
      adapter: adapterName || "github/search",
      domain: adapterName.startsWith("zhihu") ? "www.zhihu.com" : "github.com",
      profile_key: request.profile_key ?? "general_browser_assist",
      session_id: "mock-cdp-session",
      target_id: "mock-target-1",
      entry_url: "https://example.com/mock-site",
      source_url: "https://example.com/mock-site",
      data: {
        items: [
          {
            title: "Mock item 1",
            url: "https://example.com/mock-site/item-1",
          },
        ],
        echo_args: request.args ?? {},
        debug: true,
      },
    };
  },
  site_save_adapter_result: (args: any) => {
    const request = args?.request ?? {};
    const contentId =
      typeof request.content_id === "string" && request.content_id.trim()
        ? request.content_id.trim()
        : null;
    const projectId =
      typeof request.project_id === "string" && request.project_id.trim()
        ? request.project_id.trim()
        : "mock-project";
    const adapterName = String(
      request.run_request?.adapter_name ??
        request.result?.adapter ??
        "github/search",
    );
    const title =
      typeof request.save_title === "string" && request.save_title.trim()
        ? request.save_title.trim()
        : contentId
          ? "当前主稿"
          : `站点采集 ${adapterName} 2026-03-25 12:00:00`;
    return {
      content_id: contentId || "mock-site-content-1",
      project_id: projectId,
      title,
    };
  },
  open_chrome_profile_window: () => ({
    success: true,
    reused: false,
    browser_source: "system",
    browser_path:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    profile_dir: "/tmp/lime/chrome_profiles/search_google",
    remote_debugging_port: 13001,
    pid: 12345,
    devtools_http_url: "http://127.0.0.1:13001/json/version",
  }),
  get_chrome_bridge_endpoint_info: () => ({
    server_running: true,
    host: "127.0.0.1",
    port: 8999,
    observer_ws_url:
      "ws://127.0.0.1:8999/lime-chrome-observer/Lime_Key=proxy_cast",
    control_ws_url:
      "ws://127.0.0.1:8999/lime-chrome-control/Lime_Key=proxy_cast",
    bridge_key: "proxy_cast",
  }),
  get_chrome_bridge_status: () => mockChromeBridgeStatus,
  disconnect_browser_connector_session: () => {
    const disconnectedObserverCount = mockChromeBridgeStatus.observer_count;
    const disconnectedControlCount = mockChromeBridgeStatus.control_count;
    mockChromeBridgeStatus = {
      ...mockChromeBridgeStatus,
      observer_count: 0,
      control_count: 0,
      pending_command_count: 0,
      observers: [],
      controls: [],
      pending_commands: [],
    };
    return {
      disconnected_observer_count: disconnectedObserverCount,
      disconnected_control_count: disconnectedControlCount,
      status: mockChromeBridgeStatus,
    };
  },
  get_browser_connector_settings_cmd: () => mockBrowserConnectorSettings,
  set_browser_connector_install_root_cmd: (args: any) => {
    const installRootDir =
      typeof args?.request?.install_root_dir === "string" &&
      args.request.install_root_dir.trim()
        ? args.request.install_root_dir.trim()
        : "/mock/path/to/connectors";
    mockBrowserConnectorSettings = {
      ...mockBrowserConnectorSettings,
      install_root_dir: installRootDir,
      install_dir: `${installRootDir}/Lime Browser Connector`,
    };
    mockBrowserConnectorInstallStatus = {
      ...mockBrowserConnectorInstallStatus,
      install_root_dir: installRootDir,
      install_dir: `${installRootDir}/Lime Browser Connector`,
    };
    return mockBrowserConnectorSettings;
  },
  set_browser_connector_enabled_cmd: (args: any) => {
    mockBrowserConnectorSettings = {
      ...mockBrowserConnectorSettings,
      enabled: args?.enabled !== false,
    };
    return mockBrowserConnectorSettings;
  },
  set_system_connector_enabled_cmd: (args: any) => {
    const request = args?.request ?? {};
    mockBrowserConnectorSettings = {
      ...mockBrowserConnectorSettings,
      system_connectors: mockBrowserConnectorSettings.system_connectors.map(
        (connector) =>
          connector.id === request.id
            ? {
                ...connector,
                enabled: request.enabled === true,
                authorization_status:
                  request.enabled === true ? "authorized" : "not_determined",
                last_error: null,
              }
            : connector,
      ),
    };
    return mockBrowserConnectorSettings;
  },
  set_browser_action_capability_enabled_cmd: (args: any) => {
    const request = args?.request ?? {};
    const targetKey = normalizeMockBrowserActionCapabilityKey(
      String(request.key ?? ""),
    );
    mockBrowserConnectorSettings = {
      ...mockBrowserConnectorSettings,
      browser_action_capabilities:
        mockBrowserConnectorSettings.browser_action_capabilities.map(
          (capability) =>
            capability.key === targetKey
              ? {
                  ...capability,
                  enabled: request.enabled !== false,
                }
              : capability,
        ),
    };
    mockBrowserBackendsStatus = buildMockBrowserBackendsStatus();
    return mockBrowserConnectorSettings;
  },
  get_browser_connector_install_status_cmd: () =>
    mockBrowserConnectorInstallStatus,
  install_browser_connector_extension_cmd: (args: any) => {
    const installRootDir =
      typeof args?.request?.install_root_dir === "string" &&
      args.request.install_root_dir.trim()
        ? args.request.install_root_dir.trim()
        : (mockBrowserConnectorSettings.install_root_dir ??
          "/mock/path/to/connectors");
    const installDir = `${installRootDir}/Lime Browser Connector`;
    mockBrowserConnectorSettings = {
      ...mockBrowserConnectorSettings,
      install_root_dir: installRootDir,
      install_dir: installDir,
    };
    mockBrowserConnectorInstallStatus = {
      ...mockBrowserConnectorInstallStatus,
      status: "installed",
      install_root_dir: installRootDir,
      install_dir: installDir,
      installed_name: "Lime Browser Connector",
      installed_version: mockBrowserConnectorInstallStatus.bundled_version,
      message: "已安装最新版本浏览器连接器",
    };
    return {
      install_root_dir: installRootDir,
      install_dir: installDir,
      bundled_name: "Lime Browser Connector",
      bundled_version: mockBrowserConnectorInstallStatus.bundled_version,
      installed_version: mockBrowserConnectorInstallStatus.bundled_version,
      auto_config_path: `${installDir}/auto_config.json`,
    };
  },
  open_browser_extensions_page_cmd: () => true,
  open_browser_remote_debugging_page_cmd: () => true,
  chrome_bridge_execute_command: (args: any) => ({
    success: true,
    request_id: `mock-${Date.now()}`,
    command: args?.request?.command ?? "get_page_info",
    message: "mock command result",
    data:
      args?.request?.command === "list_tabs"
        ? {
            tabs: mockExistingSessionTabs,
          }
        : undefined,
    page_info: {
      title: "Mock Page",
      url: "https://example.com",
      markdown: "# Mock Page\nURL: https://example.com",
      updated_at: new Date().toISOString(),
    },
  }),
  get_browser_backend_policy: () => ({
    priority: ["aster_compat", "lime_extension_bridge", "cdp_direct"],
    auto_fallback: true,
  }),
  set_browser_backend_policy: (args: any) => ({
    priority: args?.policy?.priority ?? [
      "aster_compat",
      "lime_extension_bridge",
      "cdp_direct",
    ],
    auto_fallback: args?.policy?.auto_fallback ?? true,
  }),
  get_browser_backends_status: () => mockBrowserBackendsStatus,
  list_cdp_targets: () => [
    {
      id: "mock-target-1",
      title: "Mock Target",
      url: "https://example.com",
      target_type: "page",
      web_socket_debugger_url:
        "ws://127.0.0.1:13001/devtools/page/mock-target-1",
      devtools_frontend_url:
        "/devtools/inspector.html?ws=127.0.0.1:13001/devtools/page/mock-target-1",
    },
  ],
  open_cdp_session: (args: any) => ({
    session_id: "mock-cdp-session",
    profile_key: args?.request?.profile_key ?? "search_google",
    target_id: args?.request?.target_id ?? "mock-target-1",
    target_title: "Mock Target",
    target_url: "https://example.com",
    remote_debugging_port: 13001,
    ws_debugger_url: "ws://127.0.0.1:13001/devtools/page/mock-target-1",
    devtools_frontend_url:
      "/devtools/inspector.html?ws=127.0.0.1:13001/devtools/page/mock-target-1",
    stream_mode: undefined,
    last_page_info: {
      title: "Mock Target",
      url: "https://example.com",
      markdown: "# Mock Target\nURL: https://example.com",
      updated_at: new Date().toISOString(),
    },
    last_event_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    connected: true,
  }),
  close_cdp_session: () => true,
  start_browser_stream: (args: any) => ({
    session_id: args?.request?.session_id ?? "mock-cdp-session",
    profile_key: "search_google",
    target_id: "mock-target-1",
    target_title: "Mock Target",
    target_url: "https://example.com",
    remote_debugging_port: 13001,
    ws_debugger_url: "ws://127.0.0.1:13001/devtools/page/mock-target-1",
    stream_mode: args?.request?.mode ?? "both",
    last_page_info: {
      title: "Mock Target",
      url: "https://example.com",
      markdown: "# Mock Target\nURL: https://example.com",
      updated_at: new Date().toISOString(),
    },
    last_event_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    connected: true,
  }),
  stop_browser_stream: (args: any) => ({
    session_id: args?.request?.session_id ?? "mock-cdp-session",
    profile_key: "search_google",
    target_id: "mock-target-1",
    target_title: "Mock Target",
    target_url: "https://example.com",
    remote_debugging_port: 13001,
    ws_debugger_url: "ws://127.0.0.1:13001/devtools/page/mock-target-1",
    stream_mode: undefined,
    last_page_info: {
      title: "Mock Target",
      url: "https://example.com",
      markdown: "# Mock Target\nURL: https://example.com",
      updated_at: new Date().toISOString(),
    },
    last_event_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    connected: true,
  }),
  get_browser_session_state: (args: any) =>
    syncMockAutomationBrowserSessionState(resolveMockBrowserSessionState(args)),
  take_over_browser_session: (args: any) =>
    syncMockAutomationBrowserSessionState(
      resolveMockBrowserSessionState(args, {
        lifecycle_state: "human_controlling",
        control_mode: "human",
        human_reason: args?.request?.human_reason ?? "已进入人工接管",
      }),
    ),
  release_browser_session: (args: any) =>
    syncMockAutomationBrowserSessionState(
      resolveMockBrowserSessionState(args, {
        lifecycle_state: "waiting_for_human",
        control_mode: "shared",
        human_reason: args?.request?.human_reason ?? "等待你确认是否继续执行",
      }),
    ),
  resume_browser_session: (args: any) =>
    syncMockAutomationBrowserSessionState(
      resolveMockBrowserSessionState(args, {
        lifecycle_state: "agent_resuming",
        control_mode: "agent",
        human_reason: args?.request?.human_reason ?? "人工处理完成，继续执行",
      }),
      { finalize: true },
    ),
  get_browser_event_buffer: () => ({
    events: [],
    next_cursor: 0,
  }),
  browser_execute_action: (args: any) => {
    const backend = args?.request?.backend ?? "aster_compat";
    const action = args?.request?.action ?? "navigate";
    const requestId = `browser-mock-${Date.now()}`;

    if (action === "list_tabs") {
      return {
        success: true,
        backend,
        action,
        request_id: requestId,
        data: {
          message: "mock tabs loaded",
          data: {
            tabs: mockExistingSessionTabs,
          },
        },
        attempts: [
          {
            backend,
            success: true,
            message: "执行成功",
          },
        ],
      };
    }

    if (action === "switch_tab") {
      const target = String(args?.request?.args?.target ?? "");
      mockExistingSessionTabs = mockExistingSessionTabs.map((tab) => ({
        ...tab,
        active: String(tab.id) === target,
      }));
      const activeTab =
        mockExistingSessionTabs.find((tab) => tab.active) ??
        mockExistingSessionTabs[0];
      return {
        success: true,
        backend,
        action,
        request_id: requestId,
        data: {
          message: "mock tab switched",
          page_info: activeTab
            ? {
                title: activeTab.title,
                url: activeTab.url,
                markdown: `# ${activeTab.title}\nURL: ${activeTab.url}`,
                updated_at: now(),
              }
            : undefined,
        },
        attempts: [
          {
            backend,
            success: true,
            message: "执行成功",
          },
        ],
      };
    }

    return {
      success: true,
      backend,
      session_id: "mock-cdp-session",
      target_id: "mock-target-1",
      action,
      request_id: requestId,
      data: {
        message: "mock browser action executed",
      },
      attempts: [
        {
          backend,
          success: true,
          message: "执行成功",
        },
      ],
    };
  },
  get_browser_action_audit_logs: (args: any) => {
    const now = new Date().toISOString();
    const count = Math.min(Number(args?.limit ?? 20), 200);
    return Array.from({ length: Math.max(1, count) }, (_, idx) => ({
      id: `audit-mock-${idx + 1}`,
      created_at: now,
      kind: idx % 2 === 0 ? "launch" : "action",
      action: idx % 2 === 0 ? undefined : "navigate",
      profile_key: "default",
      profile_id: idx % 2 === 0 ? "browser-profile-general" : undefined,
      requested_backend: idx % 2 === 0 ? undefined : "aster_compat",
      selected_backend: idx % 2 === 0 ? undefined : "aster_compat",
      success: true,
      attempts:
        idx % 2 === 0
          ? []
          : [
              {
                backend: "aster_compat",
                success: true,
                message: "执行成功",
              },
            ],
      environment_preset_id:
        idx % 2 === 0 ? "browser-environment-us-desktop" : undefined,
      environment_preset_name: idx % 2 === 0 ? "美区桌面" : undefined,
      target_id: idx % 2 === 0 ? "mock-target-1" : undefined,
      session_id: idx % 2 === 0 ? "mock-cdp-session" : undefined,
      url: idx % 2 === 0 ? "https://example.com" : undefined,
      reused: idx % 2 === 0 ? false : undefined,
      open_window: idx % 2 === 0 ? true : undefined,
      stream_mode: idx % 2 === 0 ? "both" : undefined,
      browser_source: idx % 2 === 0 ? "system" : undefined,
      remote_debugging_port: idx % 2 === 0 ? 13001 : undefined,
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
  ...deprecatedAgentCommandMocks,
  agent_get_process_status: () => ({ running: false }),
  agent_start_process: () => ({ success: true }),
  agent_stop_process: () => ({ success: true }),

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
  agent_runtime_submit_turn: () => ({}),
  agent_runtime_interrupt_turn: () => true,
  agent_runtime_create_session: () => "mock-aster-session",
  agent_runtime_list_sessions: () => [],
  agent_runtime_get_session: () => ({ id: "mock", messages: [] }),
  agent_runtime_list_file_checkpoints: () => ({
    session_id: "mock-session",
    thread_id: "mock-thread",
    checkpoint_count: 1,
    checkpoints: [
      {
        checkpoint_id: "artifact-document:req-1",
        turn_id: "turn-1",
        path: ".lime/artifacts/mock-thread/demo.artifact.json",
        source: "artifact_document_service",
        updated_at: "2026-04-15T00:00:00Z",
        version_no: 2,
        version_id: "artifact-document:req-1:v2",
        request_id: "req-1",
        title: "Mock Checkpoint",
        kind: "analysis",
        status: "ready",
        preview_text: "mock preview",
        snapshot_path:
          ".lime/artifacts/mock-thread/versions/demo/v0002.artifact.json",
        validation_issue_count: 0,
      },
    ],
  }),
  agent_runtime_get_file_checkpoint: () => ({
    session_id: "mock-session",
    thread_id: "mock-thread",
    checkpoint: {
      checkpoint_id: "artifact-document:req-1",
      turn_id: "turn-1",
      path: ".lime/artifacts/mock-thread/demo.artifact.json",
      source: "artifact_document_service",
      updated_at: "2026-04-15T00:00:00Z",
      version_no: 2,
      version_id: "artifact-document:req-1:v2",
      request_id: "req-1",
      title: "Mock Checkpoint",
      kind: "analysis",
      status: "ready",
      preview_text: "mock preview",
      snapshot_path:
        ".lime/artifacts/mock-thread/versions/demo/v0002.artifact.json",
      validation_issue_count: 0,
    },
    live_path: ".lime/artifacts/mock-thread/demo.artifact.json",
    snapshot_path:
      ".lime/artifacts/mock-thread/versions/demo/v0002.artifact.json",
    checkpoint_document: { title: "Mock Checkpoint", summary: "snapshot" },
    live_document: { title: "Mock Checkpoint", summary: "live" },
    version_history: [],
    validation_issues: [],
    metadata: {},
    content: "# Mock Checkpoint",
  }),
  agent_runtime_diff_file_checkpoint: () => ({
    session_id: "mock-session",
    thread_id: "mock-thread",
    checkpoint: {
      checkpoint_id: "artifact-document:req-1",
      turn_id: "turn-1",
      path: ".lime/artifacts/mock-thread/demo.artifact.json",
      source: "artifact_document_service",
      updated_at: "2026-04-15T00:00:00Z",
      version_no: 2,
      version_id: "artifact-document:req-1:v2",
      request_id: "req-1",
      title: "Mock Checkpoint",
      kind: "analysis",
      status: "ready",
      preview_text: "mock preview",
      snapshot_path:
        ".lime/artifacts/mock-thread/versions/demo/v0002.artifact.json",
      validation_issue_count: 0,
    },
    current_version_id: "artifact-document:req-1:v2",
    previous_version_id: "artifact-document:req-1:v1",
    diff: {
      summary: "mock diff",
    },
  }),
  agent_runtime_export_analysis_handoff: () => ({
    session_id: "mock-session",
    thread_id: "mock-thread",
    workspace_root: "/mock/workspace",
    analysis_relative_root: ".lime/harness/sessions/mock-session/analysis",
    analysis_absolute_root:
      "/mock/workspace/.lime/harness/sessions/mock-session/analysis",
    handoff_bundle_relative_root: ".lime/harness/sessions/mock-session",
    evidence_pack_relative_root: ".lime/harness/sessions/mock-session/evidence",
    replay_case_relative_root: ".lime/harness/sessions/mock-session/replay",
    exported_at: "2026-03-27T00:00:00Z",
    title: "确认当前失败会话应该如何交给外部 AI 诊断和修复",
    thread_status: "waiting_request",
    latest_turn_status: "action_required",
    pending_request_count: 1,
    queued_turn_count: 0,
    sanitized_workspace_root: "/workspace/lime",
    copy_prompt:
      "# Lime 外部诊断与修复任务\n\n请先读取 analysis-brief.md 与 analysis-context.json。",
    artifacts: [
      {
        kind: "analysis_brief",
        title: "外部分析简报",
        relative_path:
          ".lime/harness/sessions/mock-session/analysis/analysis-brief.md",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/analysis/analysis-brief.md",
        bytes: 512,
      },
      {
        kind: "analysis_context",
        title: "外部分析上下文",
        relative_path:
          ".lime/harness/sessions/mock-session/analysis/analysis-context.json",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/analysis/analysis-context.json",
        bytes: 768,
      },
    ],
  }),
  agent_runtime_export_review_decision_template: () => ({
    session_id: "mock-session",
    thread_id: "mock-thread",
    workspace_root: "/mock/workspace",
    review_relative_root: ".lime/harness/sessions/mock-session/review",
    review_absolute_root:
      "/mock/workspace/.lime/harness/sessions/mock-session/review",
    analysis_relative_root: ".lime/harness/sessions/mock-session/analysis",
    analysis_absolute_root:
      "/mock/workspace/.lime/harness/sessions/mock-session/analysis",
    handoff_bundle_relative_root: ".lime/harness/sessions/mock-session",
    evidence_pack_relative_root: ".lime/harness/sessions/mock-session/evidence",
    replay_case_relative_root: ".lime/harness/sessions/mock-session/replay",
    exported_at: "2026-03-27T00:05:00Z",
    title: "记录外部分析后的人工审核结论",
    thread_status: "waiting_request",
    latest_turn_status: "action_required",
    pending_request_count: 1,
    queued_turn_count: 0,
    default_decision_status: "pending_review",
    verification_summary: {
      artifact_validator: {
        applicable: true,
        record_count: 1,
        issue_count: 1,
        repaired_count: 0,
        fallback_used_count: 0,
        outcome: "blocking_failure",
      },
      focus_verification_failure_outcomes: [
        "Artifact 校验存在 1 条未恢复 issue。",
      ],
      focus_verification_recovered_outcomes: [],
    },
    decision: {
      decision_status: "pending_review",
      decision_summary: "",
      chosen_fix_strategy: "",
      risk_level: "unknown",
      risk_tags: [],
      human_reviewer: "",
      reviewed_at: null,
      followup_actions: [
        "先对照 analysis-context.json / evidence/runtime.json 核对当前验证失败焦点，再决定是继续修复还是补证据。",
        "复查 Artifact 校验相关产物，确认 issues / repaired / fallback 状态与最终结论一致。",
      ],
      regression_requirements: [
        "按 replay case 复现问题并确认修复后行为与预期一致。",
        "重新导出 evidence pack，确认 Artifact 校验摘要已更新。",
      ],
      notes: "",
    },
    decision_status_options: [
      "accepted",
      "deferred",
      "rejected",
      "needs_more_evidence",
      "pending_review",
    ],
    risk_level_options: ["low", "medium", "high", "unknown"],
    review_checklist: [
      "先阅读 analysis-brief.md 与 analysis-context.json。",
      "确认最终决策由人工审核者填写。",
    ],
    analysis_artifacts: [
      {
        kind: "analysis_brief",
        title: "外部分析简报",
        relative_path:
          ".lime/harness/sessions/mock-session/analysis/analysis-brief.md",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/analysis/analysis-brief.md",
        bytes: 512,
      },
    ],
    artifacts: [
      {
        kind: "review_decision_markdown",
        title: "人工审核记录",
        relative_path:
          ".lime/harness/sessions/mock-session/review/review-decision.md",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/review/review-decision.md",
        bytes: 512,
      },
      {
        kind: "review_decision_json",
        title: "人工审核记录 JSON",
        relative_path:
          ".lime/harness/sessions/mock-session/review/review-decision.json",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/review/review-decision.json",
        bytes: 768,
      },
    ],
  }),
  agent_runtime_save_review_decision: ({
    request,
  }: {
    request?: MockReviewDecisionRequest;
  }) => ({
    session_id: request?.session_id || request?.sessionId || "mock-session",
    thread_id: "mock-thread",
    workspace_root: "/mock/workspace",
    review_relative_root: ".lime/harness/sessions/mock-session/review",
    review_absolute_root:
      "/mock/workspace/.lime/harness/sessions/mock-session/review",
    analysis_relative_root: ".lime/harness/sessions/mock-session/analysis",
    analysis_absolute_root:
      "/mock/workspace/.lime/harness/sessions/mock-session/analysis",
    handoff_bundle_relative_root: ".lime/harness/sessions/mock-session",
    evidence_pack_relative_root: ".lime/harness/sessions/mock-session/evidence",
    replay_case_relative_root: ".lime/harness/sessions/mock-session/replay",
    exported_at: "2026-03-27T00:07:00Z",
    title: "记录外部分析后的人工审核结论",
    thread_status: "waiting_request",
    latest_turn_status: "action_required",
    pending_request_count: 1,
    queued_turn_count: 0,
    default_decision_status: "pending_review",
    verification_summary: {
      artifact_validator: {
        applicable: true,
        record_count: 1,
        issue_count: 1,
        repaired_count: 0,
        fallback_used_count: 0,
        outcome: "blocking_failure",
      },
      focus_verification_failure_outcomes: [
        "Artifact 校验存在 1 条未恢复 issue。",
      ],
      focus_verification_recovered_outcomes: [],
    },
    decision: {
      decision_status:
        request?.decision_status || request?.decisionStatus || "pending_review",
      decision_summary:
        request?.decision_summary || request?.decisionSummary || "",
      chosen_fix_strategy:
        request?.chosen_fix_strategy || request?.chosenFixStrategy || "",
      risk_level: request?.risk_level || request?.riskLevel || "unknown",
      risk_tags: request?.risk_tags || request?.riskTags || [],
      human_reviewer: request?.human_reviewer || request?.humanReviewer || "",
      reviewed_at:
        request?.reviewed_at || request?.reviewedAt || "2026-03-27T00:07:00Z",
      followup_actions:
        request?.followup_actions || request?.followupActions || [],
      regression_requirements:
        request?.regression_requirements ||
        request?.regressionRequirements ||
        [],
      notes: request?.notes || "",
    },
    decision_status_options: [
      "accepted",
      "deferred",
      "rejected",
      "needs_more_evidence",
      "pending_review",
    ],
    risk_level_options: ["low", "medium", "high", "unknown"],
    review_checklist: [
      "先阅读 analysis-brief.md 与 analysis-context.json。",
      "确认最终决策由人工审核者填写。",
    ],
    analysis_artifacts: [
      {
        kind: "analysis_brief",
        title: "外部分析简报",
        relative_path:
          ".lime/harness/sessions/mock-session/analysis/analysis-brief.md",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/analysis/analysis-brief.md",
        bytes: 512,
      },
    ],
    artifacts: [
      {
        kind: "review_decision_markdown",
        title: "人工审核记录",
        relative_path:
          ".lime/harness/sessions/mock-session/review/review-decision.md",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/review/review-decision.md",
        bytes: 512,
      },
      {
        kind: "review_decision_json",
        title: "人工审核记录 JSON",
        relative_path:
          ".lime/harness/sessions/mock-session/review/review-decision.json",
        absolute_path:
          "/mock/workspace/.lime/harness/sessions/mock-session/review/review-decision.json",
        bytes: 768,
      },
    ],
  }),
  agent_runtime_export_handoff_bundle: () => ({
    sessionId: "mock-session",
    threadId: "mock-thread",
    workspaceRoot: "/mock/workspace",
    bundleRelativeRoot: ".lime/harness/sessions/mock-session",
    bundleAbsoluteRoot: "/mock/workspace/.lime/harness/sessions/mock-session",
    exportedAt: "2026-03-27T00:00:00Z",
    threadStatus: "idle",
    pendingRequestCount: 0,
    queuedTurnCount: 0,
    activeSubagentCount: 0,
    todoTotal: 0,
    todoPending: 0,
    todoInProgress: 0,
    todoCompleted: 0,
    artifacts: [
      {
        kind: "plan",
        title: "计划摘要",
        relativePath: ".lime/harness/sessions/mock-session/plan.md",
        absolutePath:
          "/mock/workspace/.lime/harness/sessions/mock-session/plan.md",
        bytes: 128,
      },
    ],
  }),
  agent_runtime_export_evidence_pack: () => ({
    sessionId: "mock-session",
    threadId: "mock-thread",
    workspaceRoot: "/mock/workspace",
    packRelativeRoot: ".lime/harness/sessions/mock-session/evidence",
    packAbsoluteRoot:
      "/mock/workspace/.lime/harness/sessions/mock-session/evidence",
    exportedAt: "2026-03-27T00:00:00Z",
    threadStatus: "idle",
    latestTurnStatus: "idle",
    turnCount: 0,
    itemCount: 0,
    pendingRequestCount: 0,
    queuedTurnCount: 0,
    recentArtifactCount: 0,
    knownGaps: [],
    artifacts: [
      {
        kind: "summary",
        title: "问题摘要",
        relativePath: ".lime/harness/sessions/mock-session/evidence/summary.md",
        absolutePath:
          "/mock/workspace/.lime/harness/sessions/mock-session/evidence/summary.md",
        bytes: 256,
      },
    ],
  }),
  agent_runtime_export_replay_case: () => ({
    sessionId: "mock-session",
    threadId: "mock-thread",
    workspaceRoot: "/mock/workspace",
    replayRelativeRoot: ".lime/harness/sessions/mock-session/replay",
    replayAbsoluteRoot:
      "/mock/workspace/.lime/harness/sessions/mock-session/replay",
    handoffBundleRelativeRoot: ".lime/harness/sessions/mock-session",
    evidencePackRelativeRoot: ".lime/harness/sessions/mock-session/evidence",
    exportedAt: "2026-03-27T00:00:00Z",
    threadStatus: "idle",
    latestTurnStatus: "idle",
    pendingRequestCount: 0,
    queuedTurnCount: 0,
    linkedHandoffArtifactCount: 1,
    linkedEvidenceArtifactCount: 1,
    recentArtifactCount: 0,
    artifacts: [
      {
        kind: "input",
        title: "回放输入",
        relativePath: ".lime/harness/sessions/mock-session/replay/input.json",
        absolutePath:
          "/mock/workspace/.lime/harness/sessions/mock-session/replay/input.json",
        bytes: 256,
      },
    ],
  }),
  agent_runtime_get_tool_inventory: (args?: {
    request?: {
      caller?: string;
      workbench?: boolean;
      browserAssist?: boolean;
    };
  }) => buildMockAgentRuntimeToolInventory(args?.request),
  agent_runtime_spawn_subagent: () => ({
    agent_id: "mock-subagent-session",
    nickname: "Mock Subagent",
  }),
  agent_runtime_send_subagent_input: () => ({
    submission_id: "mock-subagent-submit",
  }),
  agent_runtime_wait_subagents: () => ({
    status: {},
    timed_out: true,
  }),
  agent_runtime_resume_subagent: () => ({
    status: { session_id: "mock-subagent-session", kind: "idle" },
    cascade_session_ids: ["mock-subagent-session"],
    changed_session_ids: ["mock-subagent-session"],
  }),
  agent_runtime_close_subagent: () => ({
    previous_status: { session_id: "mock-subagent-session", kind: "idle" },
    cascade_session_ids: ["mock-subagent-session"],
    changed_session_ids: ["mock-subagent-session"],
  }),
  agent_runtime_update_session: () => ({}),
  agent_runtime_delete_session: () => ({}),
  agent_runtime_respond_action: () => ({}),

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
  get_installed_lime_skills: () => [],
  inspect_local_skill_for_app: () => ({
    content: "# Mock Skill",
    metadata: {},
    allowedTools: [],
    resourceSummary: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
  }),
  create_skill_scaffold_for_app: () => ({
    content: "# Mock Skill",
    metadata: {},
    allowedTools: [],
    resourceSummary: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
  }),
  inspect_remote_skill: () => ({
    content: "# Mock Skill",
    metadata: {},
    allowedTools: [],
    resourceSummary: {
      hasScripts: false,
      hasReferences: true,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: true,
      validationErrors: [],
      deprecatedFields: [],
    },
  }),
  install_skill_for_app: () => ({ success: true }),
  uninstall_skill_for_app: () => ({ success: true }),
  import_local_skill_for_app: () => ({ directory: "mock-skill" }),
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
  create_image_generation_task_artifact: (args: any) =>
    buildMockMediaTaskOutput(args),
  get_media_task_artifact: (args: any) => buildMockMediaTaskOutput(args),
  list_media_task_artifacts: (args: any) => {
    const request = args?.request ?? args ?? {};
    return {
      success: true,
      workspace_root: request.projectRootPath ?? "/mock/workspace",
      artifact_root: `${request.projectRootPath ?? "/mock/workspace"}/.lime/tasks`,
      filters: {
        status: request.status ?? null,
        task_family: request.taskFamily ?? null,
        task_type: request.taskType ?? null,
        limit: request.limit ?? null,
      },
      total: 1,
      tasks: [buildMockMediaTaskOutput(args)],
    };
  },
  cancel_media_task_artifact: (args: any) =>
    buildMockMediaTaskOutput(args, {
      status: "cancelled",
      normalized_status: "cancelled",
    }),
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
    outline: [],
  }),
  memory_runtime_get_overview: () => ({
    stats: { total_entries: 0, storage_used: 0, memory_count: 0 },
    categories: [],
    entries: [],
  }),
  memory_runtime_get_stats: () => ({
    total_entries: 0,
    storage_used: 0,
    memory_count: 0,
  }),
  memory_runtime_request_analysis: () => ({
    analyzed_sessions: 0,
    analyzed_messages: 0,
    generated_entries: 0,
    deduplicated_entries: 0,
  }),
  memory_runtime_cleanup: () => ({
    cleaned_entries: 0,
    freed_space: 0,
  }),
  memory_runtime_get_working_memory: () => ({
    memory_dir: "/mock/runtime/memory",
    total_sessions: 1,
    total_entries: 2,
    sessions: [
      {
        session_id: "mock-session",
        total_entries: 2,
        updated_at: Date.now(),
        files: [
          {
            file_type: "task_plan",
            path: "/mock/runtime/memory/mock-session/task_plan.md",
            exists: true,
            entry_count: 1,
            updated_at: Date.now(),
            summary: "当前任务与阶段计划。",
          },
          {
            file_type: "findings",
            path: "/mock/runtime/memory/mock-session/findings.md",
            exists: true,
            entry_count: 1,
            updated_at: Date.now(),
            summary: "最近的重要发现。",
          },
        ],
        highlights: [
          {
            id: "mock-session:task_plan:0",
            session_id: "mock-session",
            file_type: "task_plan",
            category: "context",
            title: "本轮任务",
            summary: "先补命令边界，再补页面。",
            updated_at: Date.now(),
            tags: ["plan"],
          },
        ],
      },
    ],
  }),
  memory_runtime_get_extraction_status: () => ({
    enabled: true,
    status: "ready",
    status_summary: "工作记忆和上下文压缩快照都已就绪。",
    working_session_count: 1,
    working_entry_count: 2,
    latest_working_memory_at: Date.now(),
    latest_compaction: {
      session_id: "mock-session",
      source: "summary_cache",
      summary_preview: "这是最近一次压缩后的摘要。",
      turn_count: 8,
      created_at: Date.now(),
    },
    recent_compactions: [
      {
        session_id: "mock-session",
        source: "summary_cache",
        summary_preview: "这是最近一次压缩后的摘要。",
        turn_count: 8,
        created_at: Date.now(),
      },
    ],
  }),
  memory_runtime_prefetch_for_turn: () => ({
    session_id: "mock-session",
    rules_source_paths: ["/mock/workspace/.lime/AGENTS.md"],
    working_memory_excerpt: "【task_plan.md】\\n先补命令边界，再补页面。",
    durable_memories: [
      {
        id: "durable-1",
        session_id: "mock-session",
        category: "experience",
        title: "记忆层分层经验",
        summary: "先收口事实源，再补产品层展示。",
        updated_at: Date.now(),
        tags: ["memory", "architecture"],
      },
    ],
    team_memory_entries: [
      {
        key: "team.selection",
        content: "分析、实现、验证三段式推进。",
        updated_at: Date.now(),
      },
    ],
    latest_compaction: {
      session_id: "mock-session",
      source: "summary_cache",
      summary_preview: "这是最近一次压缩后的摘要。",
      turn_count: 8,
      created_at: Date.now(),
    },
    prompt: "【运行时记忆召回】\\n- 以下是当前会话最近沉淀下来的工作记忆。",
  }),
  memory_get_effective_sources: () => ({
    working_dir: "/mock/workspace",
    total_sources: 2,
    loaded_sources: 1,
    follow_imports: true,
    import_max_depth: 5,
    sources: [
      {
        kind: "auto_memory",
        source_bucket: "auto",
        provider: "memdir",
        updated_at: Date.now(),
        path: "/mock/workspace/memory/MEMORY.md",
        exists: true,
        loaded: true,
        line_count: 4,
        import_count: 1,
        warnings: [],
        preview: "# Lime memdir\\n- [项目记忆](project/README.md)",
      },
    ],
  }),
  memory_get_auto_index: () => ({
    enabled: true,
    root_dir: "/mock/workspace/memory",
    entrypoint: "MEMORY.md",
    max_loaded_lines: 200,
    entry_exists: true,
    total_lines: 4,
    preview_lines: ["# Lime memdir", "- [项目记忆](project/README.md)"],
    items: [
      {
        title: "项目记忆",
        memory_type: "project",
        provider: "memdir",
        updated_at: Date.now(),
        relative_path: "project/README.md",
        exists: true,
        summary: "记录项目背景、时间点、约束、动机与团队分工。",
      },
    ],
  }),
  memory_toggle_auto: (args: any) => ({
    enabled: Boolean(args?.enabled),
  }),
  memory_update_auto_note: () => ({
    enabled: true,
    root_dir: "/mock/workspace/memory",
    entrypoint: "MEMORY.md",
    max_loaded_lines: 200,
    entry_exists: true,
    total_lines: 1,
    preview_lines: ["- mock note"],
    items: [
      {
        title: "项目记忆",
        memory_type: "project",
        provider: "memdir",
        updated_at: Date.now(),
        relative_path: "project/README.md",
        exists: true,
        summary: "记录项目背景、时间点、约束、动机与团队分工。",
      },
    ],
  }),
  memory_cleanup_memdir: () => ({
    root_dir: "/mock/workspace/memory",
    entrypoint: "MEMORY.md",
    scanned_files: 4,
    updated_files: 2,
    removed_duplicate_links: 1,
    dropped_missing_links: 0,
    removed_duplicate_notes: 1,
    trimmed_notes: 1,
    curated_topic_files: 1,
  }),
  memory_scaffold_memdir: (args: any) => ({
    root_dir: `${args?.workingDir ?? "/mock/workspace"}/memory`,
    entrypoint: "MEMORY.md",
    created_parent_dir: true,
    files: [
      {
        key: "entrypoint",
        path: `${args?.workingDir ?? "/mock/workspace"}/memory/MEMORY.md`,
        status: "created",
      },
      {
        key: "user",
        path: `${args?.workingDir ?? "/mock/workspace"}/memory/user/README.md`,
        status: "created",
      },
      {
        key: "feedback",
        path: `${args?.workingDir ?? "/mock/workspace"}/memory/feedback/README.md`,
        status: "created",
      },
      {
        key: "project",
        path: `${args?.workingDir ?? "/mock/workspace"}/memory/project/README.md`,
        status: "created",
      },
      {
        key: "reference",
        path: `${args?.workingDir ?? "/mock/workspace"}/memory/reference/README.md`,
        status: "created",
      },
    ],
  }),
  memory_scaffold_runtime_agents_template: (args: any) => {
    const target = args?.target ?? "workspace";
    const workingDir = args?.workingDir ?? "/mock/workspace";
    const pathByTarget: Record<string, string> = {
      global: "/mock/home/.lime/AGENTS.md",
      workspace: `${workingDir}/.lime/AGENTS.md`,
      workspace_local: `${workingDir}/.lime/AGENTS.local.md`,
    };
    return {
      target,
      path: pathByTarget[target] ?? `${workingDir}/.lime/AGENTS.md`,
      status: "created",
      createdParentDir: true,
    };
  },
  memory_ensure_workspace_local_agents_gitignore: (args: any) => ({
    path: `${args?.workingDir ?? "/mock/workspace"}/.gitignore`,
    entry: ".lime/AGENTS.local.md",
    status: "added",
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
    metadata:
      args?.metadata && typeof args.metadata === "object"
        ? args.metadata
        : undefined,
    size: typeof args?.content === "string" ? args.content.length : 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  session_files_read_file: () => "",
  session_files_resolve_file_path: (args: any) =>
    `/mock/sessions/${args?.sessionId ?? "mock-session"}/${args?.fileName ?? "mock.txt"}`,
  session_files_delete_file: () => undefined,
  save_exported_document: () => undefined,

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
  get_model_registry_provider_ids: () => [
    "openai",
    "anthropic",
    "google",
    "codex",
    "azure",
    "google-vertex",
    "amazon-bedrock",
    "ollama-cloud",
  ],
  refresh_model_registry: () => ({ success: true }),
  search_models: () => [],
  get_all_provider_models: () => ({}),
  get_all_models_by_provider: () => ({}),
  get_all_available_models: () => [],
  get_model_preferences: () => [],
  toggle_model_favorite: () => ({ success: true }),
  hide_model: () => ({ success: true }),
  record_model_usage: () => ({}),
  get_model_sync_state: () => ({ syncing: false, last_sync_at: null }),
  get_models_for_provider: () => [],
  get_models_by_tier: () => [],
  get_default_models_for_provider: () => [],
  get_provider_alias_config: () => ({ alias: {} }),
  get_all_alias_configs: () => ({}),
  sync_tray_model_shortcuts: () => ({}),

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
  close_webview_panel: () => true,
  get_webview_panels: () => [],
  focus_webview_panel: () => true,
  navigate_webview_panel: () => true,

  // Usage 相关
  get_kiro_usage: () => ({ usage: {} }),

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
    bundle_path: "mock://Lime-Support.zip",
    output_directory: "mock://",
    generated_at: new Date().toISOString(),
    platform: "mock-web",
    included_sections: ["meta/manifest.json"],
    omitted_sections: ["config 内容", "数据库内容"],
  }),
  clear_logs: () => ({}),
  clear_diagnostic_log_history: () => ({}),

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
    webmcp: { enabled: false },
  }),
  get_screenshot_shortcut_runtime_status: () => ({
    shortcut_registered: false,
    registered_shortcut: null,
  }),
  save_experimental_config: () => ({}),
  validate_shortcut: () => ({ valid: true }),
  update_screenshot_shortcut: () => ({ success: true }),

  // Voice 相关
  get_voice_input_config: () => ({
    enabled: false,
    shortcut: "CommandOrControl+Shift+V",
    processor: {
      polish_enabled: true,
      default_instruction_id: "default",
    },
    output: {
      mode: "type",
      type_delay_ms: 10,
    },
    instructions: [],
    sound_enabled: true,
    translate_instruction_id: "default",
  }),
  get_voice_shortcut_runtime_status: () => ({
    shortcut_registered: false,
    registered_shortcut: null,
    translate_shortcut_registered: false,
    registered_translate_shortcut: null,
  }),
  save_voice_input_config: () => ({}),

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

  // 自动化任务相关
  get_automation_scheduler_config: () => ({
    enabled: true,
    poll_interval_secs: 30,
    enable_history: true,
  }),
  update_automation_scheduler_config: () => undefined,
  get_automation_status: () => ({
    running: true,
    last_polled_at: now(),
    next_poll_at: now(),
    last_job_count: mockAutomationJobs.length,
    total_executions: mockAutomationRuns.length,
    active_job_id: null,
    active_job_name: null,
  }),
  get_automation_jobs: () => mockAutomationJobs,
  get_automation_job: (args: any) =>
    mockAutomationJobs.find((job) => job.id === args?.id) ?? null,
  create_automation_job: (args: any) => {
    const created = {
      ...args.request,
      id: `automation-job-${Date.now()}`,
      enabled: args.request.enabled ?? true,
      execution_mode: args.request.execution_mode ?? "intelligent",
      delivery: args.request.delivery ?? {
        mode: "none",
        channel: null,
        target: null,
        best_effort: true,
        output_schema: "text",
        output_format: "text",
      },
      timeout_secs: args.request.timeout_secs ?? null,
      max_retries: args.request.max_retries ?? 3,
      next_run_at: now(),
      last_status: null,
      last_error: null,
      last_run_at: null,
      last_finished_at: null,
      running_started_at: null,
      consecutive_failures: 0,
      last_retry_count: 0,
      auto_disabled_until: null,
      last_delivery: null,
      created_at: now(),
      updated_at: now(),
    };
    mockAutomationJobs.unshift(created);
    return created;
  },
  update_automation_job: (args: any) => {
    const index = mockAutomationJobs.findIndex((job) => job.id === args?.id);
    if (index === -1) {
      throw new Error(`automation job not found: ${args?.id}`);
    }
    const current = mockAutomationJobs[index];
    const next = {
      ...current,
      ...args.request,
      timeout_secs: args.request.clear_timeout_secs
        ? null
        : (args.request.timeout_secs ?? current.timeout_secs),
      updated_at: now(),
    };
    mockAutomationJobs[index] = next;
    return next;
  },
  delete_automation_job: (args: any) => {
    const index = mockAutomationJobs.findIndex((job) => job.id === args?.id);
    if (index === -1) {
      return false;
    }
    mockAutomationJobs.splice(index, 1);
    return true;
  },
  run_automation_job_now: (args: any) => {
    const job = mockAutomationJobs.find((item) => item.id === args?.id);
    if (!job) {
      throw new Error(`automation job not found: ${args?.id}`);
    }
    const timestamp = now();
    const browserLaunch =
      job.payload?.kind === "browser_session"
        ? buildMockBrowserSessionLaunchResponse({
            profile_id: job.payload.profile_id,
            profile_key: job.payload.profile_key,
            url: job.payload.url,
            environment_preset_id: job.payload.environment_preset_id,
            target_id: job.payload.target_id,
            open_window: job.payload.open_window,
            stream_mode: job.payload.stream_mode,
          })
        : null;
    if (job.payload?.kind === "browser_session" && browserLaunch?.session) {
      const session = browserLaunch.session;
      job.last_status = "running";
      job.last_error = null;
      job.last_run_at = timestamp;
      job.last_finished_at = null;
      job.running_started_at = timestamp;
      job.next_run_at = null;
      job.updated_at = timestamp;
      mockAutomationRuns.unshift({
        id: `automation-run-${Date.now()}`,
        source: "automation",
        source_ref: job.id,
        session_id: session.session_id,
        status: "running",
        started_at: timestamp,
        finished_at: null,
        duration_ms: null,
        error_code: null,
        error_message: null,
        metadata: buildMockAutomationBrowserMetadata(
          job,
          session,
          "running",
          null,
        ),
        created_at: timestamp,
        updated_at: timestamp,
      });
      return {
        job_count: 1,
        success_count: 0,
        failed_count: 0,
        timeout_count: 0,
      };
    }

    job.last_status = "success";
    job.last_run_at = timestamp;
    job.last_finished_at = timestamp;
    job.running_started_at = null;
    job.updated_at = timestamp;
    mockAutomationRuns.unshift({
      id: `automation-run-${Date.now()}`,
      source: "automation",
      source_ref: job.id,
      session_id: browserLaunch?.session?.session_id ?? `session-${Date.now()}`,
      status: "success",
      started_at: timestamp,
      finished_at: timestamp,
      duration_ms: 1400,
      error_code: null,
      error_message: null,
      metadata: JSON.stringify({
        job_name: job.name,
        workspace_id: job.workspace_id,
        payload_kind: job.payload?.kind ?? "agent_turn",
        profile_key:
          job.payload?.kind === "browser_session"
            ? job.payload.profile_key
            : null,
      }),
      created_at: timestamp,
      updated_at: timestamp,
    });
    return {
      job_count: 1,
      success_count: 1,
      failed_count: 0,
      timeout_count: 0,
    };
  },
  get_automation_health: () => ({
    total_jobs: mockAutomationJobs.length,
    enabled_jobs: mockAutomationJobs.filter((job) => job.enabled).length,
    pending_jobs: mockAutomationJobs.filter(
      (job) =>
        job.enabled && !job.running_started_at && !job.auto_disabled_until,
    ).length,
    running_jobs: mockAutomationJobs.filter((job) => job.running_started_at)
      .length,
    failed_jobs: mockAutomationJobs.filter((job) =>
      ["error", "timeout"].includes(job.last_status ?? ""),
    ).length,
    cooldown_jobs: mockAutomationJobs.filter((job) => job.auto_disabled_until)
      .length,
    stale_running_jobs: 0,
    failed_last_24h: mockAutomationRuns.filter((run) =>
      ["error", "timeout"].includes(run.status),
    ).length,
    failure_trend_24h: [],
    alerts: [],
    risky_jobs: mockAutomationJobs
      .filter(
        (job) =>
          job.consecutive_failures > 0 ||
          job.auto_disabled_until ||
          ["waiting_for_human", "human_controlling"].includes(
            job.last_status ?? "",
          ),
      )
      .map((job) => ({
        job_id: job.id,
        name: job.name,
        status: job.last_status ?? "idle",
        consecutive_failures: job.consecutive_failures,
        retry_count: job.last_retry_count,
        auto_disabled_until: job.auto_disabled_until,
        updated_at: job.updated_at,
      })),
    generated_at: now(),
  }),
  get_automation_run_history: (args: any) =>
    mockAutomationRuns.filter((run) => run.source_ref === args?.id),
  preview_automation_schedule: () => now(),
  validate_automation_schedule: () => ({
    valid: true,
    error: null,
  }),
  execution_run_list: () => mockAutomationRuns,
  execution_run_get: (args: any) =>
    mockAutomationRuns.find((run) => run.id === args?.runId) ?? null,
  execution_run_get_general_workbench_state: () => ({
    run_state: "idle",
    current_gate_key: "idle",
    queue_items: [],
    latest_terminal: null,
    recent_terminals: [],
    updated_at: new Date().toISOString(),
  }),
  execution_run_list_general_workbench_history: () => ({
    items: [],
    has_more: false,
    next_offset: null,
  }),
  sceneapp_list_catalog: () => mockSceneAppCatalog,
  sceneapp_get_descriptor: (args: any) =>
    findMockSceneAppDescriptor(args?.id ?? args?.sceneappId ?? null),
  sceneapp_plan_launch: (args: any) =>
    buildMockSceneAppPlanResult(
      findMockSceneAppDescriptor(
        args?.intent?.sceneappId ?? args?.sceneappId ?? args?.id ?? null,
      ),
      args,
    ),
  sceneapp_create_automation_job: (args: any) =>
    createMockSceneAppAutomationJob(args),
  sceneapp_list_runs: (args: any) => {
    const sceneappId =
      typeof args?.sceneappId === "string" ? args.sceneappId : null;
    return buildMockSceneAppRunSummaries(sceneappId ?? undefined);
  },
  sceneapp_get_run_summary: (args: any) =>
    buildMockSceneAppRunSummaries().find((run) => run.runId === args?.runId) ??
    null,
  sceneapp_prepare_run_governance_artifact: (args: any) =>
    buildMockSceneAppRunSummaries().find((run) => run.runId === args?.runId) ??
    null,
  sceneapp_get_scorecard: (args: any) =>
    buildMockSceneAppScorecard(
      typeof args?.sceneappId === "string" && args.sceneappId.trim()
        ? args.sceneappId
        : "story-video-suite",
    ),
  gateway_channel_status: (args: any) => ({
    channel:
      typeof args?.request?.channel === "string" && args.request.channel.trim()
        ? args.request.channel.trim().toLowerCase()
        : "telegram",
    status: {
      running_accounts: 0,
      accounts: [],
    },
  }),
  wechat_channel_list_accounts: () => [],
  content_get_general_workbench_document_state: () => null,

  // Workspace 相关
  workspace_list: () => [
    {
      id: "workspace-default",
      name: "默认工作区",
      workspace_type: "general",
      root_path: "/tmp/lime/workspaces/default",
      is_default: true,
      is_favorite: true,
      is_archived: false,
      created_at: Date.now(),
      updated_at: Date.now(),
      tags: [],
    },
  ],
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
  logMockInfo(`[Mock] invoke: ${cmd}`, args);

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
  logMockInfo(`[Mock] convertFileSrc: ${filePath}`);
  return filePath;
}

// 导出类型以保持兼容
export type { InvokeOptions } from "@tauri-apps/api/core";
