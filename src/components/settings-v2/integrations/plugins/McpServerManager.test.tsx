import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { McpServer } from "@/lib/api/mcp";
import { SettingsDraftContext } from "../../_layout/useSettingsDraft";
import { PluginsSettings } from ".";

const api = vi.hoisted(() => ({
  getServers: vi.fn(),
  statuses: vi.fn(),
  addServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  toggleServer: vi.fn(),
  loginOAuthServer: vi.fn(),
  open: vi.fn(),
  navigate: vi.fn(),
  register: vi.fn(),
  servers: [] as McpServer[],
  pluginServers: [] as unknown[],
  notifications: null as null | ((messages: unknown[]) => void),
  failAfterWrite: false,
  failRead: false,
}));
vi.mock("@/lib/api/mcp", () => ({
  mcpApi: api,
  listAllMcpServerStatuses: api.statuses,
}));
vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser: api.open,
}));
vi.mock("@/lib/api/appServerEventBus", () => ({
  subscribeAppServerNotifications: (options: {
    onNotifications: (messages: unknown[]) => void;
  }) => {
    api.notifications = options.onNotifications;
    return () => {
      api.notifications = null;
    };
  },
}));
vi.mock("./usePluginsSettings", () => ({
  usePluginsSettings: () => ({
    plugins: [],
    loading: false,
    pending: false,
    error: null,
    accountVersion: 0,
  }),
}));
vi.mock("./useSkillsSettings", () => ({
  useSkillsSettings: () => ({
    skills: [],
    loading: false,
    pending: false,
    error: null,
    reload: async () => true,
  }),
}));
const server = (extra: Partial<McpServer> = {}): McpServer => ({
  id: "alpha-id",
  name: "alpha",
  server_config: {
    command: "node",
    args: ["--test"],
    env: { TOKEN: " secret " },
    tool_timeout: 75,
  },
  enabled_lime: true,
  ...extra,
});
vi.mock("./useMarketplaceSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useMarketplaceSettings")>()),
  useMarketplaceSettings: () => ({
    marketplaces: [],
    loading: false,
    pending: false,
    error: null,
    removal: null,
    reload: async () => {},
    closeRemoval: () => {},
  }),
}));

let root: Root, container: HTMLDivElement;
const click = async (node: HTMLElement) => act(async () => node.click());
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text,
  )!;
const input = (id: string) =>
  document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
async function fill(node: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
async function mount(locale = "en-US") {
  await changeLimeLocale(locale);
  await act(async () =>
    root.render(
      <SettingsDraftContext.Provider value={api.register}>
        <PluginsSettings initialManageTab="mcps" onNavigate={api.navigate} />
      </SettingsDraftContext.Provider>,
    ),
  );
}
const edit = () =>
  click(
    document.querySelector<HTMLButtonElement>(
      '[aria-label="Settings for alpha"]',
    )!,
  );
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.servers = [server()];
  api.pluginServers = [];
  api.failAfterWrite = false;
  api.failRead = false;
  api.register.mockReturnValue(vi.fn());
  api.getServers.mockImplementation(async () => {
    if (api.failRead) {
      api.failRead = false;
      throw Error("test-only read unavailable");
    }
    return structuredClone(api.servers);
  });
  api.statuses.mockImplementation(async () => api.pluginServers);
  api.addServer.mockImplementation(async (value: McpServer) => {
    api.servers.push(structuredClone(value));
    if (api.failAfterWrite) api.failRead = true;
  });
  api.updateServer.mockImplementation(async (value: McpServer) => {
    api.servers = api.servers.map((item) =>
      item.id === value.id ? structuredClone(value) : item,
    );
    if (api.failAfterWrite) api.failRead = true;
  });
  api.deleteServer.mockImplementation(async (id: string) => {
    api.servers = api.servers.filter((item) => item.id !== id);
    if (api.failAfterWrite) api.failRead = true;
  });
  api.toggleServer.mockImplementation(async (id: string, enabled: boolean) => {
    api.servers.find((item) => item.id === id)!.enabled_lime = enabled;
  });
  api.loginOAuthServer.mockResolvedValue({
    authorizationUrl: "https://test.invalid/oauth",
    state: "test-only",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("keeps MCP visible, counts real servers and removes the old statistics/import/sync surface", async () => {
  await mount();
  expect(document.querySelector('[role="tab"]')?.textContent).toBe("MCPs 1");
  expect(
    container.querySelectorAll('[data-testid="mcp-config-server"]'),
  ).toHaveLength(1);
  expect(container.textContent).not.toMatch(
    /Running servers|Import all|Sync to external|Tools|Prompts|Resources/,
  );
  await click(document.querySelector<HTMLElement>('[role="switch"]')!);
  expect(api.toggleServer).toHaveBeenCalledWith("alpha-id", false);
  expect(
    document.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
  ).toBe("false");
});

it("edits structured STDIO fields while preserving unknown configuration and local enablement", async () => {
  await mount();
  await edit();
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(
    (input("mcp-config-transport") as unknown as HTMLSelectElement).disabled,
  ).toBe(true);
  await fill(input("mcp-config-command"), "python");
  await click(input("mcp-config-save"));
  expect(api.updateServer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "alpha-id",
      server_config: expect.objectContaining({
        type: "stdio",
        command: "python",
        args: ["--test"],
        env: { TOKEN: " secret " },
        tool_timeout: 75,
      }),
    }),
  );
  expect(
    container.querySelector('[data-testid="mcp-config-detail"]'),
  ).toBeNull();
});

it("creates HTTP configuration through individual header fields without app syncing or a preset", async () => {
  await mount();
  await click(input("mcp-config-create-server"));
  await fill(input("mcp-config-name"), "docs");
  await fill(
    input("mcp-config-transport") as unknown as HTMLSelectElement,
    "streamable_http",
  );
  await fill(input("mcp-config-connection-url"), "https://test.invalid/mcp");
  await click(button("Add variable"));
  await fill(input("mcp-config-env-header-key"), "Authorization");
  await fill(input("mcp-config-env-header-value"), "DOCS_TOKEN");
  await click(input("mcp-config-save"));
  expect(api.addServer).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "docs",
      enabled_lime: true,
      server_config: expect.objectContaining({
        type: "streamable_http",
        url: "https://test.invalid/mcp",
        env_http_headers: { Authorization: "DOCS_TOKEN" },
      }),
    }),
  );
  expect(api.servers).toHaveLength(2);
});

