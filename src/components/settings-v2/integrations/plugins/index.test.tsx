import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import { PluginsSettings } from ".";
import type { SettingsSkill } from "./useSkillsSettings";
import type { SettingsMarketplace } from "./useMarketplaceSettings";
import type { McpServer } from "@/lib/api/mcp";

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listInstalledPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  uninstallPlugin: vi.fn(),
  navigate: vi.fn(),
  account: null as string | null,
  version: 0,
  listeners: new Set<() => void>(),
  skills: [] as SettingsSkill[],
  reloadSkills: vi.fn(),
  servers: [] as McpServer[],
  mutateMcp: vi.fn(),
  marketplaces: [] as SettingsMarketplace[],
  marketplaceRemoval: null as null | {
    marketplace: SettingsMarketplace;
    plugins: null;
    completed: string[];
    error: "refresh";
    saved: boolean;
  },
}));
vi.mock("@/lib/api/project", () => ({ listProjects: api.listProjects }));
vi.mock("@/lib/api/pluginCatalog", () => ({
  listInstalledPlugins: api.listInstalledPlugins,
  setPluginEnabled: api.setPluginEnabled,
  uninstallPlugin: api.uninstallPlugin,
  PLUGIN_CATALOG_CHANGED_EVENT: "test:plugins-changed",
}));
vi.mock("@/lib/cloudAccount", () => ({
  getCloudAccount: () => api.account,
  cloudAccountIdentity: (value: string | null) => value,
  cloudAccountIdentityVersion: () => api.version,
  subscribeCloudAccount: (listener: () => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));
vi.mock("./useMcpSettings", () => ({
  useMcpSettings: () => ({
    servers: api.servers,
    statuses: [],
    loading: false,
    pending: false,
    error: null,
    awaitingConfirmation: false,
    reload: async () => true,
    clearError: () => {},
    mutate: api.mutateMcp,
  }),
}));
vi.mock("./useSkillsSettings", () => ({
  useSkillsSettings: () => ({
    skills: api.skills,
    loading: false,
    pending: false,
    error: null,
    reload: api.reloadSkills,
  }),
}));

vi.mock("./useMarketplaceSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useMarketplaceSettings")>()),
  useMarketplaceSettings: () => ({
    marketplaces: api.marketplaces,
    loading: false,
    pending: false,
    error: null,
    removal: api.marketplaceRemoval,
    reload: async () => {},
    closeRemoval: () => {},
    canRemove: () => false,
    canUpgrade: () => false,
  }),
}));

let root: Root;
let container: HTMLDivElement;
const plugin = (
  id = "alpha",
  extra: Partial<AppServerPluginSummary> = {},
): AppServerPluginSummary => ({
  id,
  name: id,
  installed: true,
  enabled: true,
  source: { type: "local", path: `/test-only/${id}` },
  installPolicy: "AVAILABLE",
  authPolicy: "ON_USE",
  availability: "AVAILABLE",
  interface: null,
  keywords: [],
  ...extra,
});
const response = (
  plugins: AppServerPluginSummary[],
  errors: unknown[] = [],
) => ({
  marketplaces: [
    { name: "test", path: "/test-only/marketplace", interface: null, plugins },
  ],
  marketplaceLoadErrors: errors,
});
const button = (text: string) =>
  [
    ...(
      document.querySelector('[role="alertdialog"]') ?? document
    ).querySelectorAll<HTMLButtonElement>("button"),
  ].find((node) => node.textContent === text)!;
