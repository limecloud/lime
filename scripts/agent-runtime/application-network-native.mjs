import { app, BrowserWindow, session } from "electron";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  ApplicationNetworkPolicy,
  resetApplicationNetworkConnections,
} from "../../electron/applicationNetworkPolicy.ts";
import { BrowserPermissionRequests } from "../../electron/browserPermissionRequests.ts";

// Test-only native owner integration; the managed response is an explicit fixture.
const index = process.argv.indexOf("--output");
if (index < 0 || !process.argv[index + 1])
  throw new Error("--output is required");
const output = path.resolve(process.argv[index + 1]);
mkdirSync(path.dirname(output), { recursive: true });
app.setPath("userData", path.join(path.dirname(output), "user-data"));
const summary = {
  schemaVersion: 1,
  status: "running",
  proofLevel: "native owner integration",
  claimBoundary:
    "Real Electron Session, application network policy, shared request owner and revocation helper. Explicit in-memory managed response; no App Server, product GUI, canonical turn, live provider, Windows or packaged-app claim.",
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  checks: [],
  requests: [],
  decisions: [],
};
let window;
let server;
let owner;
let nativeSession;
let requirements = null;
const policy = new ApplicationNetworkPolicy();
const sockets = new Set();
let activeWebSocket;
function check(name, action) {
  action();
  summary.checks.push({ name, passed: true });
}
function bounded(promise, label, milliseconds = 10_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function run() {
  await app.whenReady();
  server = http.createServer((request, response) => {
    summary.requests.push({ url: request.url, host: request.headers.host });
    const port = server.address().port;
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("cache-control", "no-store");
    if (request.url === "/redirect") {
      response.writeHead(302, {
        location: `http://localhost:${port}/redirect-target`,
      });
      response.end();
      return;
    }
    if (request.url === "/sw.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(
        `self.addEventListener('install', e => e.waitUntil(self.skipWaiting())); self.addEventListener('activate', e => e.waitUntil(self.clients.claim())); self.addEventListener('message', e => e.waitUntil(fetch(e.data).then(() => e.ports[0].postMessage('allowed'), () => e.ports[0].postMessage('blocked'))));`,
      );
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      "<!doctype html><title>Application network fixture</title><p>Native policy test</p>",
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    summary.requests.push({
      url: request.url,
      host: request.headers.host,
      upgrade: true,
    });
    const accept = createHash("sha1")
      .update(
        request.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    activeWebSocket = socket;
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  nativeSession = session.fromPartition("persist:embedded-browser");
  const reset = () =>
    resetApplicationNetworkConnections(
      nativeSession,
      window && !window.isDestroyed() ? [window.webContents] : [],
    );
  owner = new BrowserPermissionRequests({
    viewId: (id) => (id === window?.webContents.id ? "network-fixture" : null),
    allows: () => true,
    blocked: () => {},
    networkAllows: (url) => {
      const allowed = policy.allows(url);
      summary.decisions.push({ url, allowed });
      return allowed;
    },
    refreshNetwork: () => policy.update(requirements, reset),
  });
  owner.install(nativeSession);
  await policy.update(requirements, reset);
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: nativeSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.webContents.loadURL(`http://127.0.0.1:${port}/root`);
  const execute = (source) =>
    bounded(
      window.webContents.executeJavaScript(source, true),
      "Native page script did not settle",
    );
  check("unrestricted-localhost-fixture-is-reachable", () =>
    assert(summary.requests.some((r) => r.url === "/root")),
  );
  assert.equal(
    await execute(`fetch('http://localhost:${port}/baseline').then(r => r.ok)`),
    true,
  );
  check("blocked-host-was-reachable-before-policy", () =>
    assert(summary.requests.some((r) => r.url === "/baseline")),
  );
  requirements = {
    application: {
      network: { enabled: true, domains: { "127.0.0.1": "allow" } },
      storage: null,
    },
  };
  await policy.update(requirements, reset);
  check("allowed-request-reaches-real-server", () =>
    assert(policy.allows(`http://127.0.0.1:${port}/allowed`)),
  );
  assert.equal(await execute(`fetch('/allowed').then(r => r.ok)`), true);
  assert.equal(
    await execute(
      `fetch('http://localhost:${port}/blocked-fetch').then(() => 'allowed', () => 'blocked')`,
    ),
    "blocked",
  );
  check("denied-fetch-never-reaches-server", () =>
    assert(!summary.requests.some((r) => r.url === "/blocked-fetch")),
  );
  assert.equal(
    await execute(`fetch('/redirect').then(() => 'allowed', () => 'blocked')`),
    "blocked",
  );
  check("redirect-destination-is-rechecked", () => {
    assert(summary.requests.some((r) => r.url === "/redirect"));
    assert(!summary.requests.some((r) => r.url === "/redirect-target"));
  });
  assert.equal(
    await execute(
      `new Promise(resolve => { const script = document.createElement('script'); script.onload = () => resolve('allowed'); script.onerror = () => resolve('blocked'); script.src = 'http://localhost:${port}/blocked-script'; document.body.append(script); })`,
    ),
    "blocked",
  );
  check("denied-script-never-reaches-server", () =>
    assert(!summary.requests.some((r) => r.url === "/blocked-script")),
  );
  assert.equal(
    await execute(
      `(async () => { await navigator.serviceWorker.register('/sw.js'); const registration = await navigator.serviceWorker.ready; return new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => resolve(event.data); registration.active.postMessage('http://localhost:${port}/blocked-worker', [channel.port2]); }); })()`,
    ),
    "blocked",
  );
  check("service-worker-destination-is-gated", () =>
    assert(!summary.requests.some((r) => r.url === "/blocked-worker")),
  );
  assert.equal(
    await execute(
      `new Promise(resolve => { const socket = new WebSocket('ws://localhost:${port}/blocked-socket'); socket.onopen = () => { socket.close(); resolve('allowed'); }; socket.onerror = () => resolve('blocked'); })`,
    ),
    "blocked",
  );
  check("denied-websocket-handshake-never-reaches-server", () =>
    assert(!summary.requests.some((r) => r.url === "/blocked-socket")),
  );
  assert.equal(
    await execute(
      `new Promise(resolve => { window.fixtureSocket = new WebSocket('ws://127.0.0.1:${port}/allowed-socket'); window.fixtureSocket.onopen = () => resolve('opened'); window.fixtureSocket.onerror = () => resolve('failed'); })`,
    ),
    "opened",
  );
  check("allowed-websocket-is-really-established", () =>
    assert(activeWebSocket),
  );
  requirements = {
    application: { network: { enabled: true, domains: {} }, storage: null },
  };
  let revocation;
  try {
    await policy.update(requirements, reset);
  } catch (error) {
    revocation = error;
  }
  check("unsupported-live-websocket-revocation-is-explicitly-rejected", () =>
    assert(revocation instanceof AggregateError),
  );
  check("failed-revocation-does-not-reopen-new-network-admissions", () =>
    assert(!policy.allows(`http://127.0.0.1:${port}/after-policy-change`)),
  );
  summary.unsupported = [
    "Existing WebSocket transport closure requires native engine support or a fresh Session; the prior successful policy is not reported as replaced.",
  ];
  summary.requiredExitConditions = [
    {
      name: "policy-change-closes-established-websocket",
      passed: false,
      reason:
        "Native capability unavailable; admission remains closed and the update reports failure.",
    },
  ];
  summary.status = "partial";
}
run()
  .catch((error) => {
    summary.status = "fail";
    summary.error = error instanceof Error ? error.stack : String(error);
  })
  .finally(async () => {
    owner?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    for (const socket of sockets) socket.destroy();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
    app.exit(
      summary.status === "pass" ? 0 : summary.status === "partial" ? 2 : 1,
    );
  });
