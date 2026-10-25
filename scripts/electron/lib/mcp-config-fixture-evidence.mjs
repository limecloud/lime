import path from "node:path";

import {
  APP_SERVER_HANDLE_JSON_LINES_COMMAND,
  LEGACY_MCP_COMMANDS,
} from "../../mcp/lib/current-smoke-transport.mjs";

export const MCP_CREATE_LIST_SCENARIO_ID = "mcp-create-list";
export const MCP_CREATE_LIST_REQUIRED_METHODS = [
  "mcpServer/create",
  "mcpServer/list",
];
export const CONTEXT7_SERVER_NAME = "Context7";
export const CONTEXT7_CONFIG_URL = "https://mcp.context7.com/v1/mcp";
export const CONTEXT7_HEADER_NAME = "CONTEXT7_API_KEY";
export const CONTEXT7_ENV_VAR_NAME = "CONTEXT7_API_KEY_LIVE";

const PROJECT_GATE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function createStandaloneMcpSettingsRunId({
  now = new Date(),
  random = Math.random,
} = {}) {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  const suffix = Math.floor(random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `standalone-settings-mcp-${timestamp}-${suffix}`;
}

export function validateMcpSettingsRunId(value) {
  const runId = String(value ?? "").trim();
  if (!PROJECT_GATE_RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      "--run-id / LIME_GATE_RUN_ID 只能包含字母、数字、点、下划线和连字符，且长度不超过 128",
    );
  }
  return runId;
}

