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

function buildStaleRemoteCatalog(): ServiceSkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  return {
    version: "tenant-2026-03-20",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-20T08:00:00.000Z",
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-stale-skill",
        title: "过期目录项",
        summary: "旧的租户目录快照",
        version: "tenant-2026-03-20",
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
    expect(
      catalog.items.some(
        (item) =>
          item.defaultExecutorBinding === "browser_assist" ||
          Boolean(item.siteCapabilityBinding),
      ),
    ).toBe(false);
    expect(
      catalog.items.find((item) => item.id === "carousel-post-replication"),
    ).toEqual(
      expect.objectContaining({
        skillType: "service",
        entryHint: expect.any(String),
        aliases: expect.arrayContaining(["轮播帖"]),
        usageGuidelines: expect.arrayContaining([
          "适合先产出一版结构化草稿，再在当前工作区继续精修。",
        ]),
        surfaceScopes: expect.arrayContaining(["mention"]),
        promptTemplateKey: "replication",
        skillBundle: expect.objectContaining({
          name: "carousel-post-replication",
          standardCompliance: expect.objectContaining({
            isStandard: true,
          }),
          metadata: expect.objectContaining({
            Lime_skill_type: "service",
            Lime_prompt_template_key: "replication",
          }),
        }),
      }),
    );

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

  it("旧格式远端目录缺少 skillBundle 时应自动补齐标准摘要", async () => {
    const remoteCatalog = buildRemoteCatalog();
    if (remoteCatalog.items[0]) {
      delete remoteCatalog.items[0].skillBundle;
    }

    saveServiceSkillCatalog(remoteCatalog, "bootstrap_sync");

    const catalog = await getServiceSkillCatalog();

    expect(catalog.items[0]?.skillBundle).toEqual(
      expect.objectContaining({
        name: "carousel-post-replication",
        standardCompliance: expect.objectContaining({
          isStandard: true,
        }),
        metadata: expect.objectContaining({
          Lime_skill_type: "service",
          Lime_output_destination:
            "结果会写回当前工作区中的内容草稿，方便继续改写和发布。",
        }),
      }),
    );
  });

  it("清空缓存后应恢复到 seeded catalog", async () => {
    saveServiceSkillCatalog(buildRemoteCatalog(), "bootstrap_sync");

    clearServiceSkillCatalogCache();
    const catalog = await getServiceSkillCatalog();

    expect(catalog.tenantId).toBe("local-seeded");
    expect(catalog.version).toBe("client-seed-2026-04-04");
  });

  it("当前 OEM 租户不匹配时不应读取其他租户的缓存目录", async () => {
    saveServiceSkillCatalog(buildRemoteCatalog(), "manual_override");
    window.__LIME_OEM_CLOUD__ = {
      baseUrl: "https://oem.example.com",
      tenantId: "tenant-other",
    };

    const catalog = await getServiceSkillCatalog();

    expect(catalog.tenantId).toBe("local-seeded");
    expect(catalog.version).toBe("client-seed-2026-04-04");
  });

  it("旧的 seeded 本地缓存应自动升级到当前 seeded 目录", async () => {
    const oldSeeded = getSeededServiceSkillCatalog();
    const downgraded = {
      ...oldSeeded,
      items: oldSeeded.items.filter((item) => item.id !== "daily-trend-briefing"),
    };

    window.localStorage.setItem(
      "lime:service-skill-catalog:v1",
      JSON.stringify(downgraded),
    );

    const catalog = await getServiceSkillCatalog();

    expect(catalog.items.some((item) => item.id === "daily-trend-briefing")).toBe(
      true,
    );
    const stored = window.localStorage.getItem("lime:service-skill-catalog:v1");
    expect(stored).toContain('"daily-trend-briefing"');
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

  it("远端刷新返回更旧目录时不应回退当前缓存版本", async () => {
    saveServiceSkillCatalog(buildRemoteCatalog(), "manual_override");
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
        data: buildStaleRemoteCatalog(),
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await refreshServiceSkillCatalogFromRemote();
    const stored = await getServiceSkillCatalog();

    expect(catalog?.version).toBe("tenant-2026-03-24");
    expect(stored.version).toBe("tenant-2026-03-24");
    expect(stored.items[0]?.id).toBe("tenant-remote-skill");
  });
});
