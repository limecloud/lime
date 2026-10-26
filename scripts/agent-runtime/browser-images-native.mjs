import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ElectronEmbeddedBrowserHost } from "../../electron/embeddedBrowserHost.ts";
import { ElectronBrowserTabHost } from "../../electron/browserTabHost.ts";
import { BrowserAppServerBridge } from "../../electron/browserAppServerBridge.ts";
import { BrowserSiteSettingsStore } from "../../electron/browserSiteSettingsStore.ts";

// Test-only native integration, with explicit managed-settings responses.
const index = process.argv.indexOf("--output");
if (index < 0 || !process.argv[index + 1])
  throw new Error("--output is required");
const output = path.resolve(process.argv[index + 1]);
const root = path.dirname(output);
for (const [name, directory] of [
  ["userData", "user-data"],
  ["downloads", "downloads"],
]) {
  mkdirSync(path.join(root, directory), { recursive: true });
  app.setPath(name, path.join(root, directory));
}
const summary = {
  schemaVersion: 1,
  status: "running",
  proofLevel: "native Browser owner integration",
  claimBoundary:
    "Actual BrowserTabHost, EmbeddedBrowserHost, persistent site store, native Session/frame and HTTP/data/blob image decoders, including service-worker-generated documents. Explicit config/requirements fixtures; no preload IPC invocation, App Server process, canonical turn, live provider, Windows or packaged claim.",
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  checks: [],
  requests: [],
  rounds: [],
};
const sockets = new Set();
let server, window, embedded, host, store;
let requirements = null;
let round = 0;
const scope = {
  threadId: "image-thread",
  browserSessionId: "image-session",
  tabId: "image-tab",
};
function check(name, action) {
  action();
  summary.checks.push({ name, passed: true });
}
async function until(read, label) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await read()) return;
    } catch (error) {
      lastError = String(error);
    }
    await delay(25);
  }
  throw new Error(`${label}: ${lastError ?? "predicate false"}`);
}
async function run() {
  await app.whenReady();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
    "base64",
  );
  server = http.createServer((request, response) => {
    summary.requests.push(request.url);
    response.setHeader("cache-control", "no-store");
    const current = new URL(request.url, "http://fixture");
    if (current.pathname === "/worker.js") {
      response.setHeader("content-type", "text/javascript");
      const html = `<title>Worker document</title><img src="data:image/png;base64,${png.toString("base64")}"><img src="/pixel.png?name=worker">`;
      response.end(
        `self.addEventListener('install', e => e.waitUntil(self.skipWaiting())); self.addEventListener('activate', e => e.waitUntil(self.clients.claim())); self.addEventListener('fetch', e => { if (new URL(e.request.url).pathname === '/controlled') e.respondWith(new Response(${JSON.stringify(html)}, {headers:{'content-type':'text/html'}})); });`,
      );
      return;
    }
    if (current.pathname === "/pixel.png") {
      response.setHeader("content-type", "image/png");
      response.end(png);
      return;
    }
    const port = server.address().port;
    const n = current.searchParams.get("round");
    const pixel = (name) =>
      `http://127.0.0.1:${port}/pixel.png?name=${name}&round=${n}`;
    response.setHeader("content-type", "text/html");
    response.setHeader(
      "Content-Security-Policy",
      "script-src 'self' 'unsafe-inline'; object-src 'none'",
    );
    if (current.pathname === "/frame") {
      response.end(`<title>Cross origin</title><img src="${pixel("cross")}">`);
      return;
    }
    const inline = (name) =>
      `&lt;img src='${pixel(name).replaceAll("&", "&amp;")}'&gt;`;
    response.end(`<!doctype html><title>Image policy</title>
      <img src="http://localhost:${port}/pixel.png?name=main&round=${n}">
      <img src="data:image/png;base64,${png.toString("base64")}">
      <img id="blob-image">
      <script>document.getElementById('blob-image').src = URL.createObjectURL(new Blob([Uint8Array.from(atob('${png.toString("base64")}'), c => c.charCodeAt(0))], {type:'image/png'}));</script>
      <style>body { background-image: url('${pixel("css")}'); }</style>
      <iframe name="cross" src="http://localhost:${port}/frame?round=${n}"></iframe>
      <iframe name="inherited" srcdoc="${inline("inherited")}"></iframe>
      <iframe name="opaque" sandbox="allow-scripts" srcdoc="${inline("opaque")}"></iframe>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const mainOrigin = `http://127.0.0.1:${server.address().port}`;
  const frameOrigin = `http://localhost:${server.address().port}`;
  store = new BrowserSiteSettingsStore(path.join(root, "profile"));
  await store.ready;
  embedded = new ElectronEmbeddedBrowserHost((event, payload) =>
    host?.observeEmbeddedEvent(event, payload),
  );
  host = new ElectronBrowserTabHost(embedded, () => {}, {
    siteSettings: store,
  });
  const bridge = new BrowserAppServerBridge(host, async (method) => {
    if (method === "configRequirements/read") return { requirements };
    if (method === "config/read") return { config: {} };
    throw new Error(`Unexpected method: ${method}`);
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
  await window.loadURL("data:text/html,<title>Browser owner fixture</title>");
  const mounted = await host.invoke(window, "browser_tab_mount", {
    ...scope,
    url: `${mainOrigin}/?round=${++round}`,
    selected: true,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  const contents = embedded.resolveNativeView(mounted.viewId).view.webContents;
  summary.webContentsId = contents.id;
  const images = async () => {
    const frames = contents.mainFrame.framesInSubtree;
    if (frames.length !== 4) return null;
    const values = await Promise.all(
      frames.map(async (frame) => ({
        name: frame === contents.mainFrame ? "main" : frame.name,
        origin: frame.origin,
        ...(await frame.executeJavaScript(
          "({ ready: document.readyState === 'complete' && [...document.images].every(i => i.complete), loaded: [...document.images].map(i => i.naturalWidth > 0) })",
        )),
      })),
    );
    if (
      !values.every(
        (value) =>
          value.ready &&
          value.loaded.length === (value.name === "main" ? 3 : 1),
      )
    )
      return null;
    return Object.fromEntries(values.map((value) => [value.name, value]));
  };
  const read = async () => {
    let result;
    await until(
      async () => Boolean((result = await images())),
      "Native images did not settle",
    );
    summary.rounds.push({ round, frames: result });
    return result;
  };
  const navigate = async () => {
    await contents.loadURL(`${mainOrigin}/?round=${++round}`);
    return read();
  };
  const save = (origin, setting) =>
    host.invoke(window, "browser_site_settings_update", {
      origin,
      permission: "images",
      setting,
    });
  const initial = await read();
  check("default-allows-real-cross-origin-images-and-inherited-frame", () => {
    assert.deepEqual(initial.main.loaded, [true, true, true]);
    for (const name of ["cross", "inherited"])
      assert.deepEqual(initial[name].loaded, [true]);
    assert.deepEqual(initial.opaque.loaded, [true]);
    assert.equal(initial.opaque.origin, "null");
  });
  await save(null, "block");
  await save(frameOrigin, "allow");
  const blocked = await navigate();
  check(
    "default-block-has-no-main-css-or-inherited-image-network-request",
    () => {
      assert.deepEqual(blocked.main.loaded, [false, false, false]);
      assert.deepEqual(blocked.inherited.loaded, [false]);
      assert.deepEqual(blocked.opaque.loaded, [false]);
      assert(
        !summary.requests.some(
          (url) =>
            /name=(main|css|inherited)&/.test(url) &&
            url.endsWith(`round=${round}`),
        ),
      );
    },
  );
  check(
    "cross-origin-frame-uses-its-own-allow-even-when-image-host-is-blocked",
    () => assert.deepEqual(blocked.cross.loaded, [true]),
  );
  await save(mainOrigin, "allow");
  const allowed = await navigate();
  check("website-override-restores-real-images-in-the-same-session", () => {
    assert.deepEqual(allowed.main.loaded, [true, true, true]);
    assert.deepEqual(allowed.inherited.loaded, [true]);
    assert.deepEqual(allowed.opaque.loaded, [true]);
    assert.equal(
      embedded.resolveNativeView(mounted.viewId).view.webContents.id,
      contents.id,
    );
  });
  const reloaded = new BrowserSiteSettingsStore(path.join(root, "profile"));
  await reloaded.ready;
  check("fresh-store-restores-default-and-site-image-decisions", () => {
    assert.equal(reloaded.decision("https://other.example", "images"), "block");
    assert.equal(reloaded.decision(mainOrigin, "images"), "allow");
    assert.equal(reloaded.decision(frameOrigin, "images"), "allow");
  });
  requirements = {
    application: {
      network: { enabled: true, domains: { "127.0.0.1": "allow" } },
      storage: null,
    },
  };
  await bridge.refreshSettings();
  await contents.loadURL(`${mainOrigin}/?round=${++round}`);
  let mainImage;
  await until(async () => {
    mainImage = await contents.executeJavaScript(
      "({ complete: document.images[0].complete, width: document.images[0].naturalWidth })",
    );
    return mainImage.complete;
  }, "Enterprise-blocked main image did not settle");
  check("enterprise-domain-denial-overrides-persisted-image-allow", () => {
    assert.equal(mainImage.width, 0);
    assert(
      !summary.requests.some(
        (url) => url.includes("name=main&") && url.endsWith(`round=${round}`),
      ),
    );
  });
  await save(mainOrigin, null);
  check("reset-site-override-restores-blocked-default", () =>
    assert.equal(store.decision(mainOrigin, "images"), "block"),
  );
  requirements = null;
  await bridge.refreshSettings();
  await contents.executeJavaScript(
    "navigator.serviceWorker.register('/worker.js').then(() => navigator.serviceWorker.ready).then(() => true)",
  );
  await contents.loadURL(`${mainOrigin}/controlled`);
  let workerImages;
  await until(async () => {
    workerImages = await contents.executeJavaScript(
      "({ ready: document.readyState === 'complete' && document.images.length === 2 && [...document.images].every(i => i.complete), widths: [...document.images].map(i => i.naturalWidth) })",
    );
    return workerImages.ready;
  }, "Service worker document images did not settle");
  assert(!summary.requests.includes("/controlled"));
  const workerBlocked = workerImages.widths.every((width) => width === 0);
  summary.checks.push({
    name: "service-worker-document-cannot-bypass-network-or-inline-image-block",
    passed: workerBlocked,
    expectedWidths: [0, 0],
    actualWidths: workerImages.widths,
  });
  if (!workerBlocked) {
    summary.status = "partial";
    summary.blocker =
      "Service-worker-generated documents bypass Session response headers; full image policy requires native document enforcement.";
    return;
  }
  summary.status = "pass";
}
const timeout = setTimeout(() => {
  summary.status = "fail";
  summary.error = "Native image fixture exceeded 45 seconds";
  writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
  app.exit(1);
}, 45_000);
run()
  .catch((error) => {
    summary.status = "fail";
    summary.error = String(error.stack ?? error.message ?? error);
  })
  .finally(async () => {
    clearTimeout(timeout);
    host?.dispose();
    embedded?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    for (const socket of sockets) socket.destroy();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
    app.exit(
      summary.status === "pass" ? 0 : summary.status === "partial" ? 2 : 1,
    );
  });
