import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { clickNativeMenuItem } from "./browser-runtime-gate-a.mjs";
import { assert, sanitizeText } from "./claw-chat-current-fixture-utils.mjs";
import {
  readConfigFromPage,
  writeConfigEditsFromPage,
} from "../electron/mcp-config-fixture-smoke.mjs";
import { isObservedPreloadAppServerResponse } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  downloadHistoryClearEvidence,
  downloadHistoryMissingFileEvidence,
  downloadHistoryTraceEvidence,
} from "./browser-runtime-electron-gate-b-download-history-evidence.mjs";

import {
  fileEvidence,
  hideCompletedDownload,
  installObservers,
  isolatedProfile,
  listDownloads,
  nativeState,
  readTrace,
  snapshot,
  startDownloadServer,
  waitFor,
} from "./browser-runtime-electron-gate-b-download-history-native.mjs";
import { verifyDownloadHistoryPagination } from "./browser-runtime-electron-gate-b-download-history-pagination.mjs";

/** Downloads exercise Desktop native host and settings, without a model/runtime inference claim. */
export async function runBrowserDownloadHistoryScenario({
  app,
  page,
  options,
  identity,
  session,
  workspaceId,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
  outputDir,
}) {
  identity ??= session;
  assert(
    identity?.threadId && identity?.sessionId,
    "Download history requires the existing canonical conversation",
  );
  const locale = options.locale || guiBeforeTurn.rendererLocale || "zh-CN";
  assert(
    ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].includes(locale),
    "Unsupported downloads fixture locale",
  );
  const labels = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${locale}/browserDownloads.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const label = (name, filename) =>
    String(labels[`browserDownloads.${name}`] ?? "").replaceAll(
      "{{filename}}",
      filename ?? "",
    );
  const profile = await isolatedProfile(app),
    fixture = await startDownloadServer();
  const observerKey = `__downloadHistoryFixture_${randomUUID().replaceAll("-", "")}`;
  const captures = {},
    screenshots = [],
    consoleErrors = [],
    pageErrors = [];
  const stage = (name) =>
    console.log(`[browser-download-history] stage=${name}`);
  const onConsole = (message) => {
    if (message.type() === "error")
      consoleErrors.push(sanitizeText(message.text()));
  };
  const onError = (error) => pageErrors.push(sanitizeText(error.message));
  const downloadsPage = page.getByTestId("browser-downloads-page");
  const row = (id) => downloadsPage.locator(`li[data-download-id="${id}"]`);
  const action = (entry, name) =>
    row(entry.id).getByRole("button", {
      name: label(name, entry.filename),
      exact: true,
    });
  const capture = async (name) => {
    const directory =
      outputDir || options.screenshotDir || path.dirname(options.output);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(
      directory,
      `${locale}-browser-download-history-${name}.png`,
    );
    await page.screenshot({ path: file, fullPage: false });
    screenshots.push(file);
  };
  const waitEntry = (file, predicate, description) =>
    waitFor(
      options,
      () => listDownloads(page, profile, file.filename),
      (list) =>
        list.entries.length === 1 && predicate(list.entries[0])
          ? list.entries[0]
          : false,
      description,
    ).then((list) => list.entries[0]);
  const stableSnapshot = () =>
    waitFor(
      options,
      () => snapshot(page, profile),
      (value) => value.diskMatches,
      "Native download store did not match the public IPC read",
    );
  let initial,
    nativeBefore,
    settingsBefore,
    configured = false,
    observersInstalled = false;
  page.on("console", onConsole);
  page.on("pageerror", onError);
  const restoreSettings = async () => {
    if (!configured) return true;
    const current = await readConfigFromPage(page);
    await writeConfigEditsFromPage(page, {
      expectedVersion: current.version,
      edits: [
        {
          keyPath: "browser.download_directory",
          value: settingsBefore.config?.browser?.download_directory ?? null,
          mergeStrategy: "replace",
        },
        {
          keyPath: "browser.ask_download_location",
          value: settingsBefore.config?.browser?.ask_download_location ?? false,
          mergeStrategy: "replace",
        },
      ],
    });
    configured = false;
    const restored = await readConfigFromPage(page);
    return (
      JSON.stringify(restored.config?.browser ?? null) ===
      JSON.stringify(settingsBefore.config?.browser ?? null)
    );
  };
  try {
    stage("prepare-isolated-real-config-and-native-observation");
    const bridge = await page.evaluate(() => ({
      electron: window.__LIME_ELECTRON__ === true,
      invoke: typeof window.electronAPI?.invoke === "function",
      fallback: window.electronAPI?.devBridgeFallback,
    }));
    assert(
      bridge.electron && bridge.invoke && bridge.fallback === false,
      "Downloads fixture requires the real Electron preload bridge",
    );
    initial = await readBrowserWorkspaceState(page);
    nativeBefore = await nativeState(app, initial.webContentsId);
    assert(
      initial.threadId === identity.threadId &&
        initial.tabId === guiBeforeTurn.tabId &&
        nativeBefore?.webContentsId === initial.webContentsId &&
        initial.controlOwner !== "agent",
      "Downloads fixture initial Browser identity is unavailable or agent-controlled",
    );
    assert(
      (await listDownloads(page, profile)).total === 0,
      "Downloads fixture requires an empty isolated native history",
    );
    await fs.mkdir(profile.downloads, { recursive: true });
    settingsBefore = await readConfigFromPage(page);
    const configuredWrite = await writeConfigEditsFromPage(page, {
      expectedVersion: settingsBefore.version,
      edits: [
        {
          keyPath: "browser.download_directory",
          value: profile.downloads,
          mergeStrategy: "replace",
        },
        {
          keyPath: "browser.ask_download_location",
          value: false,
          mergeStrategy: "replace",
        },
      ],
    });
    configured = true;
    const settingsAfter = await readConfigFromPage(page);
    assert(
      settingsAfter.config?.browser?.download_directory === profile.downloads &&
        settingsAfter.config.browser.ask_download_location === false,
      "Isolated download destination did not reach config/read",
    );
    captures.config = {
      realRead: isObservedPreloadAppServerResponse(
        settingsAfter.response?.ipcObservation,
        "config/read",
      ),
      realWrite: isObservedPreloadAppServerResponse(
        configuredWrite.ipcObservation,
        "config/batchWrite",
      ),
      isolatedDirectoryApplied: true,
      permissionEdits: false,
    };
    await installObservers(app, page, observerKey, initial.webContentsId);
    observersInstalled = true;
    const trigger = (file) =>
      app.evaluate(
        ({ webContents }, { id, url }) => {
          const target = webContents.fromId(id);
          if (!target || target.isDestroyed())
            throw new Error("Native download target disappeared");
          target.downloadURL(url);
          return { sourceWebContentsId: target.id, url: target.getURL() };
        },
        { id: initial.webContentsId, url: file.url },
      );

    stage("native-downloads-and-more-menu-entry");
    const cancelledFile = fixture.files.find(
      (file) => file.name === "cancelled",
    );
    const removedFile = fixture.files.find((file) => file.name === "removed");
    const retainedFile = fixture.files.find((file) => file.name === "retained");
    const activeFile = fixture.files.find((file) => file.name === "active");
    await trigger(cancelledFile);
    await trigger(removedFile);
    await trigger(retainedFile);
    const slow = await waitEntry(
      cancelledFile,
      (entry) => entry.canPause && entry.receivedBytes > 0,
      "Native slow download did not progress",
    );
    const removed = await waitEntry(
      removedFile,
      (entry) => entry.state === "completed" && entry.fileExists,
      "First small native download did not complete",
    );
    const retained = await waitEntry(
      retainedFile,
      (entry) => entry.state === "completed" && entry.fileExists,
      "Second small native download did not complete",
    );
    captures.completedFiles = await Promise.all([
      fileEvidence(profile, removedFile),
      fileEvidence(profile, retainedFile),
    ]);
    assert(
      captures.completedFiles.every((file) => file.matchesResponse),
      "Native completed file bytes differ from the real HTTP response",
    );
    await page.getByTestId("browser-workspace-options").click();
    await clickNativeMenuItem(app, "downloads");
    await downloadsPage.waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    await downloadsPage
      .getByRole("heading", { name: label("title"), exact: true })
      .waitFor({ state: "visible" });
    await row(slow.id).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    captures.initial = await stableSnapshot();
    await capture("initial");

    stage("pause-resume-cancel-through-downloads-ui");
    await action(slow, "pause").click();
    const paused = await waitEntry(
      cancelledFile,
      (entry) => entry.state === "paused" && entry.canResume && !entry.canPause,
      "GUI pause did not reach native download state",
    );
    await action(paused, "resume").waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    captures.paused = paused;
    await capture("paused");
    await action(paused, "resume").click();
    const resumed = await waitEntry(
      cancelledFile,
      (entry) =>
        entry.state === "progressing" &&
        entry.canPause &&
        entry.receivedBytes > paused.receivedBytes,
      "GUI resume did not deliver more real HTTP bytes",
    );
    captures.resumed = resumed;
    await action(resumed, "cancel").click();
    captures.cancelled = await waitEntry(
      cancelledFile,
      (entry) =>
        entry.state === "cancelled" &&
        !entry.canCancel &&
        !entry.canPause &&
        !entry.canResume,
      "GUI cancel did not reach native terminal state",
    );
    await action(captures.cancelled, "remove").waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });

    stage("missing-file-ui-and-restored-native-file");
    const refreshManagementPage = async () => {
      await downloadsPage
        .getByRole("button", { name: label("back"), exact: true })
        .click();
      await page.locator("#browser-download-history button").click();
      await downloadsPage.waitFor({
        state: "visible",
        timeout: options.timeoutMs,
      });
      await row(retained.id).waitFor({
        state: "visible",
        timeout: options.timeoutMs,
      });
    };
    const fileUi = () =>
      row(retained.id).evaluate(
        (row, labels) => {
          const buttons = [...row.querySelectorAll("button")];
          const open = buttons.find(
            (button) => button.getAttribute("aria-label") === labels.open,
          );
          const reveal = buttons.find(
            (button) => button.getAttribute("aria-label") === labels.reveal,
          );
          const filename = row.querySelector("span[title]");
          return {
            missingText: row.innerText.includes(labels.missing),
            strikethrough:
              !!filename &&
              getComputedStyle(filename).textDecorationLine.includes(
                "line-through",
              ),
            openDisabled:
              !open || (open instanceof HTMLButtonElement && open.disabled),
            revealUnavailable: !reveal || reveal.disabled,
            revealAvailable: !!reveal && !reveal.disabled,
          };
        },
        {
          open: label("open", retained.filename),
          reveal: label("reveal", retained.filename),
          missing: label("missing"),
        },
      );
    const hidden = await hideCompletedDownload(profile, retainedFile, retained);
    const missingEvidence = { before: retained, originalFile: hidden.original };
    try {
      missingEvidence.missing = await waitEntry(
        retainedFile,
        (entry) => entry.state === "completed" && entry.fileExists === false,
        "Renaming the completed file did not update real fileExists",
      );
      await refreshManagementPage();
      missingEvidence.missingUi = await waitFor(
        options,
        fileUi,
        (ui) =>
          ui.missingText &&
          ui.strikethrough &&
          ui.openDisabled &&
          ui.revealUnavailable,
        "Missing file GUI did not mark the filename and disable file actions",
      );
      await capture("missing-file");
    } finally {
      missingEvidence.restoredFile = await hidden.restore();
      missingEvidence.restored = await waitEntry(
        retainedFile,
        (entry) => entry.state === "completed" && entry.fileExists === true,
        "Restoring the native download did not restore fileExists",
      );
      await refreshManagementPage();
      missingEvidence.restoredUi = await waitFor(
        options,
        fileUi,
        (ui) =>
          !ui.missingText &&
          !ui.strikethrough &&
          ui.openDisabled === false &&
          ui.revealAvailable,
        "Restored file GUI did not restore its file capabilities",
      );
    }
    captures.missingFile = {
      ...missingEvidence,
      checks: downloadHistoryMissingFileEvidence(missingEvidence),
    };

    stage("search-filename-and-url");
    const search = downloadsPage.getByRole("searchbox", {
      name: label("search"),
      exact: true,
    });
    await search.fill(removedFile.filename);
    await waitFor(
      options,
      () =>
        downloadsPage
          .locator("li[data-download-id]")
          .evaluateAll((rows) =>
            rows.map((row) => row.getAttribute("data-download-id")),
          ),
      (ids) => ids.length === 1 && ids[0] === removed.id,
      "Filename search did not isolate the completed download",
    );
    captures.filenameSearch = true;
    await capture("filename-search");
    await search.fill(retainedFile.url);
    await waitFor(
      options,
      () =>
        downloadsPage
          .locator("li[data-download-id]")
          .evaluateAll((rows) =>
            rows.map((row) => row.getAttribute("data-download-id")),
          ),
      (ids) => ids.length === 1 && ids[0] === retained.id,
      "URL search did not isolate the completed download",
    );
    captures.urlSearch = true;
    await search.fill(`${fixture.marker}-missing`);
    await downloadsPage
      .getByRole("status")
      .filter({ hasText: label("noResults") })
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    captures.noResults = true;
    await search.fill("");
    await row(removed.id).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });

    stage("remove-completed-record-without-deleting-file");
    await action(removed, "remove").click();
    await row(removed.id).waitFor({
      state: "hidden",
      timeout: options.timeoutMs,
    });
    await waitFor(
      options,
      () => listDownloads(page, profile),
      (list) => !list.entries.some((entry) => entry.id === removed.id),
      "Removed record remained in native history",
    );
    captures.removedFile = await fileEvidence(profile, removedFile);
    captures.afterRemove = await stableSnapshot();

    stage("clear-directly-and-preserve-active-download");
    await trigger(activeFile);
    const active = await waitEntry(
      activeFile,
      (entry) =>
        entry.state === "progressing" &&
        entry.canPause &&
        entry.receivedBytes > 0,
      "Active native download did not start while management page was visible",
    );
    await row(active.id).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    await action(active, "pause").click();
    const activePaused = await waitEntry(
      activeFile,
      (entry) => entry.state === "paused" && entry.canResume,
      "Second live native download did not pause",
    );
    await action(activePaused, "resume").waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    captures.beforeClear = await stableSnapshot();
    captures.allTimeHeading = await downloadsPage
      .getByRole("heading", { name: label("allTime"), exact: true })
      .isVisible();
    await downloadsPage
      .getByRole("button", { name: label("clear"), exact: true })
      .click();
    captures.afterClear = await waitFor(
      options,
      () => snapshot(page, profile),
      (value) =>
        value.page.entries.length === 1 &&
        value.page.entries[0].id === active.id &&
        value.diskMatches,
      "Clear removed active download or failed to remove terminal records",
    );
    captures.clear = downloadHistoryClearEvidence(
      captures.beforeClear.page,
      captures.afterClear.page,
    );
    captures.noClearConfirmation =
      (await downloadsPage.getByRole("alertdialog").count()) === 0;
    captures.clearDisabledForOnlyActive = await waitFor(
      options,
      () =>
        downloadsPage
          .getByRole("button", { name: label("clear"), exact: true })
          .isDisabled(),
      (disabled) => disabled,
      "Clear all remained enabled for only active downloads",
    );
    captures.filesAfterClear = await Promise.all([
      fileEvidence(profile, removedFile),
      fileEvidence(profile, retainedFile),
    ]);
    await capture("clear-retains-active");
    await action(activePaused, "resume").click();
    captures.activeContinued = await waitEntry(
      activeFile,
      (entry) =>
        entry.state === "progressing" &&
        entry.receivedBytes > activePaused.receivedBytes,
      "Cleared history prevented the retained active download from continuing",
    );
    await action(captures.activeContinued, "pause").click();
    await waitEntry(
      activeFile,
      (entry) => entry.state === "paused",
      "Fixture active download did not pause before pagination",
    );

    stage("real-native-history-pagination-by-scrolling");
    captures.pagination = await verifyDownloadHistoryPagination({
      app,
      page,
      options,
      profile,
      fixture,
      initial,
      readInvokeTrace,
      capture,
      labels: {
        noResultsDescription: label("noResultsDescription"),
        pause: label("pause", active.filename),
        resume: label("resume", active.filename),
      },
      active,
    });
    await action(active, "cancel").click();
    await waitEntry(
      activeFile,
      (entry) => entry.state === "cancelled",
      "Fixture active download did not cancel during cleanup",
    );

    stage("ordinary-settings-entry-and-return-to-same-browser");
    await downloadsPage
      .getByRole("button", { name: label("back"), exact: true })
      .click();
    await capture("browser-settings");
    await page.locator("#browser-download-history button").click();
    await downloadsPage.waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    captures.ordinarySettingsEntry = true;
    const uiText = await downloadsPage.innerText();
    captures.noDirectoryInDownloadsUi =
      !uiText.includes(profile.root) && !uiText.includes(profile.downloads);
    await capture("settings-reopened");
    await page.getByTestId("settings-back-button").click();
    const finalWorkspace = await waitFor(
      options,
      () => readBrowserWorkspaceState(page),
      (state) =>
        state.webContentsId === initial.webContentsId &&
        state.tabId === initial.tabId,
      "Returning from downloads did not restore the original Browser view",
    );
    const nativeAfter = await nativeState(app, initial.webContentsId);
    captures.finalIdentity = finalWorkspace;
    captures.configRestored = await restoreSettings();
    const terminal = await stableSnapshot();
    const observed = await page.evaluate((key) => {
      const state = window[key];
      return { changed: state.changed, events: state.events };
    }, observerKey);
    const eventJson = JSON.stringify(observed.events);
    const events = observed.events.map((event) => ({
      downloadId: event.downloadId,
      state: event.state,
      filename: event.filename,
      browserSessionId: event.browserSessionId,
      threadId: event.threadId,
      tabId: event.tabId,
      viewId: event.viewId,
      webContentsId: event.webContentsId,
      ownerWebContentsId: event.ownerWebContentsId,
      windowId: event.windowId,
    }));
    const nativeEvents = await app.evaluate(
      (_electron, key) => globalThis[key].records,
      observerKey,
    );
    const trace = await readTrace(page, readInvokeTrace),
      invoke = downloadHistoryTraceEvidence(trace);
    const assertions = {
      realElectronAndPreload:
        bridge.electron && bridge.invoke && bridge.fallback === false,
      configUsesCurrentAppServerIpc:
        captures.config.realRead &&
        captures.config.realWrite &&
        captures.configRestored,
      nativeDownloadSourceMatchesOriginalView: fixture.files.every((file) =>
        nativeEvents.some(
          (event) =>
            event.state === "will-download" &&
            event.url === file.url &&
            event.sourceWebContentsId === initial.webContentsId,
        ),
      ),
      nativeDownloadEventsKeepCanonicalIdentity:
        events.length > 0 &&
        events.every(
          (event) =>
            event.browserSessionId === initial.sessionId &&
            event.threadId === identity.threadId &&
            event.tabId === initial.tabId &&
            event.viewId === initial.viewId &&
            event.webContentsId === initial.webContentsId &&
            event.ownerWebContentsId === nativeBefore.ownerWebContentsId &&
            event.windowId === nativeBefore.windowId,
        ),
      sameBrowserPageAndViewAfterSettings:
        ["sessionId", "threadId", "tabId", "viewId", "webContentsId"].every(
          (key) => finalWorkspace[key] === initial[key],
        ) && nativeAfter?.url === nativeBefore.url,
      filenameUrlSearchAndNoResults:
        captures.filenameSearch && captures.urlSearch && captures.noResults,
      missingFileUiAndByteIdenticalRecovery: Object.values(
        captures.missingFile.checks,
      ).every(Boolean),
      pausedThenResumedRealBytes:
        captures.paused.state === "paused" &&
        captures.resumed.receivedBytes > captures.paused.receivedBytes &&
        captures.cancelled.state === "cancelled",
      removePreservesDownloadedFile:
        captures.removedFile.matchesResponse &&
        !captures.afterRemove.page.entries.some(
          (entry) => entry.id === removed.id,
        ),
      clearRunsDirectlyWithoutConfirmation:
        captures.noClearConfirmation &&
        invoke.filter(
          (entry) =>
            entry.command === "browser_downloads_clear" &&
            entry.status === "success",
        ).length === 1,
      clearDisabledForOnlyActive: captures.clearDisabledForOnlyActive,
      allTimeHistoryHeading: captures.allTimeHeading,
      realNativeHistoryScrollPagination:
        captures.pagination.uniqueRenderedCount === 103 &&
        captures.pagination.sameNativeIds &&
        captures.pagination.realSecondPageIpc &&
        captures.pagination.actualFilesMatchResponses &&
        captures.pagination.removedRecordsPreserveAllFiles,
      continuousProgressDoesNotInvalidateHistory:
        captures.pagination.live.progressOnlyHistoryReads === 0 &&
        captures.pagination.live.nativeBytesAdvanced &&
        captures.pagination.live.visibleProgressTextChanged &&
        captures.pagination.live.pauseRefreshedBothPages,
      clearPreservesLiveAndRemovesTerminalOnly: Object.values(
        captures.clear,
      ).every(Boolean),
      clearDoesNotDeleteCompletedFiles: captures.filesAfterClear.every(
        (file) => file.exists && file.matchesResponse,
      ),
      activeDownloadContinuesAfterClear:
        captures.activeContinued.receivedBytes > activePaused.receivedBytes,
      persistedNativeHistoryMatchesPublicRead:
        captures.initial.diskMatches &&
        captures.afterRemove.diskMatches &&
        captures.afterClear.diskMatches &&
        terminal.diskMatches,
      liveChangedEventsArrived: observed.changed > 0,
      menuAndOrdinarySettingsEntriesWork:
        captures.ordinarySettingsEntry && screenshots.length >= 5,
      publicEventsAndUiExposeNoLocalPaths:
        !/savePath|downloadPath|filePath/u.test(eventJson) &&
        !eventJson.includes(profile.root) &&
        captures.noDirectoryInDownloadsUi,
      guiActionsUseRealIpc:
        ["pause", "resume", "cancel", "remove"].every((action) =>
          invoke.some(
            (entry) =>
              entry.command === "browser_downloads_action" &&
              entry.action === action &&
              entry.transport === "electron-ipc" &&
              entry.status === "success",
          ),
        ) &&
        invoke.some(
          (entry) =>
            entry.command === "browser_downloads_clear" &&
            entry.transport === "electron-ipc" &&
            entry.status === "success",
        ),
      noProductionMockFallback: !trace.some(
        (entry) =>
          entry.fallback === true || /mock/iu.test(String(entry.transport)),
      ),
      noRendererErrors: !consoleErrors.length && !pageErrors.length,
    };
    const failedAssertions = Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    return {
      schemaVersion: "lime.browser_runtime_electron.download_history.v1",
      scenario: "download-history",
      status: failedAssertions.length ? "fail" : "pass",
      generatedAt: new Date().toISOString(),
      proofLevel: "Real Electron native host",
      runtimeInferenceVerified: false,
      claimBoundary:
        "真实隔离 Electron、原生 DownloadItem 与本地 HTTP attachment、preload/IPC、current App Server 配置读写、下载管理菜单/设置入口、暂停/恢复/取消、搜索、终态移除、直接清理保留活动、102条真实下载的滚动分页、临时重命名后的文件失效GUI/恢复及实际文件字节验证。未运行模型推理，不是 RuntimeCore Gate B；未验证跨进程重启恢复下载、系统打开/定位、真实加载失败或其他平台。",
      pending: [
        "restart resume",
        "system open/reveal",
        "load failures",
        "other platforms",
      ],
      identity: {
        threadId: identity.threadId,
        conversationSessionId: identity.sessionId,
        browserSessionId: initial.sessionId,
        tabId: initial.tabId,
        viewId: initial.viewId,
        webContentsId: initial.webContentsId,
        workspaceId,
      },
      captures,
      nativeEvents,
      events,
      fixture: { requests: fixture.requests },
      screenshots,
      invoke,
      assertions,
      failedAssertions,
      diagnostics: { consoleErrors, pageErrors },
    };
  } catch (error) {
    await capture("failure").catch(() => undefined);
    const failure = {
      schemaVersion:
        "lime.browser_runtime_electron.download_history.failure.v1",
      status: "fail",
      error: sanitizeText(
        error instanceof Error ? error.message : String(error),
      ).replaceAll(profile.root, "[isolated-profile]"),
      captures,
      screenshots,
      consoleErrors,
      pageErrors,
    };
    await fs.writeFile(
      options.output.replace(/\.json$/u, "-failure.json"),
      `${JSON.stringify(failure, null, 2)}\n`,
    );
    throw error;
  } finally {
    await restoreSettings().catch(() => undefined);
    if (observersInstalled) {
      await page
        .evaluate((key) => {
          window[key]?.stops.forEach((stop) => stop());
          delete window[key];
        }, observerKey)
        .catch(() => undefined);
      await app
        .evaluate((_electron, key) => {
          globalThis[key]?.close();
          delete globalThis[key];
        }, observerKey)
        .catch(() => undefined);
    }
    page.off("console", onConsole);
    page.off("pageerror", onError);
    await fixture.close();
  }
}
