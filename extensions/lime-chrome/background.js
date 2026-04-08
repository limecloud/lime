const HEARTBEAT_INTERVAL_MS = 30000;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const PAGE_CAPTURE_RETRY_LIMIT = 3;
const TAB_COMMAND_RETRY_LIMIT = 3;
const TAB_COMMAND_RETRY_DELAY_MS = 250;
const KEEPALIVE_ALARM_NAME = "limeBridgeKeepAlive";
const KEEPALIVE_PERIOD_MINUTES = 1;
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const MAX_LOG_ENTRIES = 200;

const DEFAULT_SETTINGS = {
  serverUrl: "ws://127.0.0.1:8999",
  bridgeKey: "",
  profileKey: "default",
  monitoringEnabled: true,
  enabled: true,
};

let ws = null;
let isConnected = false;
let isConnecting = false;
let controlWs = null;
let isControlConnected = false;
let isControlConnecting = false;
let isEnabled = true;
let reconnectAttempts = 0;
let reconnectTimer = null;
let controlReconnectAttempts = 0;
let controlReconnectTimer = null;
let heartbeatTimer = null;
let activeTabId = null;
let monitoringEnabled = true;
let latestPageInfo = null;
let lastError = null;
let controlLastError = null;
let lastSettings = { ...DEFAULT_SETTINGS };
const debuggerAttachedTabIds = new Set();
const debuggerSessionRefCounts = new Map();
const expectedClosedSockets = new WeakSet();
const logBuffer = [];

function stringifyPayload(payload) {
  if (payload === undefined || payload === null) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch (_) {
    return String(payload);
  }
}

function pushLog(dir, method, detail) {
  const normalizedMethod = String(method || "").trim() || "event";
  const normalizedDetail = String(detail || "").trim();
  logBuffer.push({
    ts: Date.now(),
    dir: String(dir || "").trim() || "sys",
    method: normalizedMethod,
    detail: normalizedDetail,
  });
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
  }
}

function logInfo(message, payload) {
  pushLog("sys", message, stringifyPayload(payload));
  if (payload === undefined) {
    console.log(`[LimeBridge] ${message}`);
  } else {
    console.log(`[LimeBridge] ${message}`, payload);
  }
}

function logWarn(message, payload) {
  pushLog("warn", message, stringifyPayload(payload));
  if (payload === undefined) {
    console.warn(`[LimeBridge] ${message}`);
  } else {
    console.warn(`[LimeBridge] ${message}`, payload);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
      resolve({ ...DEFAULT_SETTINGS, ...stored });
    });
  });
}

function writeSettings(partial) {
  return new Promise((resolve) => {
    chrome.storage.local.set(partial, () => resolve());
  });
}

function applySettingsState(settings) {
  lastSettings = settings;
  monitoringEnabled = Boolean(settings.monitoringEnabled);
  isEnabled = settings.enabled !== false;
}

function buildObserverUrl(settings) {
  const serverUrl = String(settings.serverUrl || "").trim();
  const bridgeKey = String(settings.bridgeKey || "").trim();
  if (!serverUrl || !bridgeKey) {
    return null;
  }

  const normalized = serverUrl.replace(/\/$/, "");
  const profileKey = encodeURIComponent(settings.profileKey || "default");
  return `${normalized}/lime-chrome-observer/${encodeURIComponent(bridgeKey)}?profileKey=${profileKey}`;
}

function buildControlUrl(settings) {
  const serverUrl = String(settings.serverUrl || "").trim();
  const bridgeKey = String(settings.bridgeKey || "").trim();
  if (!serverUrl || !bridgeKey) {
    return null;
  }

  const normalized = serverUrl.replace(/\/$/, "");
  return `${normalized}/lime-chrome-control/${encodeURIComponent(bridgeKey)}`;
}

