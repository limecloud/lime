#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import { ensureElectronFixtureBuild } from "../lib/electron-fixture-build.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import { createTempRuntimeEnv } from "./claw-chat-current-fixture-backend-file.mjs";
import {
  bindGuiWorkspaceAndModelPreferences,
  ensureDefaultWorkspace,
  initializeAppServer,
  invokeAppServerFromPage,
  waitForRendererReady,
} from "./claw-chat-current-fixture-rpc.mjs";
import {
  createFixtureSession,
  navigateGuiToWorkspaceScopedAgent,
  openFixtureSessionFromSidebar,
  waitForGuiSessionVisible,
} from "./claw-chat-current-fixture-session.mjs";
import { startInvokeTraceEvidenceCollector } from "./claw-chat-current-fixture-invoke-trace.mjs";
import {
  closeElectronFixture,
  openSettings,
  readConfigFromPage,
  writeConfigEditsFromPage,
} from "../electron/mcp-config-fixture-smoke.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  downloadHistoryMatchesDisk,
  downloadHistoryPublicEvidence,
  downloadHistoryTraceEvidence,
} from "./browser-runtime-electron-gate-b-download-history-evidence.mjs";
import { startRestartDownloads } from "./browser-download-restart-http.mjs";
import { setBrowserFixtureLocale } from "./browser-runtime-electron-gate-b-locale.mjs";
import { verifyBrowserDownloadSearch } from "./browser-download-search.mjs";
import { verifyBrowserDownloadFileActions } from "./browser-download-file-actions.mjs";
import {
  assertExpectedDownloadFailures,
  verifyBrowserDownloadFailures,
} from "./browser-download-failures.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const systemFileActions = args.includes("--system-file-actions");
const fileActionFailures = args.includes("--file-action-failures");
assert.ok(
  !(systemFileActions && fileActionFailures),
  "Choose one file action scenario",
);
if ((systemFileActions || fileActionFailures) && process.platform !== "darwin")
  throw new Error("System file action observation currently requires macOS");
const outputIndex = args.indexOf("--output");
if (outputIndex < 0 || !args[outputIndex + 1])
  throw new Error(
    "Usage: browser-download-restart.mjs --output <new-summary.json> [--locale zh-CN] [--system-file-actions | --file-action-failures]",
  );
const output = path.resolve(args[outputIndex + 1]);
const localeIndex = args.indexOf("--locale");
const locale = localeIndex < 0 ? "zh-CN" : args[localeIndex + 1];
assert.ok(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].includes(locale));
const directory = path.dirname(output);
await mkdir(directory, { recursive: true });
const options = { timeoutMs: 90_000, intervalMs: 100, locale };
const evidence = {
  startedAt: new Date().toISOString(),
  result: "running",
  proofLevel: "Real Electron settings UI and native download restart",
  claimBoundary:
    "Production main, Renderer, preload/IPC, App Server config and canonical Thread, two process exits, original-id native resume/cancel. Visibility-only test instrumentation suppresses window show. No Agent turn, physical input, reference pixel parity, live provider or Windows packaged claim.",
  locale,
  phases: [],
  captures: {},
  screenshots: [],
  errors: { console: [], page: [] },
};
if (systemFileActions)
  evidence.claimBoundary =
    "Production main, Renderer, preload/IPC, App Server config and canonical Thread, original-id native resume/cancel, actual shell open/reveal and macOS application observations. Hidden windows and delegating shell observer are test-only instrumentation. No Agent turn, physical input, native screenshot, reference pixel parity, live provider or Windows packaged claim.";
if (fileActionFailures)
  evidence.claimBoundary =
    "Production main, Renderer, preload/IPC, App Server config and canonical Thread, original-id restart/resume/cancel, real OS open failure and moved-file rejection, global error toast, capability refresh and file restoration. Hidden windows and delegating shell observer are test-only. No synthetic native failures, Agent turn, physical input, reference pixel parity, live provider or Windows packaged claim.";
