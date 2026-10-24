import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  launchElectronFixture,
  openSettings,
  waitForPageCondition,
} from "./mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import {
  createTempRuntimeEnv,
  startTextProviderFixtureServer,
} from "../agent-runtime/claw-chat-current-fixture-backend-file.mjs";
import {
  bindGuiWorkspaceAndModelPreferences,
  ensureDefaultWorkspace,
  ensureFixtureTextProvider,
  initializeAppServer,
  collectTraceRequestMethods,
  invokeAppServerFromPage,
  reloadRendererDocument,
} from "../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import { settleFixtureResources } from "../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import { waitForSessionReadCompleted } from "../agent-runtime/claw-chat-current-fixture-read-model-waits.mjs";
import { sendPromptFromGui } from "../agent-runtime/claw-chat-current-fixture-gui-actions.mjs";
import {
  GREETING_DONE_TEXT,
  GREETING_PROMPT,
  GREETING_SUMMARY_TEXT,
} from "../agent-runtime/claw-chat-current-fixture-constants.mjs";
import {
  readJsonl,
  sanitizeText,
} from "../agent-runtime/claw-chat-current-fixture-utils.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import { runSettingsUnsavedNavigationScenario } from "./lib/settings-unsaved-navigation-scenario.mjs";
import { runSettingsNoteNavigationScenario } from "./lib/settings-note-navigation-scenario.mjs";
import { runSettingsLocalEnvironmentsNavigationScenario } from "./lib/settings-local-environments-navigation-scenario.mjs";
import { runSettingsExecutionPolicyNavigationScenario } from "./lib/settings-execution-policy-navigation-scenario.mjs";
import { runSettingsWebSearchNavigationScenario } from "./lib/settings-web-search-navigation-scenario.mjs";
import { runSettingsProfileNavigationScenario } from "./lib/settings-profile-navigation-scenario.mjs";
import { runSettingsSearchScenario } from "./lib/settings-search-scenario.mjs";
import {
  installInvokeTraceCollector,
  captureInvokeTraceCollector,
  stopInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../lib/invoke-trace-collector.mjs";

import {
  fingerprints,
  artifactFingerprints,
} from "./lib/settings-navigation-fixture-identity.mjs";
import { runBrowserPreferencesScenario } from "./lib/settings-browser-preferences-scenario.mjs";
import { readSettingsNavigationSurface as surface } from "./lib/settings-navigation-surface.mjs";

export async function runSettingsNavigationFixture({ runId, evidenceDir }) {
  assert.match(runId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  fs.mkdirSync(evidenceDir, { recursive: false });
  const options = { timeoutMs: 120_000, intervalMs: 200 };
  const runtimeEnv = createTempRuntimeEnv();
  const summary = {
    runId,
    ok: false,
    proofLevel: "Desktop Gate B",
    backendMode: "external",
    startedAt: new Date().toISOString(),
    sourceSha256: fingerprints(),
    limitations: [
      "Controlled external backend bypasses the production runtime backend and provider execution; only the declared Browser/Keyboard shortcuts save/reload and Memory/Web Search/Environment/Execution Policy/Profile configuration and note scenarios are covered. Profile uses a non-OEM test override. Search covers only the declared 36 content targets/current section titles. No live search/provider/tool execution, auth, Windows, reference runtime or full-settings claim.",
      "Website launch uses the public Electron open-url event; OS URL dispatch is not exercised.",
      "Current Settings replaces the root rail. Draft GUI navigation covers section/back; Home/Root/New guard authority is separate component evidence, not Desktop clicks.",
    ],
    rounds: [],
    navigationObservations: [],
    recoveryPhases: [],
    mainLifecycle: [],
    consoleErrors: [],
    pageErrors: [],
    normalMainExit: null,
  };
  let handle;
  let mainExit;
  let provider;
  let collector;
  let failure;
  let quitObservationTimer;
  let quitSample = Promise.resolve(null);
  const stage = (name) => {
    summary.stage = name;
    console.log(`[settings-navigation] ${name}`);
  };
  const ledger = () =>
    readJsonl(runtimeEnv.backendLedgerPath).filter(
      (entry) => entry.kind === "turnStart",
    );
  const requireFresh = () => {
    const state = inspectElectronFixtureBuildFreshness({
      rootDir: process.cwd(),
    });
    assert.equal(state.ready, true, `current build freshness: ${state.reason}`);
    return { ready: state.ready, reason: state.reason };
  };
  try {
    stage("verify-current-artifacts");
    summary.buildBefore = requireFresh();
    summary.artifactSha256 = artifactFingerprints();
    provider = await startTextProviderFixtureServer();
    const binary = resolveDevAppServerBinary({
      env: runtimeEnv.env,
      repoRoot: process.cwd(),
      forceBuild: false,
    });
    const runtimeExecutable = () => ({
      path: binary,
      sha256: createHash("sha256")
        .update(fs.readFileSync(binary))
        .digest("hex"),
    });
    summary.appServerExecutableBefore = runtimeExecutable();
    const appServerEnv = resolveElectronAppServerRuntimeEnv({
      env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
    });
    stage("launch-native-electron");
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      consoleErrors: summary.consoleErrors,
      pageErrors: summary.pageErrors,
      backendMode: "external",
      appServerEnv: {
        ...appServerEnv,
        APP_SERVER_BACKEND_COMMAND: process.execPath,
        APP_SERVER_BACKEND_ARGS: JSON.stringify([
          runtimeEnv.backendPath,
          runtimeEnv.backendLedgerPath,
          runtimeEnv.cancelSignalPath,
          runtimeEnv.typedErrorSignalPath,
        ]),
        APP_SERVER_BACKEND_TIMEOUT_MS: "10000",
        LIME_ALLOW_LIVE_PROVIDER_SMOKE: "0",
        LIME_REAL_API_TEST: "0",
      },
    });
    mainExit = captureMainProcessExit(handle.app.process());
    const lifecyclePrefix = "__settings_navigation_lifecycle__";
    let lifecycleOutput = "";
    handle.app.process().stdout?.on("data", (chunk) => {
      lifecycleOutput += chunk.toString();
      const lines = lifecycleOutput.split(/\r?\n/);
      lifecycleOutput = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith(lifecyclePrefix)) continue;
        const observation = JSON.parse(line.slice(lifecyclePrefix.length));
        summary.mainLifecycle.push(observation);
        if (
          observation.event === "will-quit" &&
          process.platform === "darwin"
        ) {
          quitObservationTimer = setTimeout(() => {
            if (mainExit.getExitRecord() !== null) return;
            const output = path.join(evidenceDir, "main-quit-sample.txt");
            quitSample = new Promise((resolve) => {
              const sample = spawn(
                "/usr/bin/sample",
                [String(mainExit.pid), "1", "1", "-mayDie", "-file", output],
                { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
              );
              const sampleLog = fs.createWriteStream(
                path.join(evidenceDir, "main-quit-sample.log"),
              );
              sample.stdout.pipe(sampleLog, { end: false });
              sample.stderr.pipe(sampleLog, { end: false });
              sample.once("close", () => sampleLog.end());
              sample.once("error", (error) =>
                resolve({ error: sanitizeText(error.message) }),
              );
              sample.once("exit", (code, signal) =>
                resolve({ path: output, code, signal }),
              );
            });
          }, 4_000);
        }
      }
    });
    void mainExit.exitPromise.then(() => clearTimeout(quitObservationTimer));
    handle.app.process().stderr?.on("data", (chunk) => {
      if (chunk.toString().includes("Waiting for the debugger to disconnect"))
        summary.mainLifecycle.push({
          event: "waiting-for-debugger-disconnect",
          at: new Date().toISOString(),
        });
    });
    await handle.app.evaluate(({ app, BrowserWindow }, prefix) => {
      for (const event of ["before-quit", "will-quit", "quit"])
        app.prependListener(event, () => {
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
    const { page } = handle;
    page.on("console", (message) => {
      if (message.type() === "error")
        summary.consoleErrors.push(sanitizeText(message.text()));
      const phase = message
        .text()
        .match(
          /^\[AgentDebug\] AgentChatPage\.((?:initialSessionNavigation|switchTopic|runTopicSwitch)\.[\w]+)\b/,
        )?.[1];
      if (phase)
        summary.recoveryPhases.push({ phase, at: new Date().toISOString() });
    });
    await page.evaluate(() => localStorage.setItem("lime:agent-debug", "1"));
    stage("configure-isolated-workspace-provider");
    await initializeAppServer(page);
    const workspace = await ensureDefaultWorkspace(page);
    const preference = await ensureFixtureTextProvider(page, undefined, {
      apiHost: provider.baseUrl,
    });
    await bindGuiWorkspaceAndModelPreferences(page, workspace.workspaceId, {
      provider: preference.providerId,
      model: preference.modelId,
    });
    await reloadRendererDocument(page, options);
    summary.browserPreferences = await runBrowserPreferencesScenario({
      page,
      options,
      evidenceDir,
      configPath: path.join(runtimeEnv.electronUserDataDir, "config.yaml"),
      stage,
    });
    collector = await installInvokeTraceCollector(page);
    await page.getByTestId("app-sidebar-home-button").click();
    await surface(page, options, null);
    stage("select-home-workspace");
    const projectTrigger = page
      .getByTestId("home-composer-page")
      .getByTestId("composer-utility-project-trigger");
    await projectTrigger.scrollIntoViewIfNeeded();
    summary.projectPickerBefore = await projectTrigger.boundingBox();
    await projectTrigger.click();
    summary.projectPickerOpened = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        return node ? node.getBoundingClientRect().toJSON() : null;
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        trigger: rect(
          '[data-testid="home-composer-page"] [data-testid="composer-utility-project-trigger"]',
        ),
        menu: rect('[data-testid="composer-utility-menu"]'),
        project: rect('[data-testid="composer-utility-opened-project"]'),
      };
    });
    await page.screenshot({
      path: path.join(evidenceDir, "project-picker.png"),
    });
    await page
      .locator(
        `[data-testid="composer-utility-opened-project"][data-project-id="${workspace.workspaceId}"]`,
      )
      .click();
    const selectedHome = await surface(page, options, null);
    assert.equal(selectedHome.workspaceRoot, workspace.rootPath);
    stage("send-from-real-home");
    await sendPromptFromGui(page, options, GREETING_PROMPT, {
      allowTaskCenterHomeInput: true,
    });
    await waitForPageCondition(
      page,
      options,
      ({ done }) => document.body.innerText.includes(done),
      "Home answer visible",
      { done: GREETING_SUMMARY_TEXT },
    );
    const starts = ledger();
    assert.equal(
      starts.length,
      1,
      "Home first send creates exactly one backend Turn",
    );
    const sessionId = starts[0].sessionId;
    assert.ok(sessionId);
    const list = await invokeAppServerFromPage(page, "thread/list", {
      archived: false,
      limit: 100,
    });
    const thread = list.result.data.find(
      (entry) => entry.sessionId === sessionId,
    );
    assert.ok(thread, "materialized session has canonical Thread");
    const read = async () => {
      const response = await invokeAppServerFromPage(page, "thread/read", {
        threadId: thread.id,
        includeTurns: true,
      });
      assert.equal(response.result?.thread?.id, thread.id);
      return response.result.thread;
    };
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
    const canonical = completed.thread;
    summary.identity = {
      sessionId,
      threadId: thread.id,
      turnId: canonical.turns[0]?.id,
      itemIds: canonical.turns[0]?.items.map((item) => item.id),
      workspaceId: workspace.workspaceId,
      projectId: canonical.projectId,
      cwd: canonical.cwd,
      workspaceIdentitySource:
        "workspace/default/ensure id/root, canonical thread/read cwd for the visible editor session and restored navigation projectId",
    };
    assert.equal(canonical.turns.length, 1);
    assert.equal(canonical.turns[0].status, "completed");
    assert.equal(canonical.cwd, workspace.rootPath);
    const before = await surface(page, options, sessionId);
    assert.equal(
      before.electron && before.preload && before.answerVisible,
      true,
    );
    assert.equal(before.workspaceRoot, workspace.rootPath);
    assert.equal(before.threadId, thread.id);
    assert.equal(before.settings, false);

    for (const origin of ["home-first-send", "existing-session"]) {
      stage(origin);
      if (origin === "existing-session") {
        await page.getByTestId("app-sidebar-home-button").click();
        await surface(page, options, null);
        const exactRow = page.locator(
          `[data-testid="app-sidebar-conversation-open"][data-session-id="${sessionId}"]`,
        );
        await exactRow.click();
        await surface(page, options, sessionId);
      }
      summary.navigationObservations.push({
        origin,
        phase: "before-settings",
        surface: await surface(page, options, sessionId),
      });
      await openSettings(page, options);
      assert.equal(await page.getByTestId("app-sidebar").count(), 0);
      for (const section of ["about", "appearance", "providers"]) {
        await page.getByTestId(`settings-sidebar-tab-${section}`).click();
        await waitForPageCondition(
          page,
          options,
          ({ section }) => {
            const selected = document.querySelector(
              `[data-testid="settings-sidebar-tab-${section}"]`,
            );
            return (
              selected?.getAttribute("aria-current") === "page" &&
              !document.querySelector('[data-testid="settings-page-loading"]')
            );
          },
          `section ${section} committed`,
          { section },
        );
      }
      if (origin === "home-first-send")
        await page.screenshot({ path: path.join(evidenceDir, "settings.png") });
      await page.getByTestId("settings-back-button").click();
      summary.navigationObservations.push({
        origin,
        phase: "after-back",
        restore: await page.evaluate(() =>
          JSON.parse(
            sessionStorage.getItem("lime.appNavigation.restore.v1") || "null",
          ),
        ),
      });
      const after = await surface(page, options, sessionId);
      assert.equal(after.settings, false);
      assert.equal(after.home, false);
      assert.equal(after.answerVisible, true);
      assert.equal(after.workspaceRoot, before.workspaceRoot);
      assert.equal(after.threadId, before.threadId);
      assert.equal(after.restore.params.initialSessionId, sessionId);
      assert.equal(after.restore.params.projectId, workspace.workspaceId);
      assert.equal(after.restore.params.initialUserPrompt, undefined);
      assert.equal(after.restore.params.newConversationRequest, undefined);
      const reread = await read();
      assert.equal(reread.cwd, canonical.cwd);
      assert.equal(reread.projectId, canonical.projectId);
      assert.deepEqual(
        reread.turns.map((turn) => ({
          id: turn.id,
          status: turn.status,
          items: turn.items.map((item) => item.id),
        })),
        canonical.turns.map((turn) => ({
          id: turn.id,
          status: turn.status,
          items: turn.items.map((item) => item.id),
        })),
      );
      assert.equal(ledger().length, 1, "return never resends first input");
      summary.rounds.push({
        origin,
        sessionId: after.sessionId,
        sameWorkspace: true,
        sameCanonicalItemIds: true,
        backendTurnStarts: 1,
      });
      await page.screenshot({ path: path.join(evidenceDir, `${origin}.png`) });
    }
    summary.unsavedMemory = await runSettingsUnsavedNavigationScenario({
      page,
      options,
      evidenceDir,
      stage,
      waitForSession: () => surface(page, options, sessionId),
    });
    summary.unsavedNote = await runSettingsNoteNavigationScenario({
      page,
      options,
      evidenceDir,
      stage,
      waitForSession: () => surface(page, options, sessionId),
    });
    summary.unsavedWebSearch = await runSettingsWebSearchNavigationScenario({
      page,
      options,
      evidenceDir,
      stage,
      waitForSession: () => surface(page, options, sessionId),
    });
    summary.unsavedEnvironment =
      await runSettingsLocalEnvironmentsNavigationScenario({
        page,
        options,
        evidenceDir,
        stage,
        waitForSession: () => surface(page, options, sessionId),
        workspaceRoot: path.join(
          runtimeEnv.tempRoot,
          "local-environment-project",
        ),
      });
    summary.unsavedExecutionPolicy =
      await runSettingsExecutionPolicyNavigationScenario({
        page,
        options,
        evidenceDir,
        stage,
        waitForSession: () => surface(page, options, sessionId),
      });
    summary.unsavedProfile = await runSettingsProfileNavigationScenario({
      page,
      options,
      evidenceDir,
      stage,
      waitForSession: () => surface(page, options, sessionId),
    });
    summary.settingsSearch = await runSettingsSearchScenario({
      page,
      options,
      evidenceDir,
      stage,
      waitForSession: () => surface(page, options, sessionId),
    });
    assert.equal(ledger().length, 1, "settings drafts never submit a Turn");
    const afterUnsaved = await read();
    assert.deepEqual(
      afterUnsaved.turns.map((turn) => ({
        id: turn.id,
        status: turn.status,
        items: turn.items.map((item) => item.id),
      })),
      canonical.turns.map((turn) => ({
        id: turn.id,
        status: turn.status,
        items: turn.items.map((item) => item.id),
      })),
    );
    await openSettings(page, options);
    await page.getByTestId("settings-back-button").click();
    await surface(page, options, sessionId);
    await page.getByTestId("app-sidebar-nav-new-chat").click();
    const home = await surface(page, options, null);
    assert.equal(home.home, true);
    assert.equal(home.settings, false);
    assert.equal(ledger().length, 1);
    summary.backThenHome = {
      home: true,
      sessionId: null,
      backendTurnStarts: 1,
    };
    stage("verify-incoming-service-skill-and-new-conversation");
    await handle.app.evaluate(({ app }, url) => {
      app.emit("open-url", { preventDefault() {} }, url);
    }, "lime://open?kind=skill&slug=short-video-script-replication&source=website&v=1");
    const pendingForm = page.getByTestId("workspace-pending-a2ui-panel");
    await pendingForm.waitFor({ state: "visible" });
    await pendingForm
      .getByText("参考视频链接/素材（必填）", { exact: true })
      .waitFor();
    const referenceVideo = pendingForm.getByTestId(
      "service-skill-slot-reference_video",
    );
    await referenceVideo.waitFor({ state: "visible" });
    assert.equal(await referenceVideo.isEditable(), true);
    assert.equal(ledger().length, 1, "incomplete skill never starts a turn");
    await page.screenshot({
      path: path.join(evidenceDir, "incoming-service-skill.png"),
    });
    await page.getByTestId("app-sidebar-new-conversation-button").click();
    await surface(page, options, null);
    await pendingForm.waitFor({ state: "detached" });
    assert.equal(
      ledger().length,
      1,
      "new conversation never replays the skill",
    );
    summary.incomingServiceSkill = {
      entry: "electron-open-url",
      formVisible: true,
      newConversationCleared: true,
      backendTurnStarts: 1,
    };
    stage("verify-continuous-native-trace");
    const capture = await captureInvokeTraceCollector(page, collector);
    const trace = validateInvokeTraceCollectorCapture(capture, collector);
    assert.equal(
      trace.complete,
      true,
      "continuous native invoke trace provenance",
    );
    const entries = trace.ledgerEntries;
    summary.trace = {
      provenance: trace.provenance,
      methods: [...new Set(collectTraceRequestMethods(entries))],
      errors: entries.filter((entry) => entry.status === "error").length,
      electronIpc: entries.filter(
        (entry) =>
          entry.transport === "electron-ipc" &&
          entry.command === "app_server_handle_json_lines",
      ).length,
      productionMockHits: entries.filter((entry) =>
        /mock/i.test(entry.transport || ""),
      ).length,
    };
    assert.ok(summary.trace.electronIpc > 0);
    assert.equal(summary.trace.productionMockHits, 0);
    assert.equal(summary.trace.errors, 0);
    for (const method of [
      "thread/start",
      "turn/start",
      "thread/read",
      "config/read",
      "config/batchWrite",
    ])
      assert.ok(
        summary.trace.methods.includes(method),
        `native trace method ${method}`,
      );
    assert.deepEqual(summary.consoleErrors, []);
    assert.deepEqual(summary.pageErrors, []);
    assert.deepEqual(
      fingerprints(),
      summary.sourceSha256,
      "declared sources did not drift during fixture",
    );
    summary.buildAfter = requireFresh();
    assert.deepEqual(
      artifactFingerprints(),
      summary.artifactSha256,
      "product artifacts did not drift during fixture",
    );
    summary.appServerExecutableAfter = runtimeExecutable();
    assert.deepEqual(
      summary.appServerExecutableAfter,
      summary.appServerExecutableBefore,
      "configured runtime executable did not drift during fixture",
    );
  } catch (error) {
    failure = error;
    summary.error = sanitizeText(error.stack || error.message);
    if (handle) {
      summary.failureObservation = await handle.page
        .evaluate(
          ({ answerText }) => ({
            editors: [
              ...document.querySelectorAll('[data-testid="composer-editor"]'),
            ].map((editor) => ({
              sessionId: editor.getAttribute("data-session-id"),
              editable: editor.getAttribute("contenteditable"),
              visible: editor.getClientRects().length > 0,
            })),
            home: Boolean(
              document.querySelector('[data-testid="home-composer-page"]'),
            ),
            settings: Boolean(
              document.querySelector('[data-testid="settings-navigation"]'),
            ),
            answerVisible: document.body.innerText.includes(answerText),
            restore: JSON.parse(
              sessionStorage.getItem("lime.appNavigation.restore.v1") || "null",
            ),
            homeWorkspaceRoot:
              document
                .querySelector(
                  '[data-testid="home-composer-page"] [data-testid="composer-utility-bar"]',
                )
                ?.getAttribute("data-workspace-root") || null,
          }),
          { answerText: GREETING_SUMMARY_TEXT },
        )
        .catch(() => ({ unavailable: true }));
      await handle.page
        .screenshot({ path: path.join(evidenceDir, "failure.png") })
        .catch(() => undefined);
    }
  } finally {
    stage("settle-owned-resources");
    const teardown = await settleFixtureResources({
      app: handle?.app,
      mainExit,
      textProviderFixtureServer: provider,
      invokeTraceCollector: collector
        ? {
            stop: async () => {
              const stopped = await stopInvokeTraceCollector(
                handle.page,
                collector,
              );
              assert.equal(
                stopped.nativeRestored,
                true,
                "native trace hooks restored",
              );
            },
          }
        : null,
    });
    summary.teardown = teardown;
    clearTimeout(quitObservationTimer);
    summary.quitSample = await quitSample;
    summary.normalMainExit = teardown.normalMainExit;
    if (!teardown.ok)
      failure ??= new Error("settings navigation resource teardown failed");
    if (!failure) {
      try {
        fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
      } catch (error) {
        failure = error;
        summary.cleanupError = sanitizeText(error.message);
      }
    }
    summary.ok = !failure;
    summary.completedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(evidenceDir, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
  }
  if (failure) throw failure;
  return summary;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const runId = process.argv[2];
  if (!runId)
    throw new Error(
      "Usage: node scripts/electron/settings-navigation-fixture-smoke.mjs <fresh-run-id>",
    );
  runSettingsNavigationFixture({
    runId,
    evidenceDir: path.resolve(".lime/qc/settings-sections", runId),
  }).then(
    () => console.log(`[settings-navigation] pass ${runId}`),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
