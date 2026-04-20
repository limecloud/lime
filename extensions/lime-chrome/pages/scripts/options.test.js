import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function buildOptionsDom() {
  document.body.innerHTML = `
    <h1 data-i18n="page_title_text">Lime Browser Bridge</h1>
    <label>
      <span data-i18n="language_label">Language</span>
      <select id="language-select">
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
    </label>
    <div id="status-card" data-state="disabled">
      <div id="status-label"></div>
      <div id="status-meta"></div>
      <div id="status-detail"></div>
      <div id="tab-stats"></div>
    </div>
    <label>
      <input type="checkbox" id="relay-toggle" />
    </label>
    <input id="port" />
    <div id="port-status"></div>
    <button id="save" type="button">Save</button>
    <section id="tabs-section"></section>
    <div id="tabs-list"></div>
    <div id="logs-container"></div>
    <button id="logs-refresh" type="button">Refresh</button>
    <label>
      <input type="checkbox" id="closeGroupOnDisable" />
    </label>
  `;
}

async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function importOptionsScript() {
  vi.resetModules();
  return import("./options.js");
}

describe("extension options status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildOptionsDom();

    const strings = {};
    globalThis.InstallI18n = {
      register: vi.fn((lang, translations) => {
        strings[lang] = { ...(strings[lang] || {}), ...translations };
      }),
      detectLang: vi.fn(() => "en"),
      apply: vi.fn((lang) => {
        const bundle = strings[lang] || strings.en || {};
        document.querySelectorAll("[data-i18n]").forEach((element) => {
          const key = element.getAttribute("data-i18n");
          if (key && bundle[key]) {
            element.innerHTML = bundle[key];
          }
        });
        document.documentElement.lang = lang;
        if (bundle.title) {
          document.title = bundle.title;
        }
        return lang;
      }),
      t: vi.fn((key, lang) => strings[lang]?.[key] || strings.en?.[key] || key),
    };

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(async (request) => {
          if (request?.type === "getRelayStatus") {
            return {
              state: "unconfigured",
              isConfigured: false,
              observerConnected: false,
              controlConnected: false,
              debuggerTabs: [],
              attachedTabs: 0,
              agentTabs: 0,
              retainedTabs: 0,
              lastError: "缺少 serverUrl 或 bridgeKey，无法建立连接",
              controlLastError: "缺少 serverUrl 或 bridgeKey，无法建立控制通道",
            };
          }
          if (request?.type === "getTabList") {
            return { tabs: [] };
          }
          if (request?.type === "getLogs") {
            return { logs: [] };
          }
          return null;
        }),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
        onChanged: {
          addListener: vi.fn(),
        },
      },
      tabs: {
        update: vi.fn(),
        get: vi.fn(),
      },
      windows: {
        update: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete globalThis.InstallI18n;
    delete globalThis.chrome;
    document.body.innerHTML = "";
  });

  it("应在缺少扩展配置时展示 setup required 状态", async () => {
    await importOptionsScript();
    await flushTasks();

    const statusCard = document.getElementById("status-card");
    const statusLabel = document.getElementById("status-label");
    const statusDetail = document.getElementById("status-detail");
    const statusMeta = document.getElementById("status-meta");
    const tabStats = document.getElementById("tab-stats");
    const relayToggle = document.getElementById("relay-toggle");

    expect(statusCard?.dataset.state).toBe("unconfigured");
    expect(statusLabel?.textContent).toBe("Setup Required");
    expect(statusDetail?.textContent).toContain(
      "Export the connector from Lime",
    );
    expect(statusMeta?.textContent).toContain("config missing");
    expect(tabStats?.textContent).toContain(
      "Load the exported Lime Browser Connector folder",
    );
    expect(relayToggle?.checked).toBe(true);
  });

  it("应支持切换到中文", async () => {
    await importOptionsScript();
    await flushTasks();

    const languageSelect = document.getElementById("language-select");
    expect(languageSelect).toBeInstanceOf(HTMLSelectElement);

    languageSelect.value = "zh";
    languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(document.documentElement.lang).toBe("zh");
    expect(document.body.textContent).toContain("语言");
    expect(document.body.textContent).toContain("Lime 浏览器桥接");
    expect(document.getElementById("status-label")?.textContent).toBe(
      "需要配置",
    );
  });
});
