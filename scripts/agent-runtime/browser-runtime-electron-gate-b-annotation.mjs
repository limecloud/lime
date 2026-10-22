import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { invokeAppServerFromPage } from "./claw-chat-current-fixture-rpc.mjs";
import { sendPromptFromGui } from "./claw-chat-current-fixture-gui-actions.mjs";
import {
  appServerCallFromPage,
  readConfigFromPage,
} from "../electron/mcp-config-fixture-smoke.mjs";
import { APP_SERVER_METHOD_SESSION_READ } from "./claw-chat-current-fixture-constants.mjs";
import {
  assert,
  sanitizeText,
  sleep,
} from "./claw-chat-current-fixture-utils.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../electron/lib/mcp-config-fixture-evidence.mjs";

import {
  annotationImageSummary,
  annotationTextOf as textOf,
  summarizeBrowserAnnotationSubmission,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
export {
  BROWSER_ANNOTATION_FINAL_MARKER,
  createBrowserAnnotationResponses,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
const PAGE_CHANNEL = "browser-annotation-page-event";
const EDITOR_CHANNEL = "lime:browser-annotation-editor";

async function waitFor(options, read, predicate, description) {
  const deadline = Date.now() + options.timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(options.intervalMs);
  }
  throw new Error(`${description}: ${JSON.stringify(last)}`);
}

async function observeNativeInputs(app, key) {
  await app.evaluate(
    ({ ipcMain }, { key, channels }) => {
      const records = [];
      const listeners = channels.map((channel) => {
        const listener = (event, value) => {
          if (!value || typeof value !== "object") return;
          records.push({
            channel,
            senderId: event.sender.id,
            senderUrl: event.sender.getURL(),
            mainFrame: event.senderFrame === event.sender.mainFrame,
            kind: value.kind ?? value.type,
            action: value.action ?? null,
            annotationId: value.annotationId ?? null,
            editorId: value.editorId ?? null,
            generation: value.generation ?? null,
            revision: value.revision ?? null,
            bodyLength:
              typeof value.body === "string" ? value.body.length : null,
          });
        };
        ipcMain.on(channel, listener);
        return { channel, listener };
      });
      globalThis[key] = {
        records,
        close: () =>
          listeners.forEach(({ channel, listener }) =>
            ipcMain.off(channel, listener),
          ),
      };
    },
    { key, channels: [PAGE_CHANNEL, EDITOR_CHANNEL] },
  );
}

async function nativeIdentity(app, webContentsId) {
  return app.evaluate(({ BrowserWindow, webContents }, id) => {
    const target = webContents.fromId(id);
    if (!target || target.isDestroyed()) return null;
    const find = (view) =>
      view.webContents?.id === id
        ? view
        : view.children.map(find).find(Boolean);
    const window = BrowserWindow.getAllWindows().find((window) =>
      find(window.contentView),
    );
    const view = window ? find(window.contentView) : null;
    return {
      webContentsId: target.id,
      url: target.getURL(),
      windowId: window?.id ?? null,
      ownerWebContentsId: window?.webContents.id ?? null,
      bounds: view?.getBounds() ?? null,
    };
  }, webContentsId);
}

async function nativePage(app, options, predicate, description) {
  return waitFor(
    options,
    async () => {
      for (const candidate of app.context().pages()) {
        if (candidate.isClosed() || !predicate(candidate.url())) continue;
        const cdp = await app.context().newCDPSession(candidate);
        try {
          const { targetInfo } = await cdp.send("Target.getTargetInfo");
          const id = await app.evaluate(
            ({ webContents }, targetId) =>
              webContents.fromDevToolsTargetId(targetId)?.id ?? null,
            targetInfo.targetId,
          );
          if (id)
            return { page: candidate, native: await nativeIdentity(app, id) };
        } finally {
          await cdp.detach();
        }
      }
      return null;
    },
    (value) => !!value?.native?.bounds,
    description,
  );
}

async function readCanonical(page, requestLog, threadId) {
  return invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_SESSION_READ,
    { threadId, includeTurns: true },
    requestLog,
  );
}

