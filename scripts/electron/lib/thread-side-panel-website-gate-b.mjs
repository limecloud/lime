import http from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { appServerCallFromPage } from "../mcp-config-fixture-smoke.mjs";
import { sendPromptFromGui } from "../../agent-runtime/claw-chat-current-fixture-gui-actions.mjs";
import {
  captureInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../../lib/invoke-trace-collector.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "./mcp-config-fixture-evidence.mjs";

const marker = "RECENTS_WEBSITE_FIXTURE ";
const htmlFilename = "recent-website.html";
const htmlDocument =
  '<!doctype html><meta charset="utf-8"><title>Recent website</title><p>RECENTS_CANONICAL_HTML</p>';

/** 仅注入受控external backend，不进入生产runtime。 */
export function renderRecentsWebsiteBackendScript() {
  return `
if (input.kind === "turnStart" && inputText.startsWith(${JSON.stringify(marker)})) {
  const target = inputText.slice(${marker.length}).trim();
  const itemId = "recents-website:" + turnId;
  const text = "Website ready: " + target;
  const now = Date.now();
  const events = [
    ...(target === ${JSON.stringify(htmlFilename)} ? [{
      type:"item.completed",
      payload:{item:{
        sessionId, threadId, turnId, itemId:"recents-html:" + turnId,
        sequence:1, ordinal:1, createdAtMs:now, updatedAtMs:now, completedAtMs:now,
        kind:"file", status:"completed",
        payload:{type:"file", status:"applied", changes:[{
          path:target, kind:{type:"add"}, diff:${JSON.stringify(`+${htmlDocument}`)}
        }]},
        metadata:{source:"recents-website-fixture"}
      }}
    }] : []),
    {type:"message.delta", payload:{itemId, role:"assistant", text, phase:"final_answer"}},
    {type:"message.completed", payload:{itemId, role:"assistant", text, phase:"final_answer", status:"completed"}},
    {type:"turn.completed", payload:{status:"completed", text}}
  ];
  if (ledgerPath) appendFileSync(ledgerPath, JSON.stringify({kind:"backendEvents", sessionId, threadId, turnId, eventTypes:events.map(event=>event.type)}) + "\\n");
  console.log(JSON.stringify({events}));
  process.exit(0);
}
`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readWebsitePreloadTrace(page, traceCollector) {
  const capture = await captureInvokeTraceCollector(page, traceCollector);
  const trace = validateInvokeTraceCollectorCapture(capture, traceCollector);
  assert(trace.complete, "website缺少连续preload trace来源证明");
  return trace;
}

async function submitWebsiteOutput(
  page,
  { sessionId, threadId, timeoutMs },
  target,
) {
  await sendPromptFromGui(
    page,
    { timeoutMs, intervalMs: 250 },
    marker + target,
    { expectedSessionId: sessionId },
  );
  const deadline = Date.now() + timeoutMs;
  let read, turn, message;
  do {
    read = await appServerCallFromPage(page, "thread/read", {
      threadId,
      includeTurns: true,
    });
    turn = read.result?.thread?.turns?.at(-1);
    message = turn?.items?.find(
      (item) =>
        item.type === "agentMessage" &&
        item.text === `Website ready: ${target}`,
    );
    if (turn?.status === "completed" && message) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert(
    read.result?.thread?.id === threadId &&
      turn?.status === "completed" &&
      message,
    `website缺少同线程完成产物: ${JSON.stringify({ threadId, target, turnId: turn?.id, status: turn?.status })}`,
  );
  assert(
    isObservedPreloadAppServerResponse(read.ipcObservation, "thread/read"),
    "website缺少canonical preload read收据",
  );
  return { turn, message };
}

async function openRecentWebsite(
  page,
  { timeoutMs },
  target,
  name,
  activate = (output) => output.press("Enter"),
) {
  const add = page.getByTestId("workspace-right-surface-new-tab");
  if (!(await add.isVisible()))
    await page.getByTestId("thread-side-panel-toggle").click();
  await add.click();
  const source = page.locator(
    '[data-testid="workspace-right-surface-tab-workspace-new-tab"][aria-selected="true"]',
  );
  await source.waitFor({ state: "visible", timeout: timeoutMs });
  const sourceId = await source.getAttribute("id");
  assert(sourceId, "website源New tab缺少身份");
  const output = page
    .getByTestId("workspace-right-surface-active-pane")
    .getByTestId("thread-side-panel-recents")
    .getByTitle(target, { exact: true });
  await output.waitFor({ state: "visible", timeout: timeoutMs });
  assert(
    (await output.getAttribute("aria-label")) === name,
    `website名称不符合参考合同: ${target}`,
  );
  await output.focus();
  await activate(output);
  return sourceId;
}

async function waitNativeWebsite(app, id, url, route, timeoutMs) {
  let native;
  const deadline = Date.now() + Math.min(timeoutMs, 15000);
  do {
    native = await app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id);
      return {
        alive: Boolean(contents && !contents.isDestroyed()),
        url: contents?.getURL(),
        title: contents?.getTitle(),
      };
    }, id);
    if (
      native.alive &&
      native.url === url &&
      native.title === `RECENTS_NATIVE${route}`
    )
      return native;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(
    `website未到达真实native WebContents: ${JSON.stringify({ id, url, actual: native })}`,
  );
}

export async function waitForLinkTab(
  readTabs,
  { url, beforeIds, timeoutMs, readCreationRequests, creationCount },
) {
  const deadline = Date.now() + timeoutMs;
  let tabs;
  do {
    tabs = await readTabs();
    if (
      tabs.some((tab) => tab.url === url && !beforeIds.includes(tab.tabId)) &&
      (await readCreationRequests()).length === creationCount + 1
    )
      return tabs;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(
    `点击后未观察到新native标签: ${JSON.stringify({ url, beforeIds, actual: tabs })}`,
  );
}

async function collectLinkClickEvidence(page, app, context, origin, requests) {
  const browserSessionId = await page
    .getByTestId("right-surface-browser-panel")
    .getAttribute("data-browser-session-id");
  assert(browserSessionId, "修饰键场景缺少canonical Browser session");
  const scope = { browserSessionId, threadId: context.threadId };
  const readTabs = () =>
    page.evaluate(
      (scope) => window.electronAPI.invoke("browser_tab_list", scope),
      scope,
    );
  const readCreationRequests = async () => {
    const trace = await readWebsitePreloadTrace(page, context.traceCollector);
    return parseJsonRpcRequestsFromInvokeTrace(
      JSON.stringify(trace.ledgerEntries),
    ).filter(
      (entry) =>
        entry.method === "workspaceRightSurface/request" &&
        entry.params?.reason === "browser_identity_createTab" &&
        entry.params?.sessionId === context.sessionId &&
        entry.params?.metadata?.browser?.browserSessionId ===
          browserSessionId &&
        entry.transport === "electron-ipc" &&
        entry.status === "success",
    );
  };
  const clicks = [];
  for (const { route, background, markdown } of [
    { route: "/background", background: true, markdown: false },
    { route: "/foreground", background: false, markdown: false },
    { route: "/markdown-background", background: true, markdown: true },
  ]) {
    const url = origin + route;
    const { turn, message } = await submitWebsiteOutput(page, context, url);
    const before = await readTabs();
    const selectedBefore = before.find((tab) => tab.selected);
    assert(selectedBefore, "修饰键场景缺少先前native选择");
    const creationCount = (await readCreationRequests()).length;
    const activate = (output) =>
      output.click({
        button: "middle",
        modifiers: background ? [] : ["Shift"],
      });
    let sourceId = null;
    if (markdown) {
      await page.getByTestId("thread-side-panel-toggle").click();
      await page
        .getByTestId("workspace-right-surface-active-pane")
        .waitFor({ state: "hidden", timeout: context.timeoutMs });
      const link = page
        .getByText(`Website ready: ${url}`, { exact: true })
        .getByRole("link", { name: url, exact: true });
      const beforeClick = await link.evaluate((anchor) => {
        const events = [];
        const href = anchor.href;
        const observe = (event) => {
          if (event.target.closest("a")?.href === href)
            events.push({
              event,
              originalAnchor: event.target.closest("a") === anchor,
            });
        };
        for (const type of ["mousedown", "mouseup", "auxclick"])
          document.addEventListener(type, observe, true);
        window.__linkClickEvidence = { events, observe };
        return {
          html: anchor.outerHTML,
        };
      });
      await activate(link);
      const afterClick = await page.evaluate(() => {
        const { events, observe } = window.__linkClickEvidence;
        for (const type of ["mousedown", "mouseup", "auxclick"])
          document.removeEventListener(type, observe, true);
        delete window.__linkClickEvidence;
        return {
          events: events.map(({ event, originalAnchor }) => ({
            type: event.type,
            button: event.button,
            trusted: event.isTrusted,
            defaultPrevented: event.defaultPrevented,
            originalAnchor,
            targetConnected: event.target.isConnected,
          })),
          trace: JSON.parse(
            localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
          ),
        };
      });
      writeFileSync(
        context.linkClickEvidencePath,
        JSON.stringify({ url, scope, beforeClick, afterClick }, null, 2),
      );
      assert(
        afterClick.events.some(
          (event) =>
            event.type === "auxclick" &&
            event.button === 1 &&
            event.trusted &&
            event.defaultPrevented,
        ),
        `正文中键缺少真实且已处理的auxclick: ${JSON.stringify({ url, events: afterClick.events })}`,
      );
    } else {
      sourceId = await openRecentWebsite(
        page,
        context,
        url,
        `${new URL(url).host}${route}`,
        activate,
      );
    }
    const tabs = await waitForLinkTab(readTabs, {
      url,
      beforeIds: before.map((tab) => tab.tabId),
      timeoutMs: context.timeoutMs,
      readCreationRequests,
      creationCount,
    });
    const next = tabs.find((tab) => tab.url === url);
    assert(
      tabs.length === before.length + 1 &&
        next?.browserSessionId === browserSessionId &&
        next.threadId === context.threadId &&
        !before.some(
          (tab) =>
            tab.tabId === next.tabId ||
            tab.webContentsId === next.webContentsId,
        ),
      `点击未创建独立canonical/native标签: ${JSON.stringify({ url, before, tabs })}`,
    );
    assert(
      (await readCreationRequests()).length === creationCount + 1,
      `点击缺少同session的真实preload createTab请求: ${url}`,
    );
    const native = await waitNativeWebsite(
      app,
      next.webContentsId,
      url,
      route,
      context.timeoutMs,
    );
    assert(requests.includes(route), `新标签未实际读取HTTP: ${route}`);
    if (background) {
      assert(
        next.selected === false &&
          tabs.find((tab) => tab.selected)?.tabId === selectedBefore.tabId,
        `后台点击夺取native选择: ${url}`,
      );
      if (markdown)
        assert(
          !(await page
            .getByTestId("workspace-right-surface-active-pane")
            .isVisible()),
          "正文后台点击错误展开已关闭侧栏",
        );
      else
        assert(
          (await page
            .locator(`[id=${JSON.stringify(sourceId)}][aria-selected="true"]`)
            .count()) === 1,
          "Recents后台点击未保留来源New tab选择",
        );
    } else {
      await page.waitForFunction(
        (tabId) =>
          document
            .querySelector(
              '[data-testid="workspace-right-surface-active-pane"] [data-testid="right-surface-browser-panel"]',
            )
            ?.getAttribute("data-browser-tab-id") === tabId,
        next.tabId,
        { timeout: context.timeoutMs },
      );
      const selected = (await readTabs()).filter((tab) => tab.selected);
      assert(
        selected.length === 1 && selected[0].tabId === next.tabId,
        "前台点击未选择明确的新canonical标签",
      );
    }
    if (sourceId)
      assert(
        (await page.locator(`[id=${JSON.stringify(sourceId)}]`).count()) === 1,
        "修饰键点击错误消费来源New tab",
      );
    clicks.push({
      url,
      threadId: context.threadId,
      turnId: turn.id,
      itemId: message.id,
      tabId: next.tabId,
      webContentsId: next.webContentsId,
      native,
      background,
      markdown,
      sourceTabId: sourceId,
      canonicalCreateObserved: true,
      selectionMatched: true,
      closedSidebarPreserved: markdown,
    });
  }
  return {
    clicks,
    background: true,
    foreground: true,
    markdownBackground: true,
  };
}

/** GUI提交→canonical输出→Recents→当前Browser/native WebContents，两次网址验证恢复后的新导航。 */
export async function collectThreadSidePanelWebsiteEvidence(
  page,
  app,
  {
    sessionId,
    threadId,
    workspaceRoot,
    timeoutMs,
    traceCollector,
    screenshotPath,
    htmlScreenshotPath,
  },
) {
  assert(
    typeof workspaceRoot === "string" && path.isAbsolute(workspaceRoot),
    "website夹具缺少隔离工作区绝对路径",
  );
  const defaultBrowser = await page.evaluate(() =>
    window.electronAPI.invoke("is_default_browser"),
  );
  const nativeDefaultBrowser = await app.evaluate(({ app }) =>
    app.isDefaultProtocolClient("https"),
  );
  assert(
    typeof defaultBrowser === "boolean" &&
      defaultBrowser === nativeDefaultBrowser,
    "默认浏览器IPC未匹配真实OS HTTPS协议身份",
  );
  const htmlPath = path.join(workspaceRoot, htmlFilename);
  writeFileSync(htmlPath, htmlDocument);
  const context = {
    sessionId,
    threadId,
    timeoutMs,
    traceCollector,
    linkClickEvidencePath: screenshotPath.replace(/\.png$/, "-link-click.json"),
  };
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><title>RECENTS_NATIVE${request.url}</title><p>Website fixture</p>`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rounds = [];
  try {
    for (const route of ["/first", "/second"]) {
      const url = origin + route;
      const { turn, message } = await submitWebsiteOutput(page, context, url);
      const sourceId = await openRecentWebsite(
        page,
        context,
        url,
        `${new URL(url).host}${route}`,
      );
      const browser = page
        .getByTestId("workspace-right-surface-active-pane")
        .getByTestId("right-surface-browser-panel");
      await browser.waitFor({ state: "visible", timeout: timeoutMs });
      await page.waitForFunction(
        ({ url, threadId }) => {
          const pane = document.querySelector(
            '[data-testid="workspace-right-surface-active-pane"]',
          );
          const browser = pane?.querySelector(
            '[data-testid="right-surface-browser-panel"]',
          );
          return (
            browser?.getAttribute("data-browser-thread-id") === threadId &&
            Number(browser.getAttribute("data-browser-web-contents-id")) > 0 &&
            pane
              ?.querySelector('[data-testid="browser-workspace"]')
              ?.getAttribute("data-browser-url") === url
          );
        },
        { url, threadId },
        { timeout: timeoutMs },
      );
      const nativeId = Number(
        await browser.getAttribute("data-browser-web-contents-id"),
      );
      const native = await waitNativeWebsite(
        app,
        nativeId,
        url,
        route,
        timeoutMs,
      );
      assert(
        (await page.locator(`[id=${JSON.stringify(sourceId)}]`).count()) === 1,
        "website错误消费了源New tab",
      );
      const trace = await readWebsitePreloadTrace(page, traceCollector);
      const request = parseJsonRpcRequestsFromInvokeTrace(
        JSON.stringify(trace.ledgerEntries),
      ).find(
        (entry) =>
          entry.method === "workspaceRightSurface/request" &&
          entry.params?.reason === "open_thread_output" &&
          entry.params?.metadata?.browser?.launchUrl === url &&
          entry.transport === "electron-ipc" &&
          entry.status === "success",
      );
      assert(
        request?.params?.sessionId === sessionId,
        "website缺少同session真实Browser请求",
      );
      rounds.push({
        threadId,
        turnId: turn.id,
        itemId: message.id,
        url,
        nativeId,
        native,
        sourceTabId: sourceId,
        sourceNewTabPreserved: true,
        canonicalPreloadRead: true,
        browserRequest: true,
      });
    }
    assert(
      rounds[0].nativeId === rounds[1].nativeId,
      "website重新打开未复用同一native owner",
    );
    assert(
      requests.includes("/first") && requests.includes("/second"),
      "website未读取两次真实HTTP资源",
    );
    if (screenshotPath)
      await page.screenshot({ path: screenshotPath, animations: "disabled" });
    const linkClicks = await collectLinkClickEvidence(
      page,
      app,
      context,
      origin,
      requests,
    );
    const { turn, message } = await submitWebsiteOutput(
      page,
      context,
      htmlFilename,
    );
    const file = turn.items.find(
      (item) =>
        item.type === "fileChange" &&
        item.status === "completed" &&
        item.changes?.some((change) => change.path === htmlFilename),
    );
    assert(file, "本地HTML缺少同Turn的completed文件变更");
    const sourceId = await openRecentWebsite(
      page,
      context,
      htmlFilename,
      htmlFilename,
    );
    const filesTab = page.locator(
      '[data-testid="workspace-right-surface-tab-files"][aria-selected="true"]',
    );
    await filesTab.waitFor({ state: "visible", timeout: timeoutMs });
    assert(
      (await filesTab.getAttribute("title")) === htmlPath,
      "本地HTML未按cwd打开同一绝对文件身份",
    );
    await page
      .getByTestId("workspace-right-surface-active-pane")
      .frameLocator('[data-testid="file-preview-html"]')
      .getByText("RECENTS_CANONICAL_HTML", { exact: true })
      .waitFor({ state: "visible", timeout: timeoutMs });
    assert(
      (await page.locator(`[id=${JSON.stringify(sourceId)}]`).count()) === 1,
      "本地HTML错误消费了源New tab",
    );
    const trace = await readWebsitePreloadTrace(page, traceCollector);
    const htmlRead = parseJsonRpcRequestsFromInvokeTrace(
      JSON.stringify(trace.ledgerEntries),
    ).find(
      (entry) =>
        entry.method === "fs/readFile" &&
        entry.params?.path === htmlPath &&
        entry.transport === "electron-ipc" &&
        entry.status === "success",
    );
    assert(htmlRead, "本地HTML缺少真实同路径fs/readFile收据");
    if (htmlScreenshotPath)
      await page.screenshot({
        path: htmlScreenshotPath,
        animations: "disabled",
      });
    const defaultBrowserReads = trace.ledgerEntries
      .filter((entry) => entry.command === "is_default_browser")
      .map(({ transport, status }) => ({ transport, status }));
    assert(
      defaultBrowserReads.some(
        (entry) =>
          entry.transport === "electron-ipc" && entry.status === "success",
      ) &&
        defaultBrowserReads.every(
          (entry) =>
            entry.transport === "electron-ipc" && entry.status === "success",
        ),
      `实际链接点击缺少成功的默认浏览器宿主查询: ${JSON.stringify(defaultBrowserReads)}`,
    );
    return {
      defaultBrowser: {
        value: defaultBrowser,
        matchesNative: true,
        reads: defaultBrowserReads,
        traceProvenance: trace.provenance,
      },
      rounds,
      html: {
        threadId,
        turnId: turn.id,
        itemId: file.id,
        messageId: message.id,
        path: htmlPath,
        sourceTabId: sourceId,
        sourceNewTabPreserved: true,
        actualFileRead: true,
        iframeBodyMatched: true,
        screenshotPath: htmlScreenshotPath,
      },
      sameNativeOwner: true,
      actualHttpReads: true,
      linkClicks,
      screenshotPath,
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
