const DEFAULT_SETTINGS = {
  serverUrl: "ws://127.0.0.1:8999",
  bridgeKey: "",
  profileKey: "default",
  monitoringEnabled: true,
};

const bridgeStatusEl = document.getElementById("bridgeStatus");
const monitorStatusEl = document.getElementById("monitorStatus");
const statusHintEl = document.getElementById("statusHint");
const endpointPreviewEl = document.getElementById("endpointPreview");
const openConnectorPageBtnEl = document.getElementById("openConnectorPageBtn");
const refreshStatusBtnEl = document.getElementById("refreshStatusBtn");

const serverUrlEl = document.getElementById("serverUrl");
const bridgeKeyEl = document.getElementById("bridgeKey");
const profileKeyEl = document.getElementById("profileKey");

const saveBtnEl = document.getElementById("saveBtn");
const toggleConnBtnEl = document.getElementById("toggleConnBtn");
const toggleMonitorBtnEl = document.getElementById("toggleMonitorBtn");
const captureBtnEl = document.getElementById("captureBtn");

const pageTitleEl = document.getElementById("pageTitle");
const pageUrlEl = document.getElementById("pageUrl");

function setBadge(el, isOn, onText, offText) {
  el.textContent = isOn ? onText : offText;
  el.className = `badge ${isOn ? "badge-on" : "badge-off"}`;
}

function buildObserverEndpoint(serverUrl, bridgeKey, profileKey) {
  const base = String(serverUrl || "").trim().replace(/\/$/, "");
  const key = String(bridgeKey || "").trim();
  const profile = encodeURIComponent(String(profileKey || "default").trim() || "default");
  if (!base || !key) {
    return "Observer URL: 未配置";
  }
  return `Observer URL: ${base}/lime-chrome-observer/Lime_Key=${encodeURIComponent(key)}?profileKey=${profile}`;
}

function applyStatus(status) {
  const connected = Boolean(status?.isConnected);
  const monitoring = Boolean(status?.monitoringEnabled);
  setBadge(bridgeStatusEl, connected, "已连接", "未连接");
  setBadge(monitorStatusEl, monitoring, "开启", "关闭");
  toggleConnBtnEl.textContent = connected ? "断开连接" : "立即连接";
  toggleMonitorBtnEl.textContent = monitoring ? "关闭页面监控" : "开启页面监控";

  statusHintEl.textContent = connected
    ? "浏览器扩展已经接入当前 Lime 运行时。后续如需重新安装或切换目录，请回到 Lime 的“连接器”页处理。"
    : "如果当前仍未连接，请先打开 Lime 的“连接器”页启用浏览器连接器，或重新同步扩展到你选择的目录。";

  const latestPageInfo = status?.latestPageInfo;
  if (latestPageInfo?.title || latestPageInfo?.url) {
    pageTitleEl.textContent = latestPageInfo.title || "无标题";
    pageUrlEl.textContent = latestPageInfo.url || "";
  } else {
    pageTitleEl.textContent = "无页面信息";
    pageUrlEl.textContent = "当前还没有收到最近页面快照。";
  }

  const settings = status?.settings;
  if (settings) {
    if (typeof settings.serverUrl === "string" && settings.serverUrl) {
      serverUrlEl.value = settings.serverUrl;
    }
    if (typeof settings.profileKey === "string" && settings.profileKey) {
      profileKeyEl.value = settings.profileKey;
    }
    endpointPreviewEl.textContent = buildObserverEndpoint(
      settings.serverUrl,
      bridgeKeyEl.value,
      settings.profileKey,
    );
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function readStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
      resolve({ ...DEFAULT_SETTINGS, ...stored });
    });
  });
}

async function loadInitialState() {
  const settings = await readStoredSettings();
  serverUrlEl.value = settings.serverUrl;
  bridgeKeyEl.value = settings.bridgeKey;
  profileKeyEl.value = settings.profileKey;
  endpointPreviewEl.textContent = buildObserverEndpoint(
    settings.serverUrl,
    settings.bridgeKey,
    settings.profileKey,
  );

  try {
    await refreshStatus();
  } catch (error) {
    console.warn("[LimeBridgePopup] 获取状态失败", error?.message || String(error));
  }
}

async function refreshStatus() {
  const status = await sendMessage({ type: "GET_STATUS" });
  applyStatus(status || {});
}

async function saveAndReconnect() {
  const payload = {
    serverUrl: serverUrlEl.value.trim(),
    bridgeKey: bridgeKeyEl.value.trim(),
    profileKey: profileKeyEl.value.trim() || "default",
    reconnect: true,
  };

  endpointPreviewEl.textContent = buildObserverEndpoint(
    payload.serverUrl,
    payload.bridgeKey,
    payload.profileKey,
  );

  saveBtnEl.disabled = true;
  const originalText = saveBtnEl.textContent;
  saveBtnEl.textContent = "保存中...";

  try {
    await sendMessage({ type: "UPDATE_SETTINGS", data: payload });
    await refreshStatus();
    saveBtnEl.textContent = "已保存";
    setTimeout(() => {
      saveBtnEl.textContent = originalText;
      saveBtnEl.disabled = false;
    }, 900);
  } catch (error) {
    saveBtnEl.textContent = "保存失败";
    setTimeout(() => {
      saveBtnEl.textContent = originalText;
      saveBtnEl.disabled = false;
    }, 1200);
    console.warn("[LimeBridgePopup] 保存设置失败", error?.message || String(error));
  }
}