it("retries only the read after a successful create, never creating a second server", async () => {
  await mount();
  await click(input("mcp-config-create-server"));
  await fill(input("mcp-config-name"), "new");
  await fill(input("mcp-config-command"), "node");
  api.failAfterWrite = true;
  await click(input("mcp-config-save"));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "change was saved",
  );
  expect(
    (input("mcp-config-save") as unknown as HTMLButtonElement).disabled,
  ).toBe(true);
  await click(button("Retry"));
  expect(api.addServer).toHaveBeenCalledTimes(1);
  expect(
    container.querySelector('[data-testid="mcp-config-detail"]'),
  ).toBeNull();
});

it("rejects an externally changed configuration before writing the stale draft", async () => {
  await mount();
  await edit();
  await fill(input("mcp-config-command"), "python");
  api.servers[0].server_config = { command: "changed-externally" };
  await click(input("mcp-config-save"));
  expect(api.updateServer).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "differs",
  );
});

it("registers dirty drafts and requires confirmation before local Back", async () => {
  await mount();
  await edit();
  await fill(input("mcp-config-command"), "python");
  expect(api.register).toHaveBeenLastCalledWith({ dirty: true, saving: false });
  await click(input("mcp-config-cancel"));
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await click(button("Discard changes"));
  expect(
    container.querySelector('[data-testid="mcp-config-detail"]'),
  ).toBeNull();
  expect(api.updateServer).not.toHaveBeenCalled();
});

it("confirms uninstall and rereads its result before removing the detail view", async () => {
  await mount();
  await edit();
  await click(input("mcp-config-delete"));
  expect(api.deleteServer).not.toHaveBeenCalled();
  await click(
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].at(-1)!,
  );
  expect(api.deleteServer).toHaveBeenCalledWith("alpha-id");
  expect(container.textContent).toContain("No MCP servers connected");
});

it("keeps plugin-origin servers separate and navigates to their real plugin owner", async () => {
  api.pluginServers = [
    {
      name: "plugin-server",
      pluginId: "package@market",
      authStatus: "unsupported",
      runtimeStatus: "connected",
    },
  ];
  await mount();
  const toggles = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
  ];
  expect(toggles[1].disabled).toBe(true);
  expect(container.textContent).toContain("From plugins");
  await click(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) =>
        node.textContent === "Settings" && !node.hasAttribute("aria-label"),
    )!,
  );
  expect(api.navigate).toHaveBeenCalledWith("plugins", {
    statusFilter: "installed",
    selectedPluginId: "package@market",
  });
});

