import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { ElectronEmbeddedBrowserHost } from "../../electron/embeddedBrowserHost.ts";
import { ElectronBrowserTabHost } from "../../electron/browserTabHost.ts";
import { BrowserAppServerBridge } from "../../electron/browserAppServerBridge.ts";

// Test-only native owner integration. Thread/turn and reverse requests are explicit fixtures.
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1])
  throw new Error("--output is required");
const output = path.resolve(process.argv[outputIndex + 1]);
const root = path.dirname(output);
fs.mkdirSync(path.join(root, "user-data"), { recursive: true });
app.setPath("userData", path.join(root, "user-data"));
process.env.LIME_ELECTRON_E2E = "1";
process.env.ELECTRON_E2E_USER_DATA_DIR = path.join(root, "user-data");
const summary = {
  status: "running",
  proofLevel: "native Browser owner integration",
  boundary:
    "Native Browser owner and permission/download lifecycle; explicit config and thread fixture, no full RuntimeCore or packaged claim.",
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  checks: [],
  downloads: [],
  permissions: [],
};
const scope = {
  threadId: "pointer-thread",
  browserSessionId: "pointer-session",
};
let window, server, embedded, host, page;
let sequence = 0;

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
    const requestUrl = new URL(_request.url, "http://fixture.test");
    if (requestUrl.pathname === "/file") {
      const name = requestUrl.searchParams.get("name");
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${name}"`,
        "content-length": 1048576,
      });
      let sent = 0;
      const timer = setInterval(() => {
        response.write(Buffer.alloc(65536, 42));
        if (++sent === 16) {
          clearInterval(timer);
          response.end();
        }
      }, 10);
      response.on("close", () => clearInterval(timer));
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      `<!doctype html><title>Automatic downloads</title><h1>Native automatic downloads</h1><p id="status">Ready</p><script>window.download=function(name){const a=document.createElement('a');a.href='/file?name='+encodeURIComponent(name);a.download=name;document.body.append(a);a.click();a.remove()};</script>`,
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  embedded = new ElectronEmbeddedBrowserHost(
    (event, payload) => {
      if (event === "embedded-browser-view-download")
        summary.downloads.push(payload);
      if (event === "embedded-browser-view-permission-request")
        summary.permissions.push(payload);
      host?.observeEmbeddedEvent(event, payload);
    },
    { deferPermissions: true },
  );
  host = new ElectronBrowserTabHost(embedded);
  const bridge = new BrowserAppServerBridge(host, async (method) => {
    if (method === "configRequirements/read") return { requirements: null };
    if (method === "config/read")
      return {
        config: {
          browser: {
            approvalMode: "neverAsk",
            download_directory: path.join(root, "downloads"),
            ask_download_location: false,
          },
        },
      };
    throw new Error(`Unexpected fixture config method: ${method}`);
  });
  await bridge.refreshSettings();

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
  await until(
    () => !page.isLoading() && page.getURL() === url,
    "Page load timeout",
  );
  const nativeSession = page.session;
  const items = new Map();
  nativeSession.on("will-download", (_event, item) =>
    items.set(item.getFilename(), item),
  );
  const save = (permission, setting, origin = null) =>
    host.invoke(window, "browser_site_settings_update", {
      origin,
      permission,
      setting,
    });
  const snapshot = () => host.invoke(window, "browser_site_settings_list", {});
  const start = (names) =>
    page.executeJavaScript(
      `${JSON.stringify(names)}.forEach(window.download);void 0`,
    );
  const terminal = (name, state) =>
    summary.downloads.some(
      (event) => event.filename === name && event.state === state,
    );
  const complete = (name) =>
    until(
      () => terminal(name, "completed"),
      "Download did not complete: " + name,
    );
  const cancelled = (name) =>
    until(
      () => terminal(name, "cancelled"),
      "Download did not cancel: " + name,
    );
  const overlay = () =>
    window.contentView.children
      .map((view) => view.webContents)
      .find((contents) => contents.id !== page.id && !contents.isDestroyed());
  async function prompt() {
    await until(async () => {
      const contents = overlay();
      return (
        contents &&
        !contents.isLoading() &&
        contents
          .executeJavaScript(
            "Boolean(document.querySelector('[data-id=confirm]'))",
          )
          .catch(() => false)
      );
    }, "Native prompt did not appear");
    return overlay();
  }
  async function confirm(allowed = true) {
    const contents = await prompt();
    await contents.executeJavaScript(
      `document.querySelector('[data-id=${allowed ? "confirm" : "cancel"}]').click();void 0`,
    );
  }
  const initial = await snapshot();
  check("same-session-and-eight-site-settings", () => {
    assert.equal(Object.keys(initial.defaults).length, 8);
    assert.equal(nativeSession, embedded.getBrowsingDataSession());
  });
  await start(["first.bin"]);
  await complete("first.bin");
  check("first-download-completes-without-multiple-file-prompt", () =>
    assert.equal(summary.permissions.length, 0),
  );
  await start(["second.bin", "third.bin"]);
  const firstPrompt = await prompt();
  assert.equal(
    summary.permissions.filter((event) => event.decision === "pending").length,
    1,
  );
  assert(items.get("second.bin").isPaused());
  assert(items.get("third.bin").isPaused());
  assert(!terminal("second.bin", "completed"));
  assert(!terminal("third.bin", "completed"));
  check("concurrent-files-pause-behind-one-real-prompt", () => {});
  fs.writeFileSync(
    path.join(root, "automatic-download-prompt.png"),
    (await firstPrompt.capturePage()).toPNG(),
  );
  await confirm();
  await complete("second.bin");
  await complete("third.bin");
  check("native-preload-ipc-approval-resumes-both-original-items", () => {});
  await save("automaticDownloads", "block");
  await start(["blocked.bin"]);
  await cancelled("blocked.bin");
  check("persisted-block-cancels-subsequent-native-download", () =>
    assert(!terminal("blocked.bin", "completed")),
  );
  await save("automaticDownloads", "allow");
  await start(["allowed.bin"]);
  await complete("allowed.bin");
  check("persisted-allow-reaches-real-file-download", () =>
    assert.equal(
      fs.statSync(path.join(root, "downloads", "allowed.bin")).size,
      1048576,
    ),
  );
  await save("automaticDownloads", "ask");
  await start(["navigation.bin"]);
  await prompt();
  await page.loadURL(url + "next");
  await cancelled("navigation.bin");
  check("navigation-cancels-pending-item-and-native-prompt", () =>
    assert(!overlay()),
  );
  await start(["new-document.bin"]);
  await complete("new-document.bin");
  check("committed-main-document-receives-one-new-first-file-slot", () => {});
  await start(["cancel-one.bin", "keep-sibling.bin"]);
  await prompt();
  items.get("cancel-one.bin").cancel();
  await cancelled("cancel-one.bin");
  assert(items.get("keep-sibling.bin").isPaused());
  assert(overlay());
  await confirm();
  await complete("keep-sibling.bin");
  check("cancelling-one-file-preserves-sibling-approval", () => {});
  await assert.rejects(() => save("protectedContent", "allow"), /unavailable/);
  const eme = [];
  for (const key of ["org.w3.clearkey", "com.widevine.alpha"]) {
    eme.push(
      await page.executeJavaScript(
        `navigator.requestMediaKeySystemAccess(${JSON.stringify(key)},[{initDataTypes:['cenc'],videoCapabilities:[{contentType:'video/mp4; codecs="avc1.42E01E"'}],distinctiveIdentifier:'required'}]).then(()=>({key:${JSON.stringify(key)},allowed:true}),error=>({key:${JSON.stringify(key)},allowed:false,error:error.name}))`,
      ),
    );
  }
  summary.eme = eme;
  summary.protectedContentBoundary =
    "Actual EME attempts only; absent CDM/platform support cannot prove mediaKeySystem permission callback or playable DRM. Native permission request/check mapping is separately unit tested.";
  check(
    "protected-content-unavailable-write-rejected-with-explicit-eme-capability-result",
    () => {
      assert(eme.every((result) => !result.allowed));
    },
  );
  await save("automaticDownloads", "block");
  await save("automaticDownloads", "ask");
  await start(["deny-one.bin", "deny-two.bin"]);
  await confirm(false);
  await cancelled("deny-one.bin");
  await cancelled("deny-two.bin");
  check("native-denial-cancels-all-files-in-shared-prompt", () =>
    assert(!overlay()),
  );
  const decisionsBefore = summary.permissions.length;
  await start(["deny-later.bin"]);
  await cancelled("deny-later.bin");
  check("denied-document-does-not-repeat-multiple-file-prompts", () => {
    assert.equal(summary.permissions.length, decisionsBefore);
    assert(!overlay());
  });
  // A redundant ask save intentionally keeps the current document's temporary grant.
  await save("automaticDownloads", "block");
  await save("automaticDownloads", "ask");
  await start(["shutdown.bin"]);
  await prompt();
  embedded.prepareDownloadShutdown();
  await cancelled("shutdown.bin");
  check("shutdown-aborts-last-pending-download-and-prompt", () =>
    assert(!overlay()),
  );
  const disk = JSON.parse(
    fs.readFileSync(
      path.join(app.getPath("userData"), "browser", "site-settings.json"),
      "utf8",
    ),
  );
  check("same-profile-v4-settings-persist-on-disk", () => {
    assert.equal(disk.schemaVersion, 4);
    assert.equal(disk.defaults.protectedContent, "block");
    assert.equal(disk.defaults.automaticDownloads, "ask");
  });
  summary.identity = {
    ...scope,
    viewId: mounted.viewId,
    webContentsId: page.id,
  };
  summary.boundary =
    "Real BrowserTabHost/EmbeddedBrowserHost, same Session/WCV, native DownloadItem, site Store, native overlay and sandbox preload IPC. Explicit thread/turn/config fixture; no App Server/runtime/provider/full Gate B, Windows, DRM playback, child-frame request-initializer attribution or packaged parity claim.";
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
