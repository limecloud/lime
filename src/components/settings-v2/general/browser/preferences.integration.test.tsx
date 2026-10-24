import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { invalidateAppConfigCache } from "@/lib/api/appConfig";
import { AppServerRpcError } from "@/lib/api/appServerResponse";
import { updateDesktopPreference } from "@/lib/api/desktopPreferences";
import {
  effectiveBrowserSettings,
  browserSettingsFromConfig,
  browserPreferences,
  applyBrowserAgentPermissions,
  updateBrowserSetting,
} from "@/lib/api/browserSettings";
import { SettingsTabs } from "@/types/settings";
import { isSettingsSearchTarget } from "../../settingsSearch";
import { useSettingsSearchTarget } from "../../_layout/useSettingsSearchTarget";
import { BrowserUseSettings } from "./index";
import { KeyboardShortcutsSettings } from "../keyboard-shortcuts";

const { request, pickFiles } = vi.hoisted(() => ({
  request: vi.fn(),
  pickFiles: vi.fn(),
}));
vi.mock("@/lib/api/filePicker", () => ({ pickFilesFromDialog: pickFiles }));
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));

let container: HTMLDivElement;
let root: Root;
let persisted: Record<string, unknown>;
let version: number;
let rejectWrite: boolean;
let rejectRead: boolean;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  invalidateAppConfigCache();
  window.localStorage.clear();
  persisted = {
    default_provider: "openai",
    language: "en-US",
    tui: { animations: false },
  };
  version = 1;
  rejectWrite = false;
  rejectRead = false;
  pickFiles.mockReset().mockResolvedValue([]);
  request.mockReset().mockImplementation(async (method, params) => {
    if (method === "config/read") {
      if (rejectRead) throw new Error("fixture read rejected");
      return {
        result: {
          config: structuredClone(persisted),
          layers: [
            {
              name: {
                type: "user",
                file: "/fixture/config.yaml",
                profile: null,
              },
              version: `v${version}`,
              config: structuredClone(persisted),
            },
          ],
        },
      };
    }
    if (method !== "config/batchWrite")
      throw new Error(`Unexpected method ${method}`);
    if (rejectWrite) throw new Error("fixture write rejected");
    if (params.expectedVersion !== `v${version}`)
      throw new AppServerRpcError({
        id: 1,
        error: {
          code: -32600,
          message: "Configuration changed",
          data: { config_write_error_code: "configVersionConflict" },
        },
      });
    for (const edit of params.edits)
      persisted[edit.keyPath] = structuredClone(edit.value);
    version += 1;
    return {
      result: {
        status: "ok",
        version: `v${version}`,
        filePath: "/fixture/config.yaml",
      },
    };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  invalidateAppConfigCache();
  vi.restoreAllMocks();
  await changeLimeLocale("zh-CN");
});

async function renderPage(keyboard = false) {
  await act(async () =>
    root.render(
      keyboard ? <KeyboardShortcutsSettings /> : <BrowserUseSettings />,
    ),
  );
}

async function choose(target: string, label: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    `#${target} button`,
  )!;
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const option = [
    ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
  ].find((item) => item.textContent === label);
  expect(option, label).toBeDefined();
  await act(async () => option!.click());
}

