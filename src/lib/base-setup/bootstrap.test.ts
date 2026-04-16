import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStoredBaseSetupPackageSnapshot } from "./storage";
import {
  extractBaseSetupPackageFromBootstrapPayload,
  resolveBaseSetupCatalogFromBootstrapPayload,
  resolveBaseSetupCatalogPayload,
} from "./bootstrap";

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
        id: "bootstrap-base-setup-skill",
        target_catalog: "service_skill_catalog",
        entry_key: "bootstrap-base-setup-skill",
        title: "Bootstrap 基础设置场景",
        summary: "来自基础设置包编译的目录项",
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
    },
  };
}

describe("base-setup bootstrap", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("应支持从 payload 解析基础设置包并编译 compat catalog", () => {
    const resolved = resolveBaseSetupCatalogPayload(buildBaseSetupPackage(), {
      tenantId: "tenant-demo",
      syncedAt: "2026-04-15T12:00:00.000Z",
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        catalog: expect.objectContaining({
          tenantId: "tenant-demo",
          version: "tenant-2026-04-15",
          items: expect.arrayContaining([
            expect.objectContaining({
              id: "bootstrap-base-setup-skill",
            }),
          ]),
        }),
        snapshot: expect.objectContaining({
          packageId: "bootstrap-scene-pack",
          tenantId: "tenant-demo",
        }),
      }),
    );
    expect(readStoredBaseSetupPackageSnapshot()).toBeNull();
  });

  it("显式要求时应把基础设置快照写入缓存", () => {
    resolveBaseSetupCatalogPayload(buildBaseSetupPackage(), {
      tenantId: "tenant-demo",
      syncedAt: "2026-04-15T12:00:00.000Z",
      persistSnapshot: true,
    });

    expect(readStoredBaseSetupPackageSnapshot()).toEqual(
      expect.objectContaining({
        packageId: "bootstrap-scene-pack",
        packageVersion: "tenant-2026-04-15",
      }),
    );
  });

  it("应支持从 bootstrap 包装层提取并编译基础设置包", () => {
    const extracted = extractBaseSetupPackageFromBootstrapPayload({
      bootstrap: {
        baseSetupPackage: buildBaseSetupPackage(),
      },
    });
    const resolved = resolveBaseSetupCatalogFromBootstrapPayload(
      {
        bootstrap: {
          baseSetupPackage: buildBaseSetupPackage(),
        },
      },
      {
        tenantId: "tenant-demo",
      },
    );

    expect(extracted).toEqual(
      expect.objectContaining({
        id: "bootstrap-scene-pack",
      }),
    );
    expect(resolved?.catalog.items[0]?.id).toBe("bootstrap-base-setup-skill");
  });
});
