import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { BrowserCdpSessions } from "../../electron/browserCdpSessions.ts";

// Bundle this test-only entry for Electron; it never starts the product runtime.
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1])
  throw new Error("Native session fixture requires --output <summary.json>");
const output = path.resolve(process.argv[outputIndex + 1]);
mkdirSync(path.dirname(output), { recursive: true });
app.setPath("userData", path.join(path.dirname(output), "user-data"));
app.commandLine.appendSwitch("site-per-process");
const summary = {
  schemaVersion: 1,
  scenario: "nested-cdp-session-events",
  status: "running",
  proofLevel: "native owner integration",
  claimBoundary:
    "Real Electron debugger and current BrowserCdpSessions only; no product GUI, preload, App Server, canonical approvals, provider or packaged-platform claim.",
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  checks: [],
  events: [],
};
const sessions = new BrowserCdpSessions();
const tabId = "native-session-tab";
let window;
let server;
let disposeEventObserver;

function check(name, action) {
  try {
    action();
    summary.checks.push({ name, passed: true });
  } catch (error) {
    summary.failedCheck = name;
    throw error;
  }
}

function waitForNativeEvent(contents, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Native event not received: ${label}`));
    }, 15_000);
    const listener = (_event, method, params, sourceSessionId) => {
      const event = { method, params, sourceSessionId };
      if (!predicate(event)) return;
      cleanup();
      resolve(event);
    };
    const cleanup = () => {
      clearTimeout(timer);
      contents.debugger.removeListener("message", listener);
    };
    contents.debugger.on("message", listener);
  });
}

function waitForFrame(contents, url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Native frame not loaded: ${url}`));
    }, 15_000);
    const ready = () => {
      if (
        !contents.mainFrame.framesInSubtree.some((frame) => frame.url === url)
      )
        return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      contents.removeListener("did-frame-finish-load", ready);
    };
    contents.on("did-frame-finish-load", ready);
    ready();
  });
}

async function run() {
  await app.whenReady();
  server = http.createServer((request, response) => {
    const port = server.address().port;
    const body =
      request.url === "/root"
        ? `<iframe src="http://localhost:${port}/inner"></iframe><iframe src="http://localhost:${port}/sibling"></iframe>`
        : request.url === "/inner"
          ? `<iframe src="http://127.0.0.1:${port}/leaf"></iframe>`
          : `<p>${request.url === "/leaf" ? "Nested frame" : "Sibling"}</p>`;
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html><title>Native session fixture</title>${body}`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const parentUrl = `http://localhost:${port}/inner`;
  const leafUrl = `http://127.0.0.1:${port}/leaf`;
  const siblingUrl = `http://localhost:${port}/sibling`;
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const contents = window.webContents;
  summary.webContentsId = contents.id;
  await contents.loadURL(`http://127.0.0.1:${port}/root`);
  await waitForFrame(contents, leafUrl);
  await waitForFrame(contents, siblingUrl);
  check("real-nested-frame-loaded", () =>
    assert(contents.mainFrame.framesInSubtree.length >= 4),
  );
  let invalidations = 0;
  let detachments = 0;
  await sessions.attachDebugger(
    tabId,
    contents,
    () => detachments++,
    () => invalidations++,
  );
  const observer = (_event, method, params, sourceSessionId) => {
    if (!method.startsWith("Target.")) return;
    summary.events.push({
      method,
      sourceSessionId: sourceSessionId || null,
      sessionId: params?.sessionId ?? null,
      targetId: params?.targetInfo?.targetId ?? null,
    });
  };
  contents.debugger.on("message", observer);
  disposeEventObserver = () =>
    contents.debugger.removeListener("message", observer);
  const { targetInfos } =
    await contents.debugger.sendCommand("Target.getTargets");
  const target = (url) => {
    const found = targetInfos.find(
      (info) => info.type === "iframe" && info.url === url,
    );
    assert(found, `Native iframe target is unavailable: ${url}`);
    return found.targetId;
  };
  const assertActive = () => assert(contents.debugger.isAttached());
  const parent = await sessions.attachDebuggerTarget(
    tabId,
    target(parentUrl),
    assertActive,
  );
  const sibling = await sessions.attachDebuggerTarget(
    tabId,
    target(siblingUrl),
    assertActive,
  );
  const nestedPromise = waitForNativeEvent(
    contents,
    (event) =>
      event.method === "Target.attachedToTarget" &&
      event.params?.targetInfo?.url === leafUrl,
    "nested Target.attachedToTarget with a parent source",
  );
  await sessions.sendDebuggerCommand(
    tabId,
    "Target.setAutoAttach",
    { autoAttach: true, flatten: true, waitForDebuggerOnStart: false },
    parent,
  );
  const nested = await nestedPromise;
  const leaf = {
    targetId: nested.params.targetInfo.targetId,
    sessionId: nested.params.sessionId,
  };
  check("fourth-native-argument-identifies-parent-session", () =>
    assert.equal(nested.sourceSessionId, parent.sessionId),
  );
  check("nested-session-resolves-in-current-owner", () =>
    assert.deepEqual(sessions.resolveTarget(tabId, leaf), leaf),
  );
  const value = await sessions.sendDebuggerCommand(
    tabId,
    "Runtime.evaluate",
    { expression: "location.href", returnByValue: true },
    leaf,
  );
  check("native-command-reads-the-nested-frame", () =>
    assert.equal(value.result.value, leafUrl),
  );
  const beforeDetach = invalidations;
  await sessions.detachDebuggerTarget(tabId, parent.targetId);
  for (const [name, selection] of [
    ["parent", parent],
    ["descendant", leaf],
  ])
    check(`${name}-session-revoked`, () =>
      assert.throws(
        () => sessions.resolveTarget(tabId, selection),
        /session.*attached/iu,
      ),
    );
  check("sibling-session-retained", () =>
    assert.deepEqual(sessions.resolveTarget(tabId, sibling), sibling),
  );
  check("revocation-invalidates-current-snapshot", () =>
    assert(invalidations > beforeDetach),
  );
  check("stale-descendant-command-rejected-before-native-send", () =>
    assert.throws(
      () =>
        sessions.sendDebuggerCommand(
          tabId,
          "Runtime.evaluate",
          { expression: "1" },
          leaf,
        ),
      /session.*attached/iu,
    ),
  );
  const siblingValue = await sessions.sendDebuggerCommand(
    tabId,
    "Runtime.evaluate",
    { expression: "location.href", returnByValue: true },
    sibling,
  );
  check("sibling-native-command-still-works", () =>
    assert.equal(siblingValue.result.value, siblingUrl),
  );
  sessions.unregisterDebuggerListener(tabId);
  disposeEventObserver();
  check("all-owner-and-observation-listeners-removed", () =>
    assert.equal(contents.debugger.listenerCount("message"), 0),
  );
  check("no-unexpected-native-root-detachment", () =>
    assert.equal(detachments, 0),
  );
  contents.debugger.detach();
  summary.nativeSessions = { parent, leaf, sibling };
  summary.status = "pass";
}

run()
  .catch((error) => {
    summary.status = "fail";
    summary.error = { message: error.message, stack: error.stack };
  })
  .finally(async () => {
    sessions.unregisterDebuggerListener(tabId);
    disposeEventObserver?.();
    if (window && !window.isDestroyed()) window.destroy();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    summary.completedAt = new Date().toISOString();
    writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      `[browser-cdp-session-events] ${summary.status}; ${summary.checks.length} checks; ${output}`,
    );
    app.exit(summary.status === "pass" ? 0 : 1);
  });