function SearchResult({
  section,
  targetId,
}: {
  section: SettingsTabs;
  targetId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSettingsSearchTarget(ref, section, { targetId, requestKey: 1 }, true);
  return (
    <div ref={ref}>
      {section === SettingsTabs.Browser ? (
        <BrowserUseSettings />
      ) : (
        <KeyboardShortcutsSettings />
      )}
    </div>
  );
}

it.each([
  [SettingsTabs.Browser, "browser-web-target"],
  [SettingsTabs.Browser, "browser-local-target"],
  [SettingsTabs.KeyboardShortcuts, "keyboard-external-browser-link"],
])(
  "focuses the actual %s preference after selecting search result %s",
  async (section, targetId) => {
    await act(async () =>
      root.render(
        <SearchResult section={section as SettingsTabs} targetId={targetId} />,
      ),
    );
    const row = container.querySelector<HTMLElement>(`#${targetId}`)!;
    expect(row).not.toBeNull();
    expect(document.activeElement).toBe(row);
    expect(row.dataset.settingsSearchActive).toBe("true");
    expect(row.querySelector("button")?.disabled).toBe(false);
    expect(row.getAttribute("aria-labelledby")).toBe(`${targetId}-label`);
  },
);

it("keeps web/local defaults independent and persists only the selected preference through the current gateway", async () => {
  await renderPage();
  expect(
    container.querySelector("#browser-web-target-value")?.textContent,
  ).toBe("Default browser");
  expect(
    container.querySelector("#browser-local-target-value")?.textContent,
  ).toBe("Lime");
  await choose("browser-web-target", "Lime");
  expect(persisted.desktop).toEqual({
    "open-link-in-target-preference": "in-app-browser",
  });
  await choose("browser-local-target", "Default browser");
  expect(persisted.desktop).toEqual({
    "open-link-in-target-preference": "in-app-browser",
    "open-local-url-in-target-preference": "external-browser",
  });
  expect(persisted.tui).toEqual({ animations: false });
  expect(
    request.mock.calls.filter(([method]) => method === "config/batchWrite"),
  ).toHaveLength(2);
  invalidateAppConfigCache();
  await renderPage(true);
  await renderPage();
  expect(
    container.querySelector("#browser-web-target-value")?.textContent,
  ).toBe("Lime");
  expect(
    container.querySelector("#browser-local-target-value")?.textContent,
  ).toBe("Default browser");
});

it("restores the authoritative value after a rejected save and allows a subsequent retry", async () => {
  await renderPage();
  const readsBeforeSave = request.mock.calls.filter(
    ([method]) => method === "config/read",
  ).length;
  rejectWrite = true;
  await choose("browser-web-target", "Lime");
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "Could not save",
  );
  expect(
    container.querySelector("#browser-web-target-value")?.textContent,
  ).toBe("Default browser");
  expect(persisted.desktop).toBeUndefined();
  expect(
    request.mock.calls.filter(([method]) => method === "config/read"),
  ).toHaveLength(readsBeforeSave + 1);
  rejectWrite = false;
  await choose("browser-web-target", "Lime");
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(persisted.desktop).toEqual({
    "open-link-in-target-preference": "in-app-browser",
  });
});

it("serializes concurrent preference updates without overwriting another key", async () => {
  await act(async () => {
    await Promise.all([
      updateDesktopPreference(
        "open-link-in-target-preference",
        "in-app-browser",
      ),
      updateDesktopPreference("external-browser-link-shortcut", "alt"),
    ]);
  });
  expect(persisted.desktop).toEqual({
    "open-link-in-target-preference": "in-app-browser",
    "external-browser-link-shortcut": "alt",
  });
  expect(version).toBe(3);
});

it("persists browser preferences independently of desktop link settings and restores them on remount", async () => {
  await renderPage();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#browser-full-url [role=switch]")!
      .click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#browser-ask-download [role=switch]")!
      .click(),
  );
  await choose("browser-history-access", "Do not allow access");
  expect(persisted.browser).toEqual({
    ...browserPreferences(effectiveBrowserSettings()),
    show_full_url: true,
    ask_download_location: true,
    iabHistoryApprovalMode: "alwaysAsk",
  });
  expect(persisted.browser_use).toMatchObject({ allow_history_access: false });
  expect(persisted.desktop).toBeUndefined();
  expect(persisted.tui).toEqual({ animations: false });
  invalidateAppConfigCache();
  await renderPage(true);
  await renderPage();
  expect(
    container
      .querySelector("#browser-full-url [role=switch]")
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    container.querySelector("#browser-history-access-value")?.textContent,
  ).toBe("Do not allow access");
});

it("rolls an optimistic browser toggle back after rejected persistence", async () => {
  await renderPage();
  rejectWrite = true;
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#browser-enabled [role=switch]")!
      .click(),
  );
  expect(
    container
      .querySelector("#browser-enabled [role=switch]")
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "Could not save browser settings",
  );
  expect(persisted.browser).toBeUndefined();
});

