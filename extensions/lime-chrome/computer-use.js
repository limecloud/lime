// Native Messaging is the only transport. Authority comes from the shared
// App Server's target-bound grant, lease, generation and fencing token.
import { BrowserSession } from "./browser-session.js";

const browserSession = new BrowserSession();
const HOST = "com.limecloud.lime.computer_use";
let port;
let generation = 1;
let signature = "";
let profileId;
let reconnect;
let recovery = Promise.resolve();
let responses = [];
const approvals = new Map();
const active = new Map();
const granted = new Set();
let trackedTabs = new Set();
let fence = 0;

const identityKey = (target) =>
  JSON.stringify([target.profileId, target.tabId, target.origin, target.url]);
const text = (key) => chrome.i18n.getMessage(key) || key;
function changed() {
  generation++;
  granted.clear();
}
chrome.tabs.onUpdated.addListener((id, change) => {
  if (
    [...granted].some((key) => JSON.parse(key)[1] === String(id)) &&
    (change.status === "loading" || change.url)
  )
    changed();
});
chrome.tabs.onRemoved.addListener((id) => {
  if (trackedTabs.has(id)) changed();
  void browserSession.removeTab(id).catch(console.warn);
});
chrome.tabs.onCreated.addListener((tab) => {
  void browserSession.claimChildTab(tab).catch(console.warn);
});

async function snapshot() {
  const tabs = (await chrome.tabs.query({}))
    .filter((tab) => /^https?:\/\//.test(tab.url || ""))
    .slice(0, 128);
  const targets = tabs
    .map((tab) => ({
      identity: {
        type: "chrome",
        origin: new URL(tab.url).origin,
        profileId,
        tabId: String(tab.id),
        url: tab.url,
      },
      nativeApp: null,
      locked: false,
      capabilities: [
        "observe",
        "screenshot",
        "click",
        "type",
        "key",
        "scroll",
        "drag",
        "navigate",
      ],
    }))
    .sort((a, b) => a.identity.tabId.localeCompare(b.identity.tabId));
  const next = JSON.stringify(targets);
  trackedTabs = new Set(tabs.map((tab) => tab.id));
  if (signature !== next) {
    const previous = signature ? JSON.parse(signature) : [];
    const additionsOnly =
      targets.length > previous.length &&
      previous.every((target) =>
        targets.some(
          (candidate) => JSON.stringify(candidate) === JSON.stringify(target),
        ),
      );
    if (!additionsOnly) changed();
    signature = next;
  }
  return {
    generation,
    readiness: "ready",
    targets,
    reason: null,
    setupSteps: [],
  };
}

async function poll() {
  const current = port;
  if (!current) return;
  try {
    const state = await snapshot();
    if (current !== port) return;
    current.postMessage({
      snapshot: state,
      responses: responses.splice(0, 16),
    });
  } catch (error) {
    console.warn("Lime native connection unavailable", error.message);
  }
}

async function connect() {
  await recovery;
  if (port) return;
  profileId =
    (await chrome.storage.local.get("profileId")).profileId ||
    crypto.randomUUID();
  await chrome.storage.local.set({ profileId });
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      port = undefined;
      changed();
      for (const command of active.values()) command.canceled = true;
      for (const approve of approvals.values()) approve(false);
      approvals.clear();
      recovery = browserSession.disconnect().catch(console.warn);
      chrome.storage.session.set({
        connected: false,
        error: error || text("disconnected"),
      });
      clearTimeout(reconnect);
      reconnect = setTimeout(connect, 2000);
    });
    port.onMessage.addListener((message) => {
      if (message.protocol !== 1) {
        port.disconnect();
        return;
      }
      for (const id of message.cancels || []) {
        const command = active.get(id);
        if (command) command.canceled = true;
        approvals.get(id)?.(false);
      }
      for (const command of message.commands || []) void handle(command);
      chrome.storage.session.set({ connected: true, error: "" });
      setTimeout(poll, 150);
    });
    await poll();
  } catch (error) {
    port = undefined;
    chrome.storage.session.set({ connected: false, error: error.message });
  }
}

