import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import { assert } from "../lib/chat-fixture/utils.mjs";
import { openFixtureSessionFromSidebar } from "../lib/chat-fixture/session.mjs";
import {
  reloadRendererDocument,
  waitForRendererReady,
} from "../lib/chat-fixture/rpc.mjs";
import {
  waitForApprovalPrompt,
  clickApprovalDecision,
} from "./browser-runtime-electron-gate-b-approval.mjs";

export function createBrowserFirstOpenResponses(scenario, helpers) {
  return [
    () => ({
      type: "tool_call",
      id: "first-browser-open",
      name: "browser__newTab",
      arguments: { url: scenario.firstOpenUrl },
    }),
    ({ body }) => {
      const result = helpers.toolResultFromRequest(body);
      const state = helpers.extractBrowserState(result);
      assert(
        state?.tabId && state.url === scenario.firstOpenUrl,
        `First newTab failed: ${JSON.stringify(result)}`,
      );
      scenario.firstOpened = state;
      return {
        type: "tool_call",
        id: "first-browser-retain",
        name: "browser__markDeliverable",
        arguments: { tabId: state.tabId },
      };
    },
    async ({ body }) => {
      const state = helpers.extractBrowserState(
        helpers.toolResultFromRequest(body),
      );
      assert(
        state?.mark === "deliverable",
        "First-open page could not be retained",
      );
      scenario.firstMarked = state;
      await scenario.firstOpenGate;
      return { type: "text", content: "BROWSER_FIRST_OPEN_DONE" };
    },
  ];
}