const click = async (target: HTMLElement) => act(async () => target.click());
const toggle = (name = "alpha") =>
  document.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="Enable ${name}"]`,
  )!;
const mount = async (strict = false) =>
  act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <PluginsSettings onNavigate={api.navigate} />
        </StrictMode>
      ) : (
        <PluginsSettings onNavigate={api.navigate} />
      ),
    ),
  );
const uninstallDialog = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');
const openUninstall = async (id = "alpha") => {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-label="Actions for ${id}"]`,
      )!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  // Radix 在菜单卸载的焦点事件中打开确认框，把该事件也纳入 act。
  const closed = new Promise<void>((resolve) =>
    document
      .querySelector('[role="menu"]')!
      .addEventListener("focusScope.autoFocusOnUnmount", () => resolve(), {
        once: true,
      }),
  );
  await click(document.querySelector<HTMLElement>('[role="menuitem"]')!);
  await act(async () => closed);
  expect(uninstallDialog()).not.toBeNull();
};
const refresh = () =>
  click(
    document.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh plugins"]',
    )!,
  );

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.account = null;
  api.version = 0;
  api.skills = [];
  api.servers = [];
  api.marketplaces = [];
  api.marketplaceRemoval = null;
  api.reloadSkills.mockResolvedValue(true);
  api.listProjects.mockResolvedValue([
    { rootPath: "/project" },
    { rootPath: "/project" },
    { rootPath: "/archived", isArchived: true },
  ]);
  api.listInstalledPlugins.mockResolvedValue(response([plugin()]));
  api.setPluginEnabled.mockResolvedValue(undefined);
  api.uninstallPlugin.mockResolvedValue({});
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("orders Skills after MCPs, supports keyboard selection and browses the skill directory", async () => {
  api.skills = [
    {
      name: "writer",
      path: "/project/writer/SKILL.md",
      description: "Writing",
      enabled: true,
      scope: "user",
    },
  ];
  await mount();
  expect(
    [...container.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.getAttribute("data-testid"),
    ),
  ).toEqual([
    "plugins-settings-tab-plugins",
    "plugins-settings-tab-mcps",
    "plugins-settings-tab-skills",
  ]);
  await act(async () =>
    container
      .querySelector('[data-testid="plugins-settings-tab-skills"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  expect(container.querySelector('[id="plugins-skills"]')).not.toBeNull();
  await click(button("Browse directory"));
  expect(api.navigate).toHaveBeenCalledWith("skills", {
    initialView: "discover",
  });
  await refresh();
  expect(api.reloadSkills).toHaveBeenCalledTimes(1);
  api.skills = [];
  await mount();
  expect(
    container.querySelector('[data-testid="plugins-settings-tab-skills"]'),
  ).toBeNull();
  expect(
    container
      .querySelector('[data-testid="plugins-settings-tab-mcps"]')
      ?.getAttribute("aria-selected"),
  ).toBe("true");
});

it("uses distinct active project roots, filters uninstalled entries and deduplicates canonical IDs", async () => {
  const data = response([plugin(), plugin("available", { installed: false })]);
  data.marketplaces.push({
    ...data.marketplaces[0],
    name: "second",
    plugins: [plugin(), plugin("beta")],
  });
  api.listInstalledPlugins.mockResolvedValue(data);
  await mount();
  expect(api.listInstalledPlugins).toHaveBeenCalledWith({ cwds: ["/project"] });
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
  expect(container.textContent).not.toContain("available");
  await click(button("Browse directory"));
  expect(api.navigate).toHaveBeenLastCalledWith("plugins");
  await click(button("alpha"));
  expect(api.navigate).toHaveBeenLastCalledWith("plugins", {
    statusFilter: "installed",
    selectedPluginId: "alpha",
  });
});

it("uses the default public installed scope when no project is registered", async () => {
  api.listProjects.mockResolvedValue([]);
  await mount();
  expect(api.listInstalledPlugins).toHaveBeenCalledWith({});
});

it("writes local enabled state and displays the confirmed catalog state", async () => {
  await mount();
  api.listInstalledPlugins.mockResolvedValue(
    response([plugin("alpha", { enabled: false })]),
  );
  await click(toggle());
  expect(api.setPluginEnabled).toHaveBeenCalledWith({
    pluginId: "alpha",
    enabled: false,
  });
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("writes remote preferences using the opaque remote identity", async () => {
  const remote = plugin("remote", {
    source: { type: "remote" },
    remotePluginId: "opaque~1",
  });
  api.listInstalledPlugins.mockResolvedValue(response([remote]));
  await mount();
  api.listInstalledPlugins.mockResolvedValue(
    response([{ ...remote, enabled: false }]),
  );
  await click(toggle("remote"));
  expect(api.setPluginEnabled).toHaveBeenCalledWith({
    remotePluginId: "opaque~1",
    enabled: false,
  });
});

it("fails closed when a remote installation has no remote identity", async () => {
  api.listInstalledPlugins.mockResolvedValue(
    response([
      plugin("remote", {
        source: { type: "remote" },
      }),
    ]),
  );
  await mount();
  await click(toggle("remote"));
  expect(api.setPluginEnabled).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save",
  );
});

it("keeps administrator-controlled plugins read-only", async () => {
  api.listInstalledPlugins.mockResolvedValue(
    response([plugin("alpha", { availability: "DISABLED_BY_ADMIN" })]),
  );
  await mount();
  expect(toggle().disabled).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>(
      '[aria-label="Actions for alpha"]',
    )?.disabled,
  ).toBe(true);
  expect(container.textContent).toContain("Managed");
});

it("shows load failure and retries the real read", async () => {
  api.listInstalledPlugins.mockRejectedValueOnce(new Error("unavailable"));
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to load",
  );
  await click(button("Retry"));
  expect(toggle()).toBeTruthy();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps the confirmed state after a write failure and releases the saving lock", async () => {
  await mount();
  api.setPluginEnabled.mockRejectedValueOnce(new Error("denied"));
  await click(toggle());
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(toggle().disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save",
  );
});

it("retains the last complete list when a refresh returns incomplete marketplace data", async () => {
  await mount();
  api.listInstalledPlugins.mockResolvedValueOnce(
    response(
      [],
      [{ marketplacePath: "/test-only/marketplace", message: "unavailable" }],
    ),
  );
  await refresh();
  expect(toggle()).toBeTruthy();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to load",
  );
  expect(container.textContent).not.toContain("No plugins found");
  api.listInstalledPlugins.mockResolvedValue(response([]));
  await refresh();
  expect(toggle()).toBeNull();
  expect(container.textContent).toContain("No MCP servers connected");
});

