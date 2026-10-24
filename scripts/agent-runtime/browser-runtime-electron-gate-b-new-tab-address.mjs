import fs from "node:fs/promises";
import path from "node:path";
import {
  assert,
  sanitizeText,
  sleep,
} from "./claw-chat-current-fixture-utils.mjs";

/** Real New tab drafts and navigation; no injected tab state or Agent turn. */
export async function runBrowserNewTabAddressScenario({
  app,
  page,
  options,
  guiBeforeTurn,
  readBrowserWorkspaceState,
  readInvokeTrace,
}) {
  const assertions = {};
  const flows = [];
  const address = page.locator(
    '[data-testid="browser-new-tab-address"]:visible',
  );
  const newTabs = page.getByTestId(
    "workspace-right-surface-tab-workspace-new-tab",
  );
  const selectedNewTab = page.locator(
    '[data-testid="workspace-right-surface-tab-workspace-new-tab"][aria-selected="true"]',
  );
  const listTabs = () =>
    page.evaluate(
      async (scope) =>
        window.electronAPI.invoke("browser_tab_list", {
          browserSessionId: scope.sessionId,
          threadId: scope.threadId,
        }),
      guiBeforeTurn,
    );
  const waitFor = async (read, predicate, label) => {
    const deadline = Date.now() + Math.min(options.timeoutMs, 20000);
    let actual;
    do {
      actual = await read();
      if (predicate(actual)) return actual;
      await sleep(100);
    } while (Date.now() < deadline);
    throw new Error(`${label}: ${JSON.stringify(actual)}`);
  };
  const inputState = () =>
    address.evaluate((input) => ({
      value: input.value,
      focused: document.activeElement === input,
      invalid: input.getAttribute("aria-invalid"),
    }));
  const capture = async (name) => {
    const screenshotPath = path.join(
      path.dirname(options.output),
      `${name}.png`,
    );
    await page.screenshot({ path: screenshotPath });
    flows.push({ name, input: await inputState(), screenshotPath });
  };
  const add = async () => {
    await page.getByTestId("workspace-right-surface-new-tab").click();
    await address.waitFor({ state: "visible" });
    const id = await selectedNewTab.getAttribute("id");
    assert(id, "New tab has no source identity");
    return id;
  };
  const select = (id) => page.locator(`[id="${id}"]`).click();
  const close = (id) =>
    page
      .locator(`[id="${id}"]`)
      .locator("..")
      .getByTestId("workspace-right-surface-tab-close")
      .click();
  try {
    const original = await readBrowserWorkspaceState(page);
    const before = await listTabs();
    assert(
      before.length === 1,
      "New tab fixture requires one original native page",
    );
    const first = await add();
    const draft = "  localhost:5173/尚未提交  ";
    await address.fill(draft);
    const firstInput = await address.elementHandle();
    const second = await add();
    assertions.separateNewTabStartsEmpty = (await address.inputValue()) === "";
    const secondDraft = "second.example/未提交";
    await address.fill(secondDraft);
    await select(first);
    assertions.switchRestoresExactDraft =
      (await address.inputValue()) === draft;
    assertions.editingDoesNotCreateNativePages =
      (await listTabs()).length === before.length;
    await capture("first-draft-before-collapse");

    const toggle = page.getByTestId("thread-side-panel-toggle");
    await toggle.click();
    await address.waitFor({ state: "hidden" });
    flows.push({
      name: "collapsed-presentation",
      inputStillConnected: await firstInput.evaluate(
        (input) => input.isConnected,
      ),
    });
    await toggle.click();
    await address.waitFor({ state: "visible" });
    assertions.restoredAddressKeepsSourceIdentity =
      (await selectedNewTab.getAttribute("id")) === first;
    assertions.restoredAddressKeepsExactDraft =
      (await address.inputValue()) === draft;
    await capture("draft-restored-after-remount");

    await address.press("Escape");
    const canceled = await inputState();
    assertions.escapeClearsDraftAndBlurs =
      canceled.value === "" && !canceled.focused;
    await select(second);
    assertions.cancelDoesNotClearOtherTab =
      (await address.inputValue()) === secondDraft;
    await select(first);
    assertions.canceledDraftDoesNotReappear =
      (await address.inputValue()) === "";
    const invalid = "http://localhost:99999/";
    await address.fill(invalid);
    await address.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector(
        '[data-testid="browser-new-tab-address"][aria-invalid="true"]',
      ),
    );
    assertions.invalidAddressPreservesDraft =
      (await address.inputValue()) === invalid;
    assertions.invalidAddressDoesNotCreateNativePage =
      (await listTabs()).length === before.length;
    await capture("invalid-address-preserves-draft");

    const url = new URL("/browser-runtime-gate-b-user", before[0].url).href;
    await address.fill(url);
    await address.press("Enter");
    const nativeTabs = await waitFor(
      listTabs,
      (tabs) =>
        tabs.length === 2 &&
        tabs.some((tab) => tab.url === url && tab.selected && !tab.isLoading),
      "New tab did not open its real native page",
    );
    const opened = nativeTabs.find((tab) => tab.url === url);
    const gui = await waitFor(
      () => readBrowserWorkspaceState(page),
      (state) => state.tabId === opened.tabId,
      "New tab did not project native identity",
    );
    const native = await app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.fromId(id);
      return {
        alive: Boolean(wc && !wc.isDestroyed()),
        id: wc?.id,
        url: wc?.getURL(),
        sandbox: await wc?.executeJavaScript(
          "({require: typeof require, bridge: typeof window.electronAPI})",
        ),
      };
    }, opened.webContentsId);
    flows.push({ name: "submitted-new-tab", gui, native });
    assertions.validRetryReplacesSourceNewTab =
      (await page.locator(`[id="${first}"]`).count()) === 0 &&
      (await newTabs.count()) === 1;
    assertions.newPageUsesSameSessionAndThread =
      gui.sessionId === original.sessionId &&
      gui.threadId === original.threadId &&
      opened.browserSessionId === before[0].browserSessionId;
    assertions.newPageHasDistinctNativeIdentity =
      opened.tabId !== before[0].tabId &&
      opened.viewId !== before[0].viewId &&
      native.id !== before[0].webContentsId;
    assertions.newPageUsesSameWindowAndOwner =
      opened.windowId === before[0].windowId &&
      opened.ownerWebContentsId === before[0].ownerWebContentsId;
    assertions.nativePageActuallyNavigatedAndSandboxed =
      native.alive &&
      native.url === url &&
      native.sandbox.require === "undefined" &&
      native.sandbox.bridge === "undefined";
    assertions.originalNativePageUnchanged = nativeTabs.some(
      (tab) =>
        tab.tabId === before[0].tabId &&
        tab.webContentsId === before[0].webContentsId &&
        tab.url === before[0].url,
    );

    await select(second);
    assertions.otherTabDraftSurvivesNavigation =
      (await address.inputValue()) === secondDraft;
    await close(second);
    const third = await add();
    assertions.closedDraftDoesNotReturnInNextTab =
      third !== first &&
      third !== second &&
      (await address.inputValue()) === "";
    await close(third);
    const trace = await waitFor(
      readInvokeTrace,
      (entries) =>
        entries.some(
          (entry) =>
            entry.command === "browser_tab_mount" &&
            entry.status === "success" &&
            entry.transport === "electron-ipc" &&
            entry.args_preview?.url === url &&
            entry.args_preview?.browserSessionId === original.sessionId,
        ),
      "New tab creation has no production IPC receipt for the submitted URL/session",
    );
    assertions.productionCreateAndAppServerBridge = trace.some(
      (entry) =>
        entry.command === "app_server_handle_json_lines" &&
        entry.status === "success" &&
        entry.transport === "electron-ipc",
    );
    assertions.noMockFallback = !trace.some(
      (entry) => entry.transport === "mock" || entry.fallback === true,
    );
    const host = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence ?? null,
    );
    assertions.realHiddenHostWithoutPreloadErrors =
      host?.visibilityOnly === true &&
      host.visible === false &&
      host.unexpectedShowEvents === 0 &&
      host.preloadErrors.length === 0;
    return {
      scenario: "new-tab-address",
      assertions,
      flows,
      failedAssertions: Object.keys(assertions).filter(
        (key) => !assertions[key],
      ),
      initial: { gui: original, tabs: before },
      input:
        "Playwright pointer/fill/keyboard on real Electron; no physical OS keyboard or native IME claim",
      claimBoundary:
        "Real New tab draft visibility/tab lifecycle and same Session/Window navigation through production IPC. Component connection is recorded, not forced; remount recovery is separately tested in component regression. Canonical App Server identity initialized; no Agent turn or full RuntimeCore Gate B claim.",
      invokeTrace: trace.map(({ command, transport, status }) => ({
        command,
        transport,
        status,
      })),
      diagnostics: { hiddenHost: host },
    };
  } catch (error) {
    await fs.writeFile(
      options.output,
      JSON.stringify(
        {
          scenario: "new-tab-address",
          status: "fail",
          assertions,
          flows,
          error: sanitizeText(error),
          tabs: await listTabs().catch(() => null),
        },
        null,
        2,
      ),
    );
    throw error;
  }
}