function isCapturableUrl(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

function isDebuggerAttachableUrl(url) {
  const normalizedUrl = String(url || "").trim();
  return /^(https?|file):\/\//i.test(normalizedUrl) || normalizedUrl === "about:blank";
}

function maskSettings(settings) {
  return {
    ...settings,
    bridgeKey: settings.bridgeKey ? "***" : "",
  };
}

function getRelayState() {
  if (!isEnabled) {
    return "disabled";
  }
  if (isConnected && isControlConnected) {
    return "connected";
  }
  return "disconnected";
}

function buildRelayCompatibilityPayload() {
  return {
    state: getRelayState(),
    connected: isConnected && isControlConnected,
    active: isConnected,
    reconnecting:
      isConnecting ||
      isControlConnecting ||
      Boolean(reconnectTimer) ||
      Boolean(controlReconnectTimer),
    attachedTabs: debuggerAttachedTabIds.size,
    agentTabs: 0,
    retainedTabs: 0,
    observerConnected: isConnected,
    controlConnected: isControlConnected,
    debuggerTabs: Array.from(debuggerAttachedTabIds.values()),
    activeTabId,
    lastError,
    controlLastError,
  };
}

function buildStatusPayload(extra) {
  return {
    isConnected,
    isConnecting,
    isControlConnected,
    isControlConnecting,
    enabled: isEnabled,
    monitoringEnabled,
    activeTabId,
    latestPageInfo,
    debuggerTabIds: Array.from(debuggerAttachedTabIds.values()),
    lastError,
    controlLastError,
    relayState: getRelayState(),
    settings: maskSettings(lastSettings),
    ...extra,
  };
}

function setBadgeState() {
  let text = "OFF";
  let color = "#64748b";

  if (isConnected) {
    text = "ON";
    color = "#16a34a";
  } else if (isConnecting || reconnectTimer) {
    text = "…";
    color = "#d97706";
  } else if (lastError && isEnabled) {
    text = "!";
    color = "#dc2626";
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function clearLastError() {
  lastError = null;
}

function rememberLastError(error) {
  const normalized = String(error || "").trim();
  lastError = normalized || "浏览器连接器执行失败";
}

function clearControlLastError() {
  controlLastError = null;
}

function rememberControlLastError(error) {
  const normalized = String(error || "").trim();
  controlLastError = normalized || "控制通道执行失败";
}

function broadcastStatus(extra) {
  setBadgeState();
  chrome.runtime
    .sendMessage({
      type: "STATUS_UPDATE",
      data: buildStatusPayload(extra),
    })
    .catch(() => {});
}

function ensureKeepAliveAlarm() {
  chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_PERIOD_MINUTES,
  });
}

function clearKeepAliveAlarm() {
  chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
}

function closeObserverSocket(socket, { shouldReconnect }) {
  if (!socket) {
    return;
  }
  if (!shouldReconnect) {
    expectedClosedSockets.add(socket);
  }
  try {
    socket.close();
  } catch (_) {}
}

function startHeartbeat() {
  clearHeartbeatTimer();
  heartbeatTimer = setInterval(() => {
    sendObserverMessage({ type: "heartbeat", timestamp: Date.now() });
    sendControlMessage({ type: "heartbeat", timestamp: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
}

function clearHeartbeatTimer() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearControlReconnectTimer() {
  if (controlReconnectTimer) {
    clearTimeout(controlReconnectTimer);
    controlReconnectTimer = null;
  }
}

function sendObserverMessage(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  pushLog("out", payload?.type || "observer_message", stringifyPayload(payload?.data));
  ws.send(JSON.stringify(payload));
  return true;
}

function sendControlMessage(payload) {
  if (!controlWs || controlWs.readyState !== WebSocket.OPEN) {
    return false;
  }
  pushLog("out", payload?.type || "control_message", stringifyPayload(payload?.data));
  controlWs.send(JSON.stringify(payload));
  return true;
}

async function disconnectObserver(options = {}) {
  const {
    disableAutoReconnect = false,
    reason = null,
    silent = false,
  } = options;

  clearReconnectTimer();
  clearControlReconnectTimer();
  clearHeartbeatTimer();

  if (disableAutoReconnect) {
    isEnabled = false;
    lastSettings = { ...lastSettings, enabled: false };
    await writeSettings({ enabled: false });
    clearKeepAliveAlarm();
  } else if (isEnabled) {
    ensureKeepAliveAlarm();
  }

  const socket = ws;
  ws = null;
  if (socket) {
    closeObserverSocket(socket, { shouldReconnect: false });
  }
  const controlSocket = controlWs;
  controlWs = null;
  if (controlSocket) {
    closeObserverSocket(controlSocket, { shouldReconnect: false });
  }

  isConnected = false;
  isConnecting = false;
  isControlConnected = false;
  isControlConnecting = false;
  if (typeof reason === "string" && reason.trim()) {
    rememberLastError(reason);
    rememberControlLastError(reason);
  } else if (disableAutoReconnect) {
    clearLastError();
    clearControlLastError();
  }

  if (!silent) {
    broadcastStatus();
  } else {
    setBadgeState();
  }
}

async function connectObserver(forceReconnect = false) {
  if (ws && ws.readyState === WebSocket.OPEN && !forceReconnect) {
    return;
  }
  if (isConnecting && !forceReconnect) {
    return;
  }

  clearReconnectTimer();
  clearHeartbeatTimer();

  const settings = await readSettings();
  applySettingsState(settings);
  if (!isEnabled) {
    clearKeepAliveAlarm();
    isConnecting = false;
    isConnected = false;
    isControlConnecting = false;
    isControlConnected = false;
    clearLastError();
    clearControlLastError();
    broadcastStatus();
    return;
  }

  ensureKeepAliveAlarm();

  const url = buildObserverUrl(settings);
  if (!url) {
    isConnecting = false;
    isConnected = false;
    rememberLastError("缺少 serverUrl 或 bridgeKey，无法建立连接");
    broadcastStatus();
    return;
  }

  if (forceReconnect && ws) {
    closeObserverSocket(ws, { shouldReconnect: false });
    ws = null;
  }

  isConnecting = true;
  isConnected = false;
  clearLastError();
  broadcastStatus();

  logInfo(`连接 observer: ${url}`);
  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) {
      return;
    }
    reconnectAttempts = 0;
    isConnected = true;
    isConnecting = false;
    clearLastError();
    startHeartbeat();
    broadcastStatus();
    void connectControl();
    void triggerPageCapture("ws_open");
  };

  socket.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      pushLog("in", payload?.type || "observer_message", stringifyPayload(payload?.data));
      await handleObserverMessage(payload);
    } catch (error) {
      logWarn("解析消息失败", error?.message || String(error));
    }
  };

  socket.onclose = () => {
    const shouldReconnect = !expectedClosedSockets.has(socket) && isEnabled;
    if (ws === socket) {
      ws = null;
    }
    isConnected = false;
    isConnecting = false;
    clearHeartbeatTimer();
    if (shouldReconnect) {
      scheduleReconnect();
    } else {
      reconnectAttempts = 0;
      broadcastStatus();
    }
  };

  socket.onerror = (error) => {
    rememberLastError(error?.message || String(error));
    broadcastStatus();
  };
}

async function connectControl(forceReconnect = false) {
  if (controlWs && controlWs.readyState === WebSocket.OPEN && !forceReconnect) {
    return;
  }
  if (isControlConnecting && !forceReconnect) {
    return;
  }

  clearControlReconnectTimer();

  const settings = await readSettings();
  applySettingsState(settings);
  if (!isEnabled) {
    isControlConnecting = false;
    isControlConnected = false;
    clearControlLastError();
    broadcastStatus();
    return;
  }

  const url = buildControlUrl(settings);
  if (!url) {
    isControlConnecting = false;
    isControlConnected = false;
    rememberControlLastError("缺少 serverUrl 或 bridgeKey，无法建立控制通道");
    broadcastStatus();
    return;
  }

  if (forceReconnect && controlWs) {
    closeObserverSocket(controlWs, { shouldReconnect: false });
    controlWs = null;
  }

  isControlConnecting = true;
  isControlConnected = false;
  clearControlLastError();
  broadcastStatus();

  logInfo(`连接 control: ${url}`);
  const socket = new WebSocket(url);
  controlWs = socket;

  socket.onopen = () => {
    if (controlWs !== socket) {
      return;
    }
    controlReconnectAttempts = 0;
    isControlConnected = true;
    isControlConnecting = false;
    clearControlLastError();
    broadcastStatus();
  };

  socket.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      pushLog("in", payload?.type || "control_message", stringifyPayload(payload?.data));
      await handleControlMessage(payload);
    } catch (error) {
      logWarn("解析控制消息失败", error?.message || String(error));
    }
  };

  socket.onclose = () => {
    const shouldReconnect = !expectedClosedSockets.has(socket) && isEnabled;
    if (controlWs === socket) {
      controlWs = null;
    }
    isControlConnected = false;
    isControlConnecting = false;
    if (shouldReconnect) {
      scheduleControlReconnect();
    } else {
      controlReconnectAttempts = 0;
      broadcastStatus();
    }
  };

  socket.onerror = (error) => {
    rememberControlLastError(error?.message || String(error));
    broadcastStatus();
  };
}