it("does not report an empty installation after an incomplete initial read", async () => {
  api.listInstalledPlugins.mockResolvedValue(
    response(
      [],
      [{ marketplacePath: "/test-only/marketplace", message: "unavailable" }],
    ),
  );
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to load",
  );
  expect(container.textContent).not.toContain("No plugins found");
});

it("distinguishes saved-but-unread state from overridden state", async () => {
  await mount();
  api.listInstalledPlugins.mockRejectedValueOnce(new Error("read unavailable"));
  await click(toggle());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "change was saved",
  );
  expect(toggle().disabled).toBe(true);
  await click(toggle());
  expect(api.setPluginEnabled).toHaveBeenCalledTimes(1);
  await refresh();
  await click(toggle());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "effective plugin state differs",
  );
});

it("serializes writes and coalesces notifications into the mutation readback", async () => {
  let finish!: () => void;
  api.setPluginEnabled.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await click(toggle());
  expect(toggle().disabled).toBe(true);
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Refresh plugins"]')!
      .click();
    window.dispatchEvent(new Event("test:plugins-changed"));
  });
  expect(api.listInstalledPlugins).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(api.setPluginEnabled).toHaveBeenCalledTimes(1);
  expect(api.listInstalledPlugins).toHaveBeenCalledTimes(2);
});

it("requires confirmation for uninstall and restores focus on cancel", async () => {
  await mount();
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="Actions for alpha"]',
  )!;
  await openUninstall();
  expect(uninstallDialog()?.textContent).toContain("Uninstall alpha?");
  expect(api.uninstallPlugin).not.toHaveBeenCalled();
  await click(button("Cancel"));
  expect(uninstallDialog()).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("closes the menu before mounting confirmation so one Escape dismisses the dialog", async () => {
  await mount();
  await openUninstall();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(uninstallDialog()).toBeNull();
  expect(api.uninstallPlugin).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Actions for alpha",
    ),
  );
});

it("does not show an earlier toggle error as an unattempted uninstall failure", async () => {
  await mount();
  api.setPluginEnabled.mockRejectedValueOnce(new Error("denied"));
  await click(toggle());
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await openUninstall();
  expect(uninstallDialog()?.querySelector('[role="alert"]')).toBeNull();
  expect(api.uninstallPlugin).not.toHaveBeenCalled();
});

it("uninstalls only the confirmed identity and waits for a complete read before closing", async () => {
  await mount();
  await openUninstall();
  api.listInstalledPlugins.mockResolvedValueOnce(
    response(
      [],
      [{ marketplacePath: "/test-only/marketplace", message: "unavailable" }],
    ),
  );
  await click(button("Uninstall"));
  expect(api.uninstallPlugin).toHaveBeenCalledWith({ pluginId: "alpha" });
  expect(uninstallDialog()).not.toBeNull();
  expect(uninstallDialog()?.textContent).toContain("change was saved");
  const calls = api.uninstallPlugin.mock.calls.length;
  api.listInstalledPlugins.mockResolvedValue(response([]));
  await click(button("Retry"));
  expect(uninstallDialog()).toBeNull();
  expect(api.uninstallPlugin).toHaveBeenCalledTimes(calls);
});

