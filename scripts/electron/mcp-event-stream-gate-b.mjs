#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { ensureElectronFixtureBuild } from "../lib/electron-fixture-build.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  APP_SERVER_HANDLE_JSON_LINES_COMMAND,
  LEGACY_MCP_COMMANDS,
  writeJsonFile,
} from "../mcp/lib/current-smoke-transport.mjs";
import {
  appServerCallFromPage,
  assert,
  closeElectronFixture,
  createTempRuntimeEnv,
  launchElectronFixture,
  parseInvokeTraceRaw,
  parseJsonRpcRequestsFromInvokeTrace,
  sanitizeText,
  sleep,
} from "./mcp-config-fixture-smoke.mjs";
import {
  parseMcpConfigFixtureArgs,
  isObservedPreloadAppServerResponse,
} from "./lib/mcp-config-fixture-evidence.mjs";

export const MCP_EVENT_STREAM_NOTIFICATION_METHOD =
  "mcpServer/event/stream/notification";
export const MCP_EVENT_STREAM_START_METHOD = "mcpServer/event/stream/start";
export const MCP_EVENT_STREAM_REQUIRED_METHODS = [
  "thread/start",
  MCP_EVENT_STREAM_START_METHOD,
];

const APP_SERVER_DRAIN_EVENTS_COMMAND = "app_server_drain_events";
const EVENT_STREAM_SERVER_METHOD = "notifications/events/event";
const EVENT_STREAM_ACTIVE_METHOD = "notifications/events/active";
const EVENT_STREAM_TERMINATED_METHOD = "notifications/events/terminated";
const DEFAULTS = {
  evidenceDir: path.join(
    process.cwd(),
    ".lime",
    "qc",
    "gui-evidence",
    "mcp-event-stream-electron-gate-b",
  ),
  prefix: "mcp-event-stream-electron-gate-b",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};
const LOG_PREFIX = "[smoke:mcp-event-stream-gate-b]";

function printHelp() {
  console.log(`
MCP Event Stream Electron Gate B

用途:
  通过真实 Electron preload/App Server 验证同一 MCP event stream 订阅的
  active、event、重复 active 和 terminated 协议，不证明设置 UI 或网络重连。

边界:
  使用临时 stdio MCP server 与真实 App Server runtime；不调用模型、不使用
  renderer mock fallback、App Server mock backend 或旧 MCP Desktop facade。

选项:
  --evidence-dir <path> --prefix <name> --timeout-ms <ms>
  --interval-ms <ms> --keep-temp -h|--help
`);
}

function logStage(stage) {
  console.log(`${LOG_PREFIX} stage=${stage}`);
}

function writeEventStreamFixture(filePath) {
  fs.writeFileSync(
    filePath,
    `import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(\`${"${JSON.stringify(message)}"}\\n\`);
const result = (id, value) => send({ jsonrpc: "2.0", id, result: value });

rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: "2025-03-26",
      capabilities: {},
      serverInfo: { name: "event-stream-gate-b", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    result(message.id, { tools: [] });
    return;
  }
  if (message.method !== "events/stream") return;
  const meta = message.params?._meta || {};
  const sendEvent = (method, params) => send({
    jsonrpc: "2.0",
    method,
    params: { ...params, _meta: meta },
  });
  sendEvent("notifications/events/active", { status: "active" });
  setTimeout(() => sendEvent("notifications/events/event", {
    name: "issue.updated",
    data: { issue: 42, source: "electron-gate-b" },
  }), 150);
  setTimeout(() => sendEvent("notifications/events/active", { status: "active" }), 350);
  setTimeout(() => sendEvent("notifications/events/event", {
    name: "issue.recovered",
    data: { issue: 42, source: "electron-gate-b" },
  }), 500);
  setTimeout(() => sendEvent("notifications/events/terminated", {}), 900);
});
`,
    "utf8",
  );
}