function scheduleReconnect() {
  if (!isEnabled || reconnectTimer) {
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_MIN_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
  );
  isConnecting = true;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectObserver();
  }, delay);
  logInfo(`连接断开，${delay}ms 后重连（第 ${reconnectAttempts} 次）`);
  broadcastStatus();
}

function scheduleControlReconnect() {
  if (!isEnabled || controlReconnectTimer) {
    return;
  }
  controlReconnectAttempts += 1;
  const delay = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_MIN_DELAY_MS * Math.pow(2, controlReconnectAttempts - 1),
  );
  isControlConnecting = true;
  controlReconnectTimer = setTimeout(async () => {
    controlReconnectTimer = null;
    await connectControl();
  }, delay);
  logInfo(`控制通道断开，${delay}ms 后重连（第 ${controlReconnectAttempts} 次）`);
  broadcastStatus();
}

async function ensureObserverEnabled() {
  if (isConnected || isConnecting) {
    if (!isControlConnected && !isControlConnecting) {
      await connectControl();
    }
    return;
  }
  const settings = await readSettings();
  applySettingsState(settings);
  if (!isEnabled) {
    broadcastStatus();
    return;
  }
  await connectObserver();
}

async function handleKeepAliveAlarm() {
  const settings = await readSettings();
  applySettingsState(settings);
  if (!isEnabled) {
    clearKeepAliveAlarm();
    isConnecting = false;
    isConnected = false;
    isControlConnecting = false;
    isControlConnected = false;
    broadcastStatus();
    return;
  }

  if (isConnected) {
    sendObserverMessage({ type: "heartbeat", timestamp: Date.now() });
    if (isControlConnected) {
      sendControlMessage({ type: "heartbeat", timestamp: Date.now() });
    } else if (!isControlConnecting) {
      await connectControl();
    }
    return;
  }

  if (!isConnecting) {
    await connectObserver();
  }
  if (isConnected && !isControlConnected && !isControlConnecting) {
    await connectControl();
  }
}

