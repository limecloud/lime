import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredBaseSetupPackageSnapshot } from "@/lib/base-setup/storage";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  getSkillCatalog,
  listSkillCatalogCommandEntries,
  listSkillCatalogSceneEntries,
  parseSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";
import {
  applyInitialSkillCatalogBootstrap,
  extractSkillCatalogFromBootstrapPayload,
  subscribeSkillCatalogBootstrap,
  syncSkillCatalogFromBootstrapPayload,
} from "./skillCatalogBootstrap";

function buildRemoteCatalog(): SkillCatalog {
  const seeded = getSeededSkillCatalog();

  return {
    version: "tenant-2026-04-15",
    tenantId: "tenant-demo",
    syncedAt: "2026-04-15T12:00:00.000Z",
    groups: [
      {
        key: "general",
        title: "通用技能",
        summary: "不依赖站点登录态的业务技能。",
        sort: 90,
        itemCount: 1,
      },
    ],
    items: [
      {
        ...seeded.items[0]!,
        id: "tenant-bootstrap-skill",
        title: "租户同步技能",
        summary: "来自 bootstrap 的目录项",
        groupKey: "general",
        execution: {
          kind: "agent_turn",
        },
      },
    ],
    entries: [],
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
        id: "bootstrap-service",
        target_catalog: "service_skill_catalog",
        entry_key: "bootstrap-service",
        skill_key: "bootstrap-scene",
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
      {
        id: "bootstrap-scene",
        target_catalog: "scene_catalog",
        entry_key: "bootstrap-service",
        skill_key: "bootstrap-scene",
        title: "Bootstrap 显式场景",
        summary: "来自 bootstrap 的显式 scene projection",
        category: "Bootstrap",
        output_hint: "结果包",
        bundle_ref_id: "bootstrap-bundle",
        slot_profile_ref: "bootstrap-slot-profile",
        binding_profile_ref: "bootstrap-binding-profile",
        artifact_profile_ref: "bootstrap-artifact-profile",
        scorecard_profile_ref: "bootstrap-scorecard-profile",
        policy_profile_ref: "bootstrap-policy-profile",
        scene_binding: {
          scene_key: "bootstrap-scene",
          command_prefix: "/bootstrap-scene",
          title: "Bootstrap 显式场景",
          summary: "来自 bootstrap 的显式 scene projection",
          aliases: ["bootstrap"],
        },
      },
      {
        id: "bootstrap-command",
        target_catalog: "command_catalog",
        entry_key: "bootstrap-service",
        skill_key: "voice_runtime",
        title: "Bootstrap 配音入口",
        summary: "来自 bootstrap 的显式 command projection",
        category: "Bootstrap",
        output_hint: "结果包",
        bundle_ref_id: "bootstrap-bundle",
        slot_profile_ref: "bootstrap-slot-profile",
        binding_profile_ref: "bootstrap-binding-profile",
        artifact_profile_ref: "bootstrap-artifact-profile",
        scorecard_profile_ref: "bootstrap-scorecard-profile",
        policy_profile_ref: "bootstrap-policy-profile",
        aliases: ["bootstrap-voice"],
        trigger_hints: ["@配音", "/voice-runtime"],
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
        surface_scopes: ["mention", "workspace"],
      },
    ],
    compatibility: {
      min_app_version: "1.11.0",
      required_kernel_capabilities: ["agent_turn"],
      seeded_fallback: true,
    },
  };
}

describe("skillCatalogBootstrap", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearSkillCatalogCache();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SKILL_CATALOG__;
  });

  afterEach(() => {
    window.localStorage.clear();
    clearSkillCatalogCache();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_SKILL_CATALOG__;
  });

  it("应支持从 bootstrap 包装层提取 skill catalog", () => {
    const catalog = buildRemoteCatalog();

    expect(
      extractSkillCatalogFromBootstrapPayload({
        bootstrap: {
          skillCatalog: catalog,
        },
      }),
    ).toEqual(parseSkillCatalog(catalog));
  });

  it("应支持从 bootstrap 包装层提取 Base Setup Package", () => {
    const catalog = extractSkillCatalogFromBootstrapPayload({
      bootstrap: {
        baseSetupPackage: buildBaseSetupPackage(),
      },
    });

    expect(catalog).not.toBeNull();
    expect(catalog).toEqual(
      expect.objectContaining({
        version: "tenant-2026-04-15",
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "bootstrap-service",
            title: "Bootstrap 基础设置场景",
          }),
        ]),
      }),
    );
    expect(
      listSkillCatalogSceneEntries(catalog as SkillCatalog).find(
        (entry) => entry.sceneKey === "bootstrap-scene",
      ),
    ).toEqual(
      expect.objectContaining({
        commandPrefix: "/bootstrap-scene",
        linkedSkillId: "bootstrap-service",
      }),
    );
    expect(
      listSkillCatalogCommandEntries(catalog as SkillCatalog).find(
        (entry) => entry.commandKey === "voice_runtime",
      ),
    ).toEqual(
      expect.objectContaining({
        title: "Bootstrap 配音入口",
        binding: {
          skillId: "bootstrap-service",
          executionKind: "agent_turn",
        },
      }),
    );
  });

  it("bootstrap 同步基础设置包时应写入基础设置快照", async () => {
    syncSkillCatalogFromBootstrapPayload({
      bootstrap: {
        baseSetupPackage: buildBaseSetupPackage(),
      },
    });

    const storedSnapshot = readStoredBaseSetupPackageSnapshot();
    const storedCatalog = await getSkillCatalog();

    expect(storedSnapshot).toEqual(
      expect.objectContaining({
        packageId: "bootstrap-scene-pack",
        packageVersion: "tenant-2026-04-15",
        tenantId: "base-setup",
      }),
    );
    expect(
      listSkillCatalogSceneEntries(storedCatalog).some(
        (entry) => entry.sceneKey === "bootstrap-scene",
      ),
    ).toBe(true);
  });

  it("启动时应在专用全局快照无效时回退读取 bootstrap payload", async () => {
    const catalog = buildRemoteCatalog();
    window.__LIME_SKILL_CATALOG__ = {
      invalid: true,
    };
    window.__LIME_BOOTSTRAP__ = {
      skillCatalog: catalog,
    };

    const synced = applyInitialSkillCatalogBootstrap();
    const stored = await getSkillCatalog();

    expect(synced?.tenantId).toBe("tenant-demo");
    expect(stored.items[0]?.id).toBe("tenant-bootstrap-skill");
  });

  it("收到 bootstrap 事件后应同步目录", async () => {
    const catalog = buildRemoteCatalog();
    const listener = vi.fn();
    const unsubscribe = subscribeSkillCatalogBootstrap(listener);

    try {
      window.dispatchEvent(
        new CustomEvent("lime:skill-catalog-bootstrap", {
          detail: {
            skillCatalog: catalog,
          },
        }),
      );

      const stored = await getSkillCatalog();
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
});