it("keeps an uninstall failure visible and closes only after confirmed removal", async () => {
  await mount();
  await openUninstall();
  api.uninstallPlugin.mockRejectedValueOnce(new Error("denied"));
  await click(button("Uninstall"));
  expect(uninstallDialog()?.textContent).toContain("Could not save");
  api.listInstalledPlugins.mockResolvedValue(response([]));
  await click(button("Uninstall"));
  expect(uninstallDialog()).toBeNull();
  expect(container.textContent).toContain("No MCP servers connected");
  await vi.waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Refresh plugins",
    ),
  );
});

it("refreshes after an external catalog mutation and handles StrictMode remounts", async () => {
  await mount(true);
  api.listInstalledPlugins.mockResolvedValue(response([plugin("beta")]));
  await act(async () =>
    window.dispatchEvent(new Event("test:plugins-changed")),
  );
  expect(toggle("beta")).toBeTruthy();
  expect(toggle()).toBeNull();
});

it("clears pending confirmation when the account lifetime changes, including away-and-back", async () => {
  await mount();
  await openUninstall();
  await act(async () => {
    api.version += 2;
    for (const listener of api.listeners) listener();
  });
  expect(uninstallDialog()).toBeNull();
  expect(api.uninstallPlugin).not.toHaveBeenCalled();
});

it("ignores a previous account read that resolves after the new account list", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  api.listInstalledPlugins.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  api.listInstalledPlugins.mockResolvedValue(response([plugin("new-account")]));
  await act(async () => {
    api.account = "new-account";
    api.version++;
    for (const listener of api.listeners) listener();
  });
  await act(async () => resolve(response([plugin("old-account")])));
  expect(toggle("new-account")).toBeTruthy();
  expect(toggle("old-account")).toBeNull();
});

it.each([
  ["zh-CN", "插件", "浏览目录"],
  ["zh-TW", "外掛程式", "瀏覽目錄"],
  ["en-US", "Plugins", "Browse directory"],
  ["ja-JP", "プラグイン", "ディレクトリを見る"],
  ["ko-KR", "플러그인", "디렉터리 찾아보기"],
])(
  "renders the current settings header and navigation in %s",
  async (locale, title, browse) => {
    await changeLimeLocale(locale);
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe(title);
    expect(button(browse)).toBeTruthy();
    expect(container.textContent).not.toContain("settings.plugins.");
  },
);

it("orders Marketplace after Skills in the shared management tabs", async () => {
  api.marketplaces = [
    {
      name: "team",
      path: "/fixture/marketplace.json",
      interface: null,
      plugins: [],
    },
  ];
  api.skills = [
    {
      name: "writer",
      path: "/fixture/writer/SKILL.md",
      description: "Write",
      enabled: true,
      scope: "user",
    },
  ];
  await mount();
  expect(
    [...container.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.getAttribute("data-testid"),
    ),
  ).toEqual([
    "plugins-settings-tab-plugins",
    "plugins-settings-tab-mcps",
    "plugins-settings-tab-skills",
    "plugins-settings-tab-marketplace",
  ]);
});
it("falls back to MCPs for a resolved empty Marketplace group", async () => {
  await act(async () =>
    root.render(<PluginsSettings initialManageTab="marketplace" />),
  );
  expect(
    container.querySelector('[data-testid="plugins-settings-tab-marketplace"]'),
  ).toBeNull();
  expect(
    container
      .querySelector('[data-testid="plugins-settings-tab-mcps"]')
      ?.getAttribute("data-state"),
  ).toBe("active");
});
it("preserves an unconfirmed removal dialog when a concurrent refresh finds no markets", async () => {
  api.marketplaceRemoval = {
    marketplace: {
      name: "team",
      path: "/fixture/marketplace.json",
      interface: null,
      plugins: [],
    },
    plugins: null,
    completed: [],
    saved: true,
    error: "refresh",
  };
  await act(async () =>
    root.render(<PluginsSettings initialManageTab="marketplace" />),
  );
  expect(
    container
      .querySelector('[data-testid="plugins-settings-tab-marketplace"]')
      ?.getAttribute("data-state"),
  ).toBe("active");
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
});

