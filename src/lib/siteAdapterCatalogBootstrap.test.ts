import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyInitialSiteAdapterCatalogBootstrap,
  clearSiteAdapterCatalogCache,
  emitSiteAdapterCatalogBootstrap,
  extractSiteAdapterCatalogFromBootstrapPayload,
  subscribeSiteAdapterCatalogBootstrap,
  syncSiteAdapterCatalogFromBootstrapPayload,
} from "./siteAdapterCatalogBootstrap";

const {
  mockSiteApplyAdapterCatalogBootstrap,
  mockSiteClearAdapterCatalogCache,
} = vi.hoisted(() => ({
  mockSiteApplyAdapterCatalogBootstrap: vi.fn(),
  mockSiteClearAdapterCatalogCache: vi.fn(),
}));

vi.mock("@/lib/webview-api", () => ({
  siteApplyAdapterCatalogBootstrap: mockSiteApplyAdapterCatalogBootstrap,
  siteClearAdapterCatalogCache: mockSiteClearAdapterCatalogCache,
}));

function buildCatalogPayload() {
  return {
    catalogVersion: "tenant-sync-1",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-25T12:00:00.000Z",
    adapters: [
      {
        name: "github/search",
        domain: "github.com",
        description: "租户同步 GitHub 搜索",
        read_only: true,
        capabilities: ["search"],
        args: [],
        example: 'github/search {"query":"lime"}',
        entry: {
          kind: "fixed_url",
          url: "https://github.com/search",
        },
        script: "async () => ({ items: [] })",
        sourceVersion: "tenant-sync-1",
      },
    ],
  };
}

describe("siteAdapterCatalogBootstrap", () => {
  beforeEach(() => {
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SITE_ADAPTER_CATALOG__;
    mockSiteApplyAdapterCatalogBootstrap.mockResolvedValue({
      exists: true,
      source_kind: "server_synced",
      registry_version: 1,
      directory: "/tmp/lime/site-adapters/server-synced",
      catalog_version: "tenant-sync-1",
      tenant_id: "tenant-demo",
      synced_at: "2026-03-25T12:00:00.000Z",
      adapter_count: 1,
    });
    mockSiteClearAdapterCatalogCache.mockResolvedValue({
      exists: false,
      source_kind: "server_synced",
      registry_version: 1,
      directory: "/tmp/lime/site-adapters/server-synced",
      adapter_count: 0,
    });
  });

  afterEach(() => {
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SITE_ADAPTER_CATALOG__;
    vi.clearAllMocks();
  });

  it("应支持从嵌套 bootstrap payload 提取站点适配器目录", () => {
    const catalog = buildCatalogPayload();

    expect(
      extractSiteAdapterCatalogFromBootstrapPayload({
        data: {
          bootstrap: {
            siteAdapterCatalog: catalog,
          },
        },
      }),
    ).toEqual(catalog);
  });

  it("启动时应在专用全局快照无效时回退读取 bootstrap payload", async () => {
    const catalog = buildCatalogPayload();
    window.__LIME_SITE_ADAPTER_CATALOG__ = {
      invalid: true,
    };
    window.__LIME_BOOTSTRAP__ = {
      siteAdapterCatalog: catalog,
    };

    const synced = await applyInitialSiteAdapterCatalogBootstrap();

    expect(synced?.catalog_version).toBe("tenant-sync-1");
    expect(mockSiteApplyAdapterCatalogBootstrap).toHaveBeenCalledTimes(1);
    expect(mockSiteApplyAdapterCatalogBootstrap).toHaveBeenCalledWith(catalog);
  });

  it("收到 bootstrap 事件后应同步目录", async () => {
    const catalog = buildCatalogPayload();
    const listener = vi.fn();
    const unsubscribe = subscribeSiteAdapterCatalogBootstrap(listener);

    try {
      emitSiteAdapterCatalogBootstrap({
        siteAdapterCatalog: catalog,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSiteApplyAdapterCatalogBootstrap).toHaveBeenCalledWith(
        catalog,
      );
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          catalog_version: "tenant-sync-1",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  it("非法 payload 不应触发目录同步", async () => {
    const synced = await syncSiteAdapterCatalogFromBootstrapPayload({
      invalid: true,
    });

    expect(synced).toBeNull();
    expect(mockSiteApplyAdapterCatalogBootstrap).not.toHaveBeenCalled();
  });

  it("应支持清理本地站点适配器缓存", async () => {
    const status = await clearSiteAdapterCatalogCache();

    expect(status).toEqual(
      expect.objectContaining({
        exists: false,
        adapter_count: 0,
      }),
    );
    expect(mockSiteClearAdapterCatalogCache).toHaveBeenCalledTimes(1);
  });
});
