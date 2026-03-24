import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearServiceSkillCatalogCache,
  getSeededServiceSkillCatalog,
  getServiceSkillCatalog,
  listServiceSkills,
  refreshServiceSkillCatalogFromRemote,
  saveServiceSkillCatalog,
  subscribeServiceSkillCatalogChanged,
  type ServiceSkillCatalog,
} from "./serviceSkills";

function buildRemoteCatalog(): ServiceSkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  return {
    version: "tenant-2026-03-24",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-24T12:00:00.000Z",
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-remote-skill",
        title: "租户短视频脚本",
        summary: "租户下发的远端目录项",
        version: "tenant-2026-03-24",
      },
    ],
  };
}

describe("serviceSkills API", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("无缓存时应回退到 seeded catalog", async () => {
    const catalog = await getServiceSkillCatalog();

    expect(catalog.tenantId).toBe("local-seeded");
    expect(catalog.items.length).toBeGreaterThan(0);

    const cached = window.localStorage.getItem("lime:service-skill-catalog:v1");
    expect(cached).toContain('"tenantId":"local-seeded"');
  });

  it("保存远端目录后应优先返回远端 catalog", async () => {
    const remoteCatalog = buildRemoteCatalog();

    saveServiceSkillCatalog(remoteCatalog, "bootstrap_sync");

    const catalog = await getServiceSkillCatalog();
    const skills = await listServiceSkills();

    expect(catalog.tenantId).toBe("tenant-demo");
    expect(catalog.version).toBe("tenant-2026-03-24");
    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe("tenant-remote-skill");
  });

  it("清空缓存后应恢复到 seeded catalog", async () => {
    saveServiceSkillCatalog(buildRemoteCatalog(), "bootstrap_sync");

    clearServiceSkillCatalogCache();
    const catalog = await getServiceSkillCatalog();

    expect(catalog.tenantId).toBe("local-seeded");
    expect(catalog.version).toBe("client-seed-2026-03-24");
  });

  it("目录变更时应广播 catalog change 事件", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeServiceSkillCatalogChanged(callback);

    try {
      saveServiceSkillCatalog(buildRemoteCatalog(), "bootstrap_sync");
      clearServiceSkillCatalogCache();

      expect(callback).toHaveBeenNthCalledWith(1, "bootstrap_sync");
      expect(callback).toHaveBeenNthCalledWith(2, "cache_clear");
    } finally {
      unsubscribe();
    }
  });

  it("存在 OEM 注入时应优先从远端刷新目录", async () => {
    window.__LIME_OEM_CLOUD__ = {
      baseUrl: "https://oem.example.com",
      tenantId: "tenant-demo",
    };
    window.__LIME_SESSION_TOKEN__ = "session-token-demo";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 200,
        message: "success",
        data: buildRemoteCatalog(),
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await refreshServiceSkillCatalogFromRemote();
    const stored = await getServiceSkillCatalog();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oem.example.com/api/v1/public/tenants/tenant-demo/client/service-skills",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer session-token-demo",
        }),
      }),
    );
    expect(catalog?.tenantId).toBe("tenant-demo");
    expect(stored.tenantId).toBe("tenant-demo");
  });
});
