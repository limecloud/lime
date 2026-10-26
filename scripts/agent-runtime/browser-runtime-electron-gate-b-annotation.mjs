import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import { readConfigFromPage } from "../electron/mcp-config-fixture-smoke.mjs";
import { assert, sanitizeText } from "../lib/chat-fixture/utils.mjs";
import { isObservedPreloadAppServerResponse } from "../electron/lib/mcp-config-fixture-evidence.mjs";

import { annotationImageSummary } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
export {
  BROWSER_ANNOTATION_FINAL_MARKER,
  createBrowserAnnotationResponses,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
const PAGE_CHANNEL = "browser-annotation-page-event";
const EDITOR_CHANNEL = "lime:browser-annotation-editor";
import {
  observeBrowserAnnotationInputs,
  readBrowserAnnotationCommands,
  waitForBrowserAnnotationState as waitFor,
  readBrowserAnnotationNativeIdentity as nativeIdentity,
  waitForBrowserAnnotationNativePage as nativePage,
} from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import {
  runBrowserAnnotationDirectRejection,
  runBrowserAnnotationMainRejection,
} from "./browser-runtime-electron-gate-b-annotation-rejection.mjs";
import { observeBrowserAnnotationSubmission as submissionEvidence } from "./browser-runtime-electron-gate-b-annotation-submission.mjs";
import { runBrowserAnnotationActiveSubmissions } from "./browser-runtime-electron-gate-b-annotation-active.mjs";
import { runBrowserAnnotationFormTextScenario } from "./browser-runtime-electron-gate-b-annotation-form-text.mjs";
import { runBrowserAnnotationTextScenario } from "./browser-runtime-electron-gate-b-annotation-text.mjs";
import { runBrowserAnnotationFramesScenario } from "./browser-runtime-electron-gate-b-annotation-frames.mjs";

/** No permission rewrites, draft injection, bridge replacement or synthetic acceptance. */
export async function runBrowserAnnotationScenario(ctx) {
  const {
    app,
    page,
    options,
    identity,
    workspaceId,
    guiBeforeTurn,
    readBrowserWorkspaceState,
    readInvokeTrace,
    providerFixture,
  } = ctx;
  const locale = options.locale || "zh-CN";
  assert(
    ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].includes(locale),
    "Unsupported annotation fixture locale",
  );
  const labels = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${locale}/browserAnnotation.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const settingsLabels = JSON.parse(
    await fs.readFile(
      new URL(
        `../../src/i18n/resources/${locale}/settings.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const label = (name) => labels[`browserAnnotation.${name}`];
  const observerKey = `__browserAnnotationGateB_${randomUUID().replaceAll("-", "")}`;
  const initial = await readBrowserWorkspaceState(page);
  const bridge = await page.evaluate(() => ({
    electron: window.__LIME_ELECTRON__ === true,
    invoke: typeof window.electronAPI?.invoke === "function",
    fallback: window.electronAPI?.devBridgeFallback,
  }));
  assert(
    bridge.electron && bridge.invoke && bridge.fallback === false,
    "Annotation fixture requires real Electron preload",
  );
  assert(
    initial.threadId === identity.threadId &&
      initial.tabId === guiBeforeTurn.tabId,
    "Annotation initial identity drifted",
  );
  const screenshots = [],
    captures = {},
    consoleErrors = [],
    expectedConsoleErrors = [],
    pageErrors = [];
  const stage = (name) =>
    console.log(`[browser-runtime-annotation] stage=${name}`);
  const onConsole = (message) => {
    if (message.type() === "error")
      consoleErrors.push(sanitizeText(message.text()));
  };
  const onError = (error) => pageErrors.push(sanitizeText(error.message));
  const observedPages = new Set();
  const observePage = (target) => {
    if (observedPages.has(target)) return;
    observedPages.add(target);
    target.on("console", onConsole);
    target.on("pageerror", onError);
  };
  const capture = async (name, target) => {
    const directory = options.screenshotDir || path.dirname(options.output);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(
      directory,
      `${locale}-browser-annotation-${name}.png`,
    );
    assert(
      !screenshots.some((shot) => shot.file === file),
      `Duplicate annotation screenshot path: ${name}`,
    );
    const shot = await app.evaluate(async ({ webContents }, id) => {
      const image = await webContents.fromId(id).capturePage();
      return image.toPNG().toString("base64");
    }, target.native.webContentsId);
    await fs.writeFile(file, Buffer.from(shot, "base64"));
    screenshots.push({
      name,
      file,
      webContentsId: target.native.webContentsId,
      image: annotationImageSummary(`data:image/png;base64,${shot}`),
    });
  };
  const accessory = page.locator(
    '[data-testid="browser-annotation-accessory"]',
  );
  const chip = (body) =>
    accessory.getByRole("button", { name: body, exact: true });
  const focusOwner = async () => {
    await app.evaluate(({ app }) => app.focus({ steal: true }));
    const window = await app.browserWindow(page);
    await window.evaluate((owner) => {
      owner.show();
      owner.moveTop();
      owner.focus();
    });
    let focusedSamples = 0;
    await waitFor(
      options,
      () => window.evaluate((owner) => owner.isVisible() && owner.isFocused()),
      (focused) => {
        focusedSamples = focused ? focusedSamples + 1 : 0;
        return focusedSamples >= 2;
      },
      "Native annotation owner did not retain foreground focus",
    );
  };
  const fill = async (editor, body) => {
    await focusOwner();
    const input = editor.page.locator(
      '[data-testid="browser-annotation-composer"][role="textbox"]',
    );
    await input.fill(body);
    assert(
      (await input.getAttribute("contenteditable")) === "true",
      "Annotation body did not use the real Composer editor",
    );
    await input.press("End");
  };
  const editor = async () => {
    await focusOwner();
    const target = await nativePage(
      app,
      options,
      (url) => /\/browser-annotation\.html(?:[?#]|$)/u.test(url),
      "Native annotation editor did not appear",
    );
    observePage(target.page);
    await target.page
      .getByRole("dialog", { name: label("title"), exact: true })
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    assert(
      target.native.ownerWebContentsId === native.native.ownerWebContentsId &&
        target.native.windowId === native.native.windowId &&
        target.native.webContentsId !== initial.webContentsId,
      "Annotation editor escaped its native owner",
    );
    target.bridge = await target.page.evaluate(() => ({
      narrow:
        !!window.browserAnnotationEditor &&
        Object.keys(window.browserAnnotationEditor).sort().join(",") ===
          "act,onUpdate,ready",
      generalInvoke: typeof window.electronAPI?.invoke === "function",
      node:
        typeof window.require === "function" ||
        typeof window.process === "object",
    }));
    assert(
      target.bridge.narrow &&
        !target.bridge.generalInvoke &&
        !target.bridge.node,
      "Annotation editor exposed a general capability",
    );
    target.dialog = await target.page
      .getByRole("dialog")
      .evaluate((element) => ({
        editorId: element.getAttribute("data-editor-id"),
        generation: Number(element.getAttribute("data-generation")),
      }));
    return target;
  };
  let native;
  await observeBrowserAnnotationInputs(app, observerKey);
  const hasPicker = () =>
    native.page.evaluate(() => {
      const element = document.elementFromPoint(2, 2);
      return (
        element?.parentElement === document.documentElement &&
        element.style.cursor === "crosshair"
      );
    });
  const browse = async () => {
    const button = page.locator('[data-testid="browser-annotation-select"]');
    if ((await button.getAttribute("aria-pressed")) === "true")
      await button.click();
    await waitFor(
      options,
      hasPicker,
      (value) => !value,
      "Annotation mode did not exit to browsing",
    );
  };
  const beginSelection = async () => {
    await focusOwner();
    let lastBounds = "",
      stableBounds = 0;
    await waitFor(
      options,
      async () => (await nativeIdentity(app, initial.webContentsId))?.bounds,
      (bounds) => {
        const next = JSON.stringify(bounds);
        stableBounds = next === lastBounds ? stableBounds + 1 : 0;
        lastBounds = next;
        return bounds?.width > 0 && bounds.height > 0 && stableBounds >= 2;
      },
      "Native Browser layout did not settle before selection",
    );
    const button = page.locator('[data-testid="browser-annotation-select"]');
    if ((await button.getAttribute("aria-pressed")) !== "true")
      await button.click();
    await waitFor(
      options,
      hasPicker,
      Boolean,
      "Native annotation selection shield did not start",
    );
  };
  const selectHeading = async () => {
    // A real pointer hits the selection shield; locator.click would wait for it to disappear.
    const bounds = await native.page
      .getByRole("heading", { level: 1 })
      .boundingBox();
    assert(
      bounds?.width > 0 && bounds.height > 0,
      "Native fixture heading is not visible",
    );
    await native.page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  };
  const chooseScreenshotPreference = async (value) => {
    await page.getByTestId("app-sidebar-nav-settings").click();
    await page
      .getByTestId("settings-navigation")
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    await page.getByTestId("settings-sidebar-tab-browser-use").click();
    const preference = page.locator("#browser-annotation-screenshot button");
    await preference.click();
    const selectedLabel =
      settingsLabels[`settings.browser.screenshot.${value}`];
    await page
      .getByRole("menuitemradio", { name: selectedLabel, exact: true })
      .click();
    stage(`settings-${value}-selected`);
    await waitFor(
      options,
      async () => ({
        label: await preference.innerText(),
        disabled: await preference.isDisabled(),
      }),
      (snapshot) => snapshot.label === selectedLabel && !snapshot.disabled,
      "Screenshot preference did not persist",
    );
    const read = await readConfigFromPage(page);
    stage(`settings-${value}-config-read`);
    await page.getByTestId("settings-back-button").click();
    stage(`settings-${value}-back`);
    const restoredWorkspace = await waitFor(
      options,
      () => readBrowserWorkspaceState(page),
      (state) =>
        ["sessionId", "tabId", "threadId", "viewId", "webContentsId"].every(
          (key) => state[key] === initial[key],
        ),
      "Settings did not restore the original Browser identity",
    );
    captures.settingsReturns ??= [];
    captures.settingsReturns.push({
      preference: value,
      workspace: restoredWorkspace,
    });
    await capture(`settings-${value}-returned-renderer`, {
      native: { webContentsId: native.native.ownerWebContentsId },
    });
    await page
      .locator('[data-testid="browser-annotation-select"]')
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    return read;
  };
  try {
    native = await nativePage(
      app,
      options,
      (url) => url === initial.address,
      "Native fixture page was not exposed to Electron CDP",
    );
    assert(
      native.native.webContentsId === initial.webContentsId,
      "CDP page did not match the canonical Browser webContents",
    );
    observePage(native.page);
    observePage(page);
    ctx = { ...ctx, initial };
    if (
      ["annotation-text", "annotation-form-text", "annotation-frames"].includes(
        options.scenario,
      )
    ) {
      const runTextScenario =
        options.scenario === "annotation-frames"
          ? runBrowserAnnotationFramesScenario
          : options.scenario === "annotation-form-text"
            ? runBrowserAnnotationFormTextScenario
            : runBrowserAnnotationTextScenario;
      return await runTextScenario(ctx, {
        native,
        observerKey,
        beginSelection,
        browse,
        hasPicker,
        editor,
        fill,
        chip,
        label,
        capture,
        screenshots,
        consoleErrors,
        pageErrors,
        verifySubmission: (...args) => submissionEvidence(ctx, ...args),
      });
    }
    stage("element-select-save-reopen");
    await beginSelection();
    await selectHeading();
    const first = await editor();
    const prefix = `annotation-${randomUUID()}`;
    const elementBody = `${prefix} element saved`,
      editedBody = `${prefix} element edited`;
    await fill(first, elementBody);
    await capture("element-original-page", native);
    await capture("element-editor", first);
    await first.page
      .getByRole("button", { name: label("save"), exact: true })
      .click();
    await chip(elementBody).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    captures.saved = {
      bodyMarker: elementBody,
      editor: first.native,
      dialog: first.dialog,
      chipVisible: true,
    };
    await chip(elementBody).click();
    const reopened = await editor();
    assert(
      (await reopened.page
        .locator('[data-testid="browser-annotation-composer"]')
        .innerText()) === elementBody,
      "Reopened annotation body was not preserved",
    );
    assert(
      reopened.dialog.generation > first.dialog.generation,
      "Reopened native editor reused the old generation",
    );
    await fill(reopened, editedBody);
    await capture("element-reopened-edited", reopened);
    stage("direct-send-preaccept-rejection");
    captures.directRejection = await runBrowserAnnotationDirectRejection(ctx, {
      editor: reopened.page,
      chip: chip(editedBody),
      body: editedBody,
      label,
      consoleErrors,
      expectedConsoleErrors,
    });
    await capture("element-rejected-preserved", reopened);
    stage("direct-send-start");
    const requestsBeforeDirect = providerFixture.requests.length;
    await reopened.page
      .getByRole("button", { name: label("send"), exact: true })
      .click();
    await chip(editedBody).waitFor({
      state: "hidden",
      timeout: options.timeoutMs,
    });
    captures.direct = await submissionEvidence(ctx, editedBody, "element");
    captures.direct.newProviderRequests =
      providerFixture.requests.length - requestsBeforeDirect;
    captures.reopened = {
      editor: reopened.native,
      dialog: reopened.dialog,
      bodyPreserved: true,
    };

    stage("choose-necessary-screenshot-through-settings");
    const settingsBefore = await readConfigFromPage(page);
    const settingsAfter = await chooseScreenshotPreference("necessary");
    assert(
      settingsAfter.config?.browser?.annotation_screenshot === "necessary",
      "Necessary screenshot preference did not reach config/read",
    );
    captures.necessaryScreenshotPreference = {
      selectedThroughSettings: true,
      value: "necessary",
      otherBrowserSettingsPreserved: false,
      realConfigRead: isObservedPreloadAppServerResponse(
        settingsAfter.response?.ipcObservation,
        "config/read",
      ),
    };
    stage("region-capture-and-main-send");
    await beginSelection();
    const viewport = await native.page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    assert(
      viewport.width > 160 && viewport.height > 160,
      "Native Browser viewport too small for a real region drag",
    );
    // Start in whitespace; a drag beginning on text now follows the text-selection path.
    const rect = {
      x: 36,
      y: Math.min(200, viewport.height - 148),
      width: Math.min(180, viewport.width - 72),
      height: Math.min(112, viewport.height - 76),
    };
    await native.page.mouse.move(rect.x, rect.y);
    await native.page.mouse.down();
    await native.page.mouse.move(rect.x + rect.width, rect.y + rect.height, {
      steps: 8,
    });
    await native.page.mouse.up();
    const region = await editor();
    assert(
      (
        await region.page
          .locator('[data-testid="browser-annotation-selection"]')
          .innerText()
      ).includes(label("region")),
      "Dragging did not create a region selection",
    );
    const regionBody = `${prefix} region saved`,
      mainPrompt = `${prefix} main Composer`;
    await fill(region, regionBody);
    await capture("region-original-page", native);
    await capture("region-editor", region);
    await region.page
      .getByRole("button", { name: label("save"), exact: true })
      .click();
    await chip(regionBody).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    captures.mainRejection = await runBrowserAnnotationMainRejection(ctx, {
      chip: chip(regionBody),
      prompt: mainPrompt,
      consoleErrors,
      expectedConsoleErrors,
    });
    await capture("main-rejected-preserved", {
      native: { webContentsId: native.native.ownerWebContentsId },
    });
    await sendPromptFromGui(page, options, mainPrompt, {
      expectedSessionId: identity.sessionId,
    });
    await chip(regionBody).waitFor({
      state: "hidden",
      timeout: options.timeoutMs,
    });
    captures.main = await submissionEvidence(
      ctx,
      regionBody,
      "region",
      mainPrompt,
    );
    captures.region = {
      rect,
      viewport,
      editor: region.native,
      dialog: region.dialog,
    };

    stage("delete-saved-annotation");
    await beginSelection();
    await selectHeading();
    const removable = await editor(),
      deleteBody = `${prefix} delete saved`;
    await fill(removable, deleteBody);
    await removable.page
      .getByRole("button", { name: label("save"), exact: true })
      .click();
    await chip(deleteBody).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    const requestsBeforeDelete = providerFixture.requests.length;
    await chip(deleteBody)
      .locator("..")
      .getByRole("button", { name: label("remove"), exact: true })
      .click();
    await chip(deleteBody).waitFor({
      state: "hidden",
      timeout: options.timeoutMs,
    });
    captures.deleted = {
      chipRemoved: true,
      providerRequestsUnchanged:
        providerFixture.requests.length === requestsBeforeDelete,
    };
    stage("active-queue-and-steer");
    captures.active = await runBrowserAnnotationActiveSubmissions(ctx, {
      beginSelection,
      browse,
      hasPicker,
      selectHeading,
      editor,
      fill,
      chip,
      label,
      verifySubmission: (...args) => submissionEvidence(ctx, ...args),
      captureRenderer: (name) =>
        capture(name, {
          native: { webContentsId: native.native.ownerWebContentsId },
        }),
    });
    stage("restore-original-screenshot-preference-and-check-config");
    const restoredSettings = await chooseScreenshotPreference(
      settingsBefore.config?.browser?.annotation_screenshot ?? "always",
    );
    // BrowserConfig omits the complete default object, so compare after restoring the real preference.
    assert(
      JSON.stringify(settingsBefore.config?.browser ?? null) ===
        JSON.stringify(restoredSettings.config?.browser ?? null),
      "Screenshot preference changed Browser permissions or unrelated settings",
    );
    captures.necessaryScreenshotPreference.otherBrowserSettingsPreserved = true;
    captures.necessaryScreenshotPreference.originalPreferenceRestored = true;
    const nativeInputs = await app.evaluate(
      (_electron, key) => globalThis[key].records,
      observerKey,
    );
    const workspace = await readBrowserWorkspaceState(page);
    const trace = [
      ...(readInvokeTrace?.() ?? []),
      ...(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
      )),
    ];
    const commands = trace
      .filter((entry) => String(entry.command).startsWith("browser_tab_"))
      .map((entry) => ({
        command: entry.command,
        transport: entry.transport,
        status: entry.status,
      }));
    const assertions = {
      realElectronAndPreload:
        bridge.electron && bridge.invoke && bridge.fallback === false,
      sameCanonicalBrowserIdentity: [
        "sessionId",
        "tabId",
        "threadId",
        "viewId",
        "webContentsId",
      ].every((key) => workspace[key] === initial[key]),
      nativeSelectionFromOriginalMainFrame:
        nativeInputs.filter(
          (entry) =>
            entry.channel === PAGE_CHANNEL && entry.kind === "selection",
        ).length === 5 &&
        nativeInputs
          .filter((entry) => entry.channel === PAGE_CHANNEL)
          .every(
            (entry) =>
              entry.senderId === initial.webContentsId && entry.mainFrame,
          ),
      trustedEditorMainFrameActions: ["change", "save", "send"].every(
        (action) =>
          nativeInputs.some(
            (entry) =>
              entry.channel === EDITOR_CHANNEL &&
              entry.action === action &&
              entry.mainFrame &&
              entry.senderId !== initial.webContentsId,
          ),
      ),
      saveReopenAndEdit:
        captures.reopened.bodyPreserved &&
        captures.reopened.dialog.generation > captures.saved.dialog.generation,
      directStartTextImageAccepted:
        captures.direct.failedAssertions.length === 0 &&
        captures.direct.newProviderRequests > 0,
      directFailurePreservedAndRetryAccepted:
        Object.values(captures.directRejection).every(
          (value) => value === true,
        ) && captures.direct.failedAssertions.length === 0,
      mainSendTextImageAccepted: captures.main.failedAssertions.length === 0,
      mainFailurePreservedAndRetryAccepted:
        Object.values(captures.mainRejection).every(
          (value) => value === true,
        ) && captures.main.failedAssertions.length === 0,
      activeQueueAndSteerTextImageAccepted: [
        captures.active.queue,
        captures.active.steer,
      ].every((value) => value.failedAssertions.length === 0),
      visibleScreenshotMatchesAllSubmissionTargets: [
        captures.direct,
        captures.main,
        captures.active.queue,
        captures.active.steer,
      ].every(
        (value) =>
          value.messagePreview.visible &&
          value.messagePreview.image?.sha256 === value.image?.sha256,
      ),
      differentCanonicalTurnsSameThread:
        !!captures.direct.turnId &&
        captures.direct.turnId !== captures.main.turnId &&
        captures.direct.threadId === captures.main.threadId,
      regionNecessaryScreenshotCropped:
        captures.necessaryScreenshotPreference.selectedThroughSettings &&
        captures.necessaryScreenshotPreference.realConfigRead &&
        captures.necessaryScreenshotPreference.otherBrowserSettingsPreserved &&
        captures.main.screenshotKind === "crop" &&
        !!captures.main.screenshotCrop &&
        captures.main.screenshotCrop.x <= captures.region.rect.x &&
        captures.main.screenshotCrop.y <= captures.region.rect.y &&
        captures.main.screenshotCrop.x + captures.main.screenshotCrop.width >=
          captures.region.rect.x + captures.region.rect.width &&
        captures.main.screenshotCrop.y + captures.main.screenshotCrop.height >=
          captures.region.rect.y + captures.region.rect.height &&
        captures.main.screenshotCrop.width < captures.region.viewport.width &&
        captures.main.screenshotCrop.height < captures.region.viewport.height,
      deleteSavedDraftWithoutSending:
        captures.deleted.chipRemoved &&
        captures.deleted.providerRequestsUnchanged,
      annotationCommandsUseRealIpc: [
        "browser_tab_begin_annotation",
        "browser_tab_capture_annotation",
        "browser_tab_show_annotation_editor",
        "browser_tab_close_annotation_editor",
      ].every((command) =>
        commands.some(
          (entry) =>
            entry.command === command &&
            entry.transport === "electron-ipc" &&
            entry.status === "success",
        ),
      ),
      noProductionMockFallback: !trace.some(
        (entry) =>
          entry.fallback === true ||
          entry.transport === "mock" ||
          /mock.fallback/iu.test(String(entry.transport)),
      ),
      noRendererErrors: consoleErrors.length === 0 && pageErrors.length === 0,
      separateOriginalPageAndEditorScreenshots:
        screenshots.some(
          (shot) =>
            shot.name === "region-original-page" &&
            shot.webContentsId === initial.webContentsId,
        ) &&
        screenshots.some(
          (shot) =>
            shot.name === "region-editor" &&
            shot.webContentsId !== initial.webContentsId,
        ),
    };
    const failedAssertions = Object.entries(assertions)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    return {
      schemaVersion: "lime.browser_runtime_electron_gate_b.annotation.v1",
      scenario: "annotation",
      status: failedAssertions.length ? "fail" : "pass",
      generatedAt: new Date().toISOString(),
      proofLevel: "Gate B-F",
      claimBoundary:
        "真实 Lime Electron、原生网页元素/区域选择、capture、可信 Composer 编辑器、保存/重开/编辑/删除、直接发送与主Composer拒绝/保留/恢复后重试、active queue/steer、preload/IPC、App Server JSON-RPC、RuntimeCore、canonical Thread/Turn/Item 和本地 provider 接收 text+image。provider 使用显式测试夹具；未验证 live provider、Design Tweaks、进程重启或其他平台。",
      pending: [
        "continuous selection and scroll following",
        "multiple anchors",
        "Design Tweaks",
        "manual image attachments",
        "rich history recovery",
        "five-locale visual comparison",
        "packaged macOS/Windows",
      ],
      identity: {
        ...initial,
        workspaceId,
        conversationSessionId: identity.sessionId,
      },
      returnedWorkspace: workspace,
      captures,
      screenshots,
      nativeInputs,
      nativeCommands: await readBrowserAnnotationCommands(app, observerKey),
      invoke: { commands },
      assertions,
      failedAssertions,
      diagnostics: { consoleErrors, expectedConsoleErrors, pageErrors },
    };
  } catch (error) {
    await capture("failure-renderer", {
      native: { webContentsId: native?.native.ownerWebContentsId },
    }).catch(() => undefined);
    const failure = {
      schemaVersion:
        "lime.browser_runtime_electron_gate_b.annotation.failure.v1",
      status: "fail",
      error: sanitizeText(
        error instanceof Error ? error.message : String(error),
      ),
      stack: error instanceof Error ? sanitizeText(error.stack) : null,
      identity: { ...initial, workspaceId },
      captures,
      screenshots,
      consoleErrors,
      expectedConsoleErrors,
      pageErrors,
      nativeCommands: await readBrowserAnnotationCommands(app, observerKey),
      invokeTrace: readInvokeTrace?.() ?? [],
      nativeInputs: await app
        .evaluate(
          (_electron, key) => globalThis[key]?.records ?? [],
          observerKey,
        )
        .catch(() => []),
    };
    await fs.writeFile(
      options.output.replace(/\.json$/u, "-failure.json"),
      `${JSON.stringify(failure, null, 2)}\n`,
    );
    throw error;
  } finally {
    await app
      .evaluate((_electron, key) => {
        globalThis[key]?.close();
        delete globalThis[key];
      }, observerKey)
      .catch(() => undefined);
    for (const target of observedPages) {
      target.off("console", onConsole);
      target.off("pageerror", onError);
    }
  }
}
