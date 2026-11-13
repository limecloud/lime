import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_CATALOG_CHANGED_EVENT,
  installPlugin,
  listInstalledPlugins,
  listPlugins,
  reconcilePlugins,
  readPlugin,
  readPluginSkill,
  searchPluginCatalog,
  setPluginEnabled,
  uninstallPlugin,
  type PluginCatalogClient,
  addMarketplace,
  removeMarketplace,
  upgradeMarketplace,
  type MarketplaceClient,
} from "./pluginCatalog";

function client(): PluginCatalogClient {
  return {
    listPlugins: vi.fn().mockResolvedValue({
      result: {
        marketplaces: [],
        marketplaceLoadErrors: [],
        featuredPlugins: [],
      },
    }),
    searchPlugins: vi
      .fn()
      .mockResolvedValue({ result: { data: [], nextCursor: null } }),
    request: vi.fn().mockResolvedValue({ result: { plugin: {} } }),
    requestCloud: vi.fn(),
    readAccount: vi.fn(),
    readPlugin: vi.fn().mockResolvedValue({ result: { plugin: {} } }),
    installPlugin: vi.fn().mockResolvedValue({ result: { plugin: {} } }),
    uninstallPlugin: vi.fn().mockResolvedValue({ result: {} }),
    listInstalledPlugins: vi.fn().mockResolvedValue({
      result: {
        marketplaces: [],
        marketplaceLoadErrors: [],
        featuredPlugins: [],
      },
    }),
  };
}

describe("Plugin catalog API", () => {
  it("技能正文走typed RPC且传递取消信号，失败保留错误", async () => {
    const params = {
      remoteMarketplaceName: "workspace-directory",
      remotePluginId: "opaque~1",
      skillName: "research",
    };
    const options = { signal: new AbortController().signal };
    const client = {
      readPluginSkill: vi
        .fn()
        .mockResolvedValue({ result: { contents: null } }),
    };
    expect(await readPluginSkill(params, options, client)).toEqual({
      contents: null,
    });
    expect(client.readPluginSkill).toHaveBeenCalledWith(params, options);
    client.readPluginSkill.mockRejectedValueOnce(new Error("HTTP 404"));
    await expect(readPluginSkill(params, options, client)).rejects.toThrow(
      "HTTP 404",
    );
  });
  it("对账保留部分物化失败合同，只有成功响应通知共享读面刷新", async () => {
    const result = {
      changedPlugins: [
        {
          id: "research@workspace-directory",
          hasSkills: true,
          hasMcps: false,
          hasApps: false,
          hasHooks: false,
        },
      ],
      failedRemotePluginIds: ["remote-failed"],
      failedMaterializationRemotePluginIds: ["remote-failed"],
    };
    const reconciliation = {
      reconcilePlugins: vi.fn().mockResolvedValue({ result }),
    };
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    try {
      expect(
        await reconcilePlugins({ reason: "catalog-refresh" }, reconciliation),
      ).toEqual(result);
      expect(reconciliation.reconcilePlugins).toHaveBeenCalledWith({
        reason: "catalog-refresh",
      });
      expect(listener).toHaveBeenCalledTimes(1);
      reconciliation.reconcilePlugins.mockRejectedValueOnce(
        new Error("incomplete snapshot"),
      );
      await expect(reconcilePlugins({}, reconciliation)).rejects.toThrow(
        "incomplete snapshot",
      );
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }
  });

  it("市场变更成功后刷新同一catalog，失败不发出成功刷新", async () => {
    const marketClient: MarketplaceClient = {
      addMarketplace: vi.fn().mockResolvedValue({
        result: {
          marketplaceName: "team",
          installedRoot: "/tmp/team",
          alreadyAdded: false,
        },
      }),
      removeMarketplace: vi.fn().mockResolvedValue({
        result: { marketplaceName: "team", installedRoot: null },
      }),
      upgradeMarketplace: vi.fn().mockResolvedValue({
        result: {
          selectedMarketplaces: ["team"],
          upgradedRoots: [],
          errors: [{ marketplaceName: "team", message: "source unavailable" }],
        },
      }),
    };
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    try {
      await addMarketplace(
        { source: "owner/repo", refName: "main", sparsePaths: ["plugins"] },
        marketClient,
      );
      await upgradeMarketplace({}, marketClient);
      await removeMarketplace({ marketplaceName: "team" }, marketClient);
      expect(listener).toHaveBeenCalledTimes(3);
      vi.mocked(marketClient.addMarketplace).mockRejectedValueOnce(
        new Error("source rejected"),
      );
      await expect(
        addMarketplace({ source: "invalid" }, marketClient),
      ).rejects.toThrow("source rejected");
      expect(listener).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }
  });

  it("只通过 typed App Server client 访问 catalog/install owner", async () => {
    const appServerClient = client();

    await listPlugins({ cwds: ["/tmp/workspace"] }, appServerClient);
    await searchPluginCatalog({ searchTerm: "demo" }, appServerClient);
    await readPlugin(
      { marketplacePath: "/tmp/marketplace.json", pluginName: "demo" },
      appServerClient,
    );
    await setPluginEnabled(
      { pluginId: "demo@market", enabled: true },
      appServerClient,
    );
    await installPlugin(
      { marketplacePath: "/tmp/marketplace.json", pluginName: "demo" },
      appServerClient,
    );
    await listInstalledPlugins({}, appServerClient);
    await uninstallPlugin({ pluginId: "demo" }, appServerClient);

    expect(appServerClient.listPlugins).toHaveBeenCalledWith({
      cwds: ["/tmp/workspace"],
    });
    expect(appServerClient.searchPlugins).toHaveBeenCalledWith({
      searchTerm: "demo",
    });
    expect(appServerClient.request).toHaveBeenCalledWith("config/batchWrite", {
      edits: [
        {
          keyPath: 'plugins."demo@market".enabled',
          value: true,
          mergeStrategy: "replace",
        },
      ],
      reloadUserConfig: true,
    });
    expect(appServerClient.readPlugin).toHaveBeenCalledWith({
      marketplacePath: "/tmp/marketplace.json",
      pluginName: "demo",
    });
    expect(appServerClient.installPlugin).toHaveBeenCalledWith({
      marketplacePath: "/tmp/marketplace.json",
      pluginName: "demo",
    });
    expect(appServerClient.listInstalledPlugins).toHaveBeenCalledWith({});
    expect(appServerClient.uninstallPlugin).toHaveBeenCalledWith({
      pluginId: "demo",
    });
  });

  it("安装、启停和卸载后应通知 v2 catalog 消费者刷新", async () => {
    const appServerClient = client();
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);

    try {
      await installPlugin(
        { marketplacePath: "/tmp/marketplace.json", pluginName: "demo" },
        appServerClient,
      );
      await setPluginEnabled(
        { pluginId: "demo@market", enabled: false },
        appServerClient,
      );
      await uninstallPlugin({ pluginId: "demo" }, appServerClient);
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("卸载失败不发布已成功变更通知", async () => {
    const appServerClient = client();
    vi.mocked(appServerClient.uninstallPlugin).mockRejectedValue(
      new Error("uninstall rejected"),
    );
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    try {
      await expect(
        uninstallPlugin({ pluginId: "demo@market" }, appServerClient),
      ).rejects.toThrow("uninstall rejected");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }
  });
});