async function toggleConnection() {
  try {
    await sendMessage({ type: "TOGGLE_CONNECTION" });
    await refreshStatus();
  } catch (error) {
    console.warn("[LimeBridgePopup] 切换连接失败", error?.message || String(error));
  }
}

async function toggleMonitoring() {
  try {
    await sendMessage({ type: "TOGGLE_MONITORING" });
    await refreshStatus();
  } catch (error) {
    console.warn("[LimeBridgePopup] 切换监控失败", error?.message || String(error));
  }
}

async function capturePageNow() {
  captureBtnEl.disabled = true;
  const originalText = captureBtnEl.textContent;
  captureBtnEl.textContent = "抓取中...";

  try {
    await sendMessage({ type: "REQUEST_PAGE_CAPTURE" });
    await refreshStatus();
  } catch (error) {
    console.warn("[LimeBridgePopup] 请求抓取失败", error?.message || String(error));
  } finally {
    setTimeout(() => {
      captureBtnEl.textContent = originalText;
      captureBtnEl.disabled = false;
    }, 800);
  }
}

async function pasteConfigFromClipboard() {
  const pasteBtn = document.getElementById("pasteConfigBtn");
  pasteBtn.disabled = true;
  const originalText = pasteBtn.textContent;
  pasteBtn.textContent = "粘贴中...";

  try {
    const text = await navigator.clipboard.readText();
    const config = JSON.parse(text);

    if (config.serverUrl) {
      serverUrlEl.value = config.serverUrl;
    }
    if (config.bridgeKey) {
      bridgeKeyEl.value = config.bridgeKey;
    }
    if (config.profileKey) {
      profileKeyEl.value = config.profileKey;
    }
    if (typeof config.monitoringEnabled === "boolean") {
      setBadge(monitorStatusEl, config.monitoringEnabled, "开启", "关闭");
    }

    endpointPreviewEl.textContent = buildObserverEndpoint(
      serverUrlEl.value,
      bridgeKeyEl.value,
      profileKeyEl.value,
    );

    pasteBtn.textContent = "已粘贴";
    setTimeout(() => {
      pasteBtn.textContent = originalText;
      pasteBtn.disabled = false;
    }, 1000);
  } catch (error) {
    pasteBtn.textContent = "粘贴失败";
    setTimeout(() => {
      pasteBtn.textContent = originalText;
      pasteBtn.disabled = false;
    }, 1500);
    console.warn("[LimeBridgePopup] 粘贴配置失败", error?.message || String(error));
  }
}

function clearConfig() {
  serverUrlEl.value = DEFAULT_SETTINGS.serverUrl;
  bridgeKeyEl.value = "";
  profileKeyEl.value = DEFAULT_SETTINGS.profileKey;
  endpointPreviewEl.textContent = buildObserverEndpoint(
    serverUrlEl.value,
    bridgeKeyEl.value,
    profileKeyEl.value,
  );
}

async function pollStatusUntilConnected() {
  openConnectorPageBtnEl.disabled = true;
  refreshStatusBtnEl.disabled = true;

  let attempts = 0;
  const maxAttempts = 15;
  const timer = window.setInterval(async () => {
    attempts += 1;
    try {
      const status = await sendMessage({ type: "GET_STATUS" });
      applyStatus(status || {});
      if (status?.isConnected || attempts >= maxAttempts) {
        window.clearInterval(timer);
        openConnectorPageBtnEl.disabled = false;
        refreshStatusBtnEl.disabled = false;
      }
    } catch (_) {
      if (attempts >= maxAttempts) {
        window.clearInterval(timer);
        openConnectorPageBtnEl.disabled = false;
        refreshStatusBtnEl.disabled = false;
      }
    }
  }, 1000);
}

function openConnectorSettings() {
  try {
    window.open("lime://connectors/browser?enable=true");
  } catch (error) {
    console.warn(
      "[LimeBridgePopup] 打开 Lime 连接器页失败",
      error?.message || String(error),
    );
  }

  void pollStatusUntilConnected();
}

saveBtnEl.addEventListener("click", saveAndReconnect);
toggleConnBtnEl.addEventListener("click", toggleConnection);
toggleMonitorBtnEl.addEventListener("click", toggleMonitoring);
captureBtnEl.addEventListener("click", capturePageNow);
openConnectorPageBtnEl.addEventListener("click", openConnectorSettings);
refreshStatusBtnEl.addEventListener("click", () => {
  refreshStatus().catch((error) => {
    console.warn("[LimeBridgePopup] 刷新状态失败", error?.message || String(error));
  });
});
document.getElementById("pasteConfigBtn").addEventListener("click", pasteConfigFromClipboard);
document.getElementById("clearConfigBtn").addEventListener("click", clearConfig);

for (const input of [serverUrlEl, bridgeKeyEl, profileKeyEl]) {
  input.addEventListener("input", () => {
    endpointPreviewEl.textContent = buildObserverEndpoint(
      serverUrlEl.value,
      bridgeKeyEl.value,
      profileKeyEl.value,
    );
  });
}

chrome.runtime.onMessage.addListener((request) => {
  if (request?.type === "STATUS_UPDATE") {
    applyStatus(request?.data || {});
  }
});

loadInitialState();