async function submissionEvidence(ctx, body, kind, mainPrompt = "") {
  const {
    page,
    options,
    identity,
    requestLog,
    providerFixture,
    readInvokeTrace,
    initial,
  } = ctx;
  const canonical = await waitFor(
    options,
    () => readCanonical(page, requestLog, identity.threadId),
    (read) =>
      read.result?.thread?.turns?.some(
        (turn) =>
          ["completed", "complete"].includes(
            String(turn.status).toLowerCase(),
          ) &&
          turn.items?.some(
            (item) =>
              item.type === "userMessage" &&
              textOf(item.content).includes(body),
          ),
      ),
    "Annotation canonical turn did not complete",
  );
  const turn = canonical.result.thread.turns.findLast((turn) =>
    turn.items?.some(
      (item) =>
        item.type === "userMessage" && textOf(item.content).includes(body),
    ),
  );
  const item = turn.items.find(
    (item) =>
      item.type === "userMessage" && textOf(item.content).includes(body),
  );
  const uri = item.content.find((part) => part.type === "image")?.url;
  assert(uri, "Annotation user item has no canonical image");
  const mediaRead = await appServerCallFromPage(page, "media/read", {
    threadId: identity.threadId,
    uri,
    offset: 0,
    length: 8_388_608,
  });
  const trace = await waitFor(
    options,
    async () => {
      const latest = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
      );
      return [...(readInvokeTrace?.() ?? []), ...latest];
    },
    (trace) =>
      parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace)).some(
        (entry) =>
          entry.method === "turn/start" &&
          entry.params.input?.some((part) => part.text?.includes(body)),
      ),
    "Annotation turn/start trace missing",
  );
  return summarizeBrowserAnnotationSubmission({
    trace,
    canonical: canonical.result,
    providerRequests: providerFixture.requests,
    body,
    threadId: identity.threadId,
    pageUrl: initial.address,
    kind,
    mediaRead,
    mainPrompt,
  });
}

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
  const fill = async (editor, body) => {
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
  await observeNativeInputs(app, observerKey);
  const beginSelection = async () => {
    const count = () =>
      app.evaluate(
        (_electron, key) =>
          globalThis[key].records.filter(
            (entry) =>
              entry.channel === "browser-annotation-page-event" &&
              entry.kind === "began",
          ).length,
        observerKey,
      );
    const before = await count();
    await page.locator('[data-testid="browser-annotation-select"]').click();
    await waitFor(
      options,
      count,
      (value) => value > before,
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
    await page.getByTestId("settings-back-button").click();
    // The first annotation turn can rename the thread; reopen its canonical identity.
    await page.locator(
      `[data-testid="app-sidebar-conversation-open"][data-session-id="${identity.sessionId}"]`,
    ).click();
    await page.locator(
      `[data-testid="composer-editor"][data-session-id="${identity.sessionId}"]`,
    ).waitFor({ state: "visible", timeout: options.timeoutMs });
    stage("reopen-browser-panel-after-settings");
    await page.getByTestId("thread-side-panel-toggle").click();
    await page.getByTestId("side-panel-new-tab-browser").click();
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
    const rect = {
      x: 36,
      y: 38,
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
        ).length === 3 &&
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
      mainSendTextImageAccepted: captures.main.failedAssertions.length === 0,
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
        "真实 Lime Electron、原生网页元素/区域选择、capture、可信 Composer 编辑器、保存/重开/编辑/删除、direct start 与主 Composer send、preload/IPC、App Server JSON-RPC、RuntimeCore、canonical Thread/Turn/Item 和本地 provider 接收 text+image。provider 使用显式测试夹具；未验证 live provider、失败保留、queue、steer、Design Tweaks、进程重启或其他平台。",
      pending: [
        "main/direct pre-accept failure preservation",
        "queue",
        "steer",
        "Design Tweaks",
      ],
      identity: {
        ...initial,
        workspaceId,
        conversationSessionId: identity.sessionId,
      },
      captures,
      screenshots,
      nativeInputs,
      invoke: { commands },
      assertions,
      failedAssertions,
      diagnostics: { consoleErrors, pageErrors },
    };
  } catch (error) {
    const failure = {
      schemaVersion:
        "lime.browser_runtime_electron_gate_b.annotation.failure.v1",
      status: "fail",
      error: sanitizeText(
        error instanceof Error ? error.message : String(error),
      ),
      identity: { ...initial, workspaceId },
      captures,
      screenshots,
      consoleErrors,
      pageErrors,
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
