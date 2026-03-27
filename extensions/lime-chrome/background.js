const HEARTBEAT_INTERVAL_MS = 30000;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const PAGE_CAPTURE_RETRY_LIMIT = 3;

const DEFAULT_SETTINGS = {
  serverUrl: "ws://127.0.0.1:8999",
  bridgeKey: "",
  profileKey: "default",
  monitoringEnabled: true,
};

let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let activeTabId = null;
let monitoringEnabled = true;
let latestPageInfo = null;
let lastSettings = { ...DEFAULT_SETTINGS };

function logInfo(message, payload) {
  if (payload === undefined) {
    console.log(`[LimeBridge] ${message}`);
  } else {
    console.log(`[LimeBridge] ${message}`, payload);
  }
}

function logWarn(message, payload) {
  if (payload === undefined) {
    console.warn(`[LimeBridge] ${message}`);
  } else {
    console.warn(`[LimeBridge] ${message}`, payload);
  }
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

async function connectObserver(forceReconnect = false) {
  if (ws && ws.readyState === WebSocket.OPEN && !forceReconnect) {
    return;
  }

  clearReconnectTimer();
  clearHeartbeatTimer();

  const settings = await readSettings();
  lastSettings = settings;
  monitoringEnabled = Boolean(settings.monitoringEnabled);

  const url = buildObserverUrl(settings);
  if (!url) {
    logWarn("缺少 serverUrl 或 bridgeKey，无法建立连接");
    setConnectionState(false);
    broadcastStatus();
    return;
  }

  if (forceReconnect && ws) {
    try {
      ws.close();
    } catch (_) {}
  }

  logInfo(`连接 observer: ${url}`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectAttempts = 0;
    setConnectionState(true);
    startHeartbeat();
    broadcastStatus();
    triggerPageCapture("ws_open");
  };

  ws.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      await handleObserverMessage(payload);
    } catch (error) {
      logWarn("解析消息失败", error?.message || String(error));
    }
  };

  ws.onclose = () => {
    setConnectionState(false);
    clearHeartbeatTimer();
    scheduleReconnect();
    broadcastStatus();
  };

  ws.onerror = (error) => {
    logWarn("WebSocket 错误", error?.message || error);
  };
}

function disconnectObserver(manual = true) {
  clearReconnectTimer();
  clearHeartbeatTimer();
  if (ws) {
    try {
      ws.close();
    } catch (_) {}
  }
  if (manual) {
    setConnectionState(false);
    broadcastStatus();
  }
}

function setConnectionState(connected) {
  isConnected = connected;
  chrome.action.setBadgeText({ text: connected ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({
    color: connected ? "#16a34a" : "#dc2626",
  });
}

function startHeartbeat() {
  clearHeartbeatTimer();
  heartbeatTimer = setInterval(() => {
    sendObserverMessage({ type: "heartbeat", timestamp: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
}

function clearHeartbeatTimer() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_MIN_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
  );
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectObserver();
  }, delay);
  logInfo(`连接断开，${delay}ms 后重连（第 ${reconnectAttempts} 次）`);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function sendObserverMessage(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(JSON.stringify(payload));
  return true;
}

function broadcastStatus(extra) {
  chrome.runtime
    .sendMessage({
      type: "STATUS_UPDATE",
      data: {
        isConnected,
        monitoringEnabled,
        activeTabId,
        latestPageInfo,
        settings: {
          ...lastSettings,
          bridgeKey: lastSettings.bridgeKey ? "***" : "",
        },
        ...extra,
      },
    })
    .catch(() => {});
}

async function handleObserverMessage(payload) {
  const type = payload?.type;
  if (type === "heartbeat_ack" || type === "connection_ack") {
    return;
  }
  if (type !== "command" || !payload.data) {
    return;
  }
  await executeRemoteCommand(payload.data);
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
    const response = await sendCommandToTab(tabId, {
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

    sendCommandResult({
      requestId,
      sourceClientId,
      status: "success",
      message: response?.message || `${command} 执行成功`,
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
    try {
      const tab = await chrome.tabs.get(byId);
      if (tab?.id) {
        activeTabId = tab.id;
        return tab.id;
      }
    } catch (_) {}
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
    try {
      targetTab = await chrome.tabs.get(byId);
    } catch (_) {
      targetTab = null;
    }
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
  sendObserverMessage({
    type: "command_result",
    data,
  });
}

async function resolveTargetTabId() {
  if (activeTabId) {
    try {
      const tab = await chrome.tabs.get(activeTabId);
      if (tab && !tab.discarded) {
        return tab.id;
      }
    } catch (_) {}
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    activeTabId = tabs[0].id;
    return tabs[0].id;
  }
  return null;
}

async function sendCommandToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    await injectContentScript(tabId);
    return await chrome.tabs.sendMessage(tabId, payload);
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_script.js"],
  });
}

async function triggerPageCapture(reason, retry = 0) {
  if (!monitoringEnabled && reason !== "manual") {
    return;
  }

  const tabId = await resolveTargetTabId();
  if (!tabId) {
    return;
  }

  try {
    await sendCommandToTab(tabId, {
      type: "REQUEST_PAGE_CAPTURE",
      data: { reason },
    });
  } catch (error) {
    if (retry < PAGE_CAPTURE_RETRY_LIMIT) {
      setTimeout(
        () => {
          triggerPageCapture(reason, retry + 1);
        },
        250 * (retry + 1),
      );
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const type = request?.type;

  if (type === "GET_STATUS") {
    sendResponse({
      isConnected,
      monitoringEnabled,
      activeTabId,
      latestPageInfo,
      settings: {
        ...lastSettings,
        bridgeKey: lastSettings.bridgeKey ? "***" : "",
      },
    });
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
    };

    writeSettings(next).then(async () => {
      lastSettings = { ...lastSettings, ...next };
      monitoringEnabled = Boolean(next.monitoringEnabled);
      if (request?.data?.reconnect === true) {
        await connectObserver(true);
      }
      broadcastStatus();
      sendResponse({ success: true });
    });
    return true;
  }

  if (type === "TOGGLE_CONNECTION") {
    if (isConnected) {
      disconnectObserver(true);
      sendResponse({ success: true, isConnected: false });
    } else {
      connectObserver().then(() => {
        sendResponse({ success: true, isConnected: isConnected });
      });
    }
    return true;
  }

  if (type === "TOGGLE_MONITORING") {
    monitoringEnabled = !monitoringEnabled;
    writeSettings({ monitoringEnabled }).then(() => {
      if (monitoringEnabled) {
        triggerPageCapture("manual");
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
  await triggerPageCapture("tab_activated");
  broadcastStatus();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active) {
    activeTabId = tabId;
  }
  if (tab.active && changeInfo.status === "complete") {
    await triggerPageCapture("tab_updated");
  }
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
      });
      logInfo("自动配置已应用");
    } else {
      logWarn("自动配置缺少必要字段", config);
    }
  } catch (error) {
    // 文件不存在或解析失败时记录错误
    logWarn("加载自动配置失败", error?.message || String(error));
  }
}

async function init() {
  await loadAutoConfig();

  const settings = await readSettings();
  lastSettings = settings;
  monitoringEnabled = Boolean(settings.monitoringEnabled);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tabs[0]?.id || null;

  if (settings.serverUrl && settings.bridgeKey) {
    await connectObserver();
  } else {
    setConnectionState(false);
    broadcastStatus();
  }

  chrome.storage.local.get(["latestPageInfo"], (stored) => {
    if (stored.latestPageInfo) {
      latestPageInfo = stored.latestPageInfo;
      broadcastStatus();
    }
  });
}

init();