async function createMcpServer(page, server, fixturePath, fixtureRoot) {
  return appServerCallFromPage(page, "mcpServer/create", {
    server: {
      id: server.id,
      name: server.name,
      description: "MCP event stream Electron Gate B fixture",
      server_config: {
        type: "stdio",
        command: process.execPath,
        args: [fixturePath],
        cwd: fixtureRoot,
        timeout: 10,
        enabled: true,
      },
      enabled_lime: true,
      created_at: Date.now(),
    },
  });
}

async function createFixtureProvider(page, fixture) {
  const providerName = `MCP event stream Gate B ${Date.now()}`;
  const created = await appServerCallFromPage(page, "modelProvider/create", {
    name: providerName,
    providerType: fixture.provider.providerName,
    apiHost: fixture.provider.providerConfig.baseUrl,
  });
  const providerId = String(created.result?.provider?.id || "").trim();
  assert(providerId, "modelProvider/create 未返回 provider.id");
  await appServerCallFromPage(page, "modelProvider/update", {
    providerId,
    enabled: true,
    sortOrder: 1,
    models: [
      {
        id: fixture.provider.modelPreference,
        capability: fixture.provider.providerConfig.modelCapabilities,
      },
    ],
  });
  const key = await appServerCallFromPage(page, "modelProviderKey/create", {
    providerId,
    apiKey: fixture.provider.providerConfig.apiKey,
    alias: "mcp-event-stream-gate-b",
    replaceExisting: true,
  });
  assert(key.result?.key?.id, "modelProviderKey/create 未返回 key.id");
  const catalog = await appServerCallFromPage(page, "model/list", {
    includeHidden: true,
    limit: 500,
  });
  const model = Array.isArray(catalog.result?.data)
    ? catalog.result.data.find(
        (candidate) =>
          candidate?.providerId === providerId &&
          candidate?.model === fixture.provider.modelPreference,
      )
    : null;
  assert(model, "model/list 未返回可执行 fixture route");
  return {
    model: fixture.provider.modelPreference,
    providerId,
  };
}

async function readRecentStreamNotifications(page) {
  return page.evaluate(async (command) => {
    const invoke = window.electronAPI?.invoke;
    if (typeof invoke !== "function") {
      throw new Error("Electron preload invoke bridge is unavailable");
    }
    const response = await invoke(command, {
      request: { includeRecent: true, limit: 200 },
    });
    const payload = response?.result ?? response;
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(
        (message) => message?.method === "mcpServer/event/stream/notification",
      );
  }, APP_SERVER_DRAIN_EVENTS_COMMAND);
}

function summarizeTrace(traceRaw, setupRequests = []) {
  const trace = parseInvokeTraceRaw(traceRaw);
  const requests = [
    ...setupRequests,
    ...parseJsonRpcRequestsFromInvokeTrace(traceRaw),
  ];
  const relevantTrace = trace.filter((entry) =>
    [
      APP_SERVER_HANDLE_JSON_LINES_COMMAND,
      APP_SERVER_DRAIN_EVENTS_COMMAND,
    ].includes(entry?.command),
  );
  const requestMethods = Array.from(
    new Set(requests.map((request) => request.method).filter(Boolean)),
  );
  const streamNotifications = requests.filter(
    (request) => request.method === MCP_EVENT_STREAM_NOTIFICATION_METHOD,
  );
  const commands = Array.from(
    new Set(trace.map((entry) => entry?.command).filter(Boolean)),
  );
  return {
    commands,
    requestMethods,
    streamNotificationRequestCount: streamNotifications.length,
    appServerHandleJsonLinesHitCount: relevantTrace.filter(
      (entry) => entry?.command === APP_SERVER_HANDLE_JSON_LINES_COMMAND,
    ).length,
    appServerDrainEventsHitCount: relevantTrace.filter(
      (entry) => entry?.command === APP_SERVER_DRAIN_EVENTS_COMMAND,
    ).length,
    electronIpcHitCount: relevantTrace.filter(
      (entry) => entry?.transport === "electron-ipc",
    ).length,
    mockFallbackHitCount: relevantTrace.filter(
      (entry) => entry?.transport !== "electron-ipc",
    ).length,
    failedInvokeCount: relevantTrace.filter(
      (entry) => entry?.status !== "success",
    ).length,
    missingRequiredMethods: MCP_EVENT_STREAM_REQUIRED_METHODS.filter(
      (method) => !requestMethods.includes(method),
    ),
    legacyMcpCommandsSeen: LEGACY_MCP_COMMANDS.filter((command) =>
      commands.includes(command),
    ),
  };
}

