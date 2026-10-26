import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ElectronEmbeddedBrowserHost } from "../../electron/embeddedBrowserHost.ts";
import { ElectronBrowserTabHost } from "../../electron/browserTabHost.ts";
import { BrowserAppServerBridge } from "../../electron/browserAppServerBridge.ts";
import { resolveCurrentDesktopStorageRoots } from "../../electron/appDataPaths.ts";

// Run record and restore in separate Electron processes against this isolated profile.
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes("--root"), "--root is required");
const root = path.resolve(argument("--root"));
const phase = argument("--phase");
assert(["record", "restore"].includes(phase));
mkdirSync(root, { recursive: true });
const userData = path.join(root, "user-data");
const downloads = path.join(root, "downloads");
mkdirSync(userData, { recursive: true });
mkdirSync(downloads, { recursive: true });
app.setPath("userData", userData);
app.setPath("downloads", downloads);
process.env.LIME_ELECTRON_E2E = "1";
process.env.ELECTRON_E2E_USER_DATA_DIR = userData;
const summary = {
  schemaVersion: 1,
  phase,
  status: "running",
  pid: process.pid,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  proofLevel: "native Browser owner integration across Electron processes",
  claimBoundary:
    "Actual BrowserTabHost, EmbeddedBrowserHost, Session, navigationHistory, local HTTP pages and persistent files. Explicit config/requirements and thread identity fixtures. No preload IPC invocation, App Server process, canonical turn, product GUI, live provider, Windows or packaged claim.",
  checks: [],
  requests: [],
};
const scope = {
  threadId: "navigation-thread",
  browserSessionId: `navigation-${phase}`,
  tabId: `tab-${phase}`,
};
let window, server, host, embedded;
const sockets = new Set();
const timeout = setTimeout(() => {
  summary.status = "fail";
  summary.error = "Native navigation fixture timed out";
  finish();
}, 30_000);
let finishing = false;
function check(name, action) {
  action();
  summary.checks.push({ name, passed: true });
}
async function until(read, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await delay(25);
  }
  throw new Error(label);
}
async function run() {
  const previous =
    phase === "restore"
      ? JSON.parse(readFileSync(path.join(root, "record.json"), "utf8"))
      : null;
  if (previous) assert.equal(previous.status, "pass");
  await app.whenReady();
  server = http.createServer((request, response) => {
    summary.requests.push(request.url);
    response.writeHead(200, {
      "content-type": "text/html",
      "cache-control": "no-store",
    });
    response.end(
      `<title>${request.url}</title><h1>${request.url}</h1><input aria-label="Fixture input"><a href="/three">Next</a>`,
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(previous?.port ?? 0, "127.0.0.1", resolve);
  });
  summary.port = server.address().port;
  const origin = `http://127.0.0.1:${summary.port}`;
  const one = `${origin}/one`,
    two = `${origin}/two`,
    three = `${origin}/three`;
  embedded = new ElectronEmbeddedBrowserHost(
    (event, payload) => host?.observeEmbeddedEvent(event, payload),
    { deferPermissions: true },
  );
  host = new ElectronBrowserTabHost(embedded);
  const bridge = new BrowserAppServerBridge(host, async (method) => {
    if (method === "configRequirements/read") return { requirements: null };
    if (method === "config/read")
      return { config: { browser: { approvalMode: "neverAsk" } } };
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
  await window.loadURL("data:text/html,<title>Navigation fixture</title>");
  const mounted = await host.invoke(window, "browser_tab_mount", {
    ...scope,
    url: phase === "record" ? one : two,
    restoreNavigation: phase === "restore",
    selected: true,
    visible: false,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  const page = embedded.resolveNativeView(mounted.viewId).view.webContents;
  summary.identity = {
    ...scope,
    viewId: mounted.viewId,
    webContentsId: page.id,
  };
  const settled = (url) =>
    until(
      () => page.getURL() === url && !page.isLoading(),
      `Page did not settle at ${url}`,
    );
  const navigate = async (url) => {
    await host.invoke(window, "browser_tab_navigate", {
      tabId: scope.tabId,
      url,
    });
    await settled(url);
  };
  const command = async (name, url) => {
    await host.invoke(window, name, { tabId: scope.tabId });
    await settled(url);
  };
  const navigationFile = path.join(
    resolveCurrentDesktopStorageRoots(userData).appDataRoot,
    "browser",
    "navigation.json",
  );
  if (phase === "record") {
    await settled(one);
    await navigate(two);
    await page.executeJavaScript(
      "document.querySelector('input').value = 'fixture-private-form'",
    );
    await page.session.cookies.set({
      url: origin,
      name: "navigation-fixture",
      value: "retained",
      expirationDate: Date.now() / 1000 + 3600,
    });
    await page.session.cookies.flushStore();
    await navigate(three);
    await command("browser_tab_go_back", two);
    const other = await host.invoke(window, "browser_tab_mount", {
      ...scope,
      tabId: "other-record-tab",
      url: `${origin}/other`,
      selected: false,
      visible: false,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    const otherPage = embedded.resolveNativeView(other.viewId).view.webContents;
    await until(
      () => otherPage.getURL() === `${origin}/other` && !otherPage.isLoading(),
      "Other tab did not settle",
    );
    await host.invoke(window, "browser_tab_select", {
      tabId: "other-record-tab",
      visible: false,
    });
    await host.invoke(window, "browser_tab_select", {
      tabId: scope.tabId,
      visible: false,
    });
    await host.prepareShutdown();
    check("native-controller-retains-back-and-forward-entries", () => {
      assert.deepEqual(
        page.navigationHistory.getAllEntries().map((entry) => entry.url),
        [one, two, three],
      );
      assert.equal(page.navigationHistory.getActiveIndex(), 1);
    });
    const saved = JSON.parse(readFileSync(navigationFile, "utf8"));
    check(
      "switching-back-persists-the-selected-tab-without-extra-navigation",
      () => {
        assert.deepEqual(
          saved.records[0].entries.map((entry) => entry.url),
          [one, two, three],
        );
      },
    );
    check(
      "disk-record-keeps-index-and-excludes-form-state-and-authority",
      () => {
        assert.equal(saved.records[0].index, 1);
        assert.deepEqual(
          saved.records[0].entries.map((entry) => Object.keys(entry).sort()),
          Array(3).fill(["title", "url"]),
        );
        assert(
          !JSON.stringify(saved).match(
            /pageState|fixture-private-form|approvalToken|controlOwner/,
          ),
        );
      },
    );
  } else {
    await settled(two);
    check(
      "new-process-restores-stack-on-new-canonical-and-native-identity",
      () => {
        assert.notEqual(summary.pid, previous.pid);
        assert.notEqual(mounted.viewId, previous.identity.viewId);
        assert.notEqual(mounted.tabId, previous.identity.tabId);
        assert.notEqual(
          mounted.browserSessionId,
          previous.identity.browserSessionId,
        );
        assert.deepEqual(
          page.navigationHistory.getAllEntries().map((entry) => entry.url),
          [one, two, three],
        );
        assert.equal(page.navigationHistory.getActiveIndex(), 1);
        assert.equal(mounted.canGoBack, true);
        assert.equal(mounted.canGoForward, true);
        assert.equal(mounted.controlOwner, "user");
        assert.equal(mounted.activeTurnId, null);
      },
    );
    const cookies = await page.session.cookies.get({ url: origin });
    check("native-profile-cookie-survives-process-restart", () =>
      assert(
        cookies.some(
          (cookie) =>
            cookie.name === "navigation-fixture" && cookie.value === "retained",
        ),
      ),
    );
    assert.equal(
      await page.executeJavaScript("document.querySelector('input').value"),
      "",
    );
    await command("browser_tab_go_back", one);
    await command("browser_tab_go_forward", two);
    await command("browser_tab_go_forward", three);
    await command("browser_tab_go_back", two);
    check(
      "real-native-back-and-forward-navigation-work-after-cold-restore",
      () => {
        assert.equal(page.navigationHistory.getActiveIndex(), 1);
        assert(
          summary.requests.includes("/one") &&
            summary.requests.includes("/three"),
        );
      },
    );
    await host.invoke(window, "browser_tab_mount", {
      ...scope,
      url: one,
      restoreNavigation: true,
      selected: true,
      visible: false,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    check("live-remount-keeps-the-existing-document-and-stack", () => {
      assert.equal(page.getURL(), two);
      assert.equal(page.navigationHistory.length(), 3);
    });
    const fresh = await host.invoke(window, "browser_tab_mount", {
      ...scope,
      tabId: "normal-new-tab",
      url: two,
      selected: false,
      visible: false,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    const freshPage = embedded.resolveNativeView(fresh.viewId).view.webContents;
    await until(
      () => freshPage.getURL() === two && !freshPage.isLoading(),
      "Fresh tab did not settle",
    );
    check("ordinary-new-tab-does-not-inherit-a-recovery-stack", () =>
      assert.equal(freshPage.navigationHistory.length(), 1),
    );
    await host.invoke(window, "browser_history_clear", {});
    await host.invoke(window, "browser_tab_reload", { tabId: scope.tabId });
    await settled(two);
    await host.prepareShutdown();
    check(
      "history-clear-removes-recovery-records-without-recapturing-old-visits",
      () => {
        assert.deepEqual(
          JSON.parse(readFileSync(navigationFile, "utf8")).records,
          [],
        );
        assert.equal(page.navigationHistory.length(), 3);
      },
    );
  }
  summary.status = "pass";
}
async function finish() {
  if (finishing) return;
  finishing = true;
  clearTimeout(timeout);
  host?.dispose();
  embedded?.dispose();
  if (window && !window.isDestroyed()) window.destroy();
  for (const socket of sockets) socket.destroy();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, `${phase}.json`),
    JSON.stringify(summary, null, 2) + "\n",
  );
  app.exit(summary.status === "pass" ? 0 : 1);
}
run()
  .catch((error) => {
    summary.status = "fail";
    summary.error = error.stack ?? String(error);
  })
  .finally(finish);
