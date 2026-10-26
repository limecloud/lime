import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTempRuntimeEnv,
  launchElectronFixture,
} from "../mcp-config-fixture-smoke.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../../lib/electron-dev-sidecar.mjs";
import { inspectElectronFixtureBuildFreshness } from "../../lib/electron-fixture-build.mjs";
import {
  DEFAULT_FIXTURE_API_KEY,
  startOpenAiCompatibleFixtureServer,
} from "../../lib/openai-compatible-fixture-server.mjs";
import {
  bindGuiWorkspaceAndModelPreferences,
  clearInvokeBuffers,
  ensureDefaultWorkspace,
  ensureFixtureTextProvider,
  initializeAppServer,
  invokeAppServerFromPage,
  waitForRendererReady,
} from "../../lib/chat-fixture/rpc.mjs";
import { settleFixtureResources } from "../../lib/chat-fixture/teardown.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import {
  BACKGROUND_FINAL,
  backgroundResponses,
  verifyBackgroundTerminals,
} from "./background-terminal-scenario.mjs";

const MODEL = "fixture-summary-processes";

export async function runBackgroundTerminalGateB({
  output,
  timeoutMs = 60_000,
  intervalMs = 250,
}) {
  const options = { timeoutMs, intervalMs };
  const evidence = {
    status: "running",
    backendMode: "runtime",
    providerMode: "localhost-scripted-http",
    startedAt: new Date().toISOString(),
    screenshots: [],
  };
  const requestLog = [];
  const errors = { console: [], page: [] };
  const runtimeEnv = createTempRuntimeEnv();
  let handle, fixture, mainExit;
  const write = () =>
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  assert.equal(fs.existsSync(output), false, "Never overwrite prior evidence");
  write();
  try {
    evidence.freshness = inspectElectronFixtureBuildFreshness({
      rootDir: process.cwd(),
    });
    assert.equal(evidence.freshness.ready, true);
    fixture = await startOpenAiCompatibleFixtureServer({
      model: MODEL,
      scriptedResponses: backgroundResponses(),
    });
    const binary = resolveDevAppServerBinary({
      env: runtimeEnv.env,
      repoRoot: process.cwd(),
    });
    const appServerEnv = resolveElectronAppServerRuntimeEnv({
      env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
    });
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors: errors.console,
      pageErrors: errors.page,
      backendMode: "runtime",
    });
    mainExit = captureMainProcessExit(handle.app.process());
    const { page } = handle;
    evidence.rendererSnapshot = handle.rendererSnapshot;
    const rpc = (method, params) =>
      invokeAppServerFromPage(page, method, params, requestLog).then(
        (r) => r.result,
      );
    await initializeAppServer(page, requestLog);
    const workspace = await ensureDefaultWorkspace(page, requestLog);
    const provider = await ensureFixtureTextProvider(page, requestLog, {
      modelId: MODEL,
      apiHost: fixture.baseUrl + "/v1",
      apiKey: DEFAULT_FIXTURE_API_KEY,
    });
    assert.equal(provider.modelFetch.hasFixtureModel, true);
    const { thread } = await rpc("thread/start", {
      cwd: workspace.rootPath,
      historyMode: "paginated",
      model: MODEL,
      modelProvider: provider.providerId,
      runtimeWorkspaceRoots: [workspace.rootPath],
      serviceName: "Summary Processes Gate B",
      threadSource: "appServer",
    });
    const identity = { threadId: thread.id, sessionId: thread.sessionId };
    evidence.identity = identity;
    await bindGuiWorkspaceAndModelPreferences(page, workspace.workspaceId, {
      sessionId: identity.sessionId,
      provider: provider.providerId,
      model: MODEL,
    });
    await page.evaluate((sessionId) => {
      sessionStorage.setItem(
        "lime.appNavigation.restore.v1",
        JSON.stringify({
          page: "agent",
          params: { initialSessionId: sessionId },
        }),
      );
    }, identity.sessionId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRendererReady(page, options);
    const input = page.locator(
      `[data-testid="composer-editor"][data-session-id="${identity.sessionId}"]`,
    );
    await input.waitFor({ state: "visible" });
    await clearInvokeBuffers(page);
    await input.fill(
      "Start two local background commands and leave them running.",
    );
    await input
      .locator('xpath=ancestor::*[@data-testid="inputbar-core-container"]')
      .getByTestId("send-btn")
      .click();
    evidence.scenario = await verifyBackgroundTerminals({
      page,
      identity,
      requestLog,
      options,
      record: (snapshot) => {
        (evidence.runtimeSnapshots ??= []).push(snapshot);
        write();
      },
      capture: async (stage) => {
        const file = path.join(
          path.dirname(output),
          path.basename(output, ".json") + "-" + stage + ".png",
        );
        await page.screenshot({ path: file });
        evidence.screenshots.push(file);
        write();
      },
    });
    evidence.diagnostics = await page.evaluate(() => ({
      traces: JSON.parse(
        localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
      ),
      errors: JSON.parse(
        localStorage.getItem("lime_invoke_error_buffer_v1") || "[]",
      ),
    }));
    const traces = evidence.diagnostics.traces;
    const calls = traces
      .filter((entry) => entry.command === "app_server_handle_json_lines")
      .flatMap((entry) =>
        (entry.args_preview?.request?.lines ?? []).map((line) => ({
          ...JSON.parse(line),
          transport: entry.transport,
          status: entry.status,
        })),
      );
    evidence.assertions = {
      realElectronPreload:
        handle.rendererSnapshot.electron &&
        handle.rendererSnapshot.hasInvokeBridge &&
        handle.rendererSnapshot.supportsAppServer,
      guiTurnUsesCurrentBridge: calls.some(
        (call) =>
          call.method === "turn/start" &&
          call.transport === "electron-ipc" &&
          call.status === "success",
      ),
      guiStopAllUsesCurrentBridge: calls.some(
        (call) =>
          call.method === "thread/backgroundTerminals/clean" &&
          call.params.threadId === identity.threadId &&
          call.transport === "electron-ipc" &&
          call.status === "success",
      ),
      noStandaloneProcessOrStdin: !calls.some((call) =>
        call.method.startsWith("command/exec"),
      ),
      productionMockFallbackZero: !traces.some(
        (entry) =>
          entry.mock ||
          entry.mockFallback ||
          /mock/i.test(
            [entry.transport, entry.source, entry.fallback].join(" "),
          ),
      ),
      invokeErrorsZero: evidence.diagnostics.errors.length === 0,
      rendererErrorsZero:
        errors.console.length === 0 && errors.page.length === 0,
      providerToolLoop:
        fixture.requests.length >= 3 &&
        !fixture.requests.some((request) => request.responseError),
      finalAssistantVisible: await page
        .getByText(BACKGROUND_FINAL, { exact: false })
        .first()
        .isVisible(),
    };
    assert.ok(
      Object.values(evidence.assertions).every(Boolean),
      JSON.stringify(evidence.assertions),
    );
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error.stack || String(error);
    await handle?.page
      .screenshot({ path: output + ".failed.png" })
      .catch(() => undefined);
    throw error;
  } finally {
    evidence.errors = errors;
    evidence.requestLog = requestLog;
    evidence.providerRequests = fixture?.requests.map(
      ({ authorization: _authorization, ...request }) => request,
    );
    evidence.teardown = await settleFixtureResources({
      app: handle?.app,
      mainExit,
      textProviderFixtureServer: fixture,
    });
    if (!evidence.teardown.ok) evidence.status = "failed";
    evidence.completedAt = new Date().toISOString();
    write();
  }
  assert.equal(evidence.status, "passed");
  return evidence;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const output = process.argv[2];
  assert.ok(output, "Provide an absolute, unused evidence JSON path");
  assert.ok(path.isAbsolute(output));
  runBackgroundTerminalGateB({ output }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