async function handleObserverMessage(payload) {
  const type = payload?.type;
  if (type === "heartbeat_ack" || type === "connection_ack") {
    clearLastError();
    broadcastStatus();
    return;
  }
  if (type === "force_disconnect") {
    logInfo("收到桌面端主动断开指令");
    await disconnectObserver({
      disableAutoReconnect: true,
      reason: payload?.message || "Lime 已主动断开当前扩展连接。",
    });
    return;
  }
  if (type !== "command" || !payload.data) {
    return;
  }
  await executeRemoteCommand(payload.data);
}

async function handleControlMessage(payload) {
  const type = payload?.type;
  if (type === "heartbeat_ack" || type === "connection_ack") {
    clearControlLastError();
    broadcastStatus();
    return;
  }
  if (type === "command_result" || type === "page_info_update") {
    broadcastStatus();
  }
}

async function getTabById(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

async function ensureCapturableTab(tabId) {
  const tab = await getTabById(tabId);
  if (!tab?.id) {
    throw new Error("没有可用的活动标签页");
  }
  if (!isCapturableUrl(tab.url)) {
    throw new Error("当前标签页不是可控制的网页，请切换到 http/https 页面后重试");
  }
  return tab;
}

async function ensureDebuggerAttached(tabId) {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    return false;
  }
  if (debuggerAttachedTabIds.has(tabId)) {
    return true;
  }

  const tab = await getTabById(tabId);
  if (!tab?.id || !isDebuggerAttachableUrl(tab.url)) {
    return false;
  }

  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  } catch (error) {
    const message = error?.message || String(error);
    if (/already attached/i.test(message)) {
      debuggerAttachedTabIds.add(tabId);
      return true;
    }
    logWarn("附着 Chrome debugger 失败", { tabId, message });
    return false;
  }

  debuggerAttachedTabIds.add(tabId);
  await Promise.allSettled([
    chrome.debugger.sendCommand({ tabId }, "Runtime.enable"),
    chrome.debugger.sendCommand({ tabId }, "Page.enable"),
    chrome.debugger.sendCommand({ tabId }, "DOM.enable"),
  ]);
  broadcastStatus();
  return true;
}

async function sendDebuggerCommand(tabId, method, params = {}) {
  if (!(await ensureDebuggerAttached(tabId))) {
    throw new Error("当前标签页未能附着 Lime CDP 会话，请确认插件已获取 debugger 权限。");
  }
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}

async function acquireDebuggerSession(tabId) {
  if (!(await ensureDebuggerAttached(tabId))) {
    throw new Error("当前标签页未能附着 Lime CDP 会话，请确认插件已获取 debugger 权限。");
  }

  const currentCount = debuggerSessionRefCounts.get(tabId) || 0;
  debuggerSessionRefCounts.set(tabId, currentCount + 1);

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;

    const activeCount = debuggerSessionRefCounts.get(tabId) || 0;
    if (activeCount <= 1) {
      debuggerSessionRefCounts.delete(tabId);
      await detachDebugger(tabId);
      return;
    }

    debuggerSessionRefCounts.set(tabId, activeCount - 1);
  };
}

async function withTransientDebuggerSession(tabId, task) {
  const release = await acquireDebuggerSession(tabId);
  try {
    return await task();
  } finally {
    await release();
  }
}