it("changes download folder through the native picker and keeps cancellation non-mutating", async () => {
  await renderPage();
  const changeDirectory = () =>
    container.querySelector<HTMLButtonElement>(
      "#browser-download-directory button",
    )!;
  await act(async () => changeDirectory().click());
  expect(pickFiles).toHaveBeenCalledWith({
    kind: "directory",
    allowMultiple: false,
    title: "Choose download folder",
  });
  expect(persisted.browser).toBeUndefined();
  pickFiles.mockResolvedValue([
    {
      fsPath: "C:\\Downloads\\work",
      path: "C:\\Downloads\\work\\",
      label: "work",
    },
  ]);
  await act(async () => changeDirectory().click());
  expect(persisted.browser).toMatchObject({
    download_directory: "C:\\Downloads\\work",
  });
  expect(
    container.querySelector("#browser-download-directory")?.textContent,
  ).toContain("C:\\Downloads\\work");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#browser-download-directory button")!
      .click(),
  );
  expect(persisted.browser).toMatchObject({ download_directory: null });
});

it("edits all agent permission categories, normalizes a site exception, and rejects duplicate patterns", async () => {
  await renderPage();
  const section = container.querySelector("#browser-agent-permissions")!;
  const setSelect = async (label: string, value: string) => {
    const select = section.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    )!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  await setSelect("Default · Browsing", "deny");
  await act(async () =>
    section
      .querySelector<HTMLButtonElement>(
        "button[aria-label='Next permissions']",
      )!
      .click(),
  );
  await setSelect("Default · Uploads", "allow");
  await act(async () =>
    section
      .querySelector<HTMLButtonElement>(
        "button[aria-label='Next permissions']",
      )!
      .click(),
  );
  await setSelect("Default · Site tools", "deny");
  expect(persisted.browser_use).toMatchObject({
    default_origin_policy: { access: "deny", uploads: "allow" },
  });
  expect(persisted.browser).toMatchObject({ webMcpEnabled: false });
  const addSite = async () => {
    await act(async () =>
      section.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const input = section.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "HTTPS://*.EXAMPLE.COM/");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      section
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
  };
  await addSite();
  expect(currentBrowser()).toMatchObject({
    agent_permissions: {
      sites: [
        {
          pattern: "https://*.example.com",
          permissions: { browse: "default" },
        },
      ],
    },
  });
  await addSite();
  expect(section.querySelector("[role=alert]")?.textContent).toContain(
    "valid, unique",
  );
  await act(async () =>
    section
      .querySelector<HTMLButtonElement>(
        "button[aria-label='Edit permission exception for https://*.example.com']",
      )!
      .click(),
  );
  const editedInput = section.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(editedInput, "http://localhost:3000");
    editedInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    section
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(currentBrowser()).toMatchObject({
    agent_permissions: {
      sites: [
        {
          pattern: "http://localhost:3000",
          permissions: { browse: "default" },
        },
      ],
    },
  });
  await act(async () =>
    section
      .querySelector<HTMLButtonElement>(
        "button[aria-label='Remove permission exception for http://localhost:3000']",
      )!
      .click(),
  );
  expect(currentBrowser()).toMatchObject({ agent_permissions: { sites: [] } });
});

it("serializes Browser and Desktop saves through the same CAS config owner", async () => {
  await act(async () =>
    Promise.all([
      updateBrowserSetting("show_full_url", true, false),
      updateDesktopPreference(
        "open-link-in-target-preference",
        "in-app-browser",
      ),
      updateBrowserSetting("enabled", false, true),
    ]),
  );
  expect(persisted.browser).toMatchObject({
    show_full_url: true,
    enabled: false,
  });
  expect(persisted.desktop).toEqual({
    "open-link-in-target-preference": "in-app-browser",
  });
  expect(version).toBe(4);
});

function currentBrowser() {
  return browserSettingsFromConfig(persisted);
}

function setRemotePermissions(settings: ReturnType<typeof currentBrowser>) {
  const current = currentBrowser();
  const next = applyBrowserAgentPermissions(
    browserPreferences(current),
    current.browser_use,
    current.agent_permissions,
    settings.agent_permissions,
  );
  persisted = { ...persisted, ...next };
}

function writes() {
  return request.mock.calls.filter(([method]) => method === "config/batchWrite")
    .length;
}

