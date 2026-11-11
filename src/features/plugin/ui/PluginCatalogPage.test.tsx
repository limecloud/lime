import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import { PluginCatalogPage } from "./PluginCatalogPage";

const mocks = vi.hoisted(() => ({
  accountId: null as string | null,
  addMarketplace: vi.fn(),
  accountListeners: new Set<() => void>(),
  appsSubscription: null as null | {
    onUpdate: (apps: unknown[]) => void;
  },
  getProject: vi.fn(),
  installPlugin: vi.fn(),
  listPlugins: vi.fn(),
  listPluginShares: vi.fn(),
  reconcilePlugins: vi.fn(),
  readAppsReadiness: vi.fn(),
  readPlugin: vi.fn(),
  removeMarketplace: vi.fn(),
  setPluginEnabled: vi.fn(),
  subscribeAppsListUpdates: vi.fn(),
  uninstallPlugin: vi.fn(),
  upgradeMarketplace: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/cloudAccount", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudAccount")>()),
  getCloudAccount: () =>
    mocks.accountId
      ? {
          account: {
            baseUrl: "https://fixture.test",
            tenantId: "tenant",
            userId: mocks.accountId,
            sessionId: `session-${mocks.accountId}`,
          },
        }
      : null,
  subscribeCloudAccount: (listener: () => void) => {
    mocks.accountListeners.add(listener);
    return () => mocks.accountListeners.delete(listener);
  },
}));

vi.mock("@/lib/api/project", () => ({
  getProject: (...args: unknown[]) => mocks.getProject(...args),
}));

vi.mock("@/lib/api/pluginShare", () => ({
  listPluginShares: (...args: unknown[]) => mocks.listPluginShares(...args),
}));

vi.mock("@/lib/api/apps", () => ({
  readAppsReadiness: (...args: unknown[]) => mocks.readAppsReadiness(...args),
  subscribeAppsListUpdates: (...args: unknown[]) =>
    mocks.subscribeAppsListUpdates(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/api/pluginCatalog", () => ({
  addMarketplace: (...args: unknown[]) => mocks.addMarketplace(...args),
  installPlugin: (...args: unknown[]) => mocks.installPlugin(...args),
  listPlugins: (...args: unknown[]) => mocks.listPlugins(...args),
  reconcilePlugins: (...args: unknown[]) => mocks.reconcilePlugins(...args),
  readPlugin: (...args: unknown[]) => mocks.readPlugin(...args),
  removeMarketplace: (...args: unknown[]) => mocks.removeMarketplace(...args),
  setPluginEnabled: (...args: unknown[]) => mocks.setPluginEnabled(...args),
  uninstallPlugin: (...args: unknown[]) => mocks.uninstallPlugin(...args),
  upgradeMarketplace: (...args: unknown[]) => mocks.upgradeMarketplace(...args),
}));

function summary(
  overrides: Partial<AppServerPluginSummary> = {},
): AppServerPluginSummary {
  return {
    authPolicy: "ON_USE",
    availability: "AVAILABLE",
    interface: {
      displayName: "Writer Plugin",
      shortDescription: "Writing and research tools",
    },
    enabled: true,
    id: "writer-plugin@personal",
    installPolicy: "AVAILABLE",
    installed: true,
    localVersion: "1.2.3",
    name: "writer-plugin",
    source: { type: "local", path: "/tmp/writer-plugin" },
    version: "1.2.3",
    ...overrides,
  };
}

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PluginCatalogPage />);
  });
  await flush();
  mounted.push({ container, root });
  return container;
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
}

