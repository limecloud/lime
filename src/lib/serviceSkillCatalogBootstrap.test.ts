import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredBaseSetupPackageSnapshot } from "@/lib/base-setup/storage";
import {
  getSeededServiceSkillCatalog,
  getServiceSkillCatalog,
  parseServiceSkillCatalog,
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

function buildBaseSetupPackage() {
  return {
    id: "bootstrap-scene-pack",
    version: "tenant-2026-04-15",
    title: "Bootstrap Scene Pack",
    summary: "通过 bootstrap 下发基础设置包",
    bundle_refs: [
      {
        id: "bootstrap-bundle",
        source: "remote",
        path_or_uri: "lime://bundles/bootstrap",
        kind: "skill_bundle",
      },
    ],
    catalog_projections: [
      {
        id: "tenant-bootstrap-base-setup",
        target_catalog: "service_skill_catalog",
        entry_key: "tenant-bootstrap-base-setup",
        title: "Bootstrap 基础设置场景",
        summary: "来自 bootstrap 的基础设置包目录项",
        category: "Bootstrap",
        output_hint: "结果包",
        bundle_ref_id: "bootstrap-bundle",
        slot_profile_ref: "bootstrap-slot-profile",
        binding_profile_ref: "bootstrap-binding-profile",
        artifact_profile_ref: "bootstrap-artifact-profile",
        scorecard_profile_ref: "bootstrap-scorecard-profile",
        policy_profile_ref: "bootstrap-policy-profile",
      },
    ],
    slot_profiles: [
      {
        id: "bootstrap-slot-profile",
        slots: [
          {
            key: "topic",
            label: "主题",
            type: "text",
            required: true,
            placeholder: "输入主题",
          },
        ],
      },
    ],
    binding_profiles: [
      {
        id: "bootstrap-binding-profile",
        binding_family: "agent_turn",
      },
    ],
    artifact_profiles: [
      {
        id: "bootstrap-artifact-profile",
        delivery_contract: "artifact_bundle",
        required_parts: ["index.md"],
        viewer_kind: "artifact_bundle",
      },
    ],
    scorecard_profiles: [
      {
        id: "bootstrap-scorecard-profile",
        metrics: ["success_rate"],
      },
    ],
    policy_profiles: [
      {
        id: "bootstrap-policy-profile",
      },
    ],
    compatibility: {
      min_app_version: "1.11.0",
      required_kernel_capabilities: ["agent_turn"],
      seeded_fallback: true,
    },
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
    ).toEqual(parseServiceSkillCatalog(catalog));
  });

  it("应支持从 bootstrap 包装层提取 Base Setup Package", () => {
    const catalog = extractServiceSkillCatalogFromBootstrapPayload({
      bootstrap: {
        baseSetupPackage: buildBaseSetupPackage(),
      },
    });

    expect(catalog).toEqual(
      expect.objectContaining({
        version: "tenant-2026-04-15",
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "tenant-bootstrap-base-setup",
            title: "Bootstrap 基础设置场景",
          }),
        ]),
      }),
    );
  });

  it("bootstrap 同步基础设置包时应写入基础设置快照", async () => {
    syncServiceSkillCatalogFromBootstrapPayload({
      bootstrap: {
        baseSetupPackage: buildBaseSetupPackage(),
      },
    });

    const storedSnapshot = readStoredBaseSetupPackageSnapshot();
    const storedCatalog = await getServiceSkillCatalog();

    expect(storedSnapshot).toEqual(
      expect.objectContaining({
        packageId: "bootstrap-scene-pack",
        packageVersion: "tenant-2026-04-15",
        tenantId: "base-setup",
      }),
    );
    expect(storedCatalog.items[0]?.id).toBe("tenant-bootstrap-base-setup");
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