async function validate(command, requireConsent = true) {
  if (command.canceled || Date.now() >= command.deadline || !port)
    throw new Error("Canceled or expired; outcome_unknown");
  const state = await snapshot();
  if (
    command.generation !== state.generation ||
    !state.targets.some(
      (t) => identityKey(t.identity) === identityKey(command.target),
    )
  )
    throw new Error("Target changed; request access again");
  if (requireConsent && !granted.has(identityKey(command.target)))
    throw new Error("Target has no user approval");
  const tab = await chrome.tabs.get(Number(command.target.tabId));
  if (
    tab.url !== command.target.url ||
    new URL(tab.url).origin !== command.target.origin
  )
    throw new Error("Tab navigation changed");
  return tab.id;
}

async function handle(command) {
  if (active.has(command.id)) return;
  active.set(command.id, command);
  let result, error;
  try {
    if (command.method === "endTurn") {
      if (command.canceled || Date.now() >= command.deadline || !port)
        throw new Error("Canceled or expired browser cleanup");
      result = await browserSession.endTurn(command.params.owner);
    } else if (command.method === "setup") {
      await validate(command, false);
      const accepted = await new Promise((resolve) => {
        const timer = setTimeout(
          () => {
            approvals.delete(command.id);
            resolve(false);
          },
          Math.min(60000, command.deadline - Date.now()),
        );
        approvals.set(command.id, (value) => {
          clearTimeout(timer);
          approvals.delete(command.id);
          resolve(value);
        });
        chrome.windows
          .create({
            url: chrome.runtime.getURL(
              `computer-use.html?request=${command.id}`,
            ),
            type: "popup",
            width: 460,
            height: 440,
          })
          .catch(() => approvals.get(command.id)?.(false));
      });
      if (accepted) {
        await validate(command, false);
        granted.add(identityKey(command.target));
      }
      result = { accepted };
    } else if (command.method === "execute") {
      await validate(command);
      if (
        !Number.isSafeInteger(command.params.fence) ||
        command.params.fence < fence
      )
        throw new Error("Stale control fence");
      fence = command.params.fence;
      result = await execute(command);
    } else throw new Error("Unknown native operation");
  } catch (e) {
    error = e.message;
  } finally {
    approvals.delete(command.id);
    active.delete(command.id);
  }
  responses.push({ id: command.id, ...(error ? { error } : { result }) });
}

