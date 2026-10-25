import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { ElectronEmbeddedBrowserHost } from "../../electron/embeddedBrowserHost.ts";
import { ElectronBrowserTabHost } from "../../electron/browserTabHost.ts";
import { BrowserAppServerBridge } from "../../electron/browserAppServerBridge.ts";
import { connect } from "../../electron/browserNativePipeClient.ts";

// Test-only native Browser owners; the JSON-RPC responses below are explicit fixtures.
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1])
  throw new Error("--output is required");
const output = path.resolve(process.argv[outputIndex + 1]);
const fixtureRoot = path.dirname(output);
for (const name of ["user-data", "downloads"]) {
  const directory = path.join(fixtureRoot, name);
  mkdirSync(directory, { recursive: true });
  app.setPath(name === "user-data" ? "userData" : "downloads", directory);
}
const summary = {
  schemaVersion: 1,
  status: "running",
  proofLevel: "native Browser owner integration",
  claimBoundary:
    "Actual EmbeddedBrowserHost, BrowserTabHost, BrowserAppServerBridge, WebContentsView, debugger and local event socket client. Config/requirements responses and thread identity are explicit fixtures. No App Server process, preload IPC invocation, canonical turn, product GUI, OS input, live provider, Windows or packaged-app claim.",
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  checks: [],
  requests: [],
  authorityReads: [],
};
const scope = {
  threadId: "network-thread",
  browserSessionId: "network-session",
};
const tabId = "network-tab";
let window;
let server;
let embedded;
let host;
let client;
let requirements = null;
let callNumber = 0;
let interrupts = 0;
const sockets = new Set();
function check(name, action) {
  action();
  summary.checks.push({ name, passed: true });
}
async function bounded(promise, name) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(name)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function settled(read, name) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await delay(25);
  }
  throw new Error(name);
}
function tool(tool, args = {}) {
  return {
    tool,
    arguments: { tabId, ...args },
    phase: "preflight",
    callId: `network-native-${++callNumber}`,
    ownerWebContentsId: window.webContents.id,
    threadId: scope.threadId,
    turnId: "network-turn",
  };
}
async function run() {
  await app.whenReady();
  server = http.createServer((request, response) => {
    summary.requests.push({ url: request.url, host: request.headers.host });
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      "<!doctype html><title>Native network page</title><p>Original native page</p>",
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/root`;
  embedded = new ElectronEmbeddedBrowserHost(
    (event, payload) => host?.observeEmbeddedEvent(event, payload),
    { deferPermissions: true },
  );
  host = new ElectronBrowserTabHost(embedded);
  host.setTurnInterruptHandler(async () => {
    interrupts += 1;
  });
  const bridge = new BrowserAppServerBridge(host, async (method) => {
    summary.authorityReads.push(method);
    if (method === "configRequirements/read") return { requirements };
    if (method === "config/read")
      return {
        config: {
          browser: { approvalMode: "neverAsk", fullCdpAccessEnabled: true },
        },
      };
    throw new Error(`Unexpected fixture request: ${method}`);
  });
  await bridge.refreshSettings();
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL("data:text/html,<title>Native owner fixture</title>");
  const mounted = await host.invoke(window, "browser_tab_mount", {
    ...scope,
    tabId,
    url,
    selected: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  const native = embedded.resolveNativeView(mounted.viewId);
  assert(native);
  const page = native.view.webContents;
  await settled(
    () => page.getURL() === url && !page.isLoading(),
    "Native page did not load",
  );
  const state = () =>
    host.invoke(window, "browser_tab_list", scope).then((tabs) => tabs[0]);
  const loaded = await state();
  summary.identity = {
    ...scope,
    tabId,
    viewId: mounted.viewId,
    webContentsId: page.id,
  };
  check("real-webcontentsview-loaded-through-current-request-owner", () => {
    assert.equal(loaded.webContentsId, page.id);
    assert(summary.requests.some((request) => request.url === "/root"));
  });
  const claimed = await host.executeTool(
    tool("claimTab", {
      title: loaded.title,
      url: loaded.url,
      pageRevision: loaded.pageRevision,
    }),
  );
  assert.equal(claimed.status, "completed");
  const subscription = tool("addCdpEventListener");
  const approval = await host.executeTool(subscription);
  assert.equal(approval.status, "approval_required");
  const subscribed = await host.executeTool({
    ...subscription,
    phase: "approvedExecute",
    approvalToken: approval.approval.approvalToken,
  });
  assert.equal(subscribed.status, "completed");
  let detachments = 0;
  client = await connect(subscribed.data, {
    onCDPDetach: () => {
      detachments += 1;
    },
  });
  check("approved-event-capability-attaches-the-same-native-page", () =>
    assert(page.debugger.isAttached()),
  );
  await bridge.refreshSettings();
  check("unchanged-authority-keeps-debugger-and-event-client", () => {
    assert(page.debugger.isAttached());
    assert.equal(detachments, 0);
  });
  const command = tool("executeCdpCommand", {
    method: "Runtime.evaluate",
    commandParams: { expression: "'stale secret'" },
  });
  const pending = await host.executeTool(command);
  assert.equal(pending.status, "approval_required");
  requirements = {
    application: {
      network: { enabled: true, domains: { "127.0.0.1": "allow" } },
      storage: null,
    },
  };
  await bridge.refreshSettings();
  await bounded(
    client.closed,
    "Network policy change did not close the event client",
  );
  check("policy-change-closes-native-debugger-and-event-capability", () => {
    assert.equal(page.debugger.isAttached(), false);
    assert.equal(detachments, 1);
  });
  await assert.rejects(connect(subscribed.data));
  summary.checks.push({
    name: "old-event-capability-cannot-reconnect",
    passed: true,
  });
  await assert.rejects(
    host.executeTool({
      ...command,
      phase: "approvedExecute",
      approvalToken: pending.approval.approvalToken,
    }),
  );
  summary.checks.push({
    name: "old-independent-cdp-approval-cannot-execute",
    passed: true,
  });
  const retained = await state();
  check("policy-change-retains-native-page-without-physical-takeover", () => {
    assert.equal(retained.webContentsId, page.id);
    assert.equal(retained.url, url);
    assert.equal(interrupts, 0);
    assert.equal(retained.controlOwner, "agent");
  });
  assert.equal(
    await bounded(
      page.executeJavaScript("fetch('/allowed').then(r => r.ok)", true),
      "Allowed request did not settle",
    ),
    true,
  );
  check("new-allowed-native-request-reaches-server", () =>
    assert(summary.requests.some((request) => request.url === "/allowed")),
  );
  requirements = {
    application: { network: { enabled: true, domains: {} }, storage: null },
  };
  await bridge.refreshSettings();
  assert.equal(
    await bounded(
      page.executeJavaScript(
        "fetch('/blocked').then(() => 'allowed', () => 'blocked')",
        true,
      ),
      "Blocked request did not settle",
    ),
    "blocked",
  );
  check("new-denied-native-request-never-reaches-server", () =>
    assert(!summary.requests.some((request) => request.url === "/blocked")),
  );
  summary.status = "pass";
}
run()
  .catch((error) => {
    summary.status = "fail";
    summary.error = error instanceof Error ? error.stack : String(error);
  })
  .finally(async () => {
    await client?.dispose();
    host?.dispose();
    embedded?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    for (const socket of sockets) socket.destroy();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
    app.exit(summary.status === "pass" ? 0 : 1);
  });