const stage = (name) => {
  evidence.stage = name;
  console.log(`[browser-download-restart] stage=${name}`);
};
const waitFor = async (read, predicate, description) => {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw new Error(description);
};
const runtime = createTempRuntimeEnv();
runtime.writeFixtureConfig({ language: locale });
evidence.tempRoot = runtime.tempRoot;
const downloadsDirectory = path.join(
  runtime.electronUserDataDir,
  "restart-downloads",
);
await mkdir(downloadsDirectory, { recursive: true });
const storeFile = path.join(
  runtime.electronUserDataDir,
  "browser/downloads.json",
);
const fixture = await startRestartDownloads({
  textDocument: systemFileActions || fileActionFailures,
  unregisteredDocument: fileActionFailures,
});
evidence.expectedFiles = fixture.files.map(
  ({ name, filename, content, sha256, etag }) => ({
    name,
    filename,
    bytes: content.length,
    sha256,
    etag,
  }),
);
const model = "fixture-download-restart";
const providerFixture = await startOpenAiCompatibleFixtureServer({
  model,
  apiKey: "controlled-download-restart-key",
  scriptedResponses: [{ type: "text", content: "Unexpected turn" }],
});
const binary = resolveDevAppServerBinary({ env: runtime.env, repoRoot: root });
const serverEnv = resolveElectronAppServerRuntimeEnv({
  env: { ...runtime.env, APP_SERVER_BIN: binary },
});
const labels = JSON.parse(
  await readFile(
    path.join(root, `src/i18n/resources/${locale}/browserDownloads.json`),
    "utf8",
  ),
);
const label = (name, filename = "") =>
  String(labels[`browserDownloads.${name}`]).replaceAll(
    "{{filename}}",
    filename,
  );
let app;
let page;
let traceCollector;
let phase;
const requestLog = [];
const readList = async () =>
  downloadHistoryPublicEvidence(
    await page.evaluate(() =>
      window.electronAPI.invoke("browser_downloads_list", {
        query: "",
        offset: 0,
        limit: 100,
      }),
    ),
    [runtime.electronUserDataDir, downloadsDirectory],
  );
const readNative = () =>
  app.evaluate(({ BrowserWindow }) => ({
    ...globalThis.__browserRestartEvidence,
    windows: BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      visible: window.isVisible(),
    })),
  }));