export function parseMcpConfigFixtureArgs(
  argv,
  { defaults, cwd = process.cwd() } = {},
) {
  const options = { ...defaults, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--run-id" && next) {
      options.runId = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--evidence-dir" && next) {
      options.evidenceDir = path.resolve(next.trim());
      index += 1;
      continue;
    }
    if (arg === "--prefix" && next) {
      options.prefix = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      options.intervalMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--keep-temp") {
      options.keepTemp = true;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }

  if (options.help) {
    return options;
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30_000) {
    throw new Error("--timeout-ms 必须是 >= 30000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  options.runId = validateMcpSettingsRunId(
    options.runId || createStandaloneMcpSettingsRunId(),
  );
  if (!PREFIX_PATTERN.test(String(options.prefix ?? ""))) {
    throw new Error(
      "--prefix 只能包含字母、数字、点、下划线和连字符，且长度不超过 128",
    );
  }
  if (!options.evidenceDir) {
    options.evidenceDir = path.join(
      cwd,
      ".lime",
      "qc",
      "project-gates",
      options.runId,
      "settings-mcp-create-list",
    );
  }
  return options;
}

export function createMcpSettingsScenarioEvidence({
  candidateRunId,
  startedAt,
  prefix,
}) {
  const runId = validateMcpSettingsRunId(candidateRunId);
  if (!PREFIX_PATTERN.test(String(prefix ?? ""))) {
    throw new Error("invalid MCP fixture evidence prefix");
  }
  return {
    schemaVersion: 1,
    scenarioId: "SETTINGS-01-mcp-create-list",
    priority: "P0",
    proofLevel: "Gate B-F",
    claimBoundary:
      "Real Electron Settings MCP GUI create and current App Server list readback only. It does not claim MCP lifecycle, live server connectivity, OAuth, tool calls, or packaged-app behavior.",
    candidateRunId: runId,
    testOnly: true,
    startedAt,
    result: "fail",
    failureClass: "settings-mcp-create-list-not-completed",
    nextAction:
      "Run the real Electron MCP Settings fixture to a terminal GUI state and preserve same-run structured evidence.",
    settingsScenarioProof: {
      scenarioId: MCP_CREATE_LIST_SCENARIO_ID,
      complete: false,
    },
    assertions: {
      total: 1,
      passed: 0,
      failed: ["notCompleted"],
      details: {},
    },
    bridge: {
      electron: false,
      preloadInvoke: false,
      transport: null,
      command: "app_server_handle_json_lines",
      appServerIpcHitCount: 0,
      methods: [],
    },
    errors: {
      consoleErrorCount: 0,
      pageErrorCount: 0,
      invokeErrorCount: 0,
      legacyCommandHitCount: 0,
      legacyCommands: [],
      mockFallbackHitCount: 0,
    },
    artifacts: {
      screenshot: `${prefix}.png`,
      rawEvidence: `${prefix}-raw.json`,
      summary: `${prefix}-summary.json`,
    },
  };
}

function parseJsonRpcLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseInvokeTraceRaw(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isObservedPreloadAppServerResponse(observation, method) {
  return (
    observation?.electron === true &&
    observation.fallback === false &&
    observation.command === APP_SERVER_HANDLE_JSON_LINES_COMMAND &&
    observation.transport === "electron-ipc" &&
    observation.status === "success" &&
    observation.method === method &&
    typeof observation.requestId === "string" &&
    observation.requestId.length > 0 &&
    observation.responseId === observation.requestId
  );
}

export function parseJsonRpcRequestsFromInvokeTrace(raw) {
  const requests = [];
  for (const entry of parseInvokeTraceRaw(raw)) {
    if (entry?.command !== APP_SERVER_HANDLE_JSON_LINES_COMMAND) {
      continue;
    }
    const lines = entry?.args_preview?.request?.lines;
    if (!Array.isArray(lines)) {
      continue;
    }
    for (const line of lines) {
      const parsed = parseJsonRpcLine(line);
      if (parsed?.method) {
        requests.push({
          command: entry.command,
          transport: entry.transport ?? null,
          status: entry.status ?? null,
          durationMs: entry.duration_ms ?? null,
          id: parsed.id ?? null,
          method: parsed.method,
          params: parsed.params ?? {},
        });
      }
    }
  }
  return requests;
}

export function summarizeMcpElectronEvidence({ listResult, traceRaw }) {
  const requests = parseJsonRpcRequestsFromInvokeTrace(traceRaw);
  const requestMethods = Array.from(
    new Set(
      [listResult?.method, ...requests.map((request) => request.method)].filter(
        Boolean,
      ),
    ),
  );
  const commands = Array.from(
    new Set(
      parseInvokeTraceRaw(traceRaw)
        .map((entry) => entry?.command)
        .filter(Boolean),
    ),
  );
  const electronIpcRequests = requests.filter(
    (request) =>
      request.command === APP_SERVER_HANDLE_JSON_LINES_COMMAND &&
      request.transport === "electron-ipc",
  );
  const electronIpcRequestMethods = Array.from(
    new Set(electronIpcRequests.map((request) => request.method)),
  );
  return {
    appServerHandleJsonLinesSeen: commands.includes(
      APP_SERVER_HANDLE_JSON_LINES_COMMAND,
    ),
    requestMethods,
    electronIpcSeen: electronIpcRequests.length > 0,
    electronIpcHitCount: electronIpcRequests.length,
    electronIpcRequestMethods,
    missingRequiredMethods: MCP_CREATE_LIST_REQUIRED_METHODS.filter(
      (method) => !electronIpcRequestMethods.includes(method),
    ),
    legacyMcpCommandsSeen: LEGACY_MCP_COMMANDS.filter((command) =>
      commands.includes(command),
    ),
    mockFallbackHitCount: requests.filter(
      (request) =>
        request.command === APP_SERVER_HANDLE_JSON_LINES_COMMAND &&
        request.transport !== "electron-ipc",
    ).length,
    requests,
  };
}

export function getServerConfig(server) {
  return server?.server_config ?? server?.serverConfig ?? null;
}

export function assertContext7Server(
  server,
  { configUrl = CONTEXT7_CONFIG_URL, envVarName = CONTEXT7_ENV_VAR_NAME } = {},
) {
  const config = getServerConfig(server);
  if (!config || typeof config !== "object") {
    throw new Error("Context7 未返回 server_config");
  }
  if (config.transport !== "streamable_http") {
    throw new Error(`Context7 transport 不正确: ${config.transport}`);
  }
  if (config.url !== configUrl) {
    throw new Error(`Context7 URL 未落库: ${config.url}`);
  }
  if (config.env_http_headers?.[CONTEXT7_HEADER_NAME] !== envVarName) {
    throw new Error("Context7 env_http_headers 未保存 header -> env var 引用");
  }
  if (Number(config.tool_timeout) !== 60) {
    throw new Error(`Context7 tool_timeout 不正确: ${config.tool_timeout}`);
  }
}

export function assertMcpElectronEvidence(evidence) {
  if (!evidence.appServerHandleJsonLinesSeen) {
    throw new Error("未观察到 app_server_handle_json_lines");
  }
  if (!evidence.electronIpcSeen) {
    throw new Error("未观察到 electron-ipc transport");
  }
  if (evidence.missingRequiredMethods.length > 0) {
    throw new Error(
      `缺少 App Server current method: ${evidence.missingRequiredMethods.join(", ")}`,
    );
  }
  if (evidence.legacyMcpCommandsSeen.length > 0) {
    throw new Error(
      `观察到 legacy MCP 命令: ${evidence.legacyMcpCommandsSeen.join(", ")}`,
    );
  }
  if (evidence.mockFallbackHitCount !== 0) {
    throw new Error("观察到非 Electron IPC fallback");
  }
}

export function summarizeContext7Server(server) {
  const config = getServerConfig(server);
  return {
    id: server?.id ?? null,
    name: server?.name ?? null,
    description: server?.description ?? null,
    enabled_lime: server?.enabled_lime ?? server?.enabledLime ?? null,
    transport: config?.transport ?? null,
    urlHost: (() => {
      try {
        return new URL(String(config?.url || "")).host;
      } catch {
        return null;
      }
    })(),
    envHttpHeaderNames: Object.keys(config?.env_http_headers ?? {}),
    envHttpHeaderEnvVars: Object.values(config?.env_http_headers ?? {}),
    tool_timeout: config?.tool_timeout ?? null,
  };
}

export function applyPassingMcpSettingsScenarioEvidence(
  summary,
  {
    completedAt,
    electronRenderer,
    preloadInvoke,
    electronEvidence,
    guiCreatedContext7,
    context7Server,
    consoleErrors,
    pageErrors,
    invokeErrorCount,
    screenshotWritten,
  },
) {
  const electronMethods = Array.isArray(
    electronEvidence?.electronIpcRequestMethods,
  )
    ? electronEvidence.electronIpcRequestMethods
    : [];
  const legacyCommands = Array.isArray(electronEvidence?.legacyMcpCommandsSeen)
    ? electronEvidence.legacyMcpCommandsSeen
    : [];
  const mockFallbackHitCount = Number(
    electronEvidence?.mockFallbackHitCount ?? 0,
  );

  summary.bridge = {
    electron: electronRenderer === true,
    preloadInvoke: preloadInvoke === true,
    transport: electronEvidence?.electronIpcSeen ? "electron-ipc" : null,
    command: "app_server_handle_json_lines",
    appServerIpcHitCount: Number(electronEvidence?.electronIpcHitCount ?? 0),
    methods: electronMethods,
  };
  summary.errors = {
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    invokeErrorCount,
    legacyCommandHitCount: legacyCommands.length,
    legacyCommands,
    mockFallbackHitCount,
  };

  const checks = [
    ["realElectronRenderer", summary.bridge.electron],
    ["preloadInvokeBridge", summary.bridge.preloadInvoke],
    ["electronIpcTransport", summary.bridge.transport === "electron-ipc"],
    [
      "appServerHandleJsonLines",
      electronEvidence?.appServerHandleJsonLinesSeen === true,
    ],
    ["appServerIpcHit", summary.bridge.appServerIpcHitCount > 0],
    [
      "currentMethods",
      MCP_CREATE_LIST_REQUIRED_METHODS.every((method) =>
        electronMethods.includes(method),
      ),
    ],
    ["legacyCommandsZero", legacyCommands.length === 0],
    ["mockFallbackZero", mockFallbackHitCount === 0],
    ["guiCreatedContext7", guiCreatedContext7 === true],
    ["serverReadback", context7Server?.name === "Context7"],
    ["consoleErrorsZero", consoleErrors.length === 0],
    ["pageErrorsZero", pageErrors.length === 0],
    ["invokeErrorsZero", invokeErrorCount === 0],
    ["screenshotWritten", screenshotWritten === true],
  ];
  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`SETTINGS MCP evidence 断言失败: ${failed.join(", ")}`);
  }

  summary.result = "pass";
  summary.completedAt = completedAt;
  summary.settingsScenarioProof.complete = true;
  summary.assertions = {
    total: checks.length,
    passed: checks.length,
    failed: [],
    details: Object.fromEntries(checks),
  };
  delete summary.failureClass;
  delete summary.nextAction;
  delete summary.error;
  return summary;
}

export function applyFailedMcpSettingsScenarioEvidence(summary, error) {
  summary.result = "fail";
  summary.settingsScenarioProof.complete = false;
  summary.assertions = {
    total: 1,
    passed: 0,
    failed: ["scenarioFailed"],
    details: {},
  };
  summary.failureClass = "settings-mcp-create-list-fixture";
  summary.nextAction =
    "Fix the real Electron MCP Settings boundary exposed by this fixture and rerun with the same candidate run-id.";
  summary.error = String(error instanceof Error ? error.message : error).slice(
    0,
    500,
  );
  return summary;
}
