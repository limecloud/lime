#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import electronPath from "electron";
import { _electron as electron, chromium } from "playwright";

import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { ensureElectronFixtureBuild } from "../lib/electron-fixture-build.mjs";
import { createTempRuntimeEnv } from "../lib/chat-fixture/backend-file.mjs";
import {
  APP_SERVER_HANDLE_JSON_LINES_COMMAND,
  APP_SERVER_METHOD_INITIALIZED,
  APP_SERVER_METHOD_INITIALIZE,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
} from "../lib/chat-fixture/constants.mjs";
import {
  openSessionFromSidebar,
  navigateGuiToWorkspaceScopedAgent,
  waitForGuiSessionVisible,
} from "../lib/chat-fixture/session.mjs";
import {
  bindGuiWorkspaceAndModelPreferences,
  clearInvokeBuffers,
  collectTraceRequestMethods,
  decodeJsonRpcLines,
  initializeAppServer,
  invokeAppServerFromPage,
  readTraceMessages,
  waitForAppUrlReady,
  waitForRendererReady,
} from "../lib/chat-fixture/rpc.mjs";
import {
  assert,
  cleanupTempRoot,
  sanitizeJson,
  sanitizeText,
  sleep,
  writeJsonFile,
} from "../lib/chat-fixture/utils.mjs";

const LOG_PREFIX = "[cdp:agent-session-recovery]";
const DEFAULTS = {
  appUrl: "",
  cdpPort: 9223,
  cdpUrl: "",
  evidenceDir: path.join(process.cwd(), ".lime", "cdp-evidence"),
  prefix: "agent-session-recovery-cdp-gate",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};
const SESSION_TITLE = "Agent recovery CDP Gate session";
const APP_SERVER_METHOD_THREAD_START = "thread/start";
const APP_SERVER_METHOD_THREAD_READ = "thread/read";
const APP_SERVER_METHOD_THREAD_LIST = "thread/list";
const APP_SERVER_METHOD_THREAD_RESUME = "thread/resume";

function printHelp() {
  console.log(`
Agent Session Recovery CDP Gate

用途:
  启动真实 Electron Desktop Host，打开 CDP 端口，再通过
  chromium.connectOverCDP 连接真实 Electron renderer，验证:
  window.__LIME_ELECTRON__、preload invoke、app_server_handle_json_lines、
  thread/start/read/list current JSON-RPC 主链。

边界:
  默认 APP_SERVER_BACKEND_MODE=unavailable，不触发 turn/start，
  不调用正式模型后端，不使用 App Server mock backend 或 renderer mock fallback。

用法:
  node scripts/agent-runtime/agent-session-recovery-cdp-gate.mjs

选项:
  --app-url <url>        可选 renderer dev server，例如 http://127.0.0.1:1420/
  --cdp-port <port>      Electron remote debugging port，默认 ${DEFAULTS.cdpPort}
  --cdp-url <url>        显式 CDP endpoint；默认由 cdp-port 生成
  --evidence-dir <path>  证据目录，默认 .lime/cdp-evidence
  --prefix <name>        证据文件前缀
  --timeout-ms <ms>      总超时，默认 ${DEFAULTS.timeoutMs}
  --interval-ms <ms>     轮询间隔，默认 ${DEFAULTS.intervalMs}
  --keep-temp            保留临时目录便于调试
  -h, --help             显示帮助
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--app-url" && next) {
      options.appUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--cdp-port" && next) {
      options.cdpPort = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--cdp-url" && next) {
      options.cdpUrl = next.trim();
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
  if (!Number.isFinite(options.cdpPort) || options.cdpPort < 1) {
    throw new Error("--cdp-port 必须是有效端口");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30_000) {
    throw new Error("--timeout-ms 必须是 >= 30000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  if (!options.cdpUrl) {
    options.cdpUrl = `http://127.0.0.1:${options.cdpPort}`;
  }
  return options;
}

function logStage(stage) {
  console.log(`${LOG_PREFIX} stage=${stage}`);
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return await response.json();
}

async function waitForCdpEndpoint(options) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const [version, targets] = await Promise.all([
        fetchJson(`${options.cdpUrl}/json/version`),
        fetchJson(`${options.cdpUrl}/json/list`),
      ]);
      return {
        url: options.cdpUrl,
        waitedMs: Date.now() - startedAt,
        version: summarizeCdpVersion(version),
        targets: summarizeCdpTargets(targets),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(options.intervalMs);
    }
  }
  throw new Error(`Electron CDP endpoint 未就绪: ${lastError}`);
}

