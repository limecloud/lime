import http from "node:http";
import { collectThreadSidePanelTerminalEvidence } from "./thread-side-panel-terminal-scenario.mjs";
import { closeThreadSidePanelTab } from "./thread-side-panel-navigation.mjs";
import { appServerCallFromPage } from "../mcp-config-fixture-smoke.mjs";
import {
  parseInvokeTraceRaw,
  isObservedPreloadAppServerResponse,
} from "./mcp-config-fixture-evidence.mjs";

const TABS = '[data-testid="workspace-right-surface-tabs"]';
const BROWSER = '[data-testid="browser-workspace"]';

// 可直接序列化到真实 Renderer；保留的隐藏面板不能满足活动标签合同。
export function isRightSurfaceSelected({ kind, both }) {
  const host = document.querySelector(
    '[data-testid="workspace-right-surface-host"]',
  );
  const tabs = document.querySelector(
    '[data-testid="workspace-right-surface-tabs"]',
  );
  const selected = tabs?.querySelector(
    `[data-testid="workspace-right-surface-tab-${kind}"][aria-selected="true"]`,
  );
  const active = host?.querySelector(
    '[data-testid="workspace-right-surface-active-pane"][role="tabpanel"]',
  );
  return Boolean(
    host?.getAttribute("data-surface") === kind &&
    selected?.getAttribute("aria-selected") === "true" &&
    active &&
    !active.hidden &&
    selected.getAttribute("aria-controls") === active.id &&
    (!both ||
      ["browser", "changes"].every((surface) =>
        tabs.querySelector(
          `[data-testid="workspace-right-surface-tab-${surface}"]`,
        ),
      )),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function summarizeRightSurfaceLifecycleEvidence({
  traceRaw,
  errorRaw,
  sessionId,
  threadId,
  stages,
  first,
  restored,
  nativeBefore,
  nativeAfter,
  url,
  requestObservation,
}) {
  const entries = parseInvokeTraceRaw(traceRaw);
  const mounts = entries.filter(
    (entry) => entry.command === "browser_tab_mount",
  );
  const snapshots = entries.filter(
    (entry) => entry.command === "browser_tab_list",
  );
  return {
    host: {
      canonicalRequest:
        isObservedPreloadAppServerResponse(
          requestObservation,
          "workspaceRightSurface/request",
        ) &&
        requestObservation.params?.sessionId === sessionId &&
        requestObservation.params?.metadata?.browser?.launchUrl === url,
      nativeMounts:
        mounts.length >= 2 &&
        mounts.every(
          (entry) =>
            entry.transport === "electron-ipc" && entry.status === "success",
        ),
      nativeSnapshots:
        snapshots.length >= 2 &&
        snapshots.every(
          (entry) =>
            entry.transport === "electron-ipc" && entry.status === "success",
        ),
      mockFallbackHitCount: entries.filter(
        (entry) =>
          (entry.command === "browser_tab_mount" ||
            entry.command === "browser_tab_set_bounds" ||
            entry.command === "browser_tab_list") &&
          entry.transport !== "electron-ipc",
      ).length,
    },
    sameThread: first?.threadId === threadId && restored?.threadId === threadId,
    sameResource:
      Boolean(first?.sessionId && first?.tabId && first?.webContentsId) &&
      ["sessionId", "tabId", "webContentsId"].every(
        (key) => first[key] === restored?.[key],
      ) &&
      first.tabIds?.length === 2 &&
      JSON.stringify(first.tabIds) === JSON.stringify(restored?.tabIds),
    nativeReadback:
      nativeBefore?.alive === true &&
      nativeAfter?.alive === true &&
      nativeBefore.url === url &&
      nativeAfter.url === url,
    stages,
    errors: { invokeErrorCount: parseInvokeTraceRaw(errorRaw).length },
  };
}

export function assertRightSurfaceLifecycleEvidence(evidence) {
  assert(
    evidence.host.canonicalRequest &&
      evidence.host.nativeMounts &&
      evidence.host.nativeSnapshots,
    "Right Surface 缺少 current App Server 请求或真实 native Browser mount",
  );
  assert(evidence.host.mockFallbackHitCount === 0, "Right Surface 命中 mock");
  assert(
    evidence.sameThread && evidence.sameResource && evidence.nativeReadback,
    "Browser 切换后未保留同线程 native resource / URL",
  );
  for (const stage of [
    "browserOpened",
    "changesSelected",
    "browserSelected",
    "closedPrimaryRestored",
    "browserClosed",
    "changesClosed",
  ]) {
    assert(
      evidence.stages?.[stage] === true,
      `Right Surface stage 未完成: ${stage}`,
    );
  }
  assert(
    evidence.errors.invokeErrorCount === 0,
    "Right Surface 观察到 invoke error",
  );
}

/** 复用 coding fixture 的 canonical Thread；验证双 tab 恢复与关闭 primary 后不复活。 */
export async function collectRightSurfaceLifecycleEvidence(
  page,
  app,
  {
    sessionId,
    threadId,
    workspaceId,
    workspaceRoot,
    evidenceDir,
    prefix,
    timeoutMs = 60_000,
    onStage = () => {},
  },
) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Surface lifecycle fixture</title><p>Native view</p>",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/surface`;
  const stages = {};
  const waitSurface = async (kind, both) => {
    await page.waitForFunction(
      isRightSurfaceSelected,
      { kind, both },
      { timeout: timeoutMs },
    );
  };
  const readBrowser = () =>
    page.locator(BROWSER).evaluate((element) => ({
      threadId: element.getAttribute("data-browser-thread-id"),
      sessionId: element.getAttribute("data-browser-session-id"),
      tabId: element.getAttribute("data-browser-tab-id"),
      webContentsId: Number(
        element.getAttribute("data-browser-web-contents-id"),
      ),
      tabIds: Array.from(
        document.querySelectorAll(
          '[data-testid="workspace-right-surface-tab-browser"][data-browser-tab-id]',
        ),
      ).map((tab) => tab.getAttribute("data-browser-tab-id")),
    }));
  const readNative = (id) =>
    app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id);
      return {
        alive: Boolean(contents && !contents.isDestroyed()),
        url: contents?.getURL(),
      };
    }, id);
  const waitNative = async (id) => {
    const deadline = Date.now() + Math.min(timeoutMs, 15_000);
    do {
      const state = await readNative(id);
      if (state.alive && state.url === url) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error("Browser native webContents 未加载本机 fixture URL");
  };
  try {
    const requestResponse = await appServerCallFromPage(
      page,
      "workspaceRightSurface/request",
      {
        surfaceKind: "browser",
        origin: "user",
        priority: "foreground",
        sessionId,
        workspaceId,
        workspaceRoot,
        reason: "surface_lifecycle_fixture",
        metadata: {
          browser: { launchUrl: url, title: "Surface lifecycle fixture" },
        },
      },
    );
    onStage("browser-requested");
    await waitSurface("browser", true);
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[data-testid="browser-workspace"]')
            ?.getAttribute("data-browser-web-contents-id"),
        ) > 0,
      undefined,
      { timeout: timeoutMs },
    );
    const primary = await readBrowser();
    await page.waitForFunction(
      (url) =>
        document
          .querySelector('[data-testid="browser-workspace"]')
          ?.getAttribute("data-browser-url") === url,
      url,
      { timeout: timeoutMs },
    );
    // Both tabs use the local HTTP fixture; no provider or remote browser page is needed.
    await page
      .locator('[data-testid="workspace-right-surface-new-tab"]')
      .click();
    const address = page.locator(
      '[data-testid="browser-new-tab-address"]:visible',
    );
    await address.fill(url);
    await address.press("Enter");
    await page.waitForFunction(
      (primary) => {
        const panel = document.querySelector(
          '[data-testid="browser-workspace"]',
        );
        return (
          panel?.getAttribute("data-browser-tab-id") &&
          panel.getAttribute("data-browser-tab-id") !== primary
        );
      },
      primary.tabId,
      { timeout: timeoutMs },
    );
    await page.waitForFunction(
      (url) =>
        document
          .querySelector('[data-testid="browser-workspace"]')
          ?.getAttribute("data-browser-url") === url,
      url,
      { timeout: timeoutMs },
    );
    const first = await readBrowser();
    const nativeBefore = await waitNative(first.webContentsId);
    stages.browserOpened = true;
    onStage("browser-opened");
    await page
      .locator('[data-testid="workspace-right-surface-tab-changes"]')
      .click();
    await waitSurface("changes", true);
    assert(
      (await page
        .locator('[data-testid="workspace-changes-surface"]')
        .getAttribute("data-review-thread-id")) === threadId,
      "Changes 切换到另一 Thread",
    );
    stages.changesSelected = true;
    onStage("changes-selected");
    await page
      .locator(
        `[data-testid="workspace-right-surface-tab-browser"][data-browser-tab-id="${first.tabId}"]`,
      )
      .click();
    await waitSurface("browser", true);
    await page.waitForFunction(
      (id) =>
        Number(
          document
            .querySelector('[data-testid="browser-workspace"]')
            ?.getAttribute("data-browser-web-contents-id"),
        ) === id,
      first.webContentsId,
      { timeout: timeoutMs },
    );
    const restored = await readBrowser();
    const nativeAfter = await readNative(restored.webContentsId);
    stages.browserSelected = true;
    onStage("browser-restored");
    await page
      .locator(
        `[data-testid="workspace-right-surface-tab-browser"][data-browser-tab-id="${primary.tabId}"]`,
      )
      .locator("..")
      .locator('[data-testid="workspace-right-surface-tab-close"]')
      .click();
    await page.waitForFunction(
      (primary) =>
        !Array.from(
          document.querySelectorAll(
            '[data-testid="workspace-right-surface-tab-browser"][data-browser-tab-id]',
          ),
        ).some((tab) => tab.getAttribute("data-browser-tab-id") === primary),
      primary.tabId,
      { timeout: timeoutMs },
    );
    await page
      .locator('[data-testid="workspace-right-surface-tab-changes"]')
      .click();
    await waitSurface("changes", true);
    await page
      .locator(
        `[data-testid="workspace-right-surface-tab-browser"][data-browser-tab-id="${first.tabId}"]`,
      )
      .click();
    await waitSurface("browser", true);
    await page.waitForFunction(
      (id) =>
        Number(
          document
            .querySelector('[data-testid="browser-workspace"]')
            ?.getAttribute("data-browser-web-contents-id"),
        ) === id,
      first.webContentsId,
      { timeout: timeoutMs },
    );
    const afterPrimaryClose = await readBrowser();
    const nativeAfterPrimaryClose = await readNative(
      afterPrimaryClose.webContentsId,
    );
    stages.closedPrimaryRestored =
      afterPrimaryClose.tabId === first.tabId &&
      afterPrimaryClose.tabIds.length === 1 &&
      afterPrimaryClose.tabIds[0] === first.tabId &&
      nativeAfterPrimaryClose.alive &&
      nativeAfterPrimaryClose.url === url;
    assert(
      stages.closedPrimaryRestored,
      "关闭 primary 后切换复活了旧 tab 或丢失 selected native view",
    );
    onStage("closed-primary-restored");
    await closeThreadSidePanelTab(page, "browser");
    await waitSurface("changes", false);
    assert(
      (await page
        .locator(`${TABS} [data-testid="workspace-right-surface-tab-browser"]`)
        .count()) === 0,
      "关闭 Browser 后旧 tab 仍在",
    );
    stages.browserClosed = true;
    onStage("browser-closed");
    await closeThreadSidePanelTab(page, "changes");
    await page
      .locator('[data-testid="workspace-changes-surface"]')
      .waitFor({ state: "detached", timeout: timeoutMs });
    stages.changesClosed = true;
    onStage("changes-closed");
    const { traceRaw, errorRaw } = await page.evaluate(() => ({
      traceRaw: localStorage.getItem("lime_invoke_trace_buffer_v1"),
      errorRaw: localStorage.getItem("lime_invoke_error_buffer_v1"),
    }));
    const evidence = summarizeRightSurfaceLifecycleEvidence({
      traceRaw,
      errorRaw,
      sessionId,
      threadId,
      stages,
      first,
      restored,
      nativeBefore,
      nativeAfter,
      url,
      requestObservation: requestResponse.ipcObservation,
    });
    assertRightSurfaceLifecycleEvidence(evidence);
    const terminal = await collectThreadSidePanelTerminalEvidence(page, {
      timeoutMs,
      workspaceRoot,
      evidenceDir,
      prefix,
    });
    onStage("current-terminals-verified");
    return { ...evidence, terminal };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