function readPayloadNumber(payload, key) {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readScrollInstruction(payload, fallbackText) {
  const text =
    typeof fallbackText === "string" && fallbackText.trim()
      ? fallbackText.trim()
      : typeof payload?.text === "string" && payload.text.trim()
        ? payload.text.trim()
        : "";
  let direction = "down";
  let amount = 500;

  if (text.includes(":")) {
    const parts = text.split(":");
    direction = normalizeText(parts[0]) || "down";
    const parsed = Number(parts[1]);
    if (!Number.isNaN(parsed) && parsed > 0) {
      amount = parsed;
    }
  } else if (text) {
    direction = normalizeText(text) || "down";
  }

  return { direction, amount };
}

async function executeDebuggerClick(tabId, payload) {
  const x = readPayloadNumber(payload, "x");
  const y = readPayloadNumber(payload, "y");
  if (x == null || y == null) {
    return false;
  }

  await withTransientDebuggerSession(tabId, async () => {
    await sendDebuggerCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await sendDebuggerCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  });
  return true;
}

async function executeDebuggerType(tabId, text, target) {
  if (target || !text) {
    return false;
  }
  await withTransientDebuggerSession(tabId, async () => {
    await sendDebuggerCommand(tabId, "Input.insertText", {
      text,
    });
  });
  return true;
}

async function executeDebuggerScroll(tabId, payload, text) {
  const { direction, amount } = readScrollInstruction(payload, text);
  const deltaX =
    direction === "left" ? -amount : direction === "right" ? amount : 0;
  const deltaY =
    direction === "up" ? -amount : direction === "down" ? amount : 0;

  await withTransientDebuggerSession(tabId, async () => {
    await sendDebuggerCommand(tabId, "Runtime.evaluate", {
      expression: `window.scrollBy(${deltaX}, ${deltaY});`,
      userGesture: true,
      awaitPromise: false,
    });
  });
  return {
    direction,
    amount,
  };
}

async function detachDebugger(tabId) {
  if (!debuggerAttachedTabIds.has(tabId)) {
    return;
  }
  debuggerSessionRefCounts.delete(tabId);
  debuggerAttachedTabIds.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {}
  broadcastStatus();
}

async function executeRemoteCommand(commandData) {
  const command = String(commandData.command || "").trim();
  if (!command) {
    return;
  }

  const requestId = commandData.requestId;
  const sourceClientId = commandData.sourceClientId;
  const waitForPageInfo = commandData.wait_for_page_info === true;

  if (command === "open_url") {
    await handleOpenUrl(commandData, waitForPageInfo);
    return;
  }

  if (command === "switch_tab") {
    await handleSwitchTab(commandData, waitForPageInfo);
    return;
  }

  if (command === "list_tabs") {
    await handleListTabs(commandData);
    return;
  }

  const tabId = await resolveCommandTargetTabId(commandData.target);
  if (!tabId) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: "没有可用的活动标签页",
    });
    return;
  }

  try {
    const tab = await ensureCapturableTab(tabId);
    const payload =
      commandData.payload && typeof commandData.payload === "object"
        ? commandData.payload
        : null;
    const text = commandData.text == null ? "" : String(commandData.text);
    let handledByDebugger = false;
    let debuggerMessage = null;

    if (command === "click") {
      handledByDebugger = await executeDebuggerClick(tab.id, payload);
      if (handledByDebugger) {
        debuggerMessage = "click 执行成功";
      }
    } else if (command === "type") {
      handledByDebugger = await executeDebuggerType(tab.id, text, commandData.target);
      if (handledByDebugger) {
        debuggerMessage = "type 执行成功";
      }
    } else if (command === "scroll" || command === "scroll_page") {
      const scrollResult = await executeDebuggerScroll(tab.id, payload, text);
      handledByDebugger = true;
      debuggerMessage = `${command} 执行成功`;
      commandData.text = `${scrollResult.direction}:${scrollResult.amount}`;
    }

    activeTabId = tab.id;
    let response = null;
    if (!handledByDebugger) {
      response = await sendCommandToTab(tab.id, {
        type: "EXECUTE_COMMAND",
        data: commandData,
      });

      if (response?.status === "error") {
        sendCommandResult({
          requestId,
          sourceClientId,
          status: "error",
          error: response.error || "命令执行失败",
        });
        return;
      }
    }

    sendCommandResult({
      requestId,
      sourceClientId,
      status: "success",
      message: debuggerMessage || response?.message || `${command} 执行成功`,
      data: response?.data,
    });

    if (waitForPageInfo || command === "get_page_info") {
      await triggerPageCapture("command_result");
    }
  } catch (error) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: error?.message || String(error),
    });
  }
}

async function resolveCommandTargetTabId(rawTarget) {
  const normalizedTarget = String(rawTarget || "").trim();
  if (!normalizedTarget) {
    return await resolveTargetTabId();
  }

  const byId = Number(normalizedTarget);
  if (Number.isInteger(byId) && byId > 0) {
    const tab = await getTabById(byId);
    if (tab?.id) {
      activeTabId = tab.id;
      return tab.id;
    }
  }

  return await resolveTargetTabId();
}