function summarizeCdpVersion(version) {
  return sanitizeJson({
    browser: version?.Browser ?? version?.browser ?? null,
    protocolVersion: version?.["Protocol-Version"] ?? null,
    userAgent: version?.["User-Agent"] ?? null,
    webSocketDebuggerUrl: version?.webSocketDebuggerUrl ? "present" : null,
  });
}

function summarizeCdpTargets(targets) {
  return (Array.isArray(targets) ? targets : []).map((target) =>
    sanitizeJson({
      id: target?.id ?? null,
      type: target?.type ?? null,
      title: target?.title ?? null,
      url: target?.url ?? null,
    }),
  );
}

async function findElectronCdpPage(browser, options) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const page of pages) {
      const snapshot = await page
        .evaluate(() => ({
          url: window.location.href,
          title: document.title || "",
          electron: window.__LIME_ELECTRON__ === true,
          hasInvokeBridge: typeof window.electronAPI?.invoke === "function",
          supportsAppServer:
            typeof window.electronAPI?.supportsCommand === "function" &&
            window.electronAPI.supportsCommand("app_server_handle_json_lines"),
          startupVisible: Boolean(
            document.querySelector("[data-lime-startup-shell]"),
          ),
          appSidebarVisible: Boolean(
            document.querySelector('[data-testid="app-sidebar"]'),
          ),
        }))
        .catch(() => null);
      lastSnapshot = snapshot;
      if (
        snapshot?.electron &&
        snapshot.hasInvokeBridge &&
        snapshot.supportsAppServer
      ) {
        return page;
      }
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `未找到真实 Electron renderer CDP 页签: ${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}

function summarizeTraceMessages(traceMessages) {
  const appServerEntries = traceMessages.filter(
    (entry) => entry?.command === APP_SERVER_HANDLE_JSON_LINES_COMMAND,
  );
  const methodEntries = appServerEntries.flatMap((entry) =>
    decodeJsonRpcLines(entry?.args_preview?.request?.lines).map((message) => ({
      command: entry.command ?? null,
      transport: entry.transport ?? null,
      status: entry.status ?? null,
      method: message.method ?? null,
      id: message.id ?? null,
      sessionId:
        message.params?.sessionId ?? message.params?.session_id ?? null,
      threadId: message.params?.threadId ?? message.params?.thread_id ?? null,
      turnId: message.params?.turnId ?? message.params?.turn_id ?? null,
      promptLength:
        typeof message.params?.input?.text === "string"
          ? message.params.input.text.length
          : null,
    })),
  );
  return sanitizeJson({
    entryCount: traceMessages.length,
    appServerEntryCount: appServerEntries.length,
    methods: Array.from(new Set(collectTraceRequestMethods(traceMessages))),
    electronIpcSuccessCount: methodEntries.filter(
      (entry) =>
        entry.transport === "electron-ipc" && entry.status === "success",
    ).length,
    methodEntries,
  });
}

async function readRendererTrace(page) {
  const raw = await page.evaluate(() =>
    window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
  );
  return readTraceMessages(raw);
}

async function waitForProductTraceMethods(page, options, requiredMethods) {
  const startedAt = Date.now();
  let lastSummary = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const traceMessages = await readRendererTrace(page);
    const summary = summarizeTraceMessages(traceMessages);
    lastSummary = summary;
    const methods = new Set(summary.methods ?? []);
    const hasRequiredMethods = requiredMethods.every((method) =>
      methods.has(method),
    );
    if (
      hasRequiredMethods &&
      (summary.electronIpcSuccessCount ?? 0) > 0 &&
      (summary.appServerEntryCount ?? 0) > 0
    ) {
      return summary;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `未观察到 renderer safeInvoke 产品路径 trace: required=${requiredMethods.join(
      ", ",
    )}; last=${JSON.stringify(sanitizeJson(lastSummary))}`,
  );
}

async function startProbeThread(page, workspace, requestLog) {
  const response = await invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_THREAD_START,
    {
      model: FIXTURE_MODEL,
      modelProvider: FIXTURE_PROVIDER,
      cwd: workspace.rootPath,
      serviceName: SESSION_TITLE,
      threadSource: "appServer",
      historyMode: "legacy",
    },
    requestLog,
  );
  const thread = response.result?.thread;
  const threadId = String(thread?.id || "").trim();
  const sessionId = String(thread?.sessionId || "").trim();
  assert(threadId, "thread/start 未返回 thread.id");
  assert(sessionId, "thread/start 未返回 thread.sessionId");
  return {
    response: response.result,
    sessionId,
    threadId,
  };
}

function summarizeThreadRead(result) {
  const thread = result?.thread;
  return sanitizeJson({
    sessionId: thread?.sessionId ?? null,
    threadId: thread?.id ?? null,
    name: thread?.name ?? null,
    modelProvider: thread?.modelProvider ?? null,
    cwd: thread?.cwd ?? null,
    turnCount: Array.isArray(thread?.turns) ? thread.turns.length : null,
    status: thread?.status?.type ?? null,
  });
}

function summarizeThreadList(result, identity) {
  const threads = Array.isArray(result?.data) ? result.data : [];
  const matched = threads.find(
    (thread) =>
      thread?.id === identity.threadId &&
      thread?.sessionId === identity.sessionId,
  );
  return {
    count: threads.length,
    matched: matched
      ? {
          sessionId: matched.sessionId,
          threadId: matched.id,
          name: matched.name ?? null,
          status: matched.status?.type ?? null,
        }
      : null,
  };
}

function summarizeThreadResume(invocation) {
  const result = invocation?.result;
  return sanitizeJson({
    sessionId: result?.thread?.sessionId ?? null,
    threadId: result?.thread?.id ?? null,
    threadTurnCount: Array.isArray(result?.thread?.turns)
      ? result.thread.turns.length
      : null,
    initialTurnCount: Array.isArray(result?.initialTurnsPage?.data)
      ? result.initialTurnsPage.data.length
      : null,
    model: result?.model ?? null,
    modelProvider: result?.modelProvider ?? null,
    cwd: result?.cwd ?? null,
    hasLegacyFields: ["resumed", "session", "turns"].some((key) =>
      Object.hasOwn(result ?? {}, key),
    ),
    emittedThreadStarted: (invocation?.messages ?? []).some(
      (message) => message?.method === "thread/started",
    ),
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  ensureElectronFixtureBuild({
    appUrl: options.appUrl,
    logPrefix: LOG_PREFIX,
    rootDir: process.cwd(),
  });
  fs.mkdirSync(options.evidenceDir, { recursive: true });

  const summaryPath = path.join(
    options.evidenceDir,
    `${options.prefix}-summary.json`,
  );
  const screenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}-screenshot.png`,
  );
  const tracePath = path.join(
    options.evidenceDir,
    `${options.prefix}-trace-summary.json`,
  );

  const runtimeEnv = createTempRuntimeEnv();
  const appServerBinary = resolveDevAppServerBinary({
    env: runtimeEnv.env,
    repoRoot: process.cwd(),
  });
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: {
      ...runtimeEnv.env,
      APP_SERVER_BIN: appServerBinary,
    },
  });
  const requestLog = [];
  const consoleErrors = [];
  const summary = {
    ok: false,
    scenarioId: "agent-session-recovery-cdp-gate",
    proofLevel: "Gate B",
    claimBoundary:
      "真实 Electron CDP attach + preload IPC + app_server_handle_json_lines + canonical thread start/read/list/resume；不证明 live Provider turn 输出。",
    appUrl: options.appUrl || null,
    cdpUrl: options.cdpUrl,
    cdpPort: options.cdpPort,
    backendMode: "unavailable",
    sessionId: null,
    threadId: null,
    checkedAt: new Date().toISOString(),
    tempRoot: options.keepTemp ? runtimeEnv.tempRoot : null,
    electronUserDataDir: options.keepTemp
      ? runtimeEnv.electronUserDataDir
      : null,
    rendererSnapshot: null,
    cdpEndpoint: null,
    cdpPage: null,
    initialize: null,
    workspace: null,
    threadCreation: null,
    threadRead: null,
    threadList: null,
    threadResume: null,
    traceSummary: null,
    traceSummaryPath: tracePath,
    screenshot: null,
    consoleErrors,
    assertions: {},
  };

  let app = null;
  let browser = null;
  try {
    if (options.appUrl) {
      logStage("wait-app-url");
      summary.rendererDevServer = await waitForAppUrlReady(options);
    }

    logStage("launch-electron");
    app = await electron.launch({
      executablePath: electronPath,
      args: [
        `--remote-debugging-port=${options.cdpPort}`,
        "--use-mock-keychain",
        ".",
      ],
      cwd: process.cwd(),
      env: {
        ...runtimeEnv.env,
        ...appServerEnv,
        APP_SERVER_BACKEND_MODE: "unavailable",
        ELECTRON_E2E_USER_DATA_DIR: runtimeEnv.electronUserDataDir,
        LIME_ALLOW_LIVE_PROVIDER_SMOKE: "0",
        LIME_REAL_API_TEST: "0",
        LIME_ELECTRON_E2E: "1",
        LIME_ELECTRON_BRAND_DEV_APP: "0",
        LIME_ELECTRON_CLEAR_RENDERER_CACHE: "0",
        LIME_ELECTRON_DEV_HTTP_BRIDGE: "0",
        LIME_ELECTRON_REMOTE_DEBUGGING_PORT: String(options.cdpPort),
        ...(options.appUrl ? { VITE_DEV_SERVER_URL: options.appUrl } : {}),
      },
      timeout: options.timeoutMs,
    });
    app.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(sanitizeText(message.text()));
      }
    });

    const firstWindow = await app.firstWindow({ timeout: options.timeoutMs });
    firstWindow.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(sanitizeText(message.text()));
      }
    });
    firstWindow.setDefaultTimeout(options.timeoutMs);
    await firstWindow.setViewportSize({ width: 1440, height: 1000 });

    logStage("wait-cdp-endpoint");
    summary.cdpEndpoint = await waitForCdpEndpoint(options);

    logStage("connect-over-cdp");
    browser = await chromium.connectOverCDP(options.cdpUrl);
    const page = await findElectronCdpPage(browser, options);
    page.setDefaultTimeout(options.timeoutMs);
    await page.setViewportSize({ width: 1440, height: 1000 });
    summary.cdpPage = sanitizeJson({
      url: page.url(),
      title: await page.title().catch(() => ""),
    });

    logStage("wait-renderer");
    summary.rendererSnapshot = sanitizeJson(
      await waitForRendererReady(page, options),
    );

    logStage("clear-trace");
    await clearInvokeBuffers(page);

    logStage("initialize");
    summary.initialize = sanitizeJson(
      await initializeAppServer(page, requestLog),
    );

    logStage("workspace-default-ensure");
    const workspaceEnsure = await invokeAppServerFromPage(
      page,
      "workspace/default/ensure",
      {},
      requestLog,
    );
    const workspace = workspaceEnsure.result?.workspace;
    const workspaceId = String(workspace?.id || "").trim();
    const rootPath = String(workspace?.rootPath || workspace?.root_path || "");
    assert(workspaceId, "workspace/default/ensure 未返回 workspace.id");
    assert(rootPath, "workspace/default/ensure 未返回 rootPath");
    summary.workspace = sanitizeJson({
      workspaceId,
      rootPath,
    });
    summary.guiWorkspaceBinding = sanitizeJson(
      await bindGuiWorkspaceAndModelPreferences(page, workspaceId, {
        provider: FIXTURE_PROVIDER,
        model: FIXTURE_MODEL,
      }),
    );
    summary.guiWorkspaceNavigation = sanitizeJson(
      await navigateGuiToWorkspaceScopedAgent(page, options, workspaceId),
    );

    logStage("thread-start-read-list-resume");
    const identity = await startProbeThread(
      page,
      { workspaceId, rootPath },
      requestLog,
    );
    summary.sessionId = identity.sessionId;
    summary.threadId = identity.threadId;
    summary.threadCreation = sanitizeJson(identity.response);
    await page.evaluate(
      ({ sessionId, workspaceId }) => {
        window.dispatchEvent(
          new CustomEvent("lime:agent-runtime-sessions-changed", {
            detail: {
              reason: "external",
              sessionId,
              workspaceId,
            },
          }),
        );
      },
      { sessionId: identity.sessionId, workspaceId },
    );
    summary.guiSessionVisible = sanitizeJson(
      await waitForGuiSessionVisible(page, options, SESSION_TITLE),
    );
    summary.productListTrace = await waitForProductTraceMethods(page, options, [
      APP_SERVER_METHOD_THREAD_LIST,
    ]);
    const read = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_THREAD_READ,
      {
        threadId: identity.threadId,
        includeTurns: true,
      },
      requestLog,
    );
    summary.threadRead = summarizeThreadRead(read.result);
    const list = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_THREAD_LIST,
      {
        archived: false,
        limit: 20,
      },
      requestLog,
    );
    summary.threadList = summarizeThreadList(list.result, identity);
    summary.guiSessionOpened = sanitizeJson(
      await openSessionFromSidebar(page, options, requestLog, {
        sessionId: identity.sessionId,
        threadId: identity.threadId,
        title: SESSION_TITLE,
      }),
    );
    summary.productReadTrace = await waitForProductTraceMethods(page, options, [
      APP_SERVER_METHOD_THREAD_LIST,
      APP_SERVER_METHOD_THREAD_READ,
    ]);
    const resume = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_THREAD_RESUME,
      {
        threadId: identity.threadId,
        excludeTurns: true,
        initialTurnsPage: {
          limit: 20,
          sortDirection: "desc",
          itemsView: "summary",
        },
      },
      requestLog,
    );
    summary.threadResume = summarizeThreadResume(resume);

    logStage("collect-trace");
    const traceMessages = await readRendererTrace(page);
    summary.traceSummary = summarizeTraceMessages(traceMessages);
    summary.directIpcSetupMethods = requestLog
      .map((entry) => entry.method)
      .filter(Boolean);
    writeJsonFile(tracePath, summary.traceSummary);

    logStage("screenshot");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.screenshot = screenshotPath;

    const methods = new Set(summary.traceSummary.methods ?? []);
    const directMethods = new Set(summary.directIpcSetupMethods ?? []);
    summary.assertions = {
      electronPreloadBridge: summary.rendererSnapshot?.electron === true,
      hasInvokeBridge: summary.rendererSnapshot?.hasInvokeBridge === true,
      supportsAppServer: summary.rendererSnapshot?.supportsAppServer === true,
      cdpConnected:
        typeof summary.cdpEndpoint?.version?.browser === "string" ||
        typeof summary.cdpEndpoint?.version?.userAgent === "string",
      appServerHandleJsonLinesSeen:
        (summary.traceSummary?.appServerEntryCount ?? 0) > 0,
      electronIpcSuccess:
        (summary.traceSummary?.electronIpcSuccessCount ?? 0) > 0,
      initializeSeen:
        directMethods.has(APP_SERVER_METHOD_INITIALIZE) ||
        methods.has(APP_SERVER_METHOD_INITIALIZE),
      initializedSeen:
        directMethods.has(APP_SERVER_METHOD_INITIALIZED) ||
        methods.has(APP_SERVER_METHOD_INITIALIZED),
      threadStartSeen: directMethods.has(APP_SERVER_METHOD_THREAD_START),
      threadReadSeen: methods.has(APP_SERVER_METHOD_THREAD_READ),
      threadListSeen: methods.has(APP_SERVER_METHOD_THREAD_LIST),
      threadResumeSeen: directMethods.has(APP_SERVER_METHOD_THREAD_RESUME),
      threadReadMatched:
        summary.threadRead?.sessionId === identity.sessionId &&
        summary.threadRead?.threadId === identity.threadId,
      threadListMatched:
        summary.threadList?.matched?.sessionId === identity.sessionId &&
        summary.threadList?.matched?.threadId === identity.threadId,
      threadResumeMatched:
        summary.threadResume?.sessionId === identity.sessionId &&
        summary.threadResume?.threadId === identity.threadId,
      threadResumeMetadataOnly: summary.threadResume?.threadTurnCount === 0,
      threadResumeInitialPage:
        typeof summary.threadResume?.initialTurnCount === "number",
      threadResumeRoute:
        summary.threadResume?.model === FIXTURE_MODEL &&
        summary.threadResume?.modelProvider === FIXTURE_PROVIDER &&
        summary.threadResume?.cwd === rootPath,
      threadResumeNoLegacyFields:
        summary.threadResume?.hasLegacyFields === false,
      threadResumeDoesNotRestartThread:
        summary.threadResume?.emittedThreadStarted === false,
      noTurnStart:
        !methods.has("turn/start") &&
        !requestLog.some((entry) => entry.method === "turn/start"),
    };
    for (const [name, passed] of Object.entries(summary.assertions)) {
      assert(passed, `CDP Gate B assertion failed: ${name}`);
    }

    summary.requestLog = sanitizeJson(
      requestLog.map((entry) => ({
        method: entry.method,
        response: entry.response ?? null,
        error: entry.error ?? null,
      })),
    );
    summary.ok = true;
    writeJsonFile(summaryPath, summary);
    console.log(`${LOG_PREFIX} summary=${summaryPath}`);
    console.log(`${LOG_PREFIX} trace=${tracePath}`);
    console.log(`${LOG_PREFIX} screenshot=${screenshotPath}`);
  } catch (error) {
    summary.error = sanitizeText(
      error instanceof Error ? error.message : error,
    );
    writeJsonFile(summaryPath, summary);
    console.error(`${LOG_PREFIX} failed summary=${summaryPath}`);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    if (!options.keepTemp) {
      cleanupTempRoot(runtimeEnv.tempRoot);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