const search = (query: string) =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const selectGroup = (group: string) =>
  act(async () => {
    container
      .querySelector(`[data-testid="plugins-settings-tab-${group}"]`)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  });

it("filters installed plugin metadata without changing counts or canonical write identity", async () => {
  const data = [
    plugin("canonical-alpha"),
    plugin("canonical-beta", {
      interface: {
        displayName: "Review Assistant",
        shortDescription: "Code quality",
      },
    }),
  ];
  api.listInstalledPlugins.mockResolvedValue(response(data));
  await mount();
  await search(" REVIEW ");
  expect(
    [...container.querySelectorAll("[data-plugin-id]")].map((node) =>
      node.getAttribute("data-plugin-id"),
    ),
  ).toEqual(["canonical-beta"]);
  expect(
    container.querySelector('[data-testid="plugins-settings-tab-plugins"]')
      ?.textContent,
  ).toBe("Plugins 2");
  api.listInstalledPlugins.mockResolvedValue(
    response([data[0], { ...data[1], enabled: false }]),
  );
  await click(toggle("Review Assistant"));
  expect(api.setPluginEnabled).toHaveBeenCalledWith({
    pluginId: "canonical-beta",
    enabled: false,
  });
  await search("does-not-exist");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "No results found.",
  );
  expect(
    container
      .querySelector('[data-testid="plugins-settings-tab-plugins"]')
      ?.getAttribute("data-state"),
  ).toBe("active");
  await search("");
  expect(container.querySelectorAll("[data-plugin-id]")).toHaveLength(2);
  expect(api.setPluginEnabled).toHaveBeenCalledTimes(1);
});

it("keeps the same query across groups and searches Skills metadata and Marketplace paths", async () => {
  api.skills = [
    {
      name: "writer",
      path: "/project/writer/SKILL.md",
      description: "Writing",
      interface: { displayName: "Draft helper" },
      scope: "user",
      enabled: true,
    },
  ];
  api.marketplaces = [
    {
      name: "team",
      path: "/finance/marketplace.json",
      interface: null,
      plugins: [],
    },
  ];
  await mount();
  await search("draft");
  await selectGroup("skills");
  expect(
    container
      .querySelector("[data-skill-path]")
      ?.getAttribute("data-skill-path"),
  ).toBe("/project/writer/SKILL.md");
  expect(
    container.querySelector<HTMLInputElement>('input[type="search"]')?.value,
  ).toBe("draft");
  expect(
    container.querySelector('label[for="plugins-page-manage-search"]')
      ?.textContent,
  ).toBe("Search skills");
  await selectGroup("marketplace");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "No results found.",
  );
  expect(
    container.querySelector('[data-testid="plugins-settings-tab-marketplace"]')
      ?.textContent,
  ).toBe("Marketplace 1");
  await search(" FINANCE ");
  expect(
    container
      .querySelector("[data-marketplace-key]")
      ?.getAttribute("data-marketplace-key"),
  ).toBe(JSON.stringify(["team", "/finance/marketplace.json"]));
  expect(api.setPluginEnabled).not.toHaveBeenCalled();
  expect(api.uninstallPlugin).not.toHaveBeenCalled();
});

it("filters MCP names and keeps the MCP group accessible for empty results", async () => {
  api.servers = ["alpha", "beta"].map((name) => ({
    id: `${name}-id`,
    name,
    enabled_lime: true,
    server_config: { command: "node" },
  }));
  await mount();
  await selectGroup("mcps");
  await search("BETA");
  expect(
    [...container.querySelectorAll("[data-server-id]")].map((node) =>
      node.getAttribute("data-server-id"),
    ),
  ).toEqual(["beta-id"]);
  await click(container.querySelector<HTMLButtonElement>('[role="switch"]')!);
  expect(api.mutateMcp).toHaveBeenCalledWith({
    kind: "enabled",
    id: "beta-id",
    enabled: false,
  });
  await search("missing");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "No results found.",
  );
  expect(
    container.querySelector('[data-testid="plugins-settings-tab-mcps"]')
      ?.textContent,
  ).toBe("MCPs 2");
  await search("alpha");
  await click(
    container.querySelector<HTMLButtonElement>(
      '[data-testid="mcp-config-open-settings"]',
    )!,
  );
  expect(container.querySelector('input[type="search"]')).toBeNull();
});