async function execute(command) {
  const operation = command.params.operation;
  const tabId = await validate(command);
  const owner = command.params.owner;
  const revalidate = async () => {
    await validate(command);
    if (command.params.fence !== fence)
      throw new Error("Control fence changed");
  };
  switch (operation.action) {
    case "name_session":
      return browserSession.nameSession(
        owner,
        tabId,
        operation.name,
        revalidate,
      );
    case "create_tab":
      return browserSession.createTab(owner, tabId, operation.url, revalidate);
    case "mark_tab":
      return browserSession.markTab(
        owner,
        tabId,
        operation.tab_id,
        operation.mark,
        revalidate,
      );
  }
  await browserSession.claimUserTab(owner, tabId, revalidate);
  if (operation.action === "observe") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: observe,
      args: [operation.max_depth, operation.max_nodes],
    });
    return { status: "observed", ...result.result };
  }
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3").catch((error) => {
    if (!error.message.includes("already attached")) throw error;
  });
  const send = async (method, params = {}) => {
    await validate(command);
    if (command.params.fence !== fence)
      throw new Error("Control fence changed");
    return chrome.debugger.sendCommand(target, method, params);
  };
  try {
    const point = { x: operation.x, y: operation.y };
    switch (operation.action) {
      case "screenshot": {
        const image = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        if (image.data.length > 800000)
          throw new Error("Screenshot exceeds native message limit");
        return { status: "captured", mimeType: "image/png", data: image.data };
      }
      case "click":
        for (let i = 1; i <= operation.count; i++) {
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            ...point,
            button: operation.button,
            clickCount: i,
          });
          await chrome.debugger.sendCommand(
            target,
            "Input.dispatchMouseEvent",
            {
              type: "mouseReleased",
              ...point,
              button: operation.button,
              clickCount: i,
            },
          );
        }
        break;
      case "type":
        await send("Input.insertText", { text: operation.text });
        break;
      case "key": {
        const modifiers = operation.modifiers.reduce(
          (mask, key) =>
            mask | ({ option: 1, control: 2, command: 4, shift: 8 }[key] || 0),
          0,
        );
        const key =
          {
            return: "Enter",
            escape: "Escape",
            tab: "Tab",
            backspace: "Backspace",
            delete: "Delete",
            space: " ",
          }[operation.key.toLowerCase()] || operation.key;
        const code =
          {
            Enter: 13,
            Escape: 27,
            Tab: 9,
            Backspace: 8,
            Delete: 46,
            ArrowLeft: 37,
            ArrowUp: 38,
            ArrowRight: 39,
            ArrowDown: 40,
          }[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          modifiers,
          windowsVirtualKeyCode: code,
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key,
          modifiers,
          windowsVirtualKeyCode: code,
        });
        break;
      }
      case "scroll":
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          ...point,
          deltaX: operation.delta_x,
          deltaY: operation.delta_y,
        });
        break;
      case "drag":
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...point,
          button: "left",
          clickCount: 1,
        });
        try {
          for (let i = 1; i <= 10; i++) {
            await new Promise((resolve) =>
              setTimeout(resolve, operation.duration_ms / 10),
            );
            await send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: operation.x + ((operation.to_x - operation.x) * i) / 10,
              y: operation.y + ((operation.to_y - operation.y) * i) / 10,
              button: "left",
              buttons: 1,
            });
          }
        } finally {
          await chrome.debugger.sendCommand(
            target,
            "Input.dispatchMouseEvent",
            {
              type: "mouseReleased",
              x: operation.to_x,
              y: operation.to_y,
              button: "left",
              clickCount: 1,
            },
          );
        }
        break;
      default:
        throw new Error("Unsupported Chrome action");
    }
    return { status: "submitted", readbackRequired: true };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

function observe(maxDepth, maxNodes) {
  const nodes = [];
  function walk(element, depth) {
    if (
      depth > maxDepth ||
      nodes.length >= maxNodes ||
      ["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)
    )
      return;
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      nodes.push({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        name: (
          element.getAttribute("aria-label") ||
          element.innerText ||
          ""
        ).slice(0, 400),
        value:
          ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) &&
          element.type !== "password"
            ? String(element.value).slice(0, 2048)
            : undefined,
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
    for (const child of element.children) walk(child, depth + 1);
  }
  walk(document.body, 0);
  return {
    title: document.title,
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    nodes,
  };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(""))
  )
    return;
  if (message.type === "state") {
    const command = active.get(message.request);
    Promise.all([
      chrome.storage.session.get(["connected", "error"]),
      snapshot(),
    ]).then(([state, current]) =>
      respond({
        ...state,
        snapshot: current,
        target: command?.target,
        pending: approvals.has(message.request),
      }),
    );
    return true;
  }
  if (message.type === "approve") {
    approvals.get(message.request)?.(message.accepted === true);
    respond({ accepted: true });
  }
  if (message.type === "reconnect") {
    void connect();
    respond({ accepted: true });
  }
  if (message.type === "createTab") {
    if (typeof message.name !== "string" || typeof message.url !== "string")
      return;
    browserSession.createTask(message.name.slice(0, 100), message.url).then(
      (result) => respond(result),
      (error) =>
        respond({
          error: error.message === "invalidUrl" ? "invalidUrl" : "groupFailed",
        }),
    );
    return true;
  }
});
chrome.alarms.create("connect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => void connect());
recovery = browserSession.disconnect().catch(console.warn);
void connect();
