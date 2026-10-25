#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { writeMcpFixture } from "../mcp/lib/current-smoke-fixture.mjs";
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
  openMcpConfigSettings,
  waitForPageCondition,
  parseInvokeTraceRaw,
  parseJsonRpcRequestsFromInvokeTrace,
  sanitizeText,
} from "./mcp-config-fixture-smoke.mjs";
import { parseMcpConfigFixtureArgs } from "./lib/mcp-config-fixture-evidence.mjs";

const APP_SERVER_DRAIN_EVENTS_COMMAND = "app_server_drain_events";
const STARTUP_NOTIFICATION_METHOD = "mcpServer/startupStatus/updated";
const REQUIRED_REFRESH_METHODS = ["mcpServerStatus/list", "mcpServer/list"];

const DEFAULTS = {
  runId: process.env.LIME_GATE_RUN_ID?.trim() || null,
  evidenceDir: path.join(
    process.cwd(),
    ".lime",
    "qc",
    "mcp-startup-notification",
  ),
  prefix: "mcp-startup-notification-fixture",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};

const LOG_PREFIX = "[smoke:mcp-startup-notification-fixture]";

function printHelp() {
  console.log(`
MCP Startup Notification Electron Fixture Smoke

用途:
  在真实 Electron Settings MCP 页面验证 App Server typed notification
  mcpServer/startupStatus/updated 的 starting -> ready / failed 通知及设置重读。

边界:
  使用临时 stdio MCP server 和临时失败配置，不调用正式模型或 live provider，
  不允许 App Server mock backend、renderer fallback 或旧 MCP Desktop event。

用法:
  npm run smoke:mcp-startup-notification-electron-fixture

选项:
  --run-id <id> --evidence-dir <path> --prefix <name> --timeout-ms <ms>
  --interval-ms <ms> --keep-temp -h|--help
`);
}

function logStage(stage) {
  console.log(`${LOG_PREFIX} stage=${stage}`);
}

function serverCard(page, serverName) {
  return page.getByTestId("mcp-config-server").filter({ hasText: serverName });
}

async function waitForSettingsRefresh(page, options, previousCount) {
  return waitForPageCondition(
    page,
    options,
    ({ previousCount }) => {
      const entries = JSON.parse(
        localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
      );
      const count = entries
        .flatMap((entry) => entry.args_preview?.request?.lines || [])
        .filter((line) => {
          try {
            return JSON.parse(line).method === "mcpServerStatus/list";
          } catch {
            return false;
          }
        }).length;
      return (
        count > previousCount &&
        !document.querySelector(
          '[data-testid="mcp-config-page"][aria-busy="true"]',
        )
      );
    },
    "Typed notification did not refresh the current MCP settings status",
    { previousCount },
  );
}

