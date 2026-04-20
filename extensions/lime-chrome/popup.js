const DEFAULT_SETTINGS = {
  serverUrl: "ws://127.0.0.1:8999",
  bridgeKey: "",
  profileKey: "default",
  monitoringEnabled: true,
  enabled: true,
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

function setBadge(el, label, variant = "off") {
  el.textContent = label;
  el.className = `badge badge-${variant}`;
}

function buildObserverEndpoint(serverUrl, bridgeKey, profileKey) {
  const base = String(serverUrl || "").trim().replace(/\/$/, "");
  const key = String(bridgeKey || "").trim();
  const profile = encodeURIComponent(String(profileKey || "default").trim() || "default");
  if (!base || !key) {
    return "Observer URL: 未配置";
  }
  return `Observer URL: ${base}/lime-chrome-observer/${encodeURIComponent(key)}?profileKey=${profile}`;
}

function applyStatus(status) {
  const connected = Boolean(status?.isConnected);
  const connecting = Boolean(status?.isConnecting);
  const controlConnected = Boolean(status?.isControlConnected);
  const controlConnecting = Boolean(status?.isControlConnecting);
  const enabled = status?.enabled !== false;
  const configured = status?.isConfigured !== false;
  const monitoring = Boolean(status?.monitoringEnabled);
  const errorText =
    typeof status?.lastError === "string" ? status.lastError.trim() : "";
  const controlErrorText =
    typeof status?.controlLastError === "string"
      ? status.controlLastError.trim()
      : "";

  if (enabled && !configured) {
    setBadge(bridgeStatusEl, "未配置", "warn");
  } else if (connected) {
    setBadge(bridgeStatusEl, "已连接", "on");
  } else if (enabled && connecting) {
    setBadge(bridgeStatusEl, "连接中", "warn");
  } else if (enabled && errorText) {
    setBadge(bridgeStatusEl, "待重试", "warn");
  } else if (enabled) {
    setBadge(bridgeStatusEl, "已启用", "warn");
  } else {
    setBadge(bridgeStatusEl, "已停用", "off");
  }

  setBadge(monitorStatusEl, monitoring ? "开启" : "关闭", monitoring ? "on" : "off");
  toggleConnBtnEl.textContent = enabled ? "停止自动连接" : "启用并连接";
  toggleMonitorBtnEl.textContent = monitoring ? "关闭页面监控" : "开启页面监控";

  if (enabled && !configured) {
    statusHintEl.textContent =
      "当前扩展还没有拿到 Lime 的连接配置。请回到 Lime 的“连接器”页重新同步扩展，或把复制的配置粘贴到下方后保存。";
  } else if (connected && controlConnected) {
    statusHintEl.textContent =
      "浏览器扩展的 observer/control 双通道都已接入当前 Lime 运行时，后续会持续复用你当前已登录的 Chrome 标签页。";
  } else if (connected && (controlConnecting || controlErrorText)) {
    statusHintEl.textContent = controlErrorText
      ? `页面观察已接入，但控制通道当前异常：${controlErrorText}`
      : "页面观察已接入，控制通道正在补连。";
  } else if (enabled && connecting) {
    statusHintEl.textContent =
      "扩展已启用，正在尝试连接本地 Lime relay。保持当前 Chrome 打开即可，连接成功后会自动抓取当前标签页。";
  } else if (enabled && errorText) {
    statusHintEl.textContent = `扩展已启用，但当前连接失败：${errorText}`;
  } else if (enabled) {
    statusHintEl.textContent =
      "扩展已启用，但当前还未连上 Lime。请确认桌面端已经启动，并检查连接器页中的地址和密钥。";
  } else {
    statusHintEl.textContent =
      "扩展当前处于停用状态，不会自动重连。需要时点击“启用并连接”，或回到 Lime 的“连接器”页重新同步配置。";
  }

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
    enabled: true,
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
