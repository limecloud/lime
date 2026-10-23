import { app, BrowserWindow, WebContentsView, ipcMain } from "electron";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [root, snapshot, output, bundle] = process.argv.slice(2);
const summary = {
  proofLevel: "Real Electron native integration",
  claimBoundary:
    "Actual Annotation Host, trusted Editor Host, final page/editor preloads and Renderer; simulated native/DOM input in a hidden macOS window. No BrowserTabHost/App Server, physical input, reference visual parity, live provider or Windows/packaged claim.",
  hiddenWindow: true,
  syntheticInput: true,
  bridgeReplacement: false,
  appServerVerified: false,
  assertions: [],
  pageEvents: [],
  screenshots: [],
  events: [],
  errors: [],
};
let window, pageView, annotations, editor, server, observePage;
let annotationAllowed = true;
const waitFor = async (name, predicate) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${name}`);
};
const check = (name, value) => {
  assert.ok(value, name);
  summary.assertions.push(name);
};
const inspectPage = () =>
  pageView.webContents.executeJavaScript(`(() => {
  const target = document.querySelector('#target');
  return {text:target.textContent, fontSize:getComputedStyle(target).fontSize, color:getComputedStyle(target).color,
    sameNodes:globalThis.originalNodes?.every((node,index)=>target.childNodes[index]===node),
    styles:document.querySelectorAll('style[data-fixture-not-used]').length,
    previewAttributes:target.getAttributeNames().filter(name=>name.startsWith('data-browser-design-')),
    genericBridge:typeof window.electronAPI, narrowBridge:typeof window.browserAnnotationEditor, node:typeof window.require};
})()`);
const changeField = (view, label, value) =>
  view.webContents.executeJavaScript(`(() => {
  const field=Array.from(document.querySelectorAll('input,textarea')).find(node=>node.getAttribute('aria-label')===${JSON.stringify(label)});
  if(!field) throw new Error('Missing design field');
  const proto=field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(field,${JSON.stringify(value)});
  field.dispatchEvent(new Event('input',{bubbles:true}));
})()`);
const click = (view, label) =>
  view.webContents.executeJavaScript(`(() => {
  const button=Array.from(document.querySelectorAll('button')).find(node=>node.textContent===${JSON.stringify(label)});
  if(!button) throw new Error('Missing annotation button'); button.click();
})()`);
const captureDiagnostic = async (view, filename) => {
  try {
    const image = await view.webContents.capturePage(undefined, {
      stayHidden: true,
    });
    if (image.isEmpty()) throw new Error("Empty native capture");
    await writeFile(path.join(output, filename), image.toPNG());
    summary.screenshots.push({ filename, status: "captured" });
  } catch (error) {
    summary.screenshots.push({
      filename,
      status: "unavailable",
      reason: String(error),
    });
  }
};

async function run() {
  try {
    app.setPath(
      "userData",
      await mkdtemp(path.join(os.tmpdir(), "lime-design-preview-")),
    );
    if (process.platform === "darwin") app.setActivationPolicy("prohibited");
    await app.whenReady();
    const { BrowserAnnotationHost, BrowserAnnotationEditorHost } = await import(
      pathToFileURL(bundle).href
    );
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/owner.html") {
        response
          .writeHead(200, { "Content-Type": "text/html" })
          .end("<!doctype html><title>Design fixture owner</title>");
        return;
      }
      if (pathname === "/page.html") {
        response
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            '<!doctype html><title>Design fixture page</title><style>body{margin:40px}#target{font:20px/1.5 sans-serif;color:rgb(10,20,30);display:inline-block;padding:20px}</style><button id="target">  Original  <span></span></button>',
          );
        return;
      }
      if (
        pathname === "/browser-annotation.html" ||
        pathname.startsWith("/assets/")
      ) {
        const file = path.resolve(snapshot, "dist", "." + pathname);
        if (!file.startsWith(path.join(snapshot, "dist") + path.sep)) {
          response.writeHead(403).end();
          return;
        }
        try {
          const contentType = file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html";
          response
            .writeHead(200, { "Content-Type": contentType })
            .end(await readFile(file));
        } catch {
          response.writeHead(404).end();
        }
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    await window.loadURL(base + "/owner.html");
    pageView = new WebContentsView({
      webPreferences: {
        preload: path.join(snapshot, "dist-electron/preload/browserPage.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    window.contentView.addChildView(pageView);
    const content = window.getContentBounds();
    pageView.setBounds({
      x: 0,
      y: 0,
      width: content.width,
      height: content.height,
    });
    summary.nativeBounds = {
      content,
      page: pageView.getBounds(),
    };
    pageView.setVisible(true);
    for (const contents of [window.webContents, pageView.webContents])
      contents.on("preload-error", (_event, preload, error) =>
        summary.errors.push({
          kind: "preload",
          preload,
          message: String(error),
        }),
      );
    pageView.webContents.on("console-message", (event) => {
      if (event.level === "error")
        summary.errors.push({ kind: "page-console", message: event.message });
    });
    await pageView.webContents.loadURL(base + "/page.html");
    await pageView.webContents.executeJavaScript(
      "globalThis.originalNodes=Array.from(document.querySelector('#target').childNodes)",
    );
    const identity = {
      browserSessionId: "browser-design-fixture",
      threadId: "thread-design-fixture",
      tabId: "tab-design-fixture",
      viewId: "view-design-fixture",
      ownerWebContentsId: window.webContents.id,
      webContentsId: pageView.webContents.id,
      windowId: window.id,
      pageRevision: 1,
    };
    const events = [];
    annotations = new BrowserAnnotationHost({
      resolveTarget: () => ({
        identity,
        selected: true,
        annotationAllowed,
        view: pageView,
        window,
      }),
      screenshotMode: () => "always",
      emit: (event, payload) => events.push({ event, payload }),
    });
    let began = false;
    observePage = (_event, payload) => {
      if (_event.sender !== pageView.webContents) return;
      summary.pageEvents.push({
        type: payload.type,
        reason: payload.reason,
        hasDesignSnapshot: !!payload.designSnapshot,
      });
      if (payload.type === "began") began = true;
    };
    ipcMain.on("browser-annotation-page-event", observePage);
    const session = await annotations.invoke(
      window,
      "browser_tab_begin_annotation",
      { tabId: identity.tabId, kind: "element" },
    );
    await waitFor("private page began", () => began);
    const point = await pageView.webContents.executeJavaScript(
      "(() => { const r=document.querySelector('#target').getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10),width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},visibility:document.visibilityState};})()",
    );
    summary.inputPoint = point;
    await pageView.webContents.executeJavaScript(`(() => {
      const target=document.querySelector('#target');
      for(const type of ['pointermove','pointerdown','pointerup']) target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:${point.x},clientY:${point.y}}));
    })()`);
    const selected = await waitFor(
      "native selected element",
      () =>
        events.find(
          (event) => event.event === "browser-tab-annotation-selection",
        )?.payload,
    );
    check(
      "native selection has immutable CSS/text baseline",
      selected.kind === "element" &&
        selected.designSnapshot?.text?.previousValue === "Original",
    );
    const captured = await annotations.invoke(
      window,
      "browser_tab_capture_annotation",
      { tabId: identity.tabId, annotationId: session.annotationId },
    );
    summary.capture = {
      annotationId: captured.annotationId,
      screenshotStatus: captured.screenshotStatus,
      failureReason: captured.failureReason,
      hasScreenshot: !!captured.screenshot,
    };
    check(
      "capture uses the same annotation and has an explicit screenshot outcome",
      captured.annotationId === session.annotationId &&
        (captured.screenshotStatus === "captured" ||
          (captured.screenshotStatus === "timeout" &&
            captured.failureReason === "page-ready-timeout" &&
            !captured.screenshot)),
    );
    const resource = JSON.parse(
      await readFile(
        path.join(root, "src/i18n/resources/zh-CN/browserAnnotation.json"),
        "utf8",
      ),
    );
    const text = (key) => resource["browserAnnotation." + key];
    const labels = Object.fromEntries(
      [
        "title",
        "placeholder",
        "save",
        "send",
        "close",
        "element",
        "region",
        "text",
        "captureFailed",
        "sending",
        "sendFailed",
        "imageAttachment",
        "removeImage",
        "previewImage",
        "closePreview",
        "attachmentFailed",
        "attachmentLoading",
      ].map((key) => [key, text(key)]),
    );
    labels.design = {
      title: text("designTitle"),
      text: text("designText"),
      reset: text("designReset"),
      invalid: text("designInvalid"),
    };
    editor = new BrowserAnnotationEditorHost(
      (event) => {
        annotations.previewDesign(event);
        summary.events.push({
          action: event.action,
          revision: event.revision,
          body: event.body,
          designChange: event.designChange,
        });
      },
      {
        preloadPath: path.join(
          snapshot,
          "dist-electron/preload/browserAnnotationEditor.cjs",
        ),
      },
    );
    await editor.show(
      window,
      identity.viewId,
      {
        editorId: "design-editor",
        annotationId: session.annotationId,
        draftId: session.annotationId,
        body: "",
        attachedImages: [],
        revision: 0,
        selection: selected.selection,
        screenshotStatus: captured.screenshotStatus,
        labels,
        appearance: "light",
        designSnapshot: selected.designSnapshot,
        designChange: null,
      },
      pageView.webContents,
      pageView.getBounds(),
      identity,
    );
    const view = window.contentView.children.find(
      (child) => child !== pageView,
    );
    view.webContents.setBackgroundThrottling(false);
    view.webContents.on("preload-error", (_event, preload, error) =>
      summary.errors.push({ kind: "preload", preload, message: String(error) }),
    );
    await waitFor("trusted design UI ready", () =>
      view.webContents.executeJavaScript(
        "!!document.querySelector('[data-testid=browser-design-editor]')",
      ),
    );
    if (captured.screenshotStatus === "timeout")
      check(
        "hidden-frame screenshot timeout keeps the editable draft and visible fallback",
        await view.webContents.executeJavaScript(
          `document.body.textContent.includes(${JSON.stringify(labels.captureFailed)})`,
        ),
      );
    await view.webContents.executeJavaScript(
      "document.querySelector('details').open=true",
    );
    await changeField(view, "font-size", "28px");
    await changeField(view, labels.design.text, "Revised");
    const revised = await waitFor("actual page preview", async () => {
      const state = await inspectPage();
      return state.text === "Revised" && state.fontSize === "28px"
        ? state
        : false;
    });
    check(
      "trusted editor private IPC applies real CSS/text to the same WebContents",
      revised.previewAttributes.length > 0 &&
        pageView.webContents.id === identity.webContentsId,
    );
    check(
      "untrusted page has no privileged bridge or Node",
      revised.genericBridge === "undefined" &&
        revised.narrowBridge === "undefined" &&
        revised.node === "undefined",
    );
    await captureDiagnostic(pageView, "page-preview.png");
    await captureDiagnostic(view, "editor-preview.png");
    const count = summary.events.length;
    await changeField(view, "font-size", "red; } body { display:none");
    const invalid = await view.webContents.executeJavaScript(
      `(() => {const saves=Array.from(document.querySelectorAll('button')).filter(node=>node.textContent===${JSON.stringify(labels.save)});return {invalid:document.querySelector('input[aria-label="font-size"]').getAttribute('aria-invalid'),disabled:saves.length===1&&saves[0].disabled};})()`,
    );
    check(
      "invalid CSS cannot publish a draft or mutate the page",
      invalid.invalid === "true" &&
        invalid.disabled &&
        summary.events.length === count &&
        (await inspectPage()).fontSize === "28px",
    );
    await click(view, labels.design.reset);
    const restored = await waitFor("reset restores original DOM", async () => {
      const state = await inspectPage();
      return state.sameNodes && state.fontSize === "20px" ? state : false;
    });
    check(
      "reset restores original text node identities and removes temporary attributes",
      restored.text === "  Original  " &&
        restored.previewAttributes.length === 0,
    );
    await changeField(view, "font-size", "24px");
    await changeField(view, labels.design.text, "Saved design");
    await waitFor(
      "second actual preview",
      async () => (await inspectPage()).text === "Saved design",
    );
    await click(view, labels.save);
    await waitFor(
      "trusted design-only save and close",
      () =>
        summary.events.some(
          (event) =>
            event.action === "save" &&
            !event.body &&
            event.designChange?.text?.value === "Saved design",
        ) && summary.events.at(-1)?.action === "close",
    );
    check(
      "design-only save retains its queued preview after editor close",
      (await inspectPage()).fontSize === "24px" &&
        (await inspectPage()).text === "Saved design",
    );
    await annotations.invoke(window, "browser_tab_set_annotation_markers", {
      tabId: identity.tabId,
      visible: false,
    });
    check(
      "hiding markers keeps the actual CSS/text design",
      (await inspectPage()).text === "Saved design",
    );
    const original = {
      tabId: identity.tabId,
      identity,
      gestureId: "native-original",
      original: true,
    };
    await annotations.invoke(
      window,
      "browser_tab_set_annotation_original",
      original,
    );
    await waitFor("original shows native nodes", async () => {
      const state = await inspectPage();
      return state.sameNodes && state.fontSize === "20px";
    });
    check(
      "held original restores native CSS and original text nodes",
      (await inspectPage()).text === "  Original  ",
    );
    await annotations.invoke(window, "browser_tab_set_annotation_original", {
      ...original,
      gestureId: "stale-release",
      original: false,
    });
    check(
      "a stale release cannot end the current original hold",
      (await inspectPage()).sameNodes,
    );
    await annotations.invoke(window, "browser_tab_set_annotation_original", {
      ...original,
      original: false,
    });
    await waitFor(
      "release restores actual saved design",
      async () => (await inspectPage()).text === "Saved design",
    );
    check(
      "release replays the saved design with markers still hidden",
      (await inspectPage()).fontSize === "24px",
    );
    await annotations.invoke(window, "browser_tab_set_annotation_original", {
      ...original,
      gestureId: "native-agent",
    });
    annotationAllowed = false;
    annotations.revalidateView(identity.viewId);
    await waitFor(
      "Agent ownership hides preview",
      async () => (await inspectPage()).sameNodes,
    );
    check(
      "Agent takeover restores original before any new action",
      (await inspectPage()).fontSize === "20px",
    );
    annotationAllowed = true;
    annotations.revalidateView(identity.viewId);
    await waitFor(
      "private same-document restore",
      async () => (await inspectPage()).text === "Saved design",
    );
    check(
      "Agent lifecycle clears an original hold without changing marker preference",
      (await inspectPage()).fontSize === "24px",
    );
    await annotations.invoke(window, "browser_tab_cancel_annotation", {
      tabId: identity.tabId,
      annotationId: session.annotationId,
    });
    await waitFor(
      "cancel removes last saved preview",
      async () => (await inspectPage()).sameNodes,
    );
    check(
      "cancel leaves the original page and same native WebContents",
      (await inspectPage()).previewAttributes.length === 0 &&
        pageView.webContents.id === identity.webContentsId,
    );
    check("window stayed hidden", !window.isVisible());
    check("no native preload errors", summary.errors.length === 0);
    summary.identity = identity;
    summary.result = "pass";
  } catch (error) {
    summary.result = "fail";
    summary.error = error.stack ?? String(error);
  } finally {
    if (observePage) ipcMain.off("browser-annotation-page-event", observePage);
    editor?.dispose();
    annotations?.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    if (server) await new Promise((resolve) => server.close(resolve));
    summary.completedAt = new Date().toISOString();
    await writeFile(
      path.join(output, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
    app.exit(summary.result === "pass" ? 0 : 1);
  }
}
app.on("window-all-closed", () => {});
void run();
