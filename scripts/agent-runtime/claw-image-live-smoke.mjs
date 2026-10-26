#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import {
  bindGuiWorkspaceAndModelPreferences,
  clearInvokeBuffers,
  ensureDefaultWorkspace,
  initializeAppServer,
  waitForAppUrlReady,
  waitForRendererReady,
} from "../lib/chat-fixture/rpc.mjs";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import {
  assert,
  cleanupTempRoot,
  isIgnorableConsoleError,
  sanitizeJson,
  sanitizeText,
  writeJsonFile,
} from "../lib/chat-fixture/utils.mjs";
import {
  readSessionSummary,
  readWorkflowAudit,
  summarizeTaskAuditLog,
  waitForLiveImageTask,
  waitForLiveImageTaskTerminal,
} from "./claw-image-live-smoke-audit.mjs";
import { bodyTextContainsForbiddenMarker } from "./claw-image-live-smoke-common.mjs";
import {
  extractSessionAndTurn,
  waitForLiveImagePendingPromptStable,
  waitForLiveImageGuiTerminal,
} from "./claw-image-live-smoke-gui.mjs";
import {
  createLiveRuntimeEnv,
  defaultPrompt,
  IMAGE_WORKFLOW_KEY,
  INTERNAL_UI_MARKERS,
  logStage,
  LOG_PREFIX,
  parseArgs,
} from "./claw-image-live-smoke-options.mjs";
import {
  bindImageDefaultsFromPage,
  copyElectronConfigToAppServerConfig,
  ensureLiveAgnesProviderFromEnv,
} from "./claw-image-live-smoke-provider.mjs";

