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
    response.end(`<!doctype html><title>Native selection and drag fixture</title>
      <style>body{margin:20px;font:16px sans-serif}select{min-width:180px;margin:12px}section{display:flex;gap:140px;margin:25px 0}.box{width:150px;height:65px;border:2px solid;padding:10px;touch-action:none;user-select:none}#html-source{background:#cfe}#html-target{background:#def}</style>
      <label>Single choice<select aria-label="Single choice" id="single"><option value="a">Alpha</option><option value="b">Beta</option><option value="x" disabled>Disabled</option></select></label>
      <label>Multiple choice<select aria-label="Multiple choice" id="multi" multiple><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select></label>
      <section><div role="button" aria-label="Pointer source" class="box" id="source">Pointer source</div><div role="button" aria-label="Pointer destination" class="box" id="target">Pointer destination</div></section>
      <section><div role="button" aria-label="HTML source" class="box" id="html-source" draggable="true">HTML source</div><div role="button" aria-label="HTML destination" class="box" id="html-target">HTML destination</div></section>
      <output id="result">Ready</output>
      <script>
      window.selections=[];window.pointerEvents=[];window.dragEvents=[];
      document.querySelectorAll('select').forEach(s=>['input','change'].forEach(t=>s.addEventListener(t,e=>selections.push({type:e.type,trusted:e.isTrusted,value:s.value}))));
      const source=document.querySelector('#source');
      source.addEventListener('pointerdown',e=>{source.setPointerCapture(e.pointerId);pointerEvents.push({type:e.type,x:e.clientX,trusted:e.isTrusted})});
      ['pointermove','pointerup'].forEach(t=>source.addEventListener(t,e=>{if(e.buttons||t==='pointerup')pointerEvents.push({type:e.type,x:e.clientX,trusted:e.isTrusted})}));
      document.querySelector('#html-source').addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain','native-transfer');dragEvents.push({type:e.type,trusted:e.isTrusted})});
      const target=document.querySelector('#html-target');
      ['dragenter','dragover','drop'].forEach(t=>target.addEventListener(t,e=>{e.preventDefault();dragEvents.push({type:e.type,trusted:e.isTrusted});if(t==='drop'){window.dropped=e.dataTransfer.getData('text/plain');document.querySelector('#result').textContent=dropped}}));
      </script>`);
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
  page.debugger.on("message", (_event, method, params) => {
    if (method === "Input.dragIntercepted") {
      (summary.interceptedDragData ??= []).push(params.data);
      process.stdout.write(`drag-mask:${params.data?.dragOperationsMask}\n`);
    }
  });
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
    assert(definitions.some((entry) => entry.name === "select"));
    assert(definitions.some((entry) => entry.name === "drag"));
  });
  registry.observeClientResult(
    "thread/start",
    { thread: { id: scope.threadId } },
    { ownerWebContentsId: window.webContents.id },
  );
  async function call(tool, args = {}, execution = {}) {
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
          callId: execution.callId ?? `call-${sequence}`,
          namespace: "browser",
          tool,
          arguments: { tabId: "pointer-tab", ...args },
          phase: "preflight",
          ...execution,
        },
      },
    );
    assert(handled);
    assert(response);
    if (response.approval)
      return { status: "approval_required", approval: response.approval };
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
            entry.name === name &&
            ["combobox", "listbox", "button"].includes(entry.role) &&
            Number.isSafeInteger(entry.backendNodeId),
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
  async function approved(tool, args, beforeApprove) {
    const callId = `approved-${sequence + 1}`;
    const preflight = await call(tool, args, { callId });
    assert.equal(preflight.status, "approval_required");
    assert(preflight.approval.approvalToken);
    if (beforeApprove) await beforeApprove();
    return call(tool, args, {
      callId,
      phase: "approvedExecute",
      approvalToken: preflight.approval.approvalToken,
    });
  }
  await approved(
    "select",
    { ...(await observe("Single choice")), options: [{ value: "b" }] },
    async () => {
      assert.equal(
        await page.executeJavaScript("document.querySelector('#single').value"),
        "a",
      );
    },
  );
  check("selection-preflight-does-not-mutate", () => {});
  assert.equal(
    await page.executeJavaScript("document.querySelector('#single').value"),
    "b",
  );
  check("native-select-by-value-and-readback", () => {});
  await approved("select", {
    ...(await observe("Single choice")),
    options: [{ label: "Alpha", index: 0 }],
  });
  assert.equal(
    await page.executeJavaScript("document.querySelector('#single').value"),
    "a",
  );
  check("native-select-by-label-and-index", () => {});
  await approved("select", {
    ...(await observe("Multiple choice")),
    options: [{ value: "b" }, { index: 2 }],
  });
  assert.deepEqual(
    await page.executeJavaScript(
      "Array.from(document.querySelector('#multi').selectedOptions,o=>o.value)",
    ),
    ["b", "c"],
  );
  await approved("select", {
    ...(await observe("Multiple choice")),
    options: [],
  });
  assert.deepEqual(
    await page.executeJavaScript(
      "Array.from(document.querySelector('#multi').selectedOptions,o=>o.value)",
    ),
    [],
  );
  check("native-multiple-selection-and-clear", () => {});
  await assert.rejects(
    call("select", {
      ...(await observe("Single choice")),
      options: [{ value: "x" }],
    }),
    /disabled/,
  );
  check("disabled-option-is-rejected", () => {});
  await assert.rejects(
    approved(
      "select",
      { ...(await observe("Single choice")), options: [{ value: "b" }] },
      () =>
        page.executeJavaScript(
          "document.querySelector('#single').options[1].textContent='Changed Beta'",
        ),
    ),
    /changed after preflight/,
  );
  check("changed-options-invalidate-approval", () => {});
  const selections = await page.executeJavaScript("selections");
  assert.equal(selections.length, 8);
  assert(selections.every((e) => e.trusted === false));
  summary.selectionEvents = selections;
  check("selection-events-explicitly-synthetic", () => {});
  await page.executeJavaScript(
    "document.querySelector('#single').onchange=function(){this.selectedOptions[0].value='rewritten'};void 0",
  );
  await assert.rejects(
    approved("select", {
      ...(await observe("Single choice")),
      options: [{ value: "b" }],
    }),
    /outcome is unknown/,
  );
  await page.executeJavaScript(
    "document.querySelector('#single').onchange=null",
  );
  check("selection-handler-rewrite-reports-unknown-outcome", () => {});
  await assert.rejects(
    call("select", {
      ...(await observe("Multiple choice")),
      options: [{ index: 0 }, { value: "a" }],
    }),
    /duplicate choices/,
  );
  check("duplicate-options-are-rejected-before-approval", () => {});
  async function dragArgs(sourceName, targetName) {
    const observed = await call("observe");
    const node = (name) =>
      observed.data.nodes.find(
        (n) =>
          n.name === name &&
          n.role === "button" &&
          Number.isSafeInteger(n.backendNodeId),
      );
    assert(node(sourceName));
    assert(node(targetName));
    return {
      snapshotId: observed.data.snapshotId,
      backendNodeId: node(sourceName).backendNodeId,
      targetBackendNodeId: node(targetName).backendNodeId,
    };
  }
  const pointer = await approved(
    "drag",
    await dragArgs("Pointer source", "Pointer destination"),
    async () => {
      assert.deepEqual(await page.executeJavaScript("pointerEvents"), []);
    },
  );
  assert.equal(pointer.data.mode, "pointer");
  const pointerEvents = await page.executeJavaScript("pointerEvents");
  assert(pointerEvents.some((e) => e.type === "pointerdown"));
  assert(pointerEvents.some((e) => e.type === "pointerup"));
  assert(pointerEvents.every((e) => e.trusted));
  assert(pointerEvents.at(-1).x - pointerEvents[0].x > 200);
  summary.pointerEvents = pointerEvents;
  check("native-pointer-drag-is-trusted-and-reaches-destination", () => {});
  const html = await approved(
    "drag",
    await dragArgs("HTML source", "HTML destination"),
  );
  assert.equal(html.data.mode, "html5");
  assert.equal(await page.executeJavaScript("dropped"), "native-transfer");
  const dragEvents = await page.executeJavaScript("dragEvents");
  assert(dragEvents.some((e) => e.type === "drop"));
  assert(dragEvents.every((e) => e.trusted));
  summary.dragEvents = dragEvents;
  check("native-html5-drag-drops-trusted-data", () => {});
  const dropCount = dragEvents.filter((event) => event.type === "drop").length;
  await page.executeJavaScript(
    "document.querySelector('#html-source').addEventListener('dragstart',()=>{const cover=document.createElement('div');cover.id='cover';cover.style='position:fixed;inset:0;z-index:999;background:#ffffff55';document.body.append(cover)},{once:true})",
  );
  await assert.rejects(
    approved("drag", await dragArgs("HTML source", "HTML destination")),
    /obscured/,
  );
  assert.equal(
    await page.executeJavaScript(
      "dragEvents.filter(e=>e.type==='drop').length",
    ),
    dropCount,
  );
  await page.executeJavaScript("document.querySelector('#cover').remove()");
  check("obscured-mid-drag-destination-is-cancelled-without-drop", () => {});
  await approved("drag", await dragArgs("HTML source", "HTML destination"));
  assert.equal(
    await page.executeJavaScript(
      "dragEvents.filter(e=>e.type==='drop').length",
    ),
    dropCount + 1,
  );
  check("html5-drag-works-after-cancellation-and-cleanup", () => {});
  fs.writeFileSync(
    path.join(root, "native-selection-drag.png"),
    (await page.capturePage()).toPNG(),
  );
  const final = await state();
  assert.equal(final.webContentsId, page.id);
  assert.equal(final.controlOwner, "agent");
  assert.equal(interrupted, 0);
  check("same-page-control-and-input-observer-retained", () => {});
  await host.turnEnded(scope.threadId, "pointer-turn");
  await assert.rejects(
    call("drag", {
      snapshotId: "stale",
      backendNodeId: 1,
      targetBackendNodeId: 2,
    }),
    /claimed/,
  );
  check("turn-terminal-revokes-drag", () => {});
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
