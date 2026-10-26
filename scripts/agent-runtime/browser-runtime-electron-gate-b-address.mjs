import fs from "node:fs/promises";
import path from "node:path";
import {
  assert,
  sanitizeText,
  sleep,
} from "../lib/chat-fixture/utils.mjs";

/** Address UI on the real browser owner; page navigation is an external stimulus. */
export async function runBrowserAddressScenario({
  app,
  page,
  options,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const assertions = {};
  const flows = [];
  const ownerWebContentsId = await (
    await app.browserWindow(page)
  ).evaluate((window) => window.webContents.id);
  const waitForTrace = async (predicate) => {
    const deadline = Date.now() + Math.min(options.timeoutMs, 20000);
    do {
      const trace = await readInvokeTrace();
      if (predicate(trace)) return trace;
      await sleep(100);
    } while (Date.now() < deadline);
    throw new Error(
      "address IPC evidence collector did not observe completed calls",
    );
  };
  const address = page.getByTestId("browser-workspace-address");
  const readInput = () =>
    address.evaluate((input) => ({
      value: input.value,
      focused: document.activeElement === input,
      start: input.selectionStart,
      end: input.selectionEnd,
      dir: input.dir,
      documentFocused: document.hasFocus(),
      activeTag: document.activeElement?.tagName,
      activeTestId: document.activeElement?.getAttribute("data-testid"),
    }));
  const native = () =>
    app.evaluate(
      async ({ webContents, BrowserWindow }, { id, ownerId }) => {
        const wc = webContents.fromId(id);
        const owner = webContents.fromId(ownerId);
        const window = owner ? BrowserWindow.fromWebContents(owner) : null;
        const view = window?.contentView.children.find(
          (child) => child.webContents?.id === id,
        );
        return wc && !wc.isDestroyed()
          ? {
              id: wc.id,
              url: wc.getURL(),
              title: wc.getTitle(),
              focused: wc.isFocused(),
              ownerFocused: owner?.isFocused(),
              windowFocused: window?.isFocused(),
              windowVisible: window?.isVisible(),
              viewVisible: view?.getVisible(),
              sandbox: await wc.executeJavaScript(
                "({ require: typeof require, bridge: typeof window.electronAPI })",
              ),
            }
          : null;
      },
      { id: guiBeforeTurn.webContentsId, ownerId: ownerWebContentsId },
    );
  const waitNativeFocus = async () => {
    const deadline = Date.now() + Math.min(options.timeoutMs, 10000);
    let actual;
    do {
      actual = await native();
      if (actual?.focused) return actual;
      await sleep(100);
    } while (Date.now() < deadline);
    flows.push({
      name: "native-focus-timeout",
      native: actual,
      input: await readInput(),
      focusTrace: (await readInvokeTrace())
        .filter((entry) => entry.command === "browser_tab_focus_page")
        .map(({ command, transport, status, args_preview }) => ({
          command,
          transport,
          status,
          args_preview,
        })),
    });
    throw new Error(
      `address submit did not focus the native page: ${JSON.stringify(actual)}`,
    );
  };
  const navigatePage = (url) =>
    app.evaluate(
      async ({ webContents }, { id, url }) => {
        const wc = webContents.fromId(id);
        if (!wc || wc.isDestroyed()) throw new Error("native browser missing");
        await wc.loadURL(url);
      },
      { id: guiBeforeTurn.webContentsId, url },
    );
  const waitUrl = async (url, focused) => {
    await page.waitForFunction(
      ({ url, focused }) => {
        const input = document.querySelector(
          '[data-testid="browser-workspace-address"]',
        );
        return (
          input &&
          (document.activeElement === input) === focused &&
          input.value === (focused ? url : new URL(url).host)
        );
      },
      { url, focused },
    );
  };
  const capture = async (name) => {
    const state = {
      name,
      input: await readInput(),
      native: await native(),
      gui: await readBrowserWorkspaceState(page),
    };
    const file = path.join(path.dirname(options.output), `${name}.png`);
    await page.screenshot({ path: file });
    flows.push({ ...state, screenshotPath: file });
    return state;
  };
  try {
    const original = await native();
    assert(original, "native browser missing");
    const initialGui = await readBrowserWorkspaceState(page);
    assert(
      initialGui.viewId &&
        initialGui.tabId === guiBeforeTurn.tabId &&
        initialGui.threadId === guiBeforeTurn.threadId &&
        initialGui.webContentsId === original.id,
      "address fixture requires the complete initial native identity",
    );
    const foregroundPreparation = await app.evaluate(
      ({ app, BrowserWindow }, id) => {
        const window = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.webContents.id === id,
        );
        if (!window?.isVisible()) return { requested: false };
        app.focus({ steal: true });
        window.focus();
        return { requested: true };
      },
      ownerWebContentsId,
    );
    if (foregroundPreparation.requested) {
      const deadline = Date.now() + Math.min(options.timeoutMs, 30000);
      while (!(await native()).windowFocused) {
        if (Date.now() >= deadline) {
          flows.push({
            name: "foreground-window-preparation-failed",
            native: await native(),
          });
          throw new Error(
            "visible focus fixture could not activate its own window",
          );
        }
        await sleep(100);
      }
    }
    flows.push({
      name: "foreground-window-preparation",
      ...foregroundPreparation,
    });
    const initialUrl = original.url;
    const nextUrl = new URL("/browser-runtime-gate-b-user", initialUrl).href;
    await address.click();
    const focused = await readInput();
    assertions.focusShowsAndSelectsFullUrl =
      focused.focused &&
      focused.value === initialUrl &&
      focused.start === 0 &&
      focused.end === initialUrl.length;
    assertions.addressDirectionLtr = focused.dir === "ltr";

    await address.fill("unfinished search");
    await address.evaluate((input) => input.setSelectionRange(4, 4));
    await app.evaluate(async ({ webContents }, id) => {
      await webContents
        .fromId(id)
        .executeJavaScript('document.title = "Address projection updated"');
    }, guiBeforeTurn.webContentsId);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="workspace-right-surface-tabs"]')
        ?.textContent?.includes("Address projection updated"),
    );
    const titleUpdate = await capture("draft-after-title-update");
    assertions.titleProjectionKeepsDraftAndCaret =
      titleUpdate.input.focused &&
      titleUpdate.input.value === "unfinished search" &&
      titleUpdate.input.start === 4 &&
      titleUpdate.native.title === "Address projection updated";

    await navigatePage(nextUrl);
    await waitUrl(nextUrl, false);
    const canceled = await capture("external-navigation-cancels-edit");
    assertions.navigationCancelsEditedFocus =
      !canceled.input.focused &&
      canceled.input.value === new URL(nextUrl).host &&
      canceled.native.url === nextUrl;

    await address.click();
    await navigatePage(initialUrl);
    await waitUrl(initialUrl, true);
    assertions.pristineFocusFollowsNativeUrl =
      (await readInput()).value === initialUrl;

    await address.fill("https://example.com/old?x=1");
    const pasted = await address.evaluate((input) => {
      input.setSelectionRange(20, 23);
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "新 路径");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    const paste = await readInput();
    assertions.pasteReplacesSelectionAndRestoresCaret =
      pasted &&
      paste.value === "https://example.com/新 路径?x=1" &&
      paste.start === 24 &&
      paste.end === 24;
    assertions.pasteDoesNotNavigate = (await native()).url === initialUrl;
    await address.press("Escape");
    await waitUrl(initialUrl, false);
    assertions.escapeCancels = !(await readInput()).focused;

    await address.click();
    await address.fill("cancel on blur");
    await address.evaluate((input) => input.blur());
    await address.click();
    assertions.refocusRestoresActualUrl =
      (await readInput()).value === initialUrl;

    await address.fill("中文查询");
    const ime = await address.evaluate((input) => {
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(enter);
      input.closest("form").requestSubmit();
      return enter.defaultPrevented;
    });
    assertions.imeConfirmationDoesNotNavigate =
      ime && (await native()).url === initialUrl;
    await address.evaluate((input) =>
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await address.fill(nextUrl);
    await address.press("Enter");
    await waitUrl(nextUrl, false);
    await waitNativeFocus();
    const submitted = await capture("submitted-address");
    assertions.normalEnterNavigatesSameNativeTab =
      submitted.native.url === nextUrl &&
      submitted.native.id === original.id &&
      submitted.gui.tabId === guiBeforeTurn.tabId &&
      submitted.gui.threadId === guiBeforeTurn.threadId;
    assertions.newAddressFocusesOriginalNativePage = submitted.native.focused;

    const nativeKeyboard = await app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.fromId(id);
      if (!wc || wc.isDestroyed()) throw new Error("native browser missing");
      await wc.executeJavaScript(`
        window.__browserAddressKeyEvidence = null;
        window.addEventListener("keydown", function record(event) {
          if (event.key !== "F8") return;
          window.__browserAddressKeyEvidence = { key: event.key, trusted: event.isTrusted };
          window.removeEventListener("keydown", record);
        });
      `);
      wc.sendInputEvent({ type: "keyDown", keyCode: "F8" });
      wc.sendInputEvent({ type: "keyUp", keyCode: "F8" });
      const deadline = Date.now() + 5000;
      do {
        const event = await wc.executeJavaScript(
          "window.__browserAddressKeyEvidence",
        );
        if (event) return { event, id: wc.id, focused: wc.isFocused() };
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      throw new Error("native page did not receive the trusted keyboard event");
    }, original.id);
    flows.push({ name: "submitted-native-keyboard", ...nativeKeyboard });
    assertions.focusedNativePageReceivesTrustedKeyboard =
      nativeKeyboard.focused &&
      nativeKeyboard.id === original.id &&
      nativeKeyboard.event.key === "F8" &&
      nativeKeyboard.event.trusted;

    const beforeReload = await readInvokeTrace();
    await address.click();
    await address.press("Enter");
    await waitNativeFocus();
    assertions.unchangedAddressReloadFocusesPage = !(await readInput()).focused;
    await page.waitForFunction(() => {
      const entries = JSON.parse(
        localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
      );
      return entries.some(
        (entry) =>
          entry.command === "browser_tab_reload" && entry.status === "success",
      );
    });
    const success = (entries, command) =>
      entries.filter(
        (entry) =>
          entry.command === command &&
          entry.status === "success" &&
          entry.transport === "electron-ipc",
      );
    const trace = await waitForTrace(
      (entries) =>
        success(entries, "browser_tab_reload").length >
          success(beforeReload, "browser_tab_reload").length &&
        success(entries, "browser_tab_focus_page").length >= 2 &&
        success(entries, "browser_tab_navigate").some(
          (entry) =>
            entry.args_preview?.tabId === guiBeforeTurn.tabId &&
            entry.args_preview?.url === nextUrl,
        ),
    );
    assertions.unchangedAddressReloads =
      success(trace, "browser_tab_reload").length >
      success(beforeReload, "browser_tab_reload").length;
    assertions.addressNavigationUsesProductionIpc = success(
      trace,
      "browser_tab_navigate",
    ).some(
      (entry) =>
        entry.args_preview?.tabId === guiBeforeTurn.tabId &&
        entry.args_preview?.url === nextUrl,
    );
    assertions.pageFocusUsesExactNativeIdentityAndProductionIpc = success(
      trace,
      "browser_tab_focus_page",
    ).some(
      (entry) =>
        entry.args_preview?.tabId === guiBeforeTurn.tabId &&
        entry.args_preview?.viewId === initialGui.viewId &&
        entry.args_preview?.webContentsId === original.id,
    );
    assertions.appServerIdentityUsesProductionBridge =
      success(trace, "app_server_handle_json_lines").length > 0;
    assertions.noMockFallback = !trace.some(
      (entry) => entry.transport === "mock" || entry.fallback === true,
    );
    const final = await native();
    assertions.pageRemainsSandboxed =
      final.sandbox.require === "undefined" &&
      final.sandbox.bridge === "undefined";
    const hiddenHost = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence ?? null,
    );
    assertions.realHostPresentation =
      hiddenHost?.visibilityOnly === true &&
      hiddenHost.unexpectedShowEvents === 0 &&
      (hiddenHost.visible
        ? hiddenHost.showEvents > 0
        : hiddenHost.showEvents === 0) &&
      hiddenHost.preloadErrors.length === 0;
    return {
      scenario: "address-input",
      input:
        "Playwright pointer/fill/keyboard; native WCV sendInputEvent keyboard sensor; synthetic ClipboardEvent and CompositionEvent in real Electron, not physical OS input or native IME",
      claimBoundary:
        "Renderer editing, same WCV navigation and native focus through production IPC; App Server identity initialized, no Agent turn or physical OS keyboard routing claim",
      assertions,
      failedAssertions: Object.keys(assertions).filter(
        (key) => !assertions[key],
      ),
      flows,
      initial: { gui: initialGui, native: original },
      focusTrace: success(trace, "browser_tab_focus_page").map(
        ({ command, transport, status, args_preview }) => ({
          command,
          transport,
          status,
          args_preview,
        }),
      ),
      invokeTrace: trace.map(({ command, transport, status }) => ({
        command,
        transport,
        status,
      })),
      screenshotBoundary: "Renderer only; not OS-composited WCV",
      diagnostics: { hiddenHost },
    };
  } catch (error) {
    await fs.writeFile(
      options.output,
      JSON.stringify(
        {
          scenario: "address-input",
          status: "fail",
          assertions,
          flows,
          error: sanitizeText(error),
          input: await readInput().catch(() => null),
          native: await native().catch(() => null),
          gui: await readBrowserWorkspaceState(page).catch(() => null),
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  }
}