async function run() {
  const options = parseArgs(process.argv.slice(2));
  options.prompt = options.prompt || defaultPrompt();
  fs.mkdirSync(options.evidenceDir, { recursive: true });

  const runtimeEnv = createLiveRuntimeEnv();
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
  const summaryPath = path.join(
    options.evidenceDir,
    `${options.prefix}-summary.json`,
  );
  const screenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}-final.png`,
  );
  const failureScreenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}-failure.png`,
  );
  const appServerRequests = [];
  const consoleErrors = [];
  const actionableConsoleErrors = [];
  const summary = {
    ok: false,
    scenarioId: "claw-image-live",
    liveProviderAllowed: true,
    setupAgnesFromEnv: options.setupAgnesFromEnv,
    appUrl: options.appUrl || null,
    prompt: options.prompt,
    providerPreference: options.providerPreference,
    modelPreference: options.modelPreference,
    textProviderPreference: options.textProviderPreference || null,
    textModelPreference: options.textModelPreference || null,
    checkedAt: new Date().toISOString(),
    tempRoot: options.keepTemp ? runtimeEnv.tempRoot : null,
    electronUserDataDir: options.keepTemp
      ? runtimeEnv.electronUserDataDir
      : null,
    configPath: options.keepTemp ? runtimeEnv.configPath : null,
    appServerRequests,
    consoleErrors,
    actionableConsoleErrors,
    screenshots: [],
  };

  let app = null;
  let page = null;
  try {
    if (options.appUrl) {
      logStage("wait-app-url");
      summary.rendererDevServer = sanitizeJson(
        await waitForAppUrlReady(options),
      );
    }

    logStage("launch-electron");
    app = await electron.launch({
      executablePath: electronPath,
      args: ["--use-mock-keychain", "."],
      cwd: process.cwd(),
      env: {
        ...runtimeEnv.env,
        ...appServerEnv,
        APP_SERVER_BACKEND_MODE: "runtime",
        APP_SERVER_BACKEND_TIMEOUT_MS: String(options.timeoutMs),
        ELECTRON_E2E_USER_DATA_DIR: runtimeEnv.electronUserDataDir,
        LIME_ALLOW_LIVE_PROVIDER_SMOKE: "1",
        LIME_REAL_API_TEST: "1",
        LIME_ELECTRON_E2E: "1",
        LIME_ELECTRON_BRAND_DEV_APP: "0",
        LIME_ELECTRON_CLEAR_RENDERER_CACHE: "0",
        LIME_ELECTRON_DEV_HTTP_BRIDGE: "0",
        ...(options.appUrl ? { VITE_DEV_SERVER_URL: options.appUrl } : {}),
      },
      timeout: options.timeoutMs,
    });
    const collectConsoleMessage = (message) => {
      const text = sanitizeText(message.text());
      if (message.type() === "error") {
        consoleErrors.push(text);
        if (!isIgnorableConsoleError(text)) {
          actionableConsoleErrors.push(text);
        }
      }
    };
    app.on("console", collectConsoleMessage);
    page = await app.firstWindow({ timeout: options.timeoutMs });
    page.on("console", collectConsoleMessage);
    page.setDefaultTimeout(options.timeoutMs);
    await page.setViewportSize({ width: 1440, height: 1000 });

    logStage("wait-renderer");
    summary.rendererSnapshot = sanitizeJson(
      await waitForRendererReady(page, options),
    );
    await clearInvokeBuffers(page);

    logStage("initialize-app-server");
    summary.initialize = sanitizeJson(
      await initializeAppServer(page, appServerRequests),
    );

    logStage("ensure-default-workspace");
    const workspace = await ensureDefaultWorkspace(page, appServerRequests);
    summary.workspaceId = workspace.workspaceId;
    summary.workspace = sanitizeJson(workspace);

    if (options.setupAgnesFromEnv) {
      logStage("setup-agnes-provider");
      summary.providerSetup = await ensureLiveAgnesProviderFromEnv(
        page,
        appServerRequests,
        options,
      );
    }

    logStage("bind-image-defaults");
    summary.imageDefaults = sanitizeJson(
      await bindImageDefaultsFromPage(page, options),
    );
    summary.configSync = sanitizeJson(
      copyElectronConfigToAppServerConfig(runtimeEnv),
    );

    if (options.textProviderPreference && options.textModelPreference) {
      logStage("bind-gui-workspace-text-model");
      summary.guiWorkspaceBinding = sanitizeJson(
        await bindGuiWorkspaceAndModelPreferences(page, workspace.workspaceId, {
          provider: options.textProviderPreference,
          model: options.textModelPreference,
        }),
      );
    } else {
      summary.guiWorkspaceBinding = {
        skipped: true,
        reason: "use-current-ui-text-model",
      };
    }

    logStage("send-prompt-from-gui");
    summary.inputSend = sanitizeJson(
      await sendPromptFromGui(page, options, options.prompt, {
        allowTaskCenterHomeInput: true,
        requireTurnStart: true,
      }),
    );
    summary.turnStartTraceCount = (
      summary.inputSend?.afterClick?.appServerTraceTail ?? []
    ).reduce((count, entry) => {
      return (
        count +
        (entry.turnStarts ?? []).filter(
          (turnStart) => turnStart.text === options.prompt,
        ).length
      );
    }, 0);
    const turnRef = extractSessionAndTurn(summary.inputSend);
    summary.sessionId = turnRef.sessionId;
    summary.turnId = turnRef.turnId;
    summary.turnStart = turnRef.turnStart;
    assert(turnRef.sessionId, "GUI 提交后没有拿到 sessionId");

    logStage("wait-gui-pending-prompt-stable");
    summary.guiPendingPrompt = await waitForLiveImagePendingPromptStable(
      page,
      options,
      options.prompt,
    );

    logStage("wait-image-task");
    summary.imageTask = await waitForLiveImageTask(
      page,
      options,
      workspace,
      options.prompt,
      turnRef.sessionId,
    );

    logStage("wait-image-task-terminal");
    summary.imageTaskTerminal = await waitForLiveImageTaskTerminal(
      page,
      options,
      workspace,
      summary.imageTask,
    );

    logStage("wait-gui-terminal");
    summary.guiTerminal = await waitForLiveImageGuiTerminal(
      page,
      options,
      options.prompt,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.screenshots.push(path.basename(screenshotPath));

    logStage("read-session-summary");
    summary.sessionRead = await readSessionSummary(
      page,
      turnRef.sessionId,
      options.prompt,
      summary.imageTask.payload?.turnId,
    );

    logStage("read-workflow-audit");
    summary.workflowRead = await readWorkflowAudit(
      page,
      turnRef.sessionId,
      summary.imageTask.payload?.turnId || turnRef.turnId,
      summary.imageTask.taskId,
    );

    logStage("read-task-audit-jsonl");
    summary.taskAuditLog = summarizeTaskAuditLog(
      workspace,
      summary.imageTaskTerminal,
    );

    const forbiddenSummaryText = JSON.stringify({
      guiTerminal: summary.guiTerminal,
      sessionRead: summary.sessionRead,
    });
    summary.assertions = {
      liveProviderAllowed: true,
      usedRealElectron: summary.rendererSnapshot?.electron === true,
      usedCurrentAppServerBridge:
        summary.rendererSnapshot?.supportsAppServer === true,
      canonicalTurnCompleted:
        summary.sessionRead.hasThread === true &&
        summary.sessionRead.turn?.id === summary.imageTask.payload?.turnId &&
        summary.sessionRead.turn?.status === "completed",
      singleTurnStartTrace: summary.turnStartTraceCount === 1,
      guiPromptVisible: summary.guiTerminal.userMessageVisible === true,
      guiPromptNotDuplicated:
        (summary.guiPendingPrompt?.promptOccurrenceCount ?? 0) <= 1 &&
        (summary.guiPendingPrompt?.imagePromptOccurrenceCount ?? 0) <= 1 &&
        (summary.guiTerminal?.promptOccurrenceCount ?? 0) <= 1 &&
        (summary.guiTerminal?.imagePromptOccurrenceCount ?? 0) <= 1,
      guiReasoningVisible: summary.guiTerminal.reasoningVisible === true,
      guiAssistantTextVisible:
        summary.guiTerminal.hasNonCardAssistantText === true,
      guiImageCardVisible: summary.guiTerminal.hasImageCard === true,
      guiImagePreviewLoaded: summary.guiTerminal.hasLoadedImage === true,
      guiTokenVisible: summary.guiTerminal.tokenVisible === true,
      guiRightSurfaceNotAutoOpen:
        summary.guiTerminal.rightSurfaceVisible === false,
      guiInternalFieldsHidden:
        bodyTextContainsForbiddenMarker(
          forbiddenSummaryText,
          INTERNAL_UI_MARKERS,
        ).length === 0,
      taskArtifactSucceeded:
        summary.imageTaskTerminal.normalizedStatus === "succeeded",
      workflowReadProjected:
        summary.workflowRead.matchedRun?.workflowKey === IMAGE_WORKFLOW_KEY,
      workflowReadRedacted:
        summary.workflowRead.containsPrompt === false &&
        summary.workflowRead.containsTaskPath === false,
      taskAuditJsonlWritten: summary.taskAuditLog.logExists === true,
      taskAuditJsonlSucceeded: summary.taskAuditLog.hasTaskSucceeded === true,
      taskAuditJsonlNoSensitiveTokens:
        summary.taskAuditLog.hasNoSensitiveTokens === true,
    };
    const failedAssertions = Object.entries(summary.assertions)
      .filter(([, value]) => value !== true)
      .map(([key]) => key);
    assert(
      failedAssertions.length === 0,
      `live @配图断言失败: ${failedAssertions.join(", ")}`,
    );

    summary.ok = true;
    writeJsonFile(summaryPath, sanitizeJson(summary));
    console.log(`${LOG_PREFIX} pass summary=${summaryPath}`);
  } catch (error) {
    summary.ok = false;
    summary.error = sanitizeText(
      error instanceof Error ? error.stack || error.message : error,
    );
    if (page) {
      try {
        await page.screenshot({ path: failureScreenshotPath, fullPage: true });
        summary.screenshots.push(path.basename(failureScreenshotPath));
      } catch {
        // ignore
      }
    }
    writeJsonFile(summaryPath, sanitizeJson(summary));
    console.error(`${LOG_PREFIX} fail summary=${summaryPath}`);
    throw error;
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
    if (!options.keepTemp) {
      cleanupTempRoot(runtimeEnv.tempRoot);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
