import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { ElectronEmbeddedBrowserHost } from "../../electron/embeddedBrowserHost.ts";
import { ElectronBrowserTabHost } from "../../electron/browserTabHost.ts";
import { AppServerDynamicToolHost } from "../../electron/appServerDynamicToolHost.ts";
import { BrowserAppServerBridge } from "../../electron/browserAppServerBridge.ts";

// Test-only native owner integration. Thread/turn and reverse requests are explicit fixtures.
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1])
  throw new Error("--output is required");
const output = path.resolve(process.argv[outputIndex + 1]);
const root = path.dirname(output);
fs.mkdirSync(path.join(root, "user-data"), { recursive: true });
app.setPath("userData", path.join(root, "user-data"));
const summary = {
  status: "running",
  proofLevel: "native Browser owner integration",
  boundary:
    "Real immutable dynamic-tool registry, BrowserTabHost, EmbeddedBrowserHost, WCV, isolated world and native debugger input. Explicit thread/turn/config and reverse-request fixture; no preload IPC, App Server process, RuntimeCore/provider, full Gate B, Windows or packaged-app claim.",
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  checks: [],
};
const scope = {
  threadId: "pointer-thread",
  browserSessionId: "pointer-session",
};
let window, server, embedded, host, page;
let sequence = 0;
let interrupted = 0;
const sockets = new Set();
function check(name, action) {
  action();
  summary.checks.push({ name, passed: true });
  process.stdout.write(`${name}\n`);
}
async function until(read, name) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await delay(25);
  }
  throw new Error(name);
}
async function run() {
  await app.whenReady();
  server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html><title>Native pointer fixture</title>
      <style>body{height:2800px;margin:12px;font:16px sans-serif}#hover{width:180px;height:50px}#panel{width:240px;height:140px;overflow:scroll;border:2px solid}#panel>div{width:1000px;height:1000px}#far{margin-top:1400px;width:160px;height:40px}#cover{display:none;position:fixed;inset:0;z-index:100;background:white}iframe{display:none;position:fixed;inset:0;width:100%;height:100%;z-index:200}</style>
      <button id="hover">Hover target</button><p id="result">Ready</p>
      <section id="panel" role="region" aria-label="Scroll panel" tabindex="0"><div>Nested scroll content</div></section>
      <button id="far">Far hover</button><div id="cover">Cover</div><iframe srcdoc="<p>Child frame</p>"></iframe>
      <script>window.trusted=[];document.querySelector('#hover').addEventListener('mouseenter',e=>{trusted.push(e.isTrusted);document.querySelector('#result').textContent='Native hover received'});document.querySelector('#far').addEventListener('mouseenter',e=>trusted.push(e.isTrusted));document.addEventListener('wheel',e=>trusted.push(e.isTrusted),{passive:true});</script>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  embedded = new ElectronEmbeddedBrowserHost(
    (event, payload) => host?.observeEmbeddedEvent(event, payload),
    { deferPermissions: true },
  );
  host = new ElectronBrowserTabHost(embedded);
  const bridge = new BrowserAppServerBridge(host, async (method) => {
    if (method === "configRequirements/read") return { requirements: null };
    if (method === "config/read")
      return { config: { browser: { approvalMode: "neverAsk" } } };
    throw new Error(`Unexpected fixture config method: ${method}`);
  });
  await bridge.refreshSettings();
  host.setTurnInterruptHandler(async () => {
    interrupted++;
  });
  window = new BrowserWindow({
    show: true,
    width: 800,
    height: 600,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL("data:text/html,<title>Trusted fixture owner</title>");
  const mounted = await host.invoke(window, "browser_tab_mount", {
    ...scope,
    tabId: "pointer-tab",
    url,
    selected: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  page = embedded.resolveNativeView(mounted.viewId).view.webContents;
  const sendCommand = page.debugger.sendCommand.bind(page.debugger);
  page.debugger.sendCommand = async (...args) => {
    const started = Date.now();
    process.stdout.write(
      `native:${args[0]}:start${args[0] === "DOM.getNodeForLocation" ? ":" + JSON.stringify(args[1]) : ""}\n`,
    );
    const result = await sendCommand(...args);
    process.stdout.write(`native:${args[0]}:end:${Date.now() - started}ms\n`);
    return result;
  };
  await until(
    () => !page.isLoading() && page.getURL() === url,
    "Native page did not load",
  );
  const state = async () =>
    (await host.invoke(window, "browser_tab_list", scope))[0];
  const registry = new AppServerDynamicToolHost(undefined, host);
  const request = registry.prepareClientRequest({
    id: "start",
    method: "thread/start",
    params: {},
  });
  const definitions = request.params.dynamicTools.find(
    (entry) => entry.name === "browser",
  ).tools;
  check("immutable-registry-advertises-native-tools", () => {
    assert(definitions.some((entry) => entry.name === "hover"));
    assert(definitions.some((entry) => entry.name === "scroll"));
  });
  registry.observeClientResult(
    "thread/start",
    { thread: { id: scope.threadId } },
    { ownerWebContentsId: window.webContents.id },
  );
  async function call(tool, args = {}) {
    process.stdout.write(`call:${tool}\n`);
    let response;
    const handled = await registry.tryHandle(
      {
        respondServerRequest: (_id, value) => {
          response = value;
        },
        rejectServerRequest: (_id, error) => {
          throw new Error(error.message);
        },
      },
      {
        id: `request-${++sequence}`,
        method: "item/tool/call",
        params: {
          threadId: scope.threadId,
          turnId: "pointer-turn",
          callId: `call-${sequence}`,
          namespace: "browser",
          tool,
          arguments: { tabId: "pointer-tab", ...args },
          phase: "preflight",
        },
      },
    );
    assert(handled);
    assert(response);
    if (!response.success)
      throw new Error(
        response.contentItems.map((item) => item.text ?? "").join("\n"),
      );
    return JSON.parse(
      response.contentItems.find((item) => item.type === "inputText").text,
    );
  }
  async function observe(name) {
    const result = await call("observe");
    const node = name
      ? result.data.nodes.find(
          (entry) =>
            entry.name === name && Number.isSafeInteger(entry.backendNodeId),
        )
      : null;
    if (name) assert(node, `Missing observed node: ${name}`);
    return {
      snapshotId: result.data.snapshotId,
      ...(node ? { backendNodeId: node.backendNodeId } : {}),
    };
  }
  const loaded = await state();
  summary.identity = {
    ...scope,
    tabId: loaded.tabId,
    viewId: loaded.viewId,
    webContentsId: page.id,
  };
  await call("claimTab", {
    title: loaded.title,
    url: loaded.url,
    pageRevision: loaded.pageRevision,
  });
  const hover = await observe("Hover target");
  await call("hover", hover);
  await until(
    () =>
      page.executeJavaScript(
        "document.querySelector('#result').textContent==='Native hover received'",
      ),
    "Native hover did not reach the page",
  );
  check("native-hover-dispatch-is-trusted", () => assert.equal(interrupted, 0));
  fs.writeFileSync(
    path.join(root, "native-hover.png"),
    (await page.capturePage()).toPNG(),
  );
  await assert.rejects(call("hover", hover), /snapshot is stale/);
  check("consumed-snapshot-cannot-replay", () => {});
  await call("scroll", {
    ...(await observe("Scroll panel")),
    deltaX: 80,
    deltaY: 120,
  });
  await until(
    () =>
      page.executeJavaScript(
        "document.querySelector('#panel').scrollTop>0&&document.querySelector('#panel').scrollLeft>0",
      ),
    "Nested native wheel did not scroll both axes",
  );
  summary.nested = await page.executeJavaScript(
    "({x:document.querySelector('#panel').scrollLeft,y:document.querySelector('#panel').scrollTop,root:scrollY})",
  );
  check("native-wheel-scrolls-nested-container-both-axes", () =>
    assert.equal(summary.nested.root, 0),
  );
  fs.writeFileSync(
    path.join(root, "native-nested-scroll.png"),
    (await page.capturePage()).toPNG(),
  );
  await call("scroll", { ...(await observe()), deltaY: 200 });
  await until(
    () => page.executeJavaScript("scrollY>0"),
    "Viewport native wheel did not scroll",
  );
  check("untargeted-native-wheel-scrolls-page", () => {});
  await call("hover", await observe("Far hover"));
  await until(
    () => page.executeJavaScript("trusted.length>=4"),
    "Offscreen native hover did not arrive",
  );
  check("offscreen-node-is-scrolled-into-view-and-hovered", () => {});
  fs.writeFileSync(
    path.join(root, "native-far-hover.png"),
    (await page.capturePage()).toPNG(),
  );
  await page.executeJavaScript(
    "document.querySelector('#cover').style.display='block'",
  );
  await assert.rejects(call("hover", await observe("Far hover")), /obscured/);
  check("obscured-target-does-not-receive-input", () => {});
  await page.executeJavaScript(
    "document.querySelector('#cover').style.display='none';document.querySelector('iframe').style.display='block'",
  );
  await assert.rejects(
    call("scroll", { ...(await observe()), deltaY: 120 }),
    /child frame/,
  );
  check("viewport-input-cannot-enter-child-frame", () => {});
  await page.executeJavaScript(
    "document.querySelector('iframe').style.display='none'",
  );
  const invalid = await observe();
  await assert.rejects(call("scroll", { ...invalid, deltaY: 10001 }), /deltaY/);
  check("unbounded-scroll-is-rejected", () => {});
  summary.trustedEvents = await page.executeJavaScript("trusted");
  check("page-events-are-native-and-user-control-is-retained", () => {
    assert(summary.trustedEvents.length >= 4);
    assert(summary.trustedEvents.every((value) => value === true));
    assert.equal(interrupted, 0);
  });
  const final = await state();
  check("same-native-page-and-agent-owner-survive-input", () => {
    assert.equal(final.webContentsId, page.id);
    assert.equal(final.controlOwner, "agent");
    assert.equal(final.activeTurnId, "pointer-turn");
  });
  await host.turnEnded(scope.threadId, "pointer-turn");
  await assert.rejects(call("scroll", { ...invalid, deltaY: 100 }), /claimed/);
  check("turn-terminal-revokes-native-input", () => {});
  summary.status = "pass";
}
let watchdog;
Promise.race([
  run(),
  new Promise((_, reject) => {
    watchdog = setTimeout(
      () => reject(new Error("Native fixture deadline exceeded")),
      45000,
    );
  }),
])
  .catch((error) => {
    summary.status = "fail";
    summary.error = error.stack ?? String(error);
  })
  .finally(async () => {
    clearTimeout(watchdog);
    host?.connectionLost("fixture shutdown");
    host?.dispose();
    embedded?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) =>
      server ? server.close(resolve) : resolve(),
    );
    fs.writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
    app.exit(summary.status === "pass" ? 0 : 1);
  });