async function handleOpenUrl(commandData, waitForPageInfo) {
  const requestId = commandData.requestId;
  const sourceClientId = commandData.sourceClientId;
  const rawTarget = String(commandData.target || "").trim();
  let targetUrl = String(commandData.url || "").trim();
  if (!targetUrl) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: "open_url 缺少 url 参数",
    });
    return;
  }
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  try {
    const existingTabId = Number(rawTarget);
    const tab =
      Number.isInteger(existingTabId) && existingTabId > 0
        ? await new Promise((resolve, reject) => {
            chrome.tabs.update(
              existingTabId,
              { url: targetUrl, active: true },
              (updated) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve(updated);
              },
            );
          })
        : await new Promise((resolve, reject) => {
            chrome.tabs.create({ url: targetUrl, active: true }, (created) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve(created);
            });
          });

    activeTabId = tab.id;
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "success",
      message:
        Number.isInteger(existingTabId) && existingTabId > 0
          ? `已在标签页 ${existingTabId} 打开 ${targetUrl}`
          : `已打开 ${targetUrl}`,
      data: {
        tab_id: tab.id,
        url: targetUrl,
      },
    });

    if (waitForPageInfo) {
      await waitTabLoadComplete(tab.id, 30000);
      await triggerPageCapture("open_url_complete");
    }
  } catch (error) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: error?.message || String(error),
    });
  }
}

async function handleSwitchTab(commandData, waitForPageInfo) {
  const requestId = commandData.requestId;
  const sourceClientId = commandData.sourceClientId;
  const raw = String(commandData.target || "").trim();
  if (!raw) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: "switch_tab 缺少 target 参数",
    });
    return;
  }

  let targetTab = null;
  const byId = Number(raw);
  if (!Number.isNaN(byId) && byId > 0) {
    targetTab = await getTabById(byId);
  }

  if (!targetTab) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const idx = Number(raw);
    if (!Number.isNaN(idx) && idx >= 0 && idx < tabs.length) {
      targetTab = tabs[idx];
    }
  }

  if (!targetTab || !targetTab.id) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: `未找到标签页: ${raw}`,
    });
    return;
  }

  await chrome.tabs.update(targetTab.id, { active: true });
  activeTabId = targetTab.id;

  sendCommandResult({
    requestId,
    sourceClientId,
    status: "success",
    message: `已切换到标签页 ${targetTab.id}`,
    data: {
      tab_id: targetTab.id,
    },
  });

  if (waitForPageInfo) {
    await triggerPageCapture("switch_tab");
  }
}

async function handleListTabs(commandData) {
  const requestId = commandData.requestId;
  const sourceClientId = commandData.sourceClientId;

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const normalizedTabs = tabs
      .filter((tab) => Number.isInteger(tab.id) && Number.isInteger(tab.index))
      .map((tab) => ({
        id: tab.id,
        index: tab.index,
        active: tab.active === true,
        title: tab.title || "",
        url: tab.url || "",
      }));

    sendCommandResult({
      requestId,
      sourceClientId,
      status: "success",
      message: `已读取 ${normalizedTabs.length} 个标签页`,
      data: {
        tabs: normalizedTabs,
      },
    });
  } catch (error) {
    sendCommandResult({
      requestId,
      sourceClientId,
      status: "error",
      error: error?.message || String(error),
    });
  }
}

function sendCommandResult(data) {
  pushLog(
    data?.status === "error" ? "warn" : "sys",
    data?.command || "command_result",
    data?.error || data?.message || stringifyPayload(data?.data),
  );
  sendObserverMessage({
    type: "command_result",
    data,
  });
}

async function resolveTargetTabId() {
  if (activeTabId) {
    const tab = await getTabById(activeTabId);
    if (tab && !tab.discarded) {
      return tab.id;
    }
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    activeTabId = tabs[0].id;
    return tabs[0].id;
  }
  return null;
}

async function sendCommandToTab(tabId, payload) {
  let lastError = null;

  for (let attempt = 0; attempt <= TAB_COMMAND_RETRY_LIMIT; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (sendError) {
      lastError = sendError;
      try {
        await injectContentScript(tabId);
        return await chrome.tabs.sendMessage(tabId, payload);
      } catch (injectError) {
        lastError = injectError;
      }
    }

    if (
      attempt >= TAB_COMMAND_RETRY_LIMIT ||
      !looksLikeTransientTabCommandError(lastError)
    ) {
      throw lastError;
    }

    const delayMs = TAB_COMMAND_RETRY_DELAY_MS * (attempt + 1);
    logWarn("标签页命令执行命中瞬态错误，准备重试", {
      tabId,
      attempt: attempt + 1,
      delayMs,
      payloadType: payload?.type || null,
      command: payload?.data?.command || null,
      error: lastError?.message || String(lastError),
    });
    await delay(delayMs);
  }

  throw lastError || new Error("标签页命令执行失败");
}

async function injectContentScript(tabId) {
  await ensureCapturableTab(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["site_adapter_runners.generated.js", "content_script.js"],
  });
}

