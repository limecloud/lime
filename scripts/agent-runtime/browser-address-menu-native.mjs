import { app, BrowserWindow, WebContentsView, webContents } from "electron";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BrowserOverlayHost } from "../../electron/browserOverlayHost.ts";

// Test-only real native focus/layering fixture. No product runtime or mock fallback.
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1])
  throw new Error("Address popup fixture requires --output <summary.json>");
const output = path.resolve(process.argv[outputIndex + 1]);
const preloadIndex = process.argv.indexOf("--preload");
if (preloadIndex < 0 || !process.argv[preloadIndex + 1])
  throw new Error(
    "Address popup fixture requires --preload <browserOverlay.cjs>",
  );
mkdirSync(path.dirname(output), { recursive: true });
app.setPath("userData", path.join(path.dirname(output), "user-data"));
const summary = {
  scenario: "browser-address-menu",
  status: "running",
  proofLevel: "native owner integration",
  claimBoundary:
    "Current BrowserOverlayHost with real Electron/preload/IPC. Does not prove product App Server/RuntimeCore, packaged platforms or complete browser UX.",
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  checks: [],
};
let window;
let host;
const events = [];
function check(name, action) {
  action();
  summary.checks.push({ name, passed: true });
}
async function waitUntil(predicate, label) {
  const until = Date.now() + 8000;
  while (!(await predicate())) {
    if (Date.now() > until) throw new Error("Timed out: " + label);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 900,
    height: 650,
    show: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const owner = window.webContents;
  await owner.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        '<input id="address" value="exa" style="position:absolute;top:8px;left:100px;width:450px;height:28px"><input id="other" style="position:absolute;top:8px;left:600px">',
      ),
  );
  const page = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  page.setBounds({ x: 0, y: 50, width: 900, height: 600 });
  window.contentView.addChildView(page);
  await page.webContents.loadURL(
    "data:text/html,<title>Native web page</title><body style='background:green'>Original page remains visible</body>",
  );
  window.focus();
  app.focus({ steal: true });
  owner.focus();
  await waitUntil(
    () => window.isFocused() && owner.isFocused(),
    "fixture address focus before popup",
  );
  await owner.executeJavaScript(
    'document.querySelector("#address").focus();document.querySelector("#address").setSelectionRange(3,3)',
  );
  host = new BrowserOverlayHost((event) => events.push(event), {
    preloadPath: path.resolve(process.argv[preloadIndex + 1]),
  });
  const items = [
    {
      id: "docs",
      label: "Example docs",
      shortcut: "https://example.org/docs",
      checked: false,
    },
    {
      id: "other",
      label: "Other example",
      shortcut: "https://other.example/",
      checked: false,
    },
  ];
  const receipt = await host.show(
    window,
    "view-1",
    {
      menuId: "address-1",
      mode: "address",
      items,
      anchor: { x: 100, y: 8, width: 450, height: 28 },
    },
    owner,
  );
  check("native-popup-visible", () => assert(receipt.visible));
  const popup = webContents
    .getAllWebContents()
    .find(
      (content) =>
        content.id !== owner.id && content.id !== page.webContents.id,
    );
  assert(popup);
  const popupView = window.contentView.children.find(
    (view) => view.webContents?.id === popup.id,
  );
  check("popup-above-original-native-page", () =>
    assert.equal(window.contentView.children.at(-1), popupView),
  );
  check("popup-bounded-below-address", () =>
    assert.deepEqual(popupView.getBounds(), {
      x: 100,
      y: 39,
      width: 450,
      height: 98,
    }),
  );
  check("page-bounds-preserved", () =>
    assert.deepEqual(page.getBounds(), {
      x: 0,
      y: 50,
      width: 900,
      height: 600,
    }),
  );
  await waitUntil(() => owner.isFocused(), "address native focus");
  const selection = await owner.executeJavaScript(
    "({id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})",
  );
  check("address-focus-and-caret-preserved", () =>
    assert.deepEqual(selection, { id: "address", start: 3, end: 3 }),
  );
  owner.sendInputEvent({ type: "char", keyCode: "m" });
  await waitUntil(
    async () =>
      (await owner.executeJavaScript(
        'document.querySelector("#address").value',
      )) === "exam",
    "typing behind popup",
  );
  check("typing-continues-with-popup-visible", () =>
    assert(!popup.isDestroyed()),
  );
  host.update("view-1", {
    menuId: receipt.menuId,
    generation: receipt.generation,
    items: [{ ...items[0], checked: true }],
  });
  await waitUntil(
    async () =>
      (await popup.executeJavaScript(
        'document.querySelectorAll("[role=option]").length',
      )) === 1,
    "popup update",
  );
  check("native-popup-resizes-after-update", () =>
    assert.equal(popupView.getBounds().height, 54),
  );
  const selected = await popup.executeJavaScript(
    'document.querySelector("[role=option]").getAttribute("aria-selected")',
  );
  check("selected-row-reflects-keyboard-selection", () =>
    assert.equal(selected, "true"),
  );
  writeFileSync(
    path.join(path.dirname(output), "popup.png"),
    (await popup.capturePage()).toPNG(),
  );
  popup.sendInputEvent({
    type: "mouseDown",
    x: 30,
    y: 20,
    button: "left",
    clickCount: 1,
  });
  popup.sendInputEvent({
    type: "mouseUp",
    x: 30,
    y: 20,
    button: "left",
    clickCount: 1,
  });
  await waitUntil(
    () => events.some((event) => event.itemId === "docs"),
    "native mouse selection",
  );
  check("native-mouse-selection-delivers-trusted-action", () =>
    assert.equal(events.filter((event) => event.itemId === "docs").length, 1),
  );
  check("popup-disposed-after-selection", () => assert(popup.isDestroyed()));
  await host.show(
    window,
    "view-1",
    {
      menuId: "address-2",
      mode: "address",
      items,
      anchor: { x: 100, y: 8, width: 450, height: 28 },
    },
    owner,
  );
  host.hideMenu("view-1", {
    menuId: "address-1",
    generation: receipt.generation,
  });
  check("stale-close-does-not-dismiss-replacement", () =>
    assert(!events.some((event) => event.menuId === "address-2")),
  );
  page.webContents.focus();
  await waitUntil(
    () =>
      events.some(
        (event) => event.menuId === "address-2" && event.reason === "outside",
      ),
    "page focus dismisses address suggestions",
  );
  check("page-focus-dismisses-popup", () =>
    assert(page.webContents.isFocused()),
  );
  summary.events = events;
  summary.status = "passed";
}
run()
  .catch((error) => {
    summary.status = "failed";
    summary.error = error.stack || String(error);
    process.exitCode = 1;
  })
  .finally(() => {
    host?.dispose();
    window?.destroy();
    writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
    app.exit(summary.status === "passed" ? 0 : 1);
  });