/** No pre-mounted tab or direct tool invocation: the first GUI turn creates the browser. */
export async function runBrowserFirstOpenScenario(ctx) {
  const { app, page, identity, options, providerFixture, requestLog } = ctx;
  const evidence = {
    scenario: "first-open",
    evidenceLevel: "Desktop Gate B",
    identity,
    assertions: {},
    claimBoundary:
      "真实 Electron/preload/IPC/App Server/RuntimeCore 与本地 scripted provider；目标为本地 HTTP 页面。不是 live 模型、百度网络可达性或 Windows/安装包验收。",
  };
  const check = (key, value) => {
    evidence.assertions[key] = Boolean(value);
    assert(value, key);
  };
  let release;
  providerFixture.scenario.firstOpenGate = new Promise((resolve) => {
    release = resolve;
  });
  providerFixture.scenario.firstOpenRelease = release;
  providerFixture.scenario.firstOpenUrl = ctx.targetUrl;
  try {
    evidence.before = await ctx.readBrowserWorkspaceState(page);
    const tabs = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().flatMap((window) =>
        window.contentView.children
          .filter(
            (view) =>
              view.webContents && view.webContents.id !== window.webContents.id,
          )
          .map((view) => view.webContents.id),
      ),
    );
    check(
      "zero-native-tabs-before-first-tool",
      Array.isArray(tabs) && tabs.length === 0,
    );
    check("browser-panel-initially-closed", evidence.before.tabId === null);
    await sendPromptFromGui(
      page,
      {
        ...options,
        sessionId: identity.sessionId,
        threadId: identity.threadId,
      },
      "请打开内置浏览器访问网页。",
      { expectedSessionId: identity.sessionId },
    );
    if (options.scenario === "first-open-approval") {
      evidence.approval = await waitForApprovalPrompt(page, options);
      evidence.blankSurface = await ctx.waitForBrowserSurface(page, options);
      const url = await app.evaluate(
        ({ webContents }, id) => webContents.fromId(id)?.getURL(),
        evidence.blankSurface.webContentsId,
      );
      check(
        "no-destination-navigation-before-approval",
        !url || url === "about:blank",
      );
      await ctx.captureBrowserScreenshot(page, options, "first-open-approval");
      await clickApprovalDecision(
        page,
        evidence.approval.interactionId,
        "allow_once",
      );
    }
    const opened = await ctx.waitForScenarioValue(
      options,
      () => providerFixture.scenario.firstMarked,
      "first newTab and mark",
    );
    evidence.surface = await ctx.waitForBrowserSurface(page, options);
    await ctx.waitForNativeBrowserCommit(
      app,
      options,
      opened.webContentsId,
      ctx.targetUrl,
    );
    evidence.gui = await ctx.readBrowserWorkspaceState(page);
    evidence.native = await app.evaluate(
      async ({ webContents, BrowserWindow }, id) => {
        const target = webContents.fromId(id);
        const window = BrowserWindow.getAllWindows().find((window) =>
          window.contentView.children.some(
            (view) => view.webContents?.id === id,
          ),
        );
        const view = window?.contentView.children.find(
          (view) => view.webContents?.id === id,
        );
        return {
          id: target?.id,
          url: target?.getURL(),
          title: target?.getTitle(),
          visible: view?.getVisible(),
          bounds: view?.getBounds(),
          body: await target?.executeJavaScript("document.body.innerText"),
        };
      },
      opened.webContentsId,
    );
    check(
      "automatically-expanded-browser-panel",
      evidence.surface.panelVisible,
    );
    check(
      "same-native-tab-through-tool-and-gui",
      evidence.gui.tabId === opened.tabId &&
        evidence.gui.webContentsId === opened.webContentsId,
    );
    check(
      "actual-visible-native-destination",
      evidence.native.url === ctx.targetUrl &&
        evidence.native.visible &&
        evidence.native.bounds.width > 200 &&
        evidence.native.body.length > 0,
    );
    await ctx.captureBrowserScreenshot(page, options, "first-open");
    const afterTabs = await page.evaluate(
      async (scope) => window.electronAPI.invoke("browser_tab_list", scope),
      {
        threadId: identity.threadId,
        browserSessionId: opened.browserSessionId,
      },
    );
    check(
      "one-tab-no-google-placeholder",
      afterTabs.length === 1 && afterTabs[0].tabId === opened.tabId,
    );
    release();
    evidence.terminal = await ctx.waitForTerminalThread(
      page,
      options,
      identity.threadId,
      requestLog,
    );
    const items = evidence.terminal.turn.items ?? [];
    check(
      "canonical-newTab-item",
      JSON.stringify(items).includes("newTab") &&
        JSON.stringify(items).includes(opened.tabId),
    );
    const sessionOptions = {
      ...options,
      sessionId: identity.sessionId,
      threadId: identity.threadId,
    };
    await page.getByRole("button", { name: "新聊天", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="browser-workspace"]'),
    );
    const hidden = await app.evaluate(
      ({ BrowserWindow }, id) =>
        BrowserWindow.getAllWindows()
          .flatMap((window) => window.contentView.children)
          .find((view) => view.webContents?.id === id)
          ?.getVisible(),
      opened.webContentsId,
    );
    check("native-browser-hidden-in-other-conversation", hidden === false);
    await openFixtureSessionFromSidebar(page, sessionOptions, requestLog);
    evidence.reopened = await ctx.waitForBrowserSurface(page, options);
    check(
      "reopening-restores-same-native-browser",
      evidence.reopened.webContentsId === opened.webContentsId &&
        evidence.reopened.tabId === opened.tabId,
    );
    const forwardUrls = [1, 2].map((index) => {
      const url = new URL(ctx.targetUrl);
      url.hash = `navigation-recovery-${index}`;
      return url.href;
    });
    for (const url of forwardUrls) {
      const address = page.getByTestId("browser-workspace-address");
      await address.fill(url);
      await address.press("Enter");
      await ctx.waitForNativeBrowserCommit(
        app,
        options,
        opened.webContentsId,
        url,
      );
    }
    for (const url of [forwardUrls[0], ctx.targetUrl]) {
      await page.getByTestId("browser-workspace-back").click();
      await ctx.waitForNativeBrowserCommit(
        app,
        options,
        opened.webContentsId,
        url,
      );
    }
    evidence.preferencesBeforeReload = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("browser-presentation:"))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    console.log("[browser-first-open] stage=renderer-reload");
    await reloadRendererDocument(page, options);
    await waitForRendererReady(page, options);
    await openFixtureSessionFromSidebar(page, sessionOptions, requestLog);
    evidence.preferencesAfterReload = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("browser-presentation:"))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    evidence.reloaded = await ctx.waitForBrowserSurface(page, options);
    check(
      "renderer-reload-restores-browser-with-fresh-native-view",
      evidence.reloaded.webContentsId !== opened.webContentsId &&
        evidence.reloaded.threadId === opened.threadId,
    );
    await ctx.waitForNativeBrowserCommit(
      app,
      options,
      evidence.reloaded.webContentsId,
      ctx.targetUrl,
    );
    evidence.restoredNavigation = await app.evaluate(({ webContents }, id) => {
      const history = webContents.fromId(id).navigationHistory;
      return {
        index: history.getActiveIndex(),
        entries: history
          .getAllEntries()
          .map(({ url, title }) => ({ url, title })),
      };
    }, evidence.reloaded.webContentsId);
    check(
      "renderer-reload-restores-native-forward-history",
      JSON.stringify(
        evidence.restoredNavigation.entries.map(({ url }) => url),
      ) === JSON.stringify([ctx.targetUrl, ...forwardUrls]) &&
        evidence.restoredNavigation.index === 0,
    );
    await page.getByTestId("browser-workspace-forward").click();
    await ctx.waitForNativeBrowserCommit(
      app,
      options,
      evidence.reloaded.webContentsId,
      forwardUrls[0],
    );
    await page.getByTestId("browser-workspace-back").click();
    await ctx.waitForNativeBrowserCommit(
      app,
      options,
      evidence.reloaded.webContentsId,
      ctx.targetUrl,
    );
    check(
      "restored-native-history-is-navigable-through-the-gui",
      await page.getByTestId("browser-workspace-forward").isEnabled(),
    );
    await page.evaluate(({ sessionId, threadId }) => {
      localStorage.setItem(
        `browser-presentation:${JSON.stringify([sessionId, threadId])}`,
        "null",
      );
    }, identity);
    await reloadRendererDocument(page, options);
    await waitForRendererReady(page, options);
    await openFixtureSessionFromSidebar(page, sessionOptions, requestLog);
    evidence.recoveredFromStaleTeardown = await ctx.waitForBrowserSurface(
      page,
      options,
    );
    check(
      "stale-teardown-null-does-not-suppress-canonical-browser",
      evidence.recoveredFromStaleTeardown.threadId === opened.threadId &&
        evidence.recoveredFromStaleTeardown.webContentsId !==
          evidence.reloaded.webContentsId,
    );
    await ctx.waitForNativeBrowserCommit(
      app,
      options,
      evidence.recoveredFromStaleTeardown.webContentsId,
      ctx.targetUrl,
    );
    await ctx.captureBrowserScreenshot(page, options, "browser-reopened");
    await page
      .getByRole("button", { name: "关闭侧边面板", exact: true })
      .click();
    await page.getByTestId("browser-workspace").waitFor({ state: "hidden" });
    check(
      "explicit-collapse-hides-native-browser",
      await app.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.getAllWindows()
            .flatMap((window) => window.contentView.children)
            .find((view) => view.webContents?.id === id)
            ?.getVisible() === false,
        evidence.recoveredFromStaleTeardown.webContentsId,
      ),
    );
    await reloadRendererDocument(page, options);
    await waitForRendererReady(page, options);
    await openFixtureSessionFromSidebar(page, sessionOptions, requestLog);
    check(
      "explicit-collapse-survives-reload",
      !(await page.getByTestId("browser-workspace").isVisible()),
    );
    const calls = parseJsonRpcRequestsFromInvokeTrace(
      JSON.stringify(ctx.readInvokeTrace()),
    );
    evidence.calls = calls.map(({ method, transport, status }) => ({
      method,
      transport,
      status,
    }));
    for (const method of ["turn/start", "thread/read"])
      check(
        `real-preload-ipc-${method}`,
        calls.some(
          (call) =>
            call.method === method &&
            call.transport === "electron-ipc" &&
            call.status === "success",
        ),
      );
    check("real-provider-roundtrip", providerFixture.requests.length >= 3);
    check(
      "no-production-mock-fallback",
      !ctx
        .readInvokeTrace()
        .some(
          (entry) =>
            entry.mock === true ||
            entry.mockFallback === true ||
            /mock/i.test(String(entry.transport)),
        ),
    );
    evidence.status = "pass";
    return evidence;
  } catch (error) {
    evidence.preferencesAtFailure = await page
      .evaluate(() =>
        Object.fromEntries(
          Object.keys(localStorage)
            .filter((key) => key.startsWith("browser-presentation:"))
            .map((key) => [key, localStorage.getItem(key)]),
        ),
      )
      .catch(() => null);
    evidence.status = "fail";
    evidence.error = String(error);
    evidence.guiAtFailure = await ctx
      .readBrowserWorkspaceState(page)
      .catch(() => null);
    evidence.providerRequestCount = providerFixture.requests.length;
    evidence.toolResults = providerFixture.requests
      .flatMap((request) =>
        (request.body?.messages ?? [])
          .filter((message) => message.role === "tool")
          .map((message) => message.content),
      )
      .slice(-5);
    await ctx
      .captureBrowserScreenshot(page, options, "first-open-failure")
      .catch(() => {});
    return evidence;
  } finally {
    release();
  }
}
