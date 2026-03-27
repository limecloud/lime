import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSeededServiceSkillCatalog,
  getServiceSkillCatalog,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";
import {
  applyInitialServiceSkillCatalogBootstrap,
  emitServiceSkillCatalogBootstrap,
  extractServiceSkillCatalogFromBootstrapPayload,
  subscribeServiceSkillCatalogBootstrap,
  syncServiceSkillCatalogFromBootstrapPayload,
} from "./serviceSkillCatalogBootstrap";

function buildRemoteCatalog(): ServiceSkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  return {
    version: "tenant-2026-03-24",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-24T12:00:00.000Z",
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-bootstrap-skill",
        title: "租户同步技能",
        summary: "来自 bootstrap 的目录项",
        version: "tenant-2026-03-24",
      },
    ],
  };
}

function buildStaleRemoteCatalog(): ServiceSkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  return {
    version: "tenant-2026-03-20",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-20T12:00:00.000Z",
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-stale-bootstrap-skill",
        title: "租户旧目录",
        summary: "来自较旧 bootstrap 的目录项",
        version: "tenant-2026-03-20",
      },
    ],
  };
}

describe("serviceSkillCatalogBootstrap", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SERVICE_SKILL_CATALOG__;
  });

  afterEach(() => {
    window.localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SERVICE_SKILL_CATALOG__;
  });

  it("应支持从 bootstrap 包装层提取服务型技能目录", () => {
    const catalog = buildRemoteCatalog();

    expect(
      extractServiceSkillCatalogFromBootstrapPayload({
        bootstrap: {
          serviceSkillCatalog: catalog,
        },
      }),
    ).toEqual(catalog);
  });

  it("启动时应在专用全局快照无效时回退读取 bootstrap payload", async () => {
    const catalog = buildRemoteCatalog();
    window.__LIME_SERVICE_SKILL_CATALOG__ = {
      invalid: true,
    };
    window.__LIME_BOOTSTRAP__ = {
      serviceSkillCatalog: catalog,
    };

    const synced = applyInitialServiceSkillCatalogBootstrap();
    const stored = await getServiceSkillCatalog();

    expect(synced?.tenantId).toBe("tenant-demo");
    expect(stored.items[0]?.id).toBe("tenant-bootstrap-skill");
  });

  it("收到 bootstrap 事件后应同步目录", async () => {
    const catalog = buildRemoteCatalog();
    const listener = vi.fn();
    const unsubscribe = subscribeServiceSkillCatalogBootstrap(listener);

    try {
      emitServiceSkillCatalogBootstrap({
        serviceSkillCatalog: catalog,
      });

      const stored = await getServiceSkillCatalog();
      expect(stored.tenantId).toBe("tenant-demo");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-demo",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  it("非法 payload 不应覆盖已有目录", async () => {
    const catalog = buildRemoteCatalog();

    syncServiceSkillCatalogFromBootstrapPayload({
      serviceSkillCatalog: catalog,
    });
    const ignored = syncServiceSkillCatalogFromBootstrapPayload({
      serviceSkillCatalog: {
        invalid: true,
      },
    });
    const stored = await getServiceSkillCatalog();

    expect(ignored).toBeNull();
    expect(stored.tenantId).toBe("tenant-demo");
    expect(stored.items[0]?.id).toBe("tenant-bootstrap-skill");
  });

  it("较旧 bootstrap 目录不应覆盖当前已缓存版本", async () => {
    syncServiceSkillCatalogFromBootstrapPayload({
      serviceSkillCatalog: buildRemoteCatalog(),
    });

    const synced = syncServiceSkillCatalogFromBootstrapPayload({
      serviceSkillCatalog: buildStaleRemoteCatalog(),
    });
    const stored = await getServiceSkillCatalog();

    expect(synced?.version).toBe("tenant-2026-03-24");
    expect(stored.version).toBe("tenant-2026-03-24");
    expect(stored.items[0]?.id).toBe("tenant-bootstrap-skill");
  });
});