it("opens the real OAuth URL and shows failed canonical notifications", async () => {
  api.pluginServers = [
    {
      name: "alpha",
      authStatus: "notLoggedIn",
      runtimeStatus: "failed",
      pluginId: null,
    },
  ];
  await mount();
  await click(button("Authenticate"));
  expect(api.loginOAuthServer).toHaveBeenCalledWith("alpha");
  expect(api.open).toHaveBeenCalledWith("https://test.invalid/oauth");
  await act(async () =>
    api.notifications?.([
      {
        method: "mcpServer/oauthLogin/completed",
        params: {
          name: "alpha",
          success: false,
          threadId: null,
          error: "test-only failure",
        },
      },
    ]),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not authenticate",
  );
});

it.each([
  ["zh-CN", "添加服务器"],
  ["zh-TW", "新增伺服器"],
  ["en-US", "Add server"],
  ["ja-JP", "サーバーを追加"],
  ["ko-KR", "서버 추가"],
])("renders the functional MCP form in %s", async (locale, label) => {
  await mount(locale);
  await click(button(label));
  expect(
    document.querySelector('[data-testid="mcp-config-name"]'),
  ).not.toBeNull();
  expect(container.textContent).not.toContain("settings.plugins.");
});

it("restores the settings action focus after Back and Add focus after uninstall", async () => {
  await mount();
  await edit();
  await click(input("mcp-config-cancel"));
  expect(document.activeElement).toBe(input("mcp-config-open-settings"));
  await edit();
  await click(input("mcp-config-delete"));
  await click(
    document.querySelector<HTMLElement>(
      '[role="alertdialog"] button:last-child',
    )!,
  );
  expect(document.activeElement).toBe(input("mcp-config-create-server"));
});

it("does not repeat uninstall when readback fails after the delete succeeded", async () => {
  await mount();
  await edit();
  await click(input("mcp-config-delete"));
  api.failAfterWrite = true;
  await click(
    document.querySelector<HTMLElement>(
      '[role="alertdialog"] button:last-child',
    )!,
  );
  expect(api.deleteServer).toHaveBeenCalledTimes(1);
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent,
  ).toContain("change was saved");
  await click(button("Retry"));
  expect(api.deleteServer).toHaveBeenCalledTimes(1);
  expect(
    document.querySelector('[data-testid="mcp-config-detail"]'),
  ).toBeNull();
});

it("preserves a rejected save draft and keeps the next uninstall confirmation free of that error", async () => {
  await mount();
  await edit();
  await fill(input("mcp-config-command"), "python");
  api.updateServer.mockRejectedValueOnce(Error("test-only failure"));
  await click(input("mcp-config-save"));
  expect(input("mcp-config-command").value).toBe("python");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await click(input("mcp-config-delete"));
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]'),
  ).toBeNull();
});

