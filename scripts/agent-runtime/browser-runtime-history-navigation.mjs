import {
  captureInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
  withInvokeTraceCollector,
} from "../lib/invoke-trace-collector.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  assert,
  sanitizeJson,
  sanitizeText,
} from "../lib/chat-fixture/utils.mjs";
import fs from "node:fs/promises";
import { invokeAppServerFromPage } from "../lib/chat-fixture/rpc.mjs";

/** Both history entry points must mount a new page in the same canonical owner. */
export async function reopenBrowserHistoryEntry({
  app,
  page,
  options,
  history,
  label,
  target,
  initial,
  excludedTabIds = [initial.tabId],
  readBrowserWorkspaceState,
  waitFor,
}) {
  await history
    .getByRole("link", {
      name: label("open").replace("{{title}}", target.title),
      exact: true,
    })
    .click({ timeout: options.timeoutMs });
  const reopened = await waitFor(
    options,
    async () => {
      const workspace = await readBrowserWorkspaceState(page);
      const native = await app.evaluate(({ webContents }, id) => {
        if (!Number.isInteger(id)) return null;
        const target = webContents.fromId(id);
        if (!target || target.isDestroyed()) return null;
        return {
          webContentsId: target.id,
          url: target.getURL(),
          title: target.getTitle(),
          loading: target.isLoading(),
        };
      }, workspace.webContentsId);
      const settings = await page.evaluate(() => {
        const history = document.querySelector(
          '[data-testid="browser-history-page"]',
        );
        return {
          historyVisible: Boolean(history),
          error: history?.querySelector('[role="alert"]')?.textContent || null,
          openUnavailable: history
            ? [...history.querySelectorAll("a[aria-busy]")].every(
                (link) => link.getAttribute("aria-disabled") === "true",
              )
            : false,
        };
      });
      return { workspace, native, settings };
    },
    ({ workspace, native, settings }) =>
      !settings.historyVisible &&
      workspace.tabId &&
      !excludedTabIds.includes(workspace.tabId) &&
      workspace.sessionId === initial.sessionId &&
      workspace.threadId === initial.threadId &&
      workspace.pageRevision > 0 &&
      workspace.address === target.url &&
      native?.url === target.url &&
      native.title === target.title &&
      !native.loading,
    "History reopening did not return to the canonical Browser tab or commit its native page",
  );
  reopened.tabs = await page.evaluate(
    async (scope) => {
      const tabs = await window.electronAPI.invoke("browser_tab_list", scope);
      return tabs.map((tab) => ({
        tabId: tab.tabId,
        threadId: tab.threadId,
        browserSessionId: tab.browserSessionId,
        viewId: tab.viewId,
        webContentsId: tab.webContentsId,
        selected: tab.selected,
        url: tab.url,
        title: tab.title,
        pageRevision: tab.pageRevision,
      }));
    },
    { browserSessionId: initial.sessionId, threadId: initial.threadId },
  );
  return reopened;
}

/** Use ordinary Settings navigation without injecting browserReturnOwner. */
export async function reopenBrowserHistoryFromSettings({
  identity,
  workspaceId,
  ...params
}) {
  const { page, options, history, label, target, waitFor } = params;
  return withInvokeTraceCollector(
    page,
    async (handle) => {
      await page.getByTestId("app-sidebar-nav-settings").click();
      await page.getByTestId("settings-navigation").waitFor({
        state: "visible",
        timeout: options.timeoutMs,
      });
      await page.getByTestId("settings-sidebar-tab-browser-use").click();
      await page.locator("#browser-history button").click();
      await history.waitFor({ state: "visible", timeout: options.timeoutMs });
      await history
        .getByRole("searchbox", { name: label("search"), exact: true })
        .fill(target.title);
      await waitFor(
        options,
        () => history.getByTestId("browser-history-row").allTextContents(),
        (rows) => rows.length === 1 && rows[0].includes(target.title),
        "Ordinary Settings history did not find the committed page",
      );
      const reopened = await reopenBrowserHistoryEntry(params);
      const captured = await captureInvokeTraceCollector(page, handle);
      const trace = validateInvokeTraceCollectorCapture(captured, handle);
      assert(trace.complete, "Settings history native trace is incomplete");
      const requests = parseJsonRpcRequestsFromInvokeTrace(
        JSON.stringify(trace.ledgerEntries),
      );
      const canonicalRead = requests.some(
        (request) =>
          request.method === "thread/read" &&
          request.params?.threadId === identity.threadId &&
          request.transport === "electron-ipc" &&
          request.status === "success",
      );
      const sameOwnerRequest = requests.some(
        (request) =>
          request.method === "workspaceRightSurface/request" &&
          request.params?.reason === "open_browser_history" &&
          request.params?.sessionId === identity.sessionId &&
          request.params?.workspaceId === workspaceId &&
          request.transport === "electron-ipc" &&
          request.status === "success",
      );
      const isWorkspaceRead = (request) =>
        request.method === "workspace/read" &&
        request.params?.id === workspaceId &&
        request.transport === "electron-ipc" &&
        request.status === "success";
      const workspaceReadDuringOpen = requests.some(isWorkspaceRead);
      const workspaceRead =
        workspaceReadDuringOpen ||
        parseJsonRpcRequestsFromInvokeTrace(
          JSON.stringify(captured.seedEntries),
        ).some(isWorkspaceRead);
      assert(
        canonicalRead,
        "Settings history did not resolve its canonical thread through IPC",
      );
      assert(
        workspaceRead,
        "Settings history did not resolve its explicit workspace through IPC",
      );
      assert(
        sameOwnerRequest,
        "Settings history did not return to its original session/workspace",
      );
      return {
        ...reopened,
        proof: {
          canonicalRead,
          workspaceRead,
          workspaceReadSource: workspaceReadDuringOpen
            ? "history-open"
            : "same-document-observed-cache-origin",
          sameOwnerRequest,
          traceComplete: trace.complete,
        },
      };
    },
    (stopped) =>
      assert(
        stopped.nativeRestored,
        "Settings history trace observer was not restored",
      ),
  );
}

