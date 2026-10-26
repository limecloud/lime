import { writeFixtureBackend } from "../lib/chat-fixture/backend-script.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "../lib/electron-fixture-build.mjs";
import {
  manifest,
  hash,
  sourcePaths as previewSourcePaths,
} from "./lib/document-preview-provenance.mjs";
import { launchElectronFixture } from "./mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import {
  createTempRuntimeEnv,
  startTextProviderFixtureServer,
} from "../lib/chat-fixture/backend-file.mjs";
import {
  initializeAppServer,
  ensureDefaultWorkspace,
  ensureFixtureTextProvider,
  bindGuiWorkspaceAndModelPreferences,
  reloadRendererDocument,
  invokeAppServerFromPage,
  collectTraceRequestMethods,
} from "../lib/chat-fixture/rpc.mjs";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import {
  GREETING_PROMPT,
  GREETING_DONE_TEXT,
  GREETING_SUMMARY_TEXT,
} from "../lib/chat-fixture/constants.mjs";
import { waitForSessionReadCompleted } from "../lib/chat-fixture/read-model-waits.mjs";
import { settleFixtureResources } from "../lib/chat-fixture/teardown.mjs";
import {
  readJsonl,
  sanitizeText,
} from "../lib/chat-fixture/utils.mjs";
import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../lib/electron-app-server-assets.mjs";
import {
  installInvokeTraceCollector,
  captureInvokeTraceCollector,
  stopInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../lib/invoke-trace-collector.mjs";
import { writePdfPreviewFixture } from "./lib/pdf-preview-scenario.mjs";
import { observePreviewConsoleError } from "./lib/document-preview-diagnostics.mjs";

const runId = process.argv[2];
assert.match(runId ?? "", /^[a-z0-9-]+$/, "unique run id required");
ensureElectronFixtureBuild({ rootDir: process.cwd(), logPrefix: "file-click" });
const filename = "Preview-report.pdf";
const sourcePaths = [
  ...previewSourcePaths,
  "src/components/agent/chat/workspace/useWorkspaceFileOpen.ts",
  "src/components/agent/chat/workspace/useWorkspaceArtifactActionRuntime.ts",
  "src/components/agent/chat/components/ToolCallDisplay.tsx",
  "src/components/agent/chat/components/ToolCallDisplayResultPanel.tsx",
  "scripts/electron/file-click-fixture-smoke.mjs",
  "src/lib/api/session-files.ts",
  "src/components/agent/chat/components/InlineToolProcessStep.tsx",
  ...["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].flatMap((locale) => [
    "src/i18n/resources/" + locale + "/agent.json",
    "src/i18n/resources/" + locale + "/agentMessageList.json",
  ]),
];
const evidenceDir = path.resolve(".lime/qc/file-clicks", runId);
assert.equal(
  fs.existsSync(evidenceDir),
  false,
  "never overwrite previous evidence",
);
fs.mkdirSync(evidenceDir, { recursive: true });
const options = { timeoutMs: 120_000, intervalMs: 250 };
const runtimeEnv = createTempRuntimeEnv();
const clickedNames = [
  "reports/original.md",
  "reports/empty.md",
  "Preview-report.pdf",
  "stored-note.md",
  "reports/stored-note.md",
];
writeFixtureBackend(runtimeEnv.backendPath, {
  toolCalls: clickedNames.map((name, index) => ({
    name: "read_file", arguments: { file_path: name },
    output: { text: index === 1 || index === 2 ? "" : "STALE_CACHE_COPY" },
  })),
});
const summary = {
  runId,
  ok: false,
  scope:
    "Real file click -> Files through Electron/preload/IPC/current JSON-RPC and canonical Tool items. External backend bypasses production runtime/provider execution. No live/Windows/packaged claim.",
  consoleErrors: [],
  consoleErrorDetails: [],
  pageErrors: [],
  mainLifecycle: [],
  sourcesBefore: manifest(sourcePaths),
};
let handle, provider, mainExit, collector, failure;
const consoleObservations = [];
const fresh = () => {
  const value = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  assert.equal(value.ready, true, `current build freshness: ${value.reason}`);
  return value;
};
const stage = (name) => {
  summary.stage = name;
  console.log(`[document-preview] ${name}`);
};
try {
  stage("freshness");
  summary.freshnessBefore = fresh();
  summary.artifactsBefore = manifest([
    "dist",
    "dist-electron",
    "packages/app-server-client/dist",
  ]);
  const packagedBinary = electronAppServerBinaryDestination();
  const binary = runtimeEnv.env.APP_SERVER_BIN?.trim() || packagedBinary;
  assert.equal(
    hash(binary),
    hash(packagedBinary),
    "fixture App Server must match the fresh packaged sidecar",
  );
  summary.sidecarBefore = { path: binary, sha256: hash(binary) };
  provider = await startTextProviderFixtureServer();
  stage("launch");
  handle = await launchElectronFixture({
    options,
    runtimeEnv,
    consoleErrors: summary.consoleErrors,
    pageErrors: summary.pageErrors,
    backendMode: "external",
    appServerEnv: {
      ...resolveElectronAppServerRuntimeEnv({
        env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
      }),
      APP_SERVER_BACKEND_COMMAND: process.execPath,
      APP_SERVER_BACKEND_ARGS: JSON.stringify([
        runtimeEnv.backendPath,
        runtimeEnv.backendLedgerPath,
        runtimeEnv.cancelSignalPath,
      ]),
      APP_SERVER_BACKEND_TIMEOUT_MS: "10000",
      LIME_ALLOW_LIVE_PROVIDER_SMOKE: "0",
      LIME_REAL_API_TEST: "0",
    },
  });
  mainExit = captureMainProcessExit(handle.app.process());
  summary.renderer = handle.rendererSnapshot;
  assert.equal(summary.renderer.electron, true);
  assert.equal(summary.renderer.hasInvokeBridge, true);
  assert.equal(summary.renderer.supportsAppServer, true);
  const lifecyclePrefix = "[document-preview-main] ";
  let lifecycleBuffer = "";
  handle.app.process().stdout?.on("data", (chunk) => {
    lifecycleBuffer += chunk.toString();
    const lines = lifecycleBuffer.split("\n");
    lifecycleBuffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith(lifecyclePrefix))
        summary.mainLifecycle.push(
          JSON.parse(line.slice(lifecyclePrefix.length)),
        );
    }
  });
  handle.app.process().stderr?.on("data", (chunk) => {
    if (chunk.toString().includes("Waiting for the debugger to disconnect"))
      summary.mainLifecycle.push({
        event: "waiting-for-debugger-disconnect",
        at: new Date().toISOString(),
      });
  });
  handle.app.on("close", () =>
    summary.mainLifecycle.push({
      event: "playwright-app-closed",
      at: new Date().toISOString(),
    }),
  );
  await handle.app.evaluate(({ app, BrowserWindow }, prefix) => {
    for (const event of ["before-quit", "will-quit", "quit"])
      app.on(event, () => {
        process.stdout.write(
          prefix +
            JSON.stringify({
              event,
              at: new Date().toISOString(),
              windows: BrowserWindow.getAllWindows().length,
              activeResources: process.getActiveResourcesInfo(),
            }) +
            "\n",
        );
      });
  }, lifecyclePrefix);
  handle.app.on("console", (message) => {
    if (message.type() === "error")
      summary.consoleErrorDetails.push({
        stage: summary.stage,
        source: "main",
        location: message.location(),
        text: sanitizeText(message.text()),
      });
  });
  const { page } = handle;
  page.on("console", (message) => {
    if (message.type() === "error") {
      summary.consoleErrors.push(sanitizeText(message.text()));
      observePreviewConsoleError(
        message,
        summary.stage,
        summary.consoleErrorDetails,
        consoleObservations,
      );
    }
  });
  await initializeAppServer(page);
  const workspace = await ensureDefaultWorkspace(page);
  const preference = await ensureFixtureTextProvider(page, undefined, {
    apiHost: provider.baseUrl,
  });
  await bindGuiWorkspaceAndModelPreferences(page, workspace.workspaceId, {
    provider: preference.providerId,
    model: preference.modelId,
  });
  const filePath = path.join(workspace.rootPath, filename);
  writePdfPreviewFixture(filePath, 2);
  fs.mkdirSync(path.join(workspace.rootPath, "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace.rootPath, "reports/original.md"),
    "# DISK_ORIGINAL\n",
  );
  fs.writeFileSync(path.join(workspace.rootPath, "reports/empty.md"), "");
  fs.writeFileSync(
    path.join(workspace.rootPath, "stored-note.md"),
    "# WRONG_PROJECT_FILE\n",
  );
  fs.writeFileSync(
    path.join(workspace.rootPath, "reports/stored-note.md"),
    "# DIRECTORY_ORIGINAL\n",
  );
  await reloadRendererDocument(page, options);
  collector = await installInvokeTraceCollector(page);
  await page.getByTestId("app-sidebar-home-button").click();
  await page
    .getByTestId("home-composer-page")
    .getByTestId("composer-utility-project-trigger")
    .click();
  await page
    .locator(
      `[data-testid="composer-utility-opened-project"][data-project-id="${workspace.workspaceId}"]`,
    )
    .press("Enter");
  await sendPromptFromGui(page, options, GREETING_PROMPT, {
    allowTaskCenterHomeInput: true,
  });
  stage("canonical-thread");
  await page
    .getByText(GREETING_SUMMARY_TEXT, { exact: false })
    .first()
    .waitFor();
  const starts = () =>
    readJsonl(runtimeEnv.backendLedgerPath).filter(
      (entry) => entry.kind === "turnStart",
    );
  assert.equal(starts().length, 1);
  const list = await invokeAppServerFromPage(page, "thread/list", {
    archived: false,
    limit: 100,
  });
  const thread = list.result.data.find(
    (item) => item.sessionId === starts()[0].sessionId,
  );
  assert.ok(thread);
  const completed = await waitForSessionReadCompleted(
    page,
    options,
    undefined,
    {
      threadId: thread.id,
      prompt: GREETING_PROMPT,
      doneText: GREETING_DONE_TEXT,
      summaryText: GREETING_SUMMARY_TEXT,
    },
  );
  summary.identity = {
    threadId: thread.id,
    sessionId: starts()[0].sessionId,
    turns: completed.thread.turns.map((turn) => ({
      id: turn.id,
      items: turn.items.map((item) => item.id),
    })),
  };
  summary.clicks = [];
  const click = async (name) => {
    stage("click:" + name);
    await page
      .getByTestId("conversation-turn-process-segment")
      .first()
      .waitFor();
    const historical = page.locator(
      '[data-testid="message-list-historical-timeline-preview:leading"][aria-expanded="false"]',
    );
    if (await historical.count()) await historical.first().click();
    await page.getByTestId("agent-thread-flow").first().waitFor();
    const item = page.locator(
      '[data-thread-item-id="file-click-' + clickedNames.indexOf(name) + '"]',
    );
    const closed = page.locator(
      '[data-testid="conversation-turn-process-segment"] details[data-details-available="true"]:not([open]) > summary',
    );
    for (const summary of await closed.all()) await summary.click();
    await item.getByRole("button", { name: "打开文件", exact: true }).click();
    await page
      .locator(
        '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
      )
      .waitFor();
  };
  const inspectText = async (name, expectedPath, expectedText) => {
    await click(name);
    const editor = page.locator(
      '[data-testid="text-file-editor"][data-file-path="' + expectedPath + '"]',
    );
    await editor.waitFor();
    const preview = editor.getByTestId("file-preview-markdown");
    await preview.waitFor();
    if (expectedText)
      await preview.getByText(expectedText, { exact: false }).waitFor();
    else assert.equal((await preview.innerText()).trim(), "");

    const content = await editor.innerText();
    assert.equal(content.includes("STALE_CACHE_COPY"), false);
    assert.equal(content.includes("WRONG_PROJECT_FILE"), false);
    const selected = page.locator(
      '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
    );
    const tabId = await selected.getAttribute("id");
    const count = await page
      .getByTestId("workspace-right-surface-tab-files")
      .count();
    await click(name);
    assert.equal(await selected.getAttribute("id"), tabId);
    assert.equal(
      await page.getByTestId("workspace-right-surface-tab-files").count(),
      count,
    );
    const screenshot = path.join(
      evidenceDir,
      "click-" + summary.clicks.length + ".png",
    );
    await page.screenshot({ path: screenshot });
    summary.clicks.push({
      name,
      canonicalItemId: "file-click-" + clickedNames.indexOf(name),
      path: expectedPath,
      expectedText,
      tabId,
      samePathReused: true,
      screenshot,
    });
  };
  await inspectText(
    clickedNames[0],
    path.join(workspace.rootPath, clickedNames[0]),
    "DISK_ORIGINAL",
  );
  await inspectText(
    clickedNames[1],
    path.join(workspace.rootPath, clickedNames[1]),
    "",
  );
  await click(clickedNames[2]);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="pdf-preview-panel"]')
        ?.getAttribute("data-status") === "ready",
  );
  const pdfPage = page.locator(
    '[data-testid="pdf-preview-panel"] [data-pdf-page="1"][data-rendered="true"]',
  );
  await pdfPage.waitFor();
  const pdf = await pdfPage.evaluate((element) => {
    const canvas = element.querySelector("canvas");
    return {
      width: canvas.width,
      height: canvas.height,
      text: element.querySelector(".textLayer")?.textContent,
    };
  });
  assert.ok(
    pdf.width > 0 && pdf.height > 0 && pdf.text.includes("PDF_PREVIEW_01"),
  );
  await page.screenshot({ path: path.join(evidenceDir, "pdf.png") });
  summary.pdf = pdf;
  const sessionId = summary.identity.sessionId;
  await invokeAppServerFromPage(page, "sessionFile/save", {
    sessionId,
    fileName: "stored-note.md",
    content: "# SESSION_ORIGINAL\n",
  });
  const resolved = await invokeAppServerFromPage(
    page,
    "sessionFile/resolvePath",
    { sessionId, fileName: "stored-note.md" },
  );
  const storedPath = resolved.result.path;
  assert.notEqual(storedPath, path.join(workspace.rootPath, "stored-note.md"));
  const firstTrace = validateInvokeTraceCollectorCapture(
    await captureInvokeTraceCollector(page, collector),
    collector,
  );
  assert.equal(firstTrace.complete, true);
  await stopInvokeTraceCollector(page, collector);
  collector = null;
  stage("restore-session-from-sidebar");
  await reloadRendererDocument(page, options);
  collector = await installInvokeTraceCollector(page);
  await page
    .locator(
      '[data-testid="app-sidebar-conversation-open"][data-session-id="' +
        sessionId +
        '"]',
    )
    .click();
  await page
    .locator(
      '[data-testid="composer-editor"][data-session-id="' + sessionId + '"]',
    )
    .waitFor();
  await page.waitForFunction(() =>
    JSON.parse(
      localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
    ).some(
      (entry) =>
        entry.status === "success" &&
        (JSON.stringify(entry.args_preview) ?? "").includes("sessionFile/list"),
    ),
  );
  await inspectText(clickedNames[3], storedPath, "SESSION_ORIGINAL");
  await inspectText(
    clickedNames[4],
    path.join(workspace.rootPath, clickedNames[4]),
    "DIRECTORY_ORIGINAL",
  );
  const after = await invokeAppServerFromPage(page, "thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  assert.deepEqual(
    after.result.thread.turns.map((turn) => ({
      id: turn.id,
      items: turn.items.map((item) => item.id),
    })),
    summary.identity.turns,
  );
  assert.equal(starts().length, 1);
  summary.url = page.url();
  const finalTrace = validateInvokeTraceCollectorCapture(
    await captureInvokeTraceCollector(page, collector),
    collector,
  );
  assert.equal(finalTrace.complete, true);
  const entries = [...firstTrace.ledgerEntries, ...finalTrace.ledgerEntries];
  summary.trace = {
    methods: [...new Set(collectTraceRequestMethods(entries))],
    ipc: entries.filter(
      (entry) =>
        entry.transport === "electron-ipc" &&
        entry.command === "app_server_handle_json_lines",
    ).length,
    errors: entries.filter((entry) => entry.status === "error").length,
    mockHits: entries.filter((entry) => /mock/i.test(entry.transport ?? ""))
      .length,
    provenance: [firstTrace.provenance, finalTrace.provenance],
  };
  for (const method of [
    "thread/start",
    "turn/start",
    "thread/read",
    "sessionFile/resolvePath",
    "fs/readFile",
  ])
    assert.ok(summary.trace.methods.includes(method), method);
  assert.ok(summary.trace.ipc > 0);
  assert.equal(summary.trace.errors, 0);
  assert.equal(summary.trace.mockHits, 0);
  summary.sourcesAfter = manifest(sourcePaths);
  assert.deepEqual(summary.sourcesAfter, summary.sourcesBefore);
  assert.deepEqual(
    manifest(["dist", "dist-electron", "packages/app-server-client/dist"]),
    summary.artifactsBefore,
  );
  assert.deepEqual(
    { path: binary, sha256: hash(binary) },
    summary.sidecarBefore,
  );
  summary.freshnessAfter = fresh();
  assert.deepEqual(summary.consoleErrors, []);
  assert.deepEqual(summary.pageErrors, []);
} catch (error) {
  failure = error;
  summary.error = sanitizeText(error.stack ?? String(error));
  if (handle) {
    summary.failureBody = await handle.page
      .locator("body")
      .innerText()
      .catch(() => null);
    await handle.page
      .screenshot({ path: path.join(evidenceDir, "failure.png") })
      .catch(() => undefined);
  }
} finally {
  await Promise.allSettled(consoleObservations);
  summary.teardown = await settleFixtureResources({
    app: handle?.app,
    mainExit,
    invokeTraceCollector: collector
      ? { stop: () => stopInvokeTraceCollector(handle.page, collector) }
      : undefined,
    textProviderFixtureServer: provider,
  });
  summary.ok = !failure && summary.teardown.ok;
  fs.writeFileSync(
    path.join(evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
}
assert.equal(summary.ok, true, summary.error ?? "fixture teardown failed");
console.log("[file-click] passed: " + evidenceDir);