function looksLikeTransientTabCommandError(error) {
  const normalized = String(error?.message || error || "").toLowerCase();
  return (
    normalized.includes("frame with id") ||
    normalized.includes("frame was removed") ||
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection") ||
    normalized.includes("message port closed") ||
    normalized.includes("extension context invalidated")
  );
}

async function triggerPageCapture(reason, retry = 0) {
  if (!monitoringEnabled && reason !== "manual") {
    return;
  }

  const tabId = await resolveTargetTabId();
  if (!tabId) {
    return;
  }

  const tab = await getTabById(tabId);
  if (!tab || !isCapturableUrl(tab.url)) {
    return;
  }

  try {
    await sendCommandToTab(tabId, {
      type: "REQUEST_PAGE_CAPTURE",
      data: { reason },
    });
  } catch (error) {
    if (retry < PAGE_CAPTURE_RETRY_LIMIT) {
      setTimeout(() => {
        void triggerPageCapture(reason, retry + 1);
      }, 250 * (retry + 1));
    } else {
      logWarn("页面抓取请求失败", error?.message || String(error));
    }
  }
}

function waitTabLoadComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function listTrackedTabs() {
  const trackedTabIds = new Set(debuggerAttachedTabIds.values());
  if (Number.isInteger(activeTabId) && activeTabId > 0) {
    trackedTabIds.add(activeTabId);
  }

  const tabs = await Promise.all(
    Array.from(trackedTabIds.values()).map((tabId) => getTabById(tabId)),
  );

  return tabs
    .filter((tab) => tab?.id)
    .map((tab) => ({
      tabId: tab.id,
      state:
        tab.id === activeTabId
          ? "active"
          : debuggerAttachedTabIds.has(tab.id)
            ? "attached"
            : "idle",
      url: tab.url || "",
      title: tab.title || "",
      isAgent: false,
      isRetained: false,
    }));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const type = request?.type;

  if (type === "GET_STATUS") {
    sendResponse(buildStatusPayload());
    return true;
  }

  if (type === "getRelayStatus") {
    sendResponse(buildRelayCompatibilityPayload());
    return true;
  }

  if (type === "UPDATE_SETTINGS") {
    const patch = request?.data || {};
    const next = {
      serverUrl:
        typeof patch.serverUrl === "string"
          ? patch.serverUrl
          : lastSettings.serverUrl,
      bridgeKey:
        typeof patch.bridgeKey === "string"
          ? patch.bridgeKey
          : lastSettings.bridgeKey,
      profileKey:
        typeof patch.profileKey === "string"
          ? patch.profileKey
          : lastSettings.profileKey,
      monitoringEnabled:
        typeof patch.monitoringEnabled === "boolean"
          ? patch.monitoringEnabled
          : monitoringEnabled,
      enabled:
        typeof patch.enabled === "boolean"
          ? patch.enabled
          : patch.reconnect === true
            ? true
            : lastSettings.enabled,
    };

    writeSettings(next).then(async () => {
      applySettingsState(next);
      if (!isEnabled) {
        await disconnectObserver({ disableAutoReconnect: false, silent: true });
        clearLastError();
        clearControlLastError();
        clearKeepAliveAlarm();
      } else if (patch.reconnect === true) {
        await Promise.allSettled([connectObserver(true), connectControl(true)]);
      } else {
        ensureKeepAliveAlarm();
      }
      broadcastStatus();
      sendResponse({ success: true });
    });
    return true;
  }

  if (type === "toggleRelay") {
    if (isEnabled) {
      disconnectObserver({ disableAutoReconnect: true }).then(() => {
        sendResponse(buildRelayCompatibilityPayload());
      });
    } else {
      const next = { ...lastSettings, enabled: true };
      writeSettings({ enabled: true }).then(async () => {
        applySettingsState(next);
        await Promise.allSettled([connectObserver(true), connectControl(true)]);
        sendResponse(buildRelayCompatibilityPayload());
      });
    }
    return true;
  }

  if (type === "TOGGLE_CONNECTION") {
    if (isEnabled) {
      disconnectObserver({ disableAutoReconnect: true }).then(() => {
        sendResponse({ success: true, isConnected: false, enabled: false });
      });
    } else {
      const next = { ...lastSettings, enabled: true };
      writeSettings({ enabled: true }).then(async () => {
        applySettingsState(next);
        await Promise.allSettled([connectObserver(true), connectControl(true)]);
        sendResponse({
          success: true,
          isConnected,
          enabled: true,
        });
      });
    }
    return true;
  }

  if (type === "TOGGLE_MONITORING") {
    monitoringEnabled = !monitoringEnabled;
    lastSettings = { ...lastSettings, monitoringEnabled };
    writeSettings({ monitoringEnabled }).then(() => {
      if (monitoringEnabled) {
        void triggerPageCapture("manual");
      }
      broadcastStatus();
      sendResponse({ success: true, monitoringEnabled });
    });
    return true;
  }

  if (type === "REQUEST_PAGE_CAPTURE") {
    triggerPageCapture("manual").then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (type === "getTabList") {
    listTrackedTabs()
      .then((tabs) => {
        sendResponse({ tabs });
      })
      .catch((error) => {
        sendResponse({
          tabs: [],
          error: error?.message || String(error),
        });
      });
    return true;
  }

  if (type === "getLogs") {
    const limit = Math.max(1, Math.min(Number(request?.limit) || 100, MAX_LOG_ENTRIES));
    sendResponse({ logs: logBuffer.slice(-limit) });
    return true;
  }

  if (type === "PAGE_INFO_UPDATE") {
    const senderTabId = sender?.tab?.id;
    if (senderTabId && activeTabId && senderTabId !== activeTabId) {
      return true;
    }

    const markdown = request?.data?.markdown;
    if (typeof markdown !== "string" || !markdown.trim()) {
      return true;
    }

    latestPageInfo = {
      title: request?.data?.title || "",
      url: request?.data?.url || "",
      timestamp: Date.now(),
      markdown,
    };

    chrome.storage.local.set({ latestPageInfo });
    sendObserverMessage({
      type: "pageInfoUpdate",
      data: { markdown },
    });
    broadcastStatus({ latestPageInfo });
    return true;
  }

  if (type === "COMMAND_RESULT") {
    if (request?.data) {
      sendCommandResult(request.data);
    }
    return true;
  }

  return true;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  if (isEnabled && !isConnected && !isConnecting) {
    void ensureObserverEnabled();
  }
  await triggerPageCapture("tab_activated");
  broadcastStatus();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active) {
    activeTabId = tabId;
  }
  if (tab.active && changeInfo.status === "complete") {
    if (isEnabled && !isConnected && !isConnecting) {
      void ensureObserverEnabled();
    }
    await triggerPageCapture("tab_updated");
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void detachDebugger(tabId);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source?.tabId;
  if (!Number.isInteger(tabId)) {
    return;
  }
  debuggerSessionRefCounts.delete(tabId);
  debuggerAttachedTabIds.delete(tabId);
  logWarn("Chrome debugger 已断开", { tabId, reason });
  broadcastStatus();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    void handleKeepAliveAlarm();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void init();
});