/** Keep navigation identity diagnostics without recording full RPC payloads. */
export async function writeBrowserHistoryFailure({
  page,
  capture,
  options,
  error,
  consoleErrors,
  pageErrors,
  screenshots,
  identity,
  workspaceId,
  browserSessionId,
  invokeTrace = [],
}) {
  await capture("failure").catch(() => undefined);
  const renderer = await page
    .evaluate(() => ({
      text: document.body.innerText.slice(-6000),
      navigation: JSON.parse(
        sessionStorage.getItem("lime.appNavigation.restore.v1") || "null",
      ),
      headerSessionId: document
        .querySelector('[data-testid="thread-workspace-header"]')
        ?.getAttribute("data-session-id"),
      headerProjectId: document
        .querySelector('[data-testid="thread-project-selector"]')
        ?.getAttribute("data-thread-project-id"),
      testIds: [...document.querySelectorAll("[data-testid]")].map((node) =>
        node.getAttribute("data-testid"),
      ),
      nativeTrace: JSON.parse(
        localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
      ).filter((entry) =>
        /^browser_tab_|^app_server_handle_json_lines$/u.test(
          entry?.command || "",
        ),
      ),
    }))
    .catch(() => null);
  if (renderer) {
    renderer.expectedOwner = { ...identity, workspaceId, browserSessionId };
    const pending = await invokeAppServerFromPage(
      page,
      "workspaceRightSurface/pending/list",
      { workspaceId },
    ).catch(() => null);
    renderer.pending = pending?.result?.pending?.map((request) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      workspaceRoot: request.workspaceRoot,
      status: request.status,
      reason: request.reason,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
      browser: request.metadata?.browser,
    }));
    renderer.requests = parseJsonRpcRequestsFromInvokeTrace(
      JSON.stringify([...invokeTrace, ...renderer.nativeTrace]),
    )
      .filter((request) =>
        /^(?:thread\/read|workspace\/read|workspaceRightSurface\/)/u.test(
          request.method,
        ),
      )
      .map(({ method, transport, status, params }) => ({
        method,
        transport,
        status,
        threadId: params.threadId,
        workspaceReadId: method === "workspace/read" ? params.id : undefined,
        sessionId: params.sessionId,
        workspaceId: params.workspaceId,
        workspaceRoot: params.workspaceRoot,
        requestId: params.requestId,
        reason: params.reason,
        browser: params.metadata?.browser,
      }));
    renderer.nativeTrace = [...invokeTrace, ...renderer.nativeTrace]
      .filter((entry) => /^browser_tab_/u.test(entry.command))
      .map((entry) => ({
        command: entry.command,
        transport: entry.transport,
        status: entry.status,
      }));
  }
  await fs.writeFile(
    options.output.replace(/\.json$/u, "-failure.json"),
    `${JSON.stringify(
      sanitizeJson({
        scenario: "history",
        status: "fail",
        generatedAt: new Date().toISOString(),
        error: sanitizeText(error),
        renderer,
        consoleErrors,
        pageErrors,
        screenshots,
      }),
      null,
      2,
    )}\n`,
  );
}