async function statusReadCount(page) {
  const raw = await page.evaluate(() =>
    localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  return parseJsonRpcRequestsFromInvokeTrace(raw).filter(
    (request) => request.method === "mcpServerStatus/list",
  ).length;
}

async function createServer(page, { id, name, description, serverConfig }) {
  const result = await appServerCallFromPage(page, "mcpServer/create", {
    server: {
      id,
      name,
      description,
      server_config: serverConfig,
      enabled_lime: true,
      created_at: Date.now(),
    },
  });
  assert(
    Array.isArray(result.result?.servers),
    "mcpServer/create 未返回 servers",
  );
  return result;
}

async function readRecentNotifications(page) {
  return await page.evaluate(
    async ({ command, notificationMethod }) => {
      const invoke = window.electronAPI?.invoke;
      if (typeof invoke !== "function") {
        throw new Error("Electron preload invoke bridge is unavailable");
      }
      const response = await invoke(command, {
        request: { includeRecent: true, limit: 100 },
      });
      const payload = response?.result ?? response;
      const messages = Array.isArray(payload?.lines)
        ? payload.lines
            .map((line) => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(Boolean)
        : [];
      return messages.filter(
        (message) => message?.method === notificationMethod,
      );
    },
    {
      command: APP_SERVER_DRAIN_EVENTS_COMMAND,
      notificationMethod: STARTUP_NOTIFICATION_METHOD,
    },
  );
}

function assertNotificationSequence(notifications, serverName, terminalStatus) {
  const serverNotifications = notifications.filter(
    (notification) => notification?.params?.name === serverName,
  );
  const statuses = serverNotifications.map(
    (notification) => notification.params.status,
  );
  const startingIndex = statuses.indexOf("starting");
  const terminalIndex = statuses.indexOf(terminalStatus);
  assert(startingIndex >= 0, `${serverName} 缺少 starting notification`);
  assert(
    terminalIndex > startingIndex,
    `${serverName} 的 ${terminalStatus} 未按顺序出现在 starting 之后`,
  );
  for (const notification of serverNotifications) {
    assert(
      JSON.stringify(Object.keys(notification.params).sort()) ===
        JSON.stringify(
          ["error", "failureReason", "name", "status", "threadId"].sort(),
        ),
      `${serverName} notification 字段漂移`,
    );
    assert(
      notification.params.threadId === null,
      `${serverName} threadId 应为 null`,
    );
    assert(
      notification.params.failureReason === null,
      `${serverName} failureReason 当前应为 null`,
    );
  }
  return { statuses, serverNotifications };
}

function summarizeTrace(traceRaw) {
  const trace = parseInvokeTraceRaw(traceRaw);
  const requests = parseJsonRpcRequestsFromInvokeTrace(traceRaw);
  const commands = [
    ...new Set(trace.map((entry) => entry?.command).filter(Boolean)),
  ];
  const requestMethods = [
    ...new Set(requests.map((request) => request.method).filter(Boolean)),
  ];
  const relevantEntries = trace.filter((entry) =>
    [
      APP_SERVER_HANDLE_JSON_LINES_COMMAND,
      APP_SERVER_DRAIN_EVENTS_COMMAND,
    ].includes(entry?.command),
  );
  return {
    commands,
    requestMethods,
    appServerHandleJsonLinesHitCount: relevantEntries.filter(
      (entry) => entry?.command === APP_SERVER_HANDLE_JSON_LINES_COMMAND,
    ).length,
    appServerDrainEventsHitCount: relevantEntries.filter(
      (entry) => entry?.command === APP_SERVER_DRAIN_EVENTS_COMMAND,
    ).length,
    electronIpcHitCount: relevantEntries.filter(
      (entry) => entry?.transport === "electron-ipc",
    ).length,
    mockFallbackHitCount: relevantEntries.filter(
      (entry) => entry?.transport !== "electron-ipc",
    ).length,
    failedInvokeCount: relevantEntries.filter(
      (entry) => entry?.status !== "success",
    ).length,
    missingRefreshMethods: REQUIRED_REFRESH_METHODS.filter(
      (method) => !requestMethods.includes(method),
    ),
    legacyMcpCommandsSeen: LEGACY_MCP_COMMANDS.filter((command) =>
      commands.includes(command),
    ),
  };
}

async function cleanupServer(page, id, name) {
  if (!page || page.isClosed()) return;
  await appServerCallFromPage(page, "mcpServer/stop", { name }).catch(
    () => undefined,
  );
  await appServerCallFromPage(page, "mcpServer/delete", { id }).catch(
    () => undefined,
  );
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
  const appServerBinary = resolveDevAppServerBinary({
    env: runtimeEnv.env,
    repoRoot: process.cwd(),
    forceBuild: false,
  });
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtimeEnv.env, APP_SERVER_BIN: appServerBinary },
  });
  const suffix = Date.now();
  const readyServer = {
    id: `mcp-startup-ready-${suffix}`,
    name: `startup-ready-${suffix}`,
  };
  const failedServer = {
    id: `mcp-startup-failed-${suffix}`,
    name: `startup-failed-${suffix}`,
  };
  const consoleErrors = [];
  const pageErrors = [];
  const summary = {
    ok: false,
    checkedAt: new Date().toISOString(),
    runId: options.runId,
    proofLevel: "Gate B",
    notificationMethod: STARTUP_NOTIFICATION_METHOD,
    backendMode: "runtime",
    electronPreloadBridge: false,
    lifecycleNotificationsObserved: false,
    settingsRefreshObserved: false,
    claimBoundary:
      "Real Electron/preload/App Server MCP lifecycle notifications and automatic settings configuration/status rereads. Lifecycle is protocol evidence; no retired statistics panel or visible status-label claim.",
    notificationSequences: null,
    trace: null,
    consoleErrors,
    pageErrors,
    invokeErrorCount: 0,
    screenshot: null,
    tempRoot: options.keepTemp ? runtimeEnv.tempRoot : null,
    failure: null,
  };

  let handle = null;
  let page = null;
  let fixture = null;
  try {
    logStage("write-delayed-mcp-fixture");
    fixture = await writeMcpFixture({ initializeDelayMs: 1_200 });

    logStage("launch-electron");
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
      backendMode: "runtime",
    });
    page = handle.page;
    summary.electronPreloadBridge =
      handle.rendererSnapshot.electron &&
      handle.rendererSnapshot.hasInvokeBridge;

    logStage("create-startup-servers");
    await createServer(page, {
      ...readyServer,
      description: "MCP startup ready notification fixture",
      serverConfig: {
        command: "node",
        args: [fixture.serverPath],
        cwd: fixture.root,
        timeout: 5,
      },
    });
    await createServer(page, {
      ...failedServer,
      description: "MCP startup failed notification fixture",
      serverConfig: {
        command: path.join(runtimeEnv.tempRoot, "missing-mcp-command"),
        args: [],
        timeout: 3,
      },
    });

    logStage("open-mcp-runtime-settings");
    await openMcpConfigSettings(page, options);
    const readyCard = serverCard(page, readyServer.name);
    const failedCard = serverCard(page, failedServer.name);
    await Promise.all([
      readyCard.waitFor({ state: "visible", timeout: 45_000 }),
      failedCard.waitFor({ state: "visible", timeout: 45_000 }),
    ]);
    await page.evaluate(() => {
      window.localStorage.removeItem("lime_invoke_error_buffer_v1");
      window.localStorage.removeItem("lime_invoke_trace_buffer_v1");
    });

    logStage("start-ready-server");
    const readyReads = await statusReadCount(page);
    await appServerCallFromPage(page, "mcpServer/start", {
      name: readyServer.name,
    });
    await waitForSettingsRefresh(page, options, readyReads);

    logStage("start-failed-server");
    const failedReads = await statusReadCount(page);
    const failedResult = await appServerCallFromPage(page, "mcpServer/start", {
      name: failedServer.name,
    }).then(
      () => ({ failed: false, error: null }),
      (error) => ({
        failed: true,
        error: sanitizeText(
          error instanceof Error ? error.message : String(error),
        ),
      }),
    );
    assert(failedResult.failed, "失败 MCP server 意外启动成功");
    await waitForSettingsRefresh(page, options, failedReads);
    summary.settingsRefreshObserved = true;

    logStage("read-recent-typed-notifications");
    const notifications = await readRecentNotifications(page);
    const readySequence = assertNotificationSequence(
      notifications,
      readyServer.name,
      "ready",
    );
    const failedSequence = assertNotificationSequence(
      notifications,
      failedServer.name,
      "failed",
    );
    const failedTerminal = failedSequence.serverNotifications.find(
      (notification) => notification.params.status === "failed",
    );
    assert(
      typeof failedTerminal?.params?.error === "string" &&
        failedTerminal.params.error.length > 0,
      "failed notification 缺少 error",
    );
    summary.lifecycleNotificationsObserved = true;
    summary.notificationSequences = {
      [readyServer.name]: readySequence.statuses,
      [failedServer.name]: failedSequence.statuses,
    };

    const invokeEvidence = await page.evaluate(() => ({
      traceRaw: window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
      errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
      url: window.location.href,
      locale: document.documentElement.lang,
      electron: window.__LIME_ELECTRON__ === true,
      hasInvokeBridge: typeof window.electronAPI?.invoke === "function",
    }));
    const trace = summarizeTrace(invokeEvidence.traceRaw);
    assert(invokeEvidence.electron, "页面不是 Electron renderer");
    assert(invokeEvidence.hasInvokeBridge, "preload invoke bridge 不可用");
    assert(
      trace.appServerHandleJsonLinesHitCount > 0,
      "未观察到 App Server handle IPC",
    );
    assert(
      trace.appServerDrainEventsHitCount > 0,
      "未观察到 App Server event drain",
    );
    assert(
      trace.missingRefreshMethods.length === 0,
      "terminal notification 未触发刷新",
    );
    assert(trace.mockFallbackHitCount === 0, "观察到非 Electron IPC fallback");
    assert(trace.failedInvokeCount === 0, "观察到 current bridge invoke 失败");
    assert(trace.legacyMcpCommandsSeen.length === 0, "观察到 legacy MCP 命令");
    const invokeErrors = parseInvokeTraceRaw(invokeEvidence.errorRaw);
    assert(invokeErrors.length === 0, "观察到 invoke error buffer 记录");
    assert(
      consoleErrors.length === 0,
      `观察到 console error: ${consoleErrors.join(" | ")}`,
    );
    assert(
      pageErrors.length === 0,
      `观察到 page error: ${pageErrors.join(" | ")}`,
    );

    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.ok = true;
    summary.completedAt = new Date().toISOString();
    summary.pageUrl = invokeEvidence.url;
    summary.documentLocale = invokeEvidence.locale;
    summary.trace = trace;
    summary.invokeErrorCount = invokeErrors.length;
    summary.screenshot = path.basename(screenshotPath);
    writeJsonFile(summaryPath, summary);
    console.log(`${LOG_PREFIX} summary=${summaryPath}`);
  } catch (error) {
    summary.completedAt = new Date().toISOString();
    summary.failure = sanitizeText(
      error instanceof Error ? error.message : String(error),
    );
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: failureScreenshotPath, fullPage: true })
        .catch(() => undefined);
      summary.failureScreenshot = path.basename(failureScreenshotPath);
    }
    writeJsonFile(summaryPath, summary);
    console.error(`${LOG_PREFIX} failed=${summary.failure}`);
    console.error(`${LOG_PREFIX} summary=${summaryPath}`);
    throw error;
  } finally {
    await cleanupServer(page, readyServer.id, readyServer.name);
    await cleanupServer(page, failedServer.id, failedServer.name);
    await closeElectronFixture(handle);
    if (!options.keepTemp) {
      if (fixture?.root)
        fs.rmSync(fixture.root, { recursive: true, force: true });
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