chrome.runtime.onInstalled.addListener(() => {
  void init(true);
});

async function loadAutoConfig() {
  try {
    const configUrl = chrome.runtime.getURL("auto_config.json");
    logInfo(`尝试加载自动配置: ${configUrl}`);
    const response = await fetch(configUrl);
    logInfo(`fetch 响应状态: ${response.status}`);
    if (!response.ok) {
      logWarn(`自动配置文件不存在或无法访问: ${response.status}`);
      return;
    }
    const config = await response.json();
    logInfo("成功读取自动配置", config);
    if (config.serverUrl && config.bridgeKey) {
      logInfo("检测到自动配置，正在应用...", config);
      await writeSettings({
        serverUrl: config.serverUrl,
        bridgeKey: config.bridgeKey,
        profileKey: config.profileKey || "default",
        monitoringEnabled: config.monitoringEnabled !== false,
        enabled: config.enabled !== false,
      });
      logInfo("自动配置已应用");
    } else {
      logWarn("自动配置缺少必要字段", config);
    }
  } catch (error) {
    const message = error?.message || String(error);
    if (
      /failed to fetch/i.test(message) ||
      /not found/i.test(message) ||
      /networkerror/i.test(message)
    ) {
      logInfo("未检测到 auto_config.json，继续使用本地设置");
      return;
    }
    logWarn("加载自动配置失败", message);
  }
}

async function init(forceReconnect = false) {
  await loadAutoConfig();

  const settings = await readSettings();
  applySettingsState(settings);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tabs[0]?.id || null;

  chrome.storage.local.get(["latestPageInfo"], (stored) => {
    if (stored.latestPageInfo) {
      latestPageInfo = stored.latestPageInfo;
      broadcastStatus();
    }
  });

  if (!isEnabled) {
    clearKeepAliveAlarm();
    isConnecting = false;
    isConnected = false;
    clearLastError();
    broadcastStatus();
    return;
  }

  ensureKeepAliveAlarm();

  if (settings.serverUrl && settings.bridgeKey) {
    await Promise.allSettled([
      connectObserver(forceReconnect),
      connectControl(forceReconnect),
    ]);
  } else {
    isConnecting = false;
    isConnected = false;
    isControlConnecting = false;
    isControlConnected = false;
    clearLastError();
    clearControlLastError();
    broadcastStatus();
  }
}

void init();