it("queues notifications during a read and refreshes after that read completes", async () => {
  await mount();
  let finish!: (value: McpServer[]) => void;
  api.getServers.mockImplementationOnce(
    () =>
      new Promise<McpServer[]>((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Refresh plugins"]',
  )!;
  await click(refresh);
  const before = api.getServers.mock.calls.length;
  await act(async () =>
    api.notifications?.([
      {
        method: "mcpServer/oauthLogin/completed",
        params: {
          name: "alpha",
          success: false,
          threadId: null,
          error: "test-only rejection",
        },
      },
    ]),
  );
  expect(api.getServers).toHaveBeenCalledTimes(before);
  await act(async () => finish(structuredClone(api.servers)));
  expect(api.getServers).toHaveBeenCalledTimes(before + 1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not authenticate",
  );
});

it("rejects duplicate server names and preserves freshly changed enable flags", async () => {
  await mount();
  await click(input("mcp-config-create-server"));
  await fill(input("mcp-config-name"), "alpha");
  await fill(input("mcp-config-command"), "node");
  await click(input("mcp-config-save"));
  expect(api.addServer).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "differs",
  );
  await click(input("mcp-config-cancel"));
  await click(button("Discard changes"));
  await edit();
  await fill(input("mcp-config-command"), "python");
  api.servers[0].enabled_lime = false;
  await click(input("mcp-config-save"));
  expect(api.updateServer).toHaveBeenCalledWith(
    expect.objectContaining({ enabled_lime: false }),
  );
});

it("ignores stale StrictMode reads and a delivered notification from an unmounted subscription", async () => {
  let finish!: (value: McpServer[]) => void;
  api.getServers.mockImplementationOnce(
    () =>
      new Promise<McpServer[]>((resolve) => {
        finish = resolve;
      }),
  );
  await changeLimeLocale("en-US");
  await act(async () =>
    root.render(
      <StrictMode>
        <PluginsSettings initialManageTab="mcps" />
      </StrictMode>,
    ),
  );
  expect(
    container.querySelectorAll('[data-testid="mcp-config-server"]'),
  ).toHaveLength(1);
  await act(async () => finish([]));
  expect(
    container.querySelectorAll('[data-testid="mcp-config-server"]'),
  ).toHaveLength(1);
  const deliveredLate = api.notifications;
  await act(async () => root.render(<div />));
  const reads = api.getServers.mock.calls.length;
  await act(async () =>
    deliveredLate?.([
      {
        method: "mcpServer/oauthLogin/completed",
        params: {
          name: "alpha",
          success: false,
          threadId: null,
          error: "late test-only callback",
        },
      },
    ]),
  );
  expect(api.getServers).toHaveBeenCalledTimes(reads);
});

it("closes a fresh uninstall confirmation with a single Escape and restores its trigger", async () => {
  await mount();
  await edit();
  await click(input("mcp-config-delete"));
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
  await act(async () =>
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alertdialog"]')).toBeNull(),
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(input("mcp-config-delete")),
  );
  expect(api.deleteServer).not.toHaveBeenCalled();
});

it("uses the effective runtime enabled value and restores a disabled configuration through its canonical owner", async () => {
  api.servers[0].server_config = {
    ...api.servers[0].server_config,
    enabled: false,
  };
  await mount();
  const toggle = document.querySelector<HTMLButtonElement>(
    '[data-server-id="alpha-id"] [role="switch"]',
  )!;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await click(toggle);
  expect(api.updateServer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "alpha-id",
      enabled_lime: true,
      server_config: expect.objectContaining({
        enabled: true,
        tool_timeout: 75,
      }),
    }),
  );
  expect(api.toggleServer).not.toHaveBeenCalled();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

it("clears a previous OAuth failure when a later successful canonical notification arrives", async () => {
  await mount();
  await act(async () =>
    api.notifications?.([
      {
        method: "mcpServer/oauthLogin/completed",
        params: {
          name: "alpha",
          success: false,
          threadId: null,
          error: "test-only rejection",
        },
      },
    ]),
  );
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () =>
    api.notifications?.([
      {
        method: "mcpServer/oauthLogin/completed",
        params: { name: "alpha", success: true, threadId: null },
      },
    ]),
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("closes a saved-but-unread draft after a background notification confirms the write", async () => {
  await mount();
  await click(input("mcp-config-create-server"));
  await fill(input("mcp-config-name"), "new");
  await fill(input("mcp-config-command"), "node");
  api.failAfterWrite = true;
  await click(input("mcp-config-save"));
  expect(
    container.querySelector('[data-testid="mcp-config-detail"]'),
  ).not.toBeNull();
  await act(async () =>
    api.notifications?.([
      {
        method: "mcpServer/startupStatus/updated",
        params: {
          threadId: null,
          name: "new",
          status: "ready",
          error: null,
          failureReason: null,
        },
      },
    ]),
  );
  expect(
    container.querySelector('[data-testid="mcp-config-detail"]'),
  ).toBeNull();
  expect(api.addServer).toHaveBeenCalledTimes(1);
});

it("edits, validates, saves and clears local environment variable passthrough", async () => {
  await mount();
  await edit();
  await click(button("Add variable"));
  await fill(input("mcp-config-env-var-passthrough"), "A=B");
  expect(input("mcp-config-save").disabled).toBe(true);
  expect(api.updateServer).not.toHaveBeenCalled();
  await fill(input("mcp-config-env-var-passthrough"), " WORKSPACE_TOKEN ");
  await click(input("mcp-config-save"));
  expect(api.updateServer).toHaveBeenLastCalledWith(
    expect.objectContaining({
      server_config: expect.objectContaining({
        env_vars: ["WORKSPACE_TOKEN"],
        env: { TOKEN: " secret " },
      }),
    }),
  );
  await edit();
  const field = input("mcp-config-env-var-passthrough");
  expect(field.value).toBe("WORKSPACE_TOKEN");
  await click(field.parentElement!.querySelector("button")!);
  await click(input("mcp-config-save"));
  expect(api.servers[0].server_config).not.toHaveProperty("env_vars");
});