async function setPattern(pattern: string) {
  const input = container.querySelector<HTMLInputElement>(
    "#browser-site-pattern",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, pattern);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitPattern() {
  await act(async () =>
    container
      .querySelector("#browser-agent-permissions form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

async function openAddPattern() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#browser-agent-permissions button")!
      .click(),
  );
}

it("restores remote permissions after CAS rejection, preserves the draft and retries only on explicit submit", async () => {
  await renderPage();
  await openAddPattern();
  await setPattern("https://example.com");
  const remote = currentBrowser();
  remote.agent_permissions.default.browse = "deny";
  setRemotePermissions(remote);
  version += 1;
  await submitPattern();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "changed elsewhere",
  );
  expect(
    container.querySelector<HTMLInputElement>("#browser-site-pattern")!.value,
  ).toBe("https://example.com");
  expect(
    container.querySelector<HTMLSelectElement>(
      'select[aria-label="Default · Browsing"]',
    )!.value,
  ).toBe("deny");
  expect(currentBrowser().agent_permissions.sites).toEqual([]);
  expect(writes()).toBe(1);
  await submitPattern();
  expect(currentBrowser().agent_permissions.sites).toMatchObject([
    { pattern: "https://example.com", permissions: { browse: "default" } },
  ]);
  expect(container.querySelector("#browser-site-pattern")).toBeNull();
  expect(container.querySelector("[role=alert]")).toBeNull();
  expect(writes()).toBe(2);
});

it("keeps an editing baseline when another editor refreshes the matrix before submit", async () => {
  await renderPage();
  await openAddPattern();
  await setPattern("example.com");
  const baseline = currentBrowser();
  const updated = structuredClone(baseline.agent_permissions);
  updated.default.download = "deny";
  await act(async () =>
    updateBrowserSetting(
      "agent_permissions",
      updated,
      baseline.agent_permissions,
    ),
  );
  expect(writes()).toBe(1);
  await submitPattern();
  expect(writes()).toBe(1);
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "changed elsewhere",
  );
  expect(
    container.querySelector<HTMLInputElement>("#browser-site-pattern")!.value,
  ).toBe("example.com");
  await submitPattern();
  expect(writes()).toBe(2);
  expect(currentBrowser().agent_permissions.sites[0].permissions.download).toBe(
    "default",
  );
  expect(currentBrowser().agent_permissions.default.download).toBe("deny");
});

it("does not silently recreate or report saving a site rule removed during editing", async () => {
  const initial = currentBrowser();
  initial.agent_permissions.sites = [
    {
      pattern: "example.com",
      permissions: { ...initial.agent_permissions.default },
    },
  ];
  setRemotePermissions(initial);
  await renderPage();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Edit permission exception for example.com"]',
      )!
      .click(),
  );
  await setPattern("renamed.example.com");
  await act(async () =>
    updateBrowserSetting(
      "agent_permissions",
      { ...initial.agent_permissions, sites: [] },
      initial.agent_permissions,
    ),
  );
  await submitPattern();
  await submitPattern();
  expect(writes()).toBe(1);
  expect(currentBrowser().agent_permissions.sites).toEqual([]);
  expect(
    container.querySelector("#browser-agent-permissions [role=alert]")
      ?.textContent,
  ).toContain("rule was removed");
  expect(
    container.querySelector<HTMLInputElement>("#browser-site-pattern")!.value,
  ).toBe("renamed.example.com");
});

it("blocks further changes if authoritative reload fails and enables them after explicit reload", async () => {
  await renderPage();
  await openAddPattern();
  await setPattern("example.com");
  version += 1;
  rejectRead = true;
  await submitPattern();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "may be outdated",
  );
  expect(
    container.querySelector<HTMLButtonElement>(
      "#browser-enabled [role=switch]",
    )!.disabled,
  ).toBe(true);
  await submitPattern();
  expect(writes()).toBe(1);
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[role=alert] button")!.click(),
  );
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "may be outdated",
  );
  expect(
    container.querySelector<HTMLButtonElement>(
      "#browser-enabled [role=switch]",
    )!.disabled,
  ).toBe(true);
  rejectRead = false;
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[role=alert] button")!.click(),
  );
  expect(
    container.querySelector<HTMLButtonElement>(
      "#browser-enabled [role=switch]",
    )!.disabled,
  ).toBe(false);
  expect(
    container.querySelector<HTMLInputElement>("#browser-site-pattern")!.value,
  ).toBe("example.com");
  await submitPattern();
  expect(currentBrowser().agent_permissions.sites[0].pattern).toBe(
    "example.com",
  );
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "shows a translated conflict and preserves input in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    await renderPage();
    await openAddPattern();
    await setPattern("example.com");
    version += 1;
    await submitPattern();
    const alert = container.querySelector("[role=alert]")!;
    expect(alert.textContent!.length).toBeGreaterThan(20);
    expect(alert.textContent).not.toContain("settings.");
    expect(
      container.querySelector<HTMLInputElement>("#browser-site-pattern")!.value,
    ).toBe("example.com");
    expect(writes()).toBe(1);
  },
);