export function summarizeMcpEventStreamEvidence({
  traceRaw,
  subscriptionId,
  notifications,
  setupRequests = [],
}) {
  const trace = summarizeTrace(traceRaw, setupRequests);
  const methods = notifications
    .filter(
      (message) =>
        message?.method === MCP_EVENT_STREAM_NOTIFICATION_METHOD &&
        message?.params?.subscriptionId === subscriptionId,
    )
    .map((notification) => notification?.params?.notification?.method);
  const streamNotificationMethods = Array.from(new Set(methods));
  const activeCount = methods.filter(
    (method) => method === EVENT_STREAM_ACTIVE_METHOD,
  ).length;
  const eventCount = methods.filter(
    (method) => method === EVENT_STREAM_SERVER_METHOD,
  ).length;
  const terminatedCount = methods.filter(
    (method) => method === EVENT_STREAM_TERMINATED_METHOD,
  ).length;
  return {
    lifecycle: {
      activeCount,
      eventCount,
      terminatedCount,
      methods: streamNotificationMethods,
      repeatedActiveObserved: activeCount > 1,
      orderedLifecycle:
        methods[0] === EVENT_STREAM_ACTIVE_METHOD &&
        methods.at(-1) === EVENT_STREAM_TERMINATED_METHOD &&
        methods.indexOf(EVENT_STREAM_SERVER_METHOD) > 0,
      subscriptionId,
    },
    bridge: trace,
    ok:
      activeCount > 0 &&
      eventCount > 0 &&
      terminatedCount > 0 &&
      trace.missingRequiredMethods.length === 0 &&
      trace.appServerHandleJsonLinesHitCount > 0 &&
      trace.appServerDrainEventsHitCount > 0 &&
      trace.mockFallbackHitCount === 0 &&
      trace.failedInvokeCount === 0 &&
      trace.legacyMcpCommandsSeen.length === 0 &&
      activeCount > 1 &&
      methods[0] === EVENT_STREAM_ACTIVE_METHOD &&
      methods.at(-1) === EVENT_STREAM_TERMINATED_METHOD &&
      methods.indexOf(EVENT_STREAM_SERVER_METHOD) > 0,
  };
}

async function readRendererBridge(page) {
  return page.evaluate(() => ({
    traceRaw: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errorRaw: localStorage.getItem("lime_invoke_error_buffer_v1"),
    locale: document.documentElement.lang,
    electron: window.__LIME_ELECTRON__ === true,
    hasInvokeBridge: typeof window.electronAPI?.invoke === "function",
  }));
}

export function assertEvidence(evidence) {
  assert(
    evidence.lifecycle.activeCount > 0,
    "缺少 active event stream notification",
  );
  assert(
    evidence.lifecycle.eventCount > 0,
    "缺少 event stream event notification",
  );
  assert(
    evidence.lifecycle.terminatedCount > 0,
    "缺少 terminated event stream notification",
  );
  assert(
    evidence.bridge.missingRequiredMethods.length === 0,
    `缺少 current methods: ${evidence.bridge.missingRequiredMethods.join(", ")}`,
  );
  assert(
    evidence.bridge.appServerHandleJsonLinesHitCount > 0,
    "未命中 app_server_handle_json_lines",
  );
  assert(
    evidence.bridge.appServerDrainEventsHitCount > 0,
    "未命中 app_server_drain_events",
  );
  assert(evidence.bridge.mockFallbackHitCount === 0, "观察到 mock fallback");
  assert(evidence.bridge.failedInvokeCount === 0, "观察到 invoke error");
  assert(
    evidence.bridge.legacyMcpCommandsSeen.length === 0,
    "观察到已退役 MCP 命令",
  );
  assert(
    evidence.lifecycle.repeatedActiveObserved,
    "缺少同一订阅的重复 active 通知",
  );
  assert(
    evidence.lifecycle.orderedLifecycle,
    "同一订阅的 active/event/terminated 顺序错误",
  );
}