const capture = async (name) => {
  const filename = `${locale}-${name}.png`;
  await page.screenshot({ path: path.join(directory, filename) });
  evidence.screenshots.push(filename);
};
async function launch(name) {
  phase = { name, startedAt: new Date().toISOString() };
  evidence.phases.push(phase);
  const env = {
    ...runtime.env,
    ...serverEnv,
    APP_SERVER_BACKEND_MODE: "runtime",
    ELECTRON_E2E_USER_DATA_DIR: runtime.electronUserDataDir,
    LIME_ELECTRON_E2E: "1",
    LIME_ELECTRON_BRAND_DEV_APP: "0",
    LIME_ELECTRON_DEV_HTTP_BRIDGE: "0",
    LIME_BROWSER_RESTART_ROOT: root,
    LIME_BROWSER_RESTART_SYSTEM_ACTIONS:
      systemFileActions || fileActionFailures ? "1" : "0",
  };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LIME_ELECTRON_SMOKE;
  delete env.VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath: electronPath,
    args: [
      "--use-mock-keychain",
      fileURLToPath(
        new URL("./browser-download-restart-host.mjs", import.meta.url),
      ),
    ],
    cwd: root,
    env,
    timeout: options.timeoutMs,
  });
  phase.pid = app.process().pid;
  const observedPhase = phase;
  observedPhase.quitEvents = [];
  let quitOutput = "";
  app.process().stderr.on("data", (chunk) => {
    quitOutput += String(chunk);
    const lines = quitOutput.split("\n");
    quitOutput = lines.pop().slice(-2_000);
    for (const line of lines) {
      const prefix = "[browser-restart-quit]";
      if (line.startsWith(prefix))
        observedPhase.quitEvents.push(JSON.parse(line.slice(prefix.length)));
    }
  });
  app.process().once("exit", (exitCode, signal) => {
    observedPhase.processExit = {
      exitCode,
      signal,
      observedAt: new Date().toISOString(),
    };
  });
  app.on("console", (message) => {
    if (message.type() === "error")
      evidence.errors.console.push(message.text().slice(0, 500));
  });
  page = await app.firstWindow({ timeout: options.timeoutMs });
  page.setDefaultTimeout(options.timeoutMs);
  page.on("pageerror", (error) =>
    evidence.errors.page.push(error.message.slice(0, 500)),
  );
  await waitForRendererReady(page, options, () => {});
  await initializeAppServer(page, requestLog);
  if (name === "capture") await setBrowserFixtureLocale(page, options);
  await page.waitForFunction(
    (expected) => document.documentElement.lang === expected,
    locale,
    { timeout: options.timeoutMs },
  );
  const bridge = await page.evaluate(() => ({
    electron: window.__LIME_ELECTRON__ === true,
    invoke: typeof window.electronAPI?.invoke === "function",
    fallback: window.electronAPI?.devBridgeFallback,
    locale: document.documentElement.lang,
  }));
  assert.equal(bridge.electron, true);
  assert.equal(bridge.invoke, true);
  assert.equal(bridge.fallback, false);
  assert.equal(bridge.locale, locale);
  phase.bridge = bridge;
  traceCollector = startInvokeTraceEvidenceCollector(page, options);
}
async function quitNormally() {
  const trace = (await traceCollector.stop()).filter(
    (entry) => entry.timestamp >= phase.startedAt,
  );
  const rpc = parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace));
  phase.trace = downloadHistoryTraceEvidence(trace);
  const expectedErrorCount =
    fileActionFailures && phase.name === "recover"
      ? assertExpectedDownloadFailures(
          trace,
          evidence.captures.failureFeedback?.id,
        )
      : 0;
  phase.bridgeTrace = {
    appServerIpcHits: rpc.filter(
      (request) => request.transport === "electron-ipc",
    ).length,
    appServerMethods: [...new Set(rpc.map((request) => request.method))],
    nonNativeHits: trace.filter((entry) => entry.transport !== "electron-ipc")
      .length,
    errorCount: trace.filter((entry) => entry.status === "error").length,
    expectedErrorCount,
    unexpectedErrorCount:
      trace.filter((entry) => entry.status === "error").length -
      expectedErrorCount,
  };
  assert.ok(phase.bridgeTrace.appServerIpcHits > 0);
  assert.equal(phase.bridgeTrace.nonNativeHits, 0);
  assert.equal(phase.bridgeTrace.unexpectedErrorCount, 0);
  phase.native = await readNative();
  assert.equal(phase.native.unexpectedShowEvents, 0);
  assert.ok(phase.native.windows.every((window) => !window.visible));
  assert.deepEqual(phase.native.preloadErrors, []);
  const child = app.process();
  const exited = new Promise((resolve) =>
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal })),
  );
  await app.evaluate(({ app }) => {
    setImmediate(() => app.quit());
    return true;
  });
  let timer;
  const result = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        phase.quitTimeout = {
          at: new Date().toISOString(),
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          killed: child.killed,
        };
        reject(new Error("Normal application quit did not drain"));
      }, 30_000);
    }),
  ]).finally(() => clearTimeout(timer));
  Object.assign(phase, result, { endedAt: new Date().toISOString() });
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  app = null;
}
async function openDownloads() {
  stage(`${phase.name}-settings-navigation`);
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-browser-use").click();
  stage(`${phase.name}-browser-settings`);
  await page.locator("#browser-download-history button").click();
  await page
    .getByTestId("browser-downloads-page")
    .waitFor({ state: "visible" });
  stage(`${phase.name}-downloads-page`);
}
const row = (id) =>
  page
    .getByTestId("browser-downloads-page")
    .locator(`li[data-download-id="${id}"]`);
const action = (entry, name) =>
  row(entry.id).getByRole("button", {
    name: label(name, entry.filename),
    exact: true,
  });