describe("PluginCatalogPage", () => {
  beforeEach(async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    await changeLimeLocale("zh-CN");
    vi.clearAllMocks();
    mocks.accountId = null;
    mocks.listPluginShares.mockResolvedValue({ data: [] });
    mocks.appsSubscription = null;
    mocks.listPlugins.mockResolvedValue({
      marketplaces: [
        {
          name: "personal",
          path: "/tmp/marketplace.json",
          plugins: [summary()],
        },
      ],
    });
    mocks.readPlugin.mockResolvedValue({
      plugin: {
        summary: summary(),
        skills: [
          {
            name: "Article Writing",
            description: "",
            shortDescription: null,
            interface: null,
            path: "/tmp/writer-plugin/skills/article-writing/SKILL.md",
            enabled: true,
          },
        ],
        mcpServers: [],
        apps: [
          {
            id: "writer-app",
            name: "Writer App",
            description: "",
            installUrl: null,
            category: null,
          },
        ],
        hooks: [],
      },
    });
    mocks.setPluginEnabled.mockResolvedValue(undefined);
    mocks.reconcilePlugins.mockResolvedValue({
      changedPlugins: [],
      failedRemotePluginIds: [],
      failedMaterializationRemotePluginIds: [],
    });
    mocks.uninstallPlugin.mockResolvedValue({});
    mocks.readAppsReadiness.mockResolvedValue({
      apps: [
        {
          id: "writer-app",
          name: "Writer App",
          description: null,
          logoUrl: null,
          logoUrlDark: null,
          iconAssets: null,
          iconDarkAssets: null,
          distributionChannel: "local",
          branding: null,
          appMetadata: null,
          labels: null,
          installUrl: null,
          isAccessible: true,
          isEnabled: true,
          pluginDisplayNames: ["Writer Plugin"],
        },
      ],
      installed: [
        {
          id: "writer-app",
          runtimeName: "Writer App",
          enabled: true,
          callable: false,
        },
      ],
      ready: false,
    });
    mocks.subscribeAppsListUpdates.mockImplementation(
      (subscription: { onUpdate: (apps: unknown[]) => void }) => {
        mocks.appsSubscription = subscription;
        return vi.fn();
      },
    );
  });

  afterEach(async () => {
    while (mounted.length) {
      const entry = mounted.pop();
      if (!entry) {
        continue;
      }
      await act(async () => entry.root.unmount());
      entry.container.remove();
    }
  });

  it("同页侧栏导航应同步安装筛选、搜索和选中的插件详情", async () => {
    mocks.listPlugins.mockResolvedValue({
      marketplaces: [
        {
          name: "personal",
          path: "/tmp/marketplace.json",
          plugins: [
            summary(),
            summary({ id: "browser", name: "Browser", installed: false }),
          ],
        },
      ],
    });
    const container = await renderPage();
    const { root } = mounted.at(-1)!;
    await act(async () => {
      root.render(
        <PluginCatalogPage
          pageParams={{
            statusFilter: "installed",
            selectedPluginId: "writer-plugin@personal",
            query: "Writer",
          }}
        />,
      );
    });
    await flush();
    expect(
      container
        .querySelector('[data-testid="plugin-catalog-search"]')
        ?.getAttribute("value"),
    ).toBe("Writer");
    expect(
      container.querySelector('[data-testid="plugin-catalog-card-browser"]'),
    ).toBeNull();
    expect(mocks.readPlugin).toHaveBeenLastCalledWith({
      marketplacePath: "/tmp/marketplace.json",
      pluginName: "writer-plugin",
    });

    await click(
      container.querySelector('[data-testid="plugin-catalog-view-all"]'),
    );
    await act(async () => {
      root.render(
        <PluginCatalogPage pageParams={{ statusFilter: "installed" }} />,
      );
    });
    await flush();
    expect(
      container.querySelector<HTMLInputElement>(
        '[data-testid="plugin-catalog-search"]',
      )?.value,
    ).toBe("");
    expect(
      container.querySelector('[data-testid="plugin-catalog-card-browser"]'),
    ).toBeNull();

    await act(async () => {
      root.render(<PluginCatalogPage pageParams={{}} />);
    });
    await flush();
    expect(
      container.querySelector('[data-testid="plugin-catalog-card-browser"]'),
    ).not.toBeNull();
  });

  it("项目切换后忽略旧市场请求，使用新项目的显式 cwd", async () => {
    mocks.getProject.mockImplementation(async (id: string) => ({
      rootPath: `/tmp/${id}`,
    }));
    let finishOldRequest!: (value: { marketplaces: unknown[] }) => void;
    mocks.listPlugins.mockImplementation(({ cwds }: { cwds?: string[] }) => {
      if (cwds?.[0] === "/tmp/old-project") {
        return new Promise((resolve) => {
          finishOldRequest = resolve;
        });
      }
      return Promise.resolve({ marketplaces: [] });
    });
    const container = await renderPage();
    const { root } = mounted.at(-1)!;
    await act(async () => {
      root.render(
        <PluginCatalogPage pageParams={{ currentProjectId: "old-project" }} />,
      );
    });
    await flush();
    expect(mocks.listPlugins).toHaveBeenCalledWith({
      cwds: ["/tmp/old-project"],
    });
    await act(async () => {
      root.render(
        <PluginCatalogPage pageParams={{ currentProjectId: "new-project" }} />,
      );
    });
    await flush();
    expect(mocks.listPlugins).toHaveBeenLastCalledWith({
      cwds: ["/tmp/new-project"],
    });
    await act(async () => {
      finishOldRequest({
        marketplaces: [
          { name: "personal", path: "/tmp/old.json", plugins: [summary()] },
        ],
      });
    });
    await flush();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-writer-plugin@personal"]',
      ),
    ).toBeNull();
  });

  it("从 v2 catalog 展示安装状态并读取详情", async () => {
    const container = await renderPage();

    expect(container.textContent).toContain("插件");
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-writer-plugin@personal"]',
      ),
    ).not.toBeNull();
    expect(mocks.listPlugins).toHaveBeenCalledWith({});
    expect(mocks.readPlugin).toHaveBeenCalledWith({
      marketplacePath: "/tmp/marketplace.json",
      pluginName: "writer-plugin",
    });
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-select-writer-plugin@personal"]',
      ),
    );
    await flush();
    expect(container.textContent).toContain("Article Writing");
    expect(
      container
        .querySelector(
          '[data-testid="plugin-catalog-app-readiness-writer-app"]',
        )
        ?.getAttribute("data-callable"),
    ).toBe("false");
    expect(container.textContent).toContain("宿主待接入");

    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-actions-writer-plugin@personal"]',
      ),
    );
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-toggle-writer-plugin@personal"]',
      ),
    );
    expect(mocks.setPluginEnabled).toHaveBeenCalledWith({
      pluginId: "writer-plugin@personal",
      enabled: false,
    });
  });

  it.each([
    ["zh-CN", "无法更新插件启停状态，请重试。"],
    ["zh-TW", "無法更新外掛啟停狀態，請重試。"],
    ["en-US", "Could not update the plugin. Please try again."],
    [
      "ja-JP",
      "プラグインの状態を更新できませんでした。もう一度お試しください。",
    ],
    ["ko-KR", "플러그인 상태를 업데이트하지 못했습니다. 다시 시도해 주세요."],
  ])(
    "%s 远端启停传 opaque ID，成功刷新，失败保留状态",
    async (locale, message) => {
      await changeLimeLocale(locale);
      mocks.accountId = "one";
      const plugin = summary({
        id: "writer-plugin@workspace-directory",
        remotePluginId: "remote_writer~1",
        source: { type: "remote" },
      });
      mocks.listPlugins.mockImplementation(async ({ marketplaceKinds }) =>
        marketplaceKinds
          ? {
              marketplaces: [
                { name: "workspace-directory", path: null, plugins: [plugin] },
              ],
            }
          : { marketplaces: [] },
      );
      const container = await renderPage();
      for (const failed of [false, true]) {
        if (failed)
          mocks.setPluginEnabled.mockRejectedValueOnce(
            new Error("HTTP 503 private detail"),
          );
        const reads = mocks.reconcilePlugins.mock.calls.length;
        await click(
          container.querySelector(
            '[data-testid="plugin-catalog-actions-writer-plugin@workspace-directory"]',
          ),
        );
        await click(
          container.querySelector(
            '[data-testid="plugin-catalog-toggle-writer-plugin@workspace-directory"]',
          ),
        );
        expect(mocks.setPluginEnabled).toHaveBeenLastCalledWith({
          remotePluginId: "remote_writer~1",
          enabled: false,
        });
        expect(mocks.reconcilePlugins.mock.calls.length).toBe(
          reads + (failed ? 0 : 1),
        );
      }
      expect(container.textContent).toContain(message);
      expect(container.textContent).not.toContain("private detail");
    },
  );

  it("远端详情和安装传服务 ID，配置身份保持 canonical ID", async () => {
    mocks.accountId = "one";
    const plugin = summary({
      id: "writer-plugin@workspace-directory",
      remotePluginId: "remote_writer~1",
      source: { type: "remote" },
      installed: false,
      enabled: false,
    });
    const remoteCatalog = {
      marketplaces: [
        {
          name: "workspace-directory",
          path: null,
          plugins: [plugin],
        },
      ],
    };
    mocks.listPlugins.mockImplementation(async ({ marketplaceKinds }) =>
      marketplaceKinds ? remoteCatalog : { marketplaces: [] },
    );
    mocks.installPlugin.mockResolvedValue({
      authPolicy: "ON_USE",
      appsNeedingAuth: [],
    });
    const container = await renderPage();
    expect(mocks.readPlugin).toHaveBeenCalledWith({
      remoteMarketplaceName: "workspace-directory",
      pluginName: "remote_writer~1",
    });
    expect(mocks.reconcilePlugins).toHaveBeenCalledWith({
      reason: "plugin-catalog-refresh",
    });
    expect(mocks.reconcilePlugins.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listPlugins.mock.invocationCallOrder[0],
    );
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-install-writer-plugin@workspace-directory"]',
      ),
    );
    await click(
      document.body.querySelector(
        '[data-testid="plugin-catalog-confirm-install"]',
      ),
    );
    expect(mocks.installPlugin).toHaveBeenCalledWith({
      remoteMarketplaceName: "workspace-directory",
      pluginName: "remote_writer~1",
      installAttemptId: expect.any(String),
    });
    expect(mocks.listPlugins).toHaveBeenCalledWith({
      marketplaceKinds: [
        "workspace-directory",
        "created-by-me-remote",
        "shared-with-me",
      ],
    });
  });

  it("换号丢弃迟到目录，注销清空远端视图", async () => {
    mocks.accountId = "old";
    let finishOld!: (value: unknown) => void;
    mocks.listPlugins.mockImplementation(async ({ marketplaceKinds }) => {
      if (!marketplaceKinds) return { marketplaces: [] };
      if (mocks.accountId === "old")
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      return {
        marketplaces: [
          {
            name: "workspace-directory",
            path: null,
            plugins: [
              summary({
                id: "new@workspace-directory",
                name: "new",
                remotePluginId: "new-id",
                source: { type: "remote" },
              }),
            ],
          },
        ],
      };
    });
    const container = await renderPage();
    await act(async () => {
      mocks.accountId = "new";
      mocks.accountListeners.forEach((listener) => listener());
    });
    await flush();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-new@workspace-directory"]',
      ),
    ).not.toBeNull();
    await act(async () => {
      finishOld({
        marketplaces: [{ name: "old", path: null, plugins: [summary()] }],
      });
    });
    await flush();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-new@workspace-directory"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-writer-plugin@personal"]',
      ),
    ).toBeNull();
    await act(async () => {
      mocks.accountId = null;
      mocks.accountListeners.forEach((listener) => listener());
    });
    await flush();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-new@workspace-directory"]',
      ),
    ).toBeNull();
  });

  it("从分享列表补入我创建的私人远端插件并提供管理入口", async () => {
    mocks.accountId = "owner";
    const plugin = summary({
      id: "private@workspace-shared-with-me",
      name: "private",
      remotePluginId: "opaque~private",
      source: { type: "remote" },
      shareContext: {
        remotePluginId: "opaque~private",
        discoverability: "PRIVATE",
        creatorAccountUserId: "owner",
      },
    });
    mocks.listPluginShares.mockResolvedValue({
      data: [{ plugin, localPluginPath: null }],
    });
    mocks.listPlugins.mockResolvedValue({ marketplaces: [] });
    const container = await renderPage();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-share-private@workspace-shared-with-me"]',
      ),
    ).not.toBeNull();
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-select-private@workspace-shared-with-me"]',
      ),
    );
    expect(mocks.readPlugin).toHaveBeenCalledWith({
      pluginName: "opaque~private",
      remoteMarketplaceName: "workspace-shared-with-me",
    });
  });

  it("分享读取失败仍保留真实本地目录，并显示失败原因", async () => {
    mocks.accountId = "owner";
    mocks.listPlugins.mockImplementation(async ({ marketplaceKinds }) => ({
      marketplaces: marketplaceKinds
        ? []
        : [
            {
              name: "personal",
              path: "/tmp/marketplace.json",
              plugins: [summary()],
            },
          ],
    }));
    mocks.listPluginShares.mockRejectedValue(new Error("sharing unavailable"));
    const container = await renderPage();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-share-writer-plugin@personal"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="plugin-catalog-error"]')
        ?.textContent,
    ).toContain("sharing unavailable");
  });

  it.each([
    ["zh-CN", "远端插件标识无效，请刷新目录。"],
    ["zh-TW", "遠端插件識別碼無效，請重新整理目錄。"],
    ["en-US", "Invalid remote plugin ID. Refresh the catalog."],
    ["ja-JP", "リモートプラグインの ID が無効です。一覧を更新してください。"],
    ["ko-KR", "원격 플러그인 ID가 올바르지 않습니다. 목록을 새로 고침하세요."],
  ])("%s 远端缺 ID 时显示本地化错误且不请求详情", async (locale, message) => {
    await changeLimeLocale(locale);
    mocks.listPlugins.mockResolvedValue({
      marketplaces: [
        {
          name: "workspace-directory",
          path: null,
          plugins: [
            summary({ source: { type: "remote" }, remotePluginId: null }),
          ],
        },
      ],
    });
    const container = await renderPage();
    expect(container.textContent).toContain(message);
    expect(mocks.readPlugin).not.toHaveBeenCalled();
  });

  it("收到 typed app/list/updated 后刷新 Apps readiness", async () => {
    const container = await renderPage();
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-select-writer-plugin@personal"]',
      ),
    );
    await flush();
    const readinessCallsBeforeUpdate =
      mocks.readAppsReadiness.mock.calls.length;
    mocks.readAppsReadiness.mockResolvedValueOnce({
      apps: [],
      installed: [
        {
          id: "writer-app",
          runtimeName: "Writer App",
          enabled: false,
          callable: false,
        },
      ],
      ready: true,
    });

    await act(async () => {
      mocks.appsSubscription?.onUpdate([]);
      await Promise.resolve();
    });
    await flush();

    expect(mocks.readAppsReadiness).toHaveBeenCalledTimes(
      readinessCallsBeforeUpdate + 1,
    );
    const row = container.querySelector(
      '[data-testid="plugin-catalog-app-readiness-writer-app"]',
    );
    expect(row?.getAttribute("data-enabled")).toBe("false");
    expect(row?.getAttribute("data-status")).toBe("disabled");
    expect(row?.textContent).toContain("已停用");
  });

  it("卸载空响应后刷新市场安装态、关闭确认并提示成功", async () => {
    mocks.uninstallPlugin.mockResolvedValue({});
    const container = await renderPage();
    mocks.listPlugins.mockResolvedValue({
      marketplaces: [
        {
          name: "personal",
          path: "/tmp/marketplace.json",
          plugins: [summary({ installed: false, enabled: false })],
        },
      ],
    });
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-actions-writer-plugin@personal"]',
      ),
    );
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-uninstall-writer-plugin@personal"]',
      ),
    );
    const confirm = container.querySelector(
      '[data-testid="plugin-catalog-uninstall-confirm"]',
    );
    await click(confirm?.querySelector("button:last-child") ?? null);

    expect(mocks.uninstallPlugin).toHaveBeenCalledWith({
      pluginId: "writer-plugin@personal",
    });
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-writer-plugin@personal"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-uninstall-confirm"]',
      ),
    ).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("卸载失败时保留卡片和确认状态，不提示成功", async () => {
    mocks.uninstallPlugin.mockRejectedValue(new Error("uninstall rejected"));
    const container = await renderPage();
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-actions-writer-plugin@personal"]',
      ),
    );
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-uninstall-writer-plugin@personal"]',
      ),
    );
    const confirm = container.querySelector(
      '[data-testid="plugin-catalog-uninstall-confirm"]',
    );
    await click(confirm?.querySelector("button:last-child") ?? null);

    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-card-writer-plugin@personal"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-uninstall-confirm"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="plugin-catalog-error"]')
        ?.textContent,
    ).toContain("uninstall rejected");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("按市场定位安装并从服务端刷新，不依赖安装响应中的插件", async () => {
    mocks.listPlugins
      .mockResolvedValueOnce({
        marketplaces: [
          {
            name: "personal",
            path: "/tmp/marketplace.json",
            plugins: [summary({ installed: false, enabled: false })],
          },
        ],
      })
      .mockResolvedValue({
        marketplaces: [
          {
            name: "personal",
            path: "/tmp/marketplace.json",
            plugins: [summary()],
          },
        ],
      });
    mocks.installPlugin.mockResolvedValue({
      authPolicy: "ON_USE",
      appsNeedingAuth: [],
    });
    const container = await renderPage();
    expect(
      container.querySelector('[data-testid="plugin-catalog-install-local"]'),
    ).toBeNull();
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-install-writer-plugin@personal"]',
      ),
    );
    await click(
      document.body.querySelector(
        '[data-testid="plugin-catalog-confirm-install"]',
      ),
    );
    expect(mocks.installPlugin).toHaveBeenCalledWith({
      marketplacePath: "/tmp/marketplace.json",
      pluginName: "writer-plugin",
      installAttemptId: expect.any(String),
    });
    expect(mocks.listPlugins).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-actions-writer-plugin@personal"]',
      ),
    ).not.toBeNull();
  });

  it.each([
    ["zh-CN", "连接插件，让 Lime 在你的各类工具中协同工作。"],
    ["zh-TW", "連接外掛，讓 Lime 在你的各種工具中協同工作。"],
    [
      "en-US",
      "Connect plugins so Lime can work with your tools.",
    ],
    ["ja-JP", "プラグインを接続して、Lime をさまざまなツールで活用しましょう。"],
    ["ko-KR", "플러그인을 연결해 Lime이 다양한 도구에서 함께 작동하도록 하세요."],
  ] as const)("%s 展示市场安装文案", async (locale, description) => {
    await changeLimeLocale(locale);
    const container = await renderPage();
    expect(container.textContent).toContain(description);
    expect(
      container.querySelector('[data-testid="plugin-catalog-install-local"]'),
    ).toBeNull();
  });
  it("头部添加按钮提交市场来源并刷新目录", async () => {
    mocks.addMarketplace.mockResolvedValue({});
    const container = await renderPage();
    await click(
      container.querySelector('[data-testid="plugin-catalog-add"]'),
    );
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="plugin-catalog-add-source"]',
    );
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "https://example.com/marketplace.git");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const callsBefore = mocks.listPlugins.mock.calls.length;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="plugin-catalog-add-confirm"]',
        )
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.addMarketplace).toHaveBeenCalledWith({
      source: "https://example.com/marketplace.git",
    });
    await vi.waitFor(() =>
      expect(mocks.listPlugins.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
  it("插件设置对话框可移除市场并刷新目录", async () => {
    mocks.removeMarketplace.mockResolvedValue({});
    const container = await renderPage();
    await click(
      container.querySelector('[data-testid="plugin-catalog-settings"]'),
    );
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-settings-dialog"]',
      ),
    ).not.toBeNull();
    const callsBefore = mocks.listPlugins.mock.calls.length;
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-remove-marketplace-personal"]',
      ),
    );
    await flush();
    expect(mocks.removeMarketplace).toHaveBeenCalledWith({
      marketplaceName: "personal",
    });
    await vi.waitFor(() =>
      expect(mocks.listPlugins.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
  it("插件设置对话框可更新市场并刷新目录", async () => {
    mocks.upgradeMarketplace.mockResolvedValue({});
    const container = await renderPage();
    await click(
      container.querySelector('[data-testid="plugin-catalog-settings"]'),
    );
    const callsBefore = mocks.listPlugins.mock.calls.length;
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-upgrade-marketplace-personal"]',
      ),
    );
    await flush();
    expect(mocks.upgradeMarketplace).toHaveBeenCalledWith({
      marketplaceName: "personal",
    });
    await vi.waitFor(() =>
      expect(mocks.listPlugins.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
  it("设置对话框可直接转到添加市场", async () => {
    const container = await renderPage();
    await click(
      container.querySelector('[data-testid="plugin-catalog-settings"]'),
    );
    await click(
      container.querySelector('[data-testid="plugin-catalog-settings-add"]'),
    );
    expect(
      container.querySelector(
        '[data-testid="plugin-catalog-add-marketplace"]',
      ),
    ).not.toBeNull();
  });
  it("按插件 interface.category 分组展示", async () => {
    mocks.listPlugins.mockResolvedValue({
      marketplaces: [
        {
          name: "personal",
          path: "/tmp/marketplace.json",
          plugins: [
            summary({
              id: "writer@personal",
              interface: {
                displayName: "Writer",
                shortDescription: "Write",
                category: "Productivity",
              },
            }),
            summary({
              id: "slack@personal",
              interface: {
                displayName: "Slack",
                shortDescription: "Chat",
                category: "Communication",
              },
            }),
          ],
        },
      ],
    });
    const container = await renderPage();
    expect(container.textContent).toContain("Productivity");
    expect(container.textContent).toContain("Communication");
  });
  it("未安装插件的详情页显示安装入口", async () => {
    mocks.listPlugins.mockResolvedValue({
      marketplaces: [
        {
          name: "personal",
          path: "/tmp/marketplace.json",
          plugins: [summary({ installed: false })],
        },
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PluginCatalogPage
          pageParams={{ selectedPluginId: "writer-plugin@personal" }}
        />,
      );
    });
    await flush();
    mounted.push({ container, root });
    const detail = container.querySelector(
      '[data-testid="plugin-catalog-detail"]',
    );
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("安装插件");
  });
  it("插件详情展示信息表与版本", async () => {
    const container = await renderPage();
    await click(
      container.querySelector(
        '[data-testid="plugin-catalog-select-writer-plugin@personal"]',
      ),
    );
    await flush();
    const detail = container.querySelector(
      '[data-testid="plugin-catalog-detail"]',
    );
    expect(detail?.textContent).toContain("信息");
    expect(detail?.textContent).toContain("版本");
    expect(detail?.textContent).toContain("1.2.3");
  });
});