it.each(["MacIntel", "Win32"])(
  "renders platform modifier choices in order and saves the exact enum on %s",
  async (platform) => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
    await renderPage(true);
    const trigger = container.querySelector<HTMLButtonElement>(
      "#keyboard-external-browser-link button",
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const labels = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitemradio]"),
    ].map((item) => item.textContent);
    expect(labels).toEqual(
      platform === "MacIntel"
        ? ["Unassigned", "⌘+Click", "⌥+Click", "⇧⌘+Click"]
        : ["Unassigned", "Ctrl+Click", "Alt+Click", "Ctrl+Shift+Click"],
    );
    await act(async () =>
      document.querySelectorAll<HTMLElement>("[role=menuitemradio]")[3].click(),
    );
    expect(persisted.desktop).toEqual({
      "external-browser-link-shortcut": "primary-shift",
    });
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "exposes both searchable destinations and the keyboard preference in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    await renderPage();
    expect(container.textContent).not.toMatch(
      /(?:settings|browserDownloads)\./u,
    );
    for (const target of ["browser-web-target", "browser-local-target"]) {
      expect(isSettingsSearchTarget(SettingsTabs.Browser, target, true)).toBe(
        true,
      );
      expect(container.querySelector(`#${target}`)).not.toBeNull();
    }
    await renderPage(true);
    expect(container.textContent).not.toContain("settings.");
    expect(
      isSettingsSearchTarget(
        SettingsTabs.KeyboardShortcuts,
        "keyboard-external-browser-link",
        true,
      ),
    ).toBe(true);
    expect(
      container.querySelector("#keyboard-external-browser-link"),
    ).not.toBeNull();
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "explains unavailable site ask and excludes CDP/WebMCP ask in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    persisted.browser = { approvalMode: "neverAsk" };
    persisted.browser_use = {
      default_origin_policy: { access: "deny" },
      origins: { "example.com": {} },
    };
    await renderPage();
    const site = container.querySelector<HTMLSelectElement>(
      'select[data-browser-permission-action="browse"][data-browser-permission-pattern="example.com"]',
    )!;
    const ask = site.querySelector<HTMLOptionElement>('option[value="ask"]')!;
    expect(ask.disabled).toBe(true);
    const inherited = site.querySelector<HTMLOptionElement>(
      'option[value="default"]',
    )!;
    expect(inherited.textContent!.length).toBeGreaterThan(2);
    expect(inherited.textContent).not.toContain("settings.");
    expect(ask.title.length).toBeGreaterThan(15);
    expect(ask.title).not.toContain("settings.");
    const next = () =>
      container
        .querySelector<HTMLButtonElement>(
          "#browser-agent-permissions thead button:last-child",
        )!
        .click();
    await act(async () => next());
    const cdp = container.querySelector<HTMLSelectElement>(
      'select[data-browser-permission-action="debug"][data-browser-permission-pattern=""]',
    )!;
    expect([...cdp.options].map((option) => option.value)).toEqual([
      "allow",
      "deny",
    ]);
    await act(async () => next());
    const web = container.querySelector<HTMLSelectElement>(
      'select[data-browser-permission-action="site_tools"][data-browser-permission-pattern=""]',
    )!;
    expect([...web.options].map((option) => option.value)).toEqual([
      "allow",
      "deny",
    ]);
    expect(writes()).toBe(0);
  },
);