const waitState = async (id, predicate) => {
  const list = await waitFor(
    readList,
    (value) =>
      value.entries.some((entry) => entry.id === id && predicate(entry)),
    `Download ${id} did not reach its expected native state`,
  );
  return list.entries.find((entry) => entry.id === id);
};
const fileHash = async (file) => {
  const bytes = await readFile(path.join(downloadsDirectory, file.filename));
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
try {
  ensureElectronFixtureBuild({
    rootDir: root,
    logPrefix: "[browser-download-restart]",
  });
  stage("capture-launch-and-configure");
  await launch("capture");
  const current = await readConfigFromPage(page);
  const write = await writeConfigEditsFromPage(page, {
    expectedVersion: current.version,
    edits: [
      {
        keyPath: "browser.download_directory",
        value: downloadsDirectory,
        mergeStrategy: "replace",
      },
      {
        keyPath: "browser.ask_download_location",
        value: false,
        mergeStrategy: "replace",
      },
    ],
  });
  const config = await readConfigFromPage(page);
  assert.equal(config.config.browser.download_directory, downloadsDirectory);
  assert.equal(config.config.browser.ask_download_location, false);
  evidence.captures.config = {
    realRead: isObservedPreloadAppServerResponse(
      config.response.ipcObservation,
      "config/read",
    ),
    realWrite: isObservedPreloadAppServerResponse(
      write.ipcObservation,
      "config/batchWrite",
    ),
  };
  assert.ok(
    evidence.captures.config.realRead && evidence.captures.config.realWrite,
  );
  const workspace = await ensureDefaultWorkspace(page, requestLog);
  const provider = await invokeAppServerFromPage(
    page,
    "modelProvider/create",
    {
      name: "Download restart fixture",
      providerType: "openai",
      apiHost: `${providerFixture.baseUrl}/v1`,
    },
    requestLog,
  );
  const providerId = provider.result.provider.id;
  await invokeAppServerFromPage(
    page,
    "modelProvider/update",
    { providerId, enabled: true, sortOrder: 0, models: [] },
    requestLog,
  );
  await invokeAppServerFromPage(
    page,
    "modelProviderKey/create",
    {
      providerId,
      apiKey: "controlled-download-restart-key",
      alias: "download-restart",
      replaceExisting: true,
    },
    requestLog,
  );
  await invokeAppServerFromPage(
    page,
    "modelProvider/fetchModels",
    { providerId },
    requestLog,
  );
  await bindGuiWorkspaceAndModelPreferences(page, workspace.workspaceId, {
    provider: providerId,
    model,
  });
  const created = await createFixtureSession(page, workspace, requestLog, {
    provider: providerId,
    model,
  });
  const identity = created.identity;
  const sessionOptions = { ...options, ...identity };
  evidence.identity = { ...identity, workspaceId: workspace.workspaceId };
  await navigateGuiToWorkspaceScopedAgent(
    page,
    sessionOptions,
    workspace.workspaceId,
  );
  await waitForGuiSessionVisible(page, sessionOptions);
  await openFixtureSessionFromSidebar(page, sessionOptions, requestLog);
  await invokeAppServerFromPage(
    page,
    "workspaceRightSurface/request",
    {
      workspaceId: workspace.workspaceId,
      workspaceRoot: workspace.rootPath,
      sessionId: identity.sessionId,
      surfaceKind: "browser",
      origin: "runtime",
      priority: "foreground",
      reason: "download_restart_fixture",
      candidateId: "download-restart",
      ttlMs: 120_000,
      metadata: {
        browser: {
          launchUrl: fixture.ownerUrl,
          title: "Download restart fixture",
        },
      },
    },
    requestLog,
  );
  const native = await waitFor(
    () =>
      page.getByTestId("browser-workspace").evaluate((node) => ({
        threadId: node.dataset.browserThreadId,
        tabId: node.dataset.browserTabId,
        webContentsId: Number(node.dataset.browserWebContentsId),
      })),
    (value) => value.threadId === identity.threadId && value.webContentsId > 0,
    "Canonical Browser WCV did not mount",
  );
  evidence.captures.browser = native;
  await app.evaluate(
    async ({ session, webContents }, { id, url, files }) => {
      const target = webContents.fromId(id);
      if (!target) throw new Error("Browser download source disappeared");
      if (
        (await target.executeJavaScript("typeof window.electronAPI")) !==
        "undefined"
      )
        throw new Error("Website acquired the general bridge");
      const profile = session.fromPartition("persist:embedded-browser");
      await profile.cookies.set({
        url,
        name: "restart-download",
        value: "controlled-fixture",
        expirationDate: Math.floor(Date.now() / 1000) + 86400,
      });
      await profile.cookies.flushStore();
      for (const file of files) target.downloadURL(file.url);
    },
    {
      id: native.webContentsId,
      url: fixture.ownerUrl,
      files: fixture.files.map(({ url }) => ({ url })),
    },
  );
  const active = await waitFor(
    readList,
    (value) =>
      value.total === 2 &&
      value.entries.every(
        (entry) =>
          entry.state === "progressing" &&
          entry.receivedBytes > 128 * 1024 &&
          entry.receivedBytes < entry.totalBytes,
      ),
    "Two real downloads did not progress",
  );
  evidence.captures.beforeQuit = active;
  stage("capture-downloads-ui-and-normal-quit");
  await openDownloads();
  for (const entry of active.entries)
    await action(entry, "pause").waitFor({ state: "visible" });
  await capture("before-quit");
  await quitNormally();
  const saved = JSON.parse(await readFile(storeFile, "utf8"));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.entries.length, 2);
  assert.ok(saved.entries.every((entry) => entry.resume && !entry.finished));
  assert.equal(
    (
      await readdir(path.join(runtime.electronUserDataDir, "browser/partials"))
    ).filter((file) => file.endsWith(".part")).length,
    2,
  );
  evidence.captures.quitStore = saved.entries.map(
    ({ id, state, receivedBytes, totalBytes }) => ({
      id,
      state,
      receivedBytes,
      totalBytes,
    }),
  );
  stage("recover-launch-and-open-settings");
  await launch("recover");
  const threadRead = await invokeAppServerFromPage(
    page,
    "thread/read",
    { threadId: identity.threadId, includeTurns: true },
    requestLog,
  );
  assert.equal(threadRead.result.thread.id, identity.threadId);
  assert.equal(threadRead.result.thread.sessionId, identity.sessionId);
  assert.ok(Array.isArray(threadRead.result.thread.turns));
  assert.equal(threadRead.result.thread.turns.length, 0);
  evidence.captures.canonicalThreadRestored = true;
  evidence.captures.canonicalTurnCount = threadRead.result.thread.turns.length;
  const recoveredConfig = await readConfigFromPage(page);
  assert.equal(
    recoveredConfig.config.browser.download_directory,
    downloadsDirectory,
  );
  await openDownloads();
  const cold = await waitFor(
    readList,
    (value) =>
      value.total === 2 &&
      value.entries.every(
        (entry) =>
          entry.state === "interrupted" && entry.canResume && entry.canCancel,
      ),
    "Downloads settings did not expose cold recovery capabilities",
  );
  assert.deepEqual(
    cold.entries.map((entry) => entry.id).sort(),
    active.entries.map((entry) => entry.id).sort(),
  );
  evidence.captures.cold = cold;
  for (const entry of cold.entries) {
    await action(entry, "resume").waitFor({ state: "visible" });
    await action(entry, "cancel").waitFor({ state: "visible" });
    assert.equal(
      await row(entry.id).getAttribute("data-download-state"),
      "interrupted",
    );
  }
  const clear = () =>
    page
      .getByTestId("browser-downloads-page")
      .getByRole("button", { name: label("clear"), exact: true });
  assert.equal(await clear().isDisabled(), true);
  await capture("cold-recovery");
  evidence.captures.searchKeyboard = await verifyBrowserDownloadSearch({
    page,
    entries: cold.entries,
    label,
    waitFor,
    capture,
  });
  const resumeFile = fixture.files.find((file) => file.name === "resume");
  const cancelFile = fixture.files.find((file) => file.name === "cancel");
  const resumeEntry = cold.entries.find(
    (entry) => entry.filename === resumeFile.filename,
  );
  const cancelEntry = cold.entries.find(
    (entry) => entry.filename === cancelFile.filename,
  );
  stage("resume-original-id-through-ui");
  await action(resumeEntry, "resume").click();
  const progressing = await waitState(
    resumeEntry.id,
    (entry) => entry.state === "progressing" && entry.canPause,
  );
  evidence.captures.resumed = progressing;
  await action(progressing, "pause").waitFor({ state: "visible" });
  await capture("resuming");
  const completed = await waitState(
    resumeEntry.id,
    (entry) => entry.state === "completed" && entry.fileExists,
  );
  evidence.captures.completed = completed;
  await action(completed, "reveal").waitFor({ state: "visible" });
  assert.equal(await action(completed, "open").isEnabled(), true);
  const completedHash = await fileHash(resumeFile);
  assert.equal(completedHash.bytes, resumeFile.content.length);
  assert.equal(completedHash.sha256, resumeFile.sha256);
  evidence.captures.file = completedHash;
  await capture("completed");
  if (systemFileActions) {
    stage("completed-file-system-actions-through-ui");
    evidence.captures.systemFileActions =
      await verifyBrowserDownloadFileActions({
        app,
        entry: completed,
        file: resumeFile,
        downloadPath: path.join(downloadsDirectory, resumeFile.filename),
        action,
        waitFor,
        capture,
      });
    assert.equal((await fileHash(resumeFile)).sha256, completedHash.sha256);
  }
  if (fileActionFailures) {
    stage("failed-file-actions-through-ui");
    evidence.captures.failureFeedback = await verifyBrowserDownloadFailures({
      app,
      page,
      entry: completed,
      file: resumeFile,
      downloadPath: path.join(downloadsDirectory, resumeFile.filename),
      action,
      label,
      waitFor,
      capture,
      readList,
    });
    assert.equal((await fileHash(resumeFile)).sha256, completedHash.sha256);
  }
  stage("clear-completed-preserve-recoverable");
  await clear().click();
  evidence.captures.afterClearCompleted = await waitFor(
    readList,
    (value) =>
      value.total === 1 &&
      value.entries[0].id === cancelEntry.id &&
      value.entries[0].canResume,
    "Clear removed the cold recoverable record",
  );
  await row(resumeEntry.id).waitFor({ state: "detached" });
  assert.equal((await fileHash(resumeFile)).sha256, completedHash.sha256);
  stage("cancel-cold-record-through-ui");
  await action(cancelEntry, "cancel").click();
  const cancelled = await waitState(
    cancelEntry.id,
    (entry) =>
      entry.state === "cancelled" && !entry.canResume && !entry.canCancel,
  );
  evidence.captures.cancelled = cancelled;
  await action(cancelled, "remove").waitFor({ state: "visible" });
  await capture("cold-cancelled");
  await clear().click();
  evidence.captures.afterClearCancelled = await waitFor(
    readList,
    (value) => value.total === 0,
    "Cancelled download could not be cleared",
  );
  await row(cancelEntry.id).waitFor({ state: "detached" });
  assert.equal((await fileHash(resumeFile)).sha256, completedHash.sha256);
  assert.deepEqual(
    await readdir(path.join(runtime.electronUserDataDir, "browser/partials")),
    [],
  );
  assert.ok(
    downloadHistoryMatchesDisk(
      await readList(),
      JSON.parse(await readFile(storeFile, "utf8")),
    ),
  );
  const nativeRecovered = await readNative();
  assert.equal(nativeRecovered.downloads.length, 1);
  assert.equal(nativeRecovered.downloads[0].webContentsId, null);
  assert.equal(nativeRecovered.downloads[0].done, "completed");
  const rangeRequests = fixture.requests.filter(
    (request) => request.name === "resume" && request.range,
  );
  assert.equal(rangeRequests.length, 1);
  assert.equal(
    rangeRequests[0].range,
    `bytes=${nativeRecovered.downloads[0].offset}-`,
  );
  assert.equal(rangeRequests[0].ifRange, resumeFile.etag);
  assert.equal(rangeRequests[0].cookiePresent, true);
  assert.equal(
    fixture.requests.filter((request) => request.name === "cancel").length,
    1,
  );
  await capture("cleared");
  evidence.finalPage = {
    url: page.url(),
    route: "settings/browser/downloads",
    empty: true,
  };
  await quitNormally();
  const uiTrace = evidence.phases[1].trace;
  for (const [id, name] of [
    [resumeEntry.id, "resume"],
    [cancelEntry.id, "cancel"],
  ])
    assert.ok(
      uiTrace.some(
        (entry) =>
          entry.command === "browser_downloads_action" &&
          entry.transport === "electron-ipc" &&
          entry.status === "success" &&
          entry.id === id &&
          entry.action === name,
      ),
    );
  assert.equal(evidence.errors.console.length, 0);
  assert.equal(evidence.errors.page.length, 0);
  evidence.result = "pass";
} catch (error) {
  evidence.result = "fail";
  evidence.error = String(error.stack ?? error);
  if (app) {
    evidence.failureUrl = await page?.url();
    await capture("failure").catch(() => {});
    evidence.failureNative = await readNative().catch(() => null);
    await traceCollector?.stop().catch(() => {});
    await closeElectronFixture({ app }).catch(() => {});
    app = null;
  }
  process.exitCode = 1;
} finally {
  evidence.requests = fixture.requests;
  evidence.providerRequests = providerFixture.requests.map(
    ({ method, path, body }) => ({
      method,
      path,
      model: body?.model ?? null,
      messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
    }),
  );
  evidence.appServerMethods = [
    ...new Set(requestLog.map((request) => request.method)),
  ];
  await fixture.close();
  await providerFixture.close();
  evidence.completedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    `[browser-download-restart] result=${evidence.result} output=${output}`,
  );
}