async function cleanupServer(page, server) {
  if (!page || page.isClosed()) return;
  await appServerCallFromPage(page, "mcpServer/stop", {
    name: server.name,
  }).catch(() => undefined);
  await appServerCallFromPage(page, "mcpServer/delete", {
    id: server.id,
  }).catch(() => undefined);
}

export async function run() {
  const options = parseMcpConfigFixtureArgs(process.argv.slice(2), {
    defaults: DEFAULTS,
  });
  if (options.help) {
    printHelp();
    return;
  }
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const summaryPath = path.join(
    options.evidenceDir,
    `${options.prefix}-summary.json`,
  );
  const screenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}.png`,
  );
  const failureScreenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}-failure.png`,
  );
  const runtimeEnv = createTempRuntimeEnv();
  const fixtureRoot = path.join(runtimeEnv.tempRoot, "event-stream-fixture");
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const fixturePath = path.join(fixtureRoot, "server.mjs");
  writeEventStreamFixture(fixturePath);
  const server = {
    id: "event-stream-gate-b",
    name: "event-stream-gate-b",
  };
  const consoleErrors = [];
  const pageErrors = [];
  let providerFixture = null;
  const summary = {
    schemaVersion: 1,
    scenarioId: "CODEX-ALIGN-mcp-event-stream",
    proofLevel: "Electron IPC / App Server event protocol",
    claimBoundary:
      "Real Electron/preload/App Server MCP event protocol and canonical Thread subscription, filtered by the exact subscription identity. No settings lifecycle UI, network reconnect, live provider or packaged behavior claim.",
    ok: false,
    checkedAt: new Date().toISOString(),
    identity: { threadId: null, subscriptionId: null },
    bridge: null,
    lifecycle: null,
    errors: null,
    screenshot: null,
  };
  let handle = null;
  let threadId = null;
  const setupRequests = [];
  try {
    logStage("start-provider-fixture");
    providerFixture = await startOpenAiCompatibleFixtureServer();
    ensureElectronFixtureBuild({
      logPrefix: LOG_PREFIX,
      rootDir: process.cwd(),
    });
    const appServerBinary = resolveDevAppServerBinary({
      env: runtimeEnv.env,
      repoRoot: process.cwd(),
      forceBuild: false,
    });
    const appServerEnv = resolveElectronAppServerRuntimeEnv({
      env: { ...runtimeEnv.env, APP_SERVER_BIN: appServerBinary },
    });
    logStage("launch-electron");
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
      backendMode: "runtime",
    });
    const page = handle.page;
    await page.evaluate(() => {
      window.localStorage.removeItem("lime_invoke_error_buffer_v1");
      window.localStorage.removeItem("lime_invoke_trace_buffer_v1");
      window.localStorage.setItem("lime.app-sidebar.collapsed", "false");
    });
    logStage("create-and-start-mcp-server");
    await createMcpServer(page, server, fixturePath, fixtureRoot);
    await appServerCallFromPage(page, "mcpServer/start", { name: server.name });
    const route = await createFixtureProvider(page, providerFixture);
    logStage("start-canonical-thread");
    const started = await appServerCallFromPage(page, "thread/start", {
      model: route.model,
      modelProvider: route.providerId,
      cwd: fixtureRoot,
      serviceName: "MCP Event Stream Gate B",
      historyMode: "legacy",
      threadSource: "fixture",
    });
    threadId = String(started.result?.thread?.id || "").trim();
    assert(threadId, "thread/start 未返回 canonical Thread ID");
    assert(
      isObservedPreloadAppServerResponse(
        started.ipcObservation,
        "thread/start",
      ),
      "thread/start requires the matching real preload IPC response",
    );
    setupRequests.push(started.ipcObservation);
    const subscriptionId = `event-stream-${Date.now()}`;
    logStage("start-event-stream");
    const streamStarted = await appServerCallFromPage(
      page,
      MCP_EVENT_STREAM_START_METHOD,
      {
        threadId,
        server: server.name,
        subscriptionId,
        name: "issue.updated",
        arguments: {},
        _meta: { source: "electron-gate-b" },
      },
    );
    assert(
      isObservedPreloadAppServerResponse(
        streamStarted.ipcObservation,
        MCP_EVENT_STREAM_START_METHOD,
      ),
      "event subscription requires the matching real preload IPC response",
    );
    setupRequests.push(streamStarted.ipcObservation);
    const deadline = Date.now() + options.timeoutMs;
    let notifications = [];
    while (Date.now() < deadline) {
      notifications = await readRecentStreamNotifications(page);
      if (
        notifications.some(
          (message) =>
            message.params?.subscriptionId === subscriptionId &&
            message.params?.notification?.method ===
              EVENT_STREAM_TERMINATED_METHOD,
        )
      )
        break;
      await sleep(options.intervalMs);
    }
    const observed = await readRendererBridge(page);
    const evidence = summarizeMcpEventStreamEvidence({
      traceRaw: observed.traceRaw,
      subscriptionId,
      notifications,
      setupRequests,
    });
    assert(observed.electron, "页面不是 Electron renderer");
    assert(observed.hasInvokeBridge, "preload invoke bridge 不可用");
    assertEvidence(evidence);
    assert(
      consoleErrors.length === 0,
      `观察到 console error: ${consoleErrors.join(" | ")}`,
    );
    assert(
      pageErrors.length === 0,
      `观察到 page error: ${pageErrors.join(" | ")}`,
    );
    const invokeErrors = parseInvokeTraceRaw(observed.errorRaw);
    assert(invokeErrors.length === 0, "观察到 invoke error buffer 记录");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.ok = true;
    summary.identity = { threadId, subscriptionId };
    summary.bridge = evidence.bridge;
    summary.lifecycle = evidence.lifecycle;
    summary.errors = {
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      invokeErrorCount: invokeErrors.length,
      legacyCommands: evidence.bridge.legacyMcpCommandsSeen,
    };
    summary.screenshot = path.basename(screenshotPath);
    summary.documentLocale = observed.locale;
    writeJsonFile(summaryPath, summary);
    console.log(`${LOG_PREFIX} summary=${summaryPath}`);
  } catch (error) {
    summary.error = sanitizeText(
      error instanceof Error ? error.message : String(error),
    );
    summary.errors = {
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    };
    if (handle?.page && !handle.page.isClosed()) {
      await handle.page
        .screenshot({ path: failureScreenshotPath, fullPage: true })
        .catch(() => undefined);
      summary.failureScreenshot = path.basename(failureScreenshotPath);
    }
    writeJsonFile(summaryPath, summary);
    console.error(`${LOG_PREFIX} failed=${summary.error}`);
    console.error(`${LOG_PREFIX} summary=${summaryPath}`);
    throw error;
  } finally {
    await cleanupServer(handle?.page, server);
    if (providerFixture) {
      await providerFixture.close().catch(() => undefined);
    }
    await closeElectronFixture(handle);
    if (!options.keepTemp) {
      fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
    }
  }
}

const entryHref = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entryHref === import.meta.url) {
  run().catch(() => {
    process.exitCode = 1;
  });
}
