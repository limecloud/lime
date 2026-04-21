import { describe, expect, it } from "vitest";
import {
  createStoredBaseSetupPackageSnapshot,
  type StoredBaseSetupPackageSnapshot,
} from "@/lib/base-setup/storage";
import type { BaseSetupPackage } from "@/lib/base-setup/types";
import {
  compileSceneAppCatalogFromPackage,
  compileSceneAppCatalogFromSnapshot,
} from "./catalog";

function buildSceneAppPackage(): BaseSetupPackage {
  return {
    id: "lime-core-sceneapps",
    version: "2026-04-15",
    title: "Lime Core SceneApps",
    summary: "SceneApp 目录装配包",
    bundleRefs: [
      {
        id: "story-video-bundle",
        source: "builtin",
        pathOrUri: "lime://bundles/story-video",
        kind: "skill_bundle",
      },
    ],
    catalogProjections: [
      {
        id: "story-video-service",
        targetCatalog: "service_skill_catalog",
        entryKey: "story-video-suite",
        title: "短视频编排",
        summary: "把文本、线框图、配乐、剧本和短视频串起来。",
        category: "Scene Apps",
        outputHint: "短视频项目包",
        bundleRefId: "story-video-bundle",
        slotProfileRef: "story-video-slots",
        bindingProfileRef: "story-video-cloud-binding",
        artifactProfileRef: "story-video-artifacts",
        scorecardProfileRef: "story-video-scorecard",
        policyProfileRef: "story-video-policy",
        compositionBlueprintRef: "story-video-blueprint",
        skillKey: "story-video-suite",
        aliases: ["story-video"],
        sceneBinding: {
          sceneKey: "story-video-suite",
          commandPrefix: "/story-video-suite",
          aliases: ["mv-pipeline"],
        },
        readinessRequirements: {
          requiresProject: true,
        },
      },
      {
        id: "story-video-scene",
        targetCatalog: "scene_catalog",
        entryKey: "story-video-suite",
        title: "短视频编排",
        summary: "将文本、草图、配乐和视频草稿收口成一个混合型 SceneApp。",
        category: "Scene Apps",
        outputHint: "短视频项目包",
        bundleRefId: "story-video-bundle",
        slotProfileRef: "story-video-slots",
        bindingProfileRef: "story-video-cloud-binding",
        artifactProfileRef: "story-video-artifacts",
        scorecardProfileRef: "story-video-scorecard",
        policyProfileRef: "story-video-policy",
        compositionBlueprintRef: "story-video-blueprint",
        skillKey: "story-video-suite",
        aliases: ["short-video-suite"],
        sceneBinding: {
          sceneKey: "story-video-suite",
          commandPrefix: "/story-video-suite",
          aliases: ["story-video-scene"],
        },
        readinessRequirements: {
          requiresProject: true,
        },
      },
    ],
    slotProfiles: [
      {
        id: "story-video-slots",
        slots: [
          {
            key: "topic",
            label: "主题",
            type: "text",
            required: true,
            placeholder: "输入要处理的主题",
          },
        ],
      },
    ],
    bindingProfiles: [
      {
        id: "story-video-cloud-binding",
        bindingFamily: "cloud_scene",
        executionLocation: "cloud_required",
        capabilityRefs: ["timeline", "workspace_storage"],
      },
      {
        id: "story-video-native-binding",
        bindingFamily: "native_skill",
        capabilityRefs: ["artifact_viewer"],
      },
    ],
    compositionBlueprints: [
      {
        id: "story-video-blueprint",
        artifactProfileRef: "story-video-artifacts",
        deliveryContract: {
          requiredParts: [
            "brief",
            "storyboard",
            "script",
            "music_refs",
            "video_draft",
            "review_note",
          ],
        },
        steps: [
          {
            id: "brief",
            bindingProfileRef: "story-video-native-binding",
          },
          {
            id: "storyboard",
            bindingProfileRef: "story-video-native-binding",
          },
          {
            id: "script",
            bindingProfileRef: "story-video-native-binding",
          },
          {
            id: "music_refs",
            bindingProfileRef: "story-video-cloud-binding",
          },
          {
            id: "video_draft",
            bindingProfileRef: "story-video-cloud-binding",
          },
          {
            id: "review_note",
            bindingProfileRef: "story-video-native-binding",
          },
        ],
      },
    ],
    artifactProfiles: [
      {
        id: "story-video-artifacts",
        deliveryContract: "project_pack",
        requiredParts: [
          "brief",
          "storyboard",
          "script",
          "music_refs",
          "video_draft",
          "review_note",
        ],
        viewerKind: "artifact_bundle",
        outputDestination: "workspace",
      },
    ],
    scorecardProfiles: [
      {
        id: "story-video-scorecard",
        metrics: [
          "complete_pack_rate",
          "review_pass_rate",
          "publish_conversion_rate",
        ],
        failureSignals: ["pack_incomplete", "review_blocked", "publish_stalled"],
      },
    ],
    policyProfiles: [
      {
        id: "story-video-policy",
        enabled: true,
        rolloutStage: "limited",
        surfaceScopes: ["mention", "workspace"],
      },
    ],
    compatibility: {
      minAppVersion: "1.11.0",
      requiredKernelCapabilities: ["cloud_scene", "native_skill"],
      seededFallback: true,
    },
  };
}

function buildSnapshot(): StoredBaseSetupPackageSnapshot {
  const pkg = buildSceneAppPackage();
  return createStoredBaseSetupPackageSnapshot({
    package: pkg,
    projectionIndex: {
      artifactProfileRefsByProjectionId: {
        "story-video-service": "story-video-artifacts",
        "story-video-scene": "story-video-artifacts",
      },
      scorecardProfileRefsByProjectionId: {
        "story-video-service": "story-video-scorecard",
        "story-video-scene": "story-video-scorecard",
      },
      policyProfileRefsByProjectionId: {
        "story-video-service": "story-video-policy",
        "story-video-scene": "story-video-policy",
      },
      automationProfileRefsByProjectionId: {},
      compositionBlueprintRefsByProjectionId: {
        "story-video-service": "story-video-blueprint",
        "story-video-scene": "story-video-blueprint",
      },
    },
    tenantId: "tenant-demo",
    syncedAt: "2026-04-15T00:00:00.000Z",
  });
}

function buildLegacyCompatCloudOnlySceneAppPackage(): BaseSetupPackage {
  return {
    id: "legacy-cloud-sceneapp",
    version: "2026-04-21",
    title: "Legacy Cloud SceneApp",
    summary: "历史目录仍使用 cloud_scene / cloud_required。",
    bundleRefs: [
      {
        id: "legacy-cloud-bundle",
        source: "remote",
        pathOrUri: "lime://bundles/legacy-cloud",
        kind: "skill_bundle",
      },
    ],
    catalogProjections: [
      {
        id: "legacy-cloud-service",
        targetCatalog: "service_skill_catalog",
        entryKey: "legacy-cloud-service",
        title: "旧版云场景",
        summary: "历史目录中的云场景兼容投影。",
        category: "Legacy",
        outputHint: "结果包",
        bundleRefId: "legacy-cloud-bundle",
        slotProfileRef: "legacy-cloud-slots",
        bindingProfileRef: "legacy-cloud-binding",
        artifactProfileRef: "legacy-cloud-artifacts",
        scorecardProfileRef: "legacy-cloud-scorecard",
        policyProfileRef: "legacy-cloud-policy",
        skillKey: "legacy-cloud-service",
        sceneBinding: {
          sceneKey: "legacy-cloud-service",
          commandPrefix: "/legacy-cloud-service",
        },
      },
    ],
    slotProfiles: [
      {
        id: "legacy-cloud-slots",
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
    bindingProfiles: [
      {
        id: "legacy-cloud-binding",
        bindingFamily: "cloud_scene",
        executionLocation: "cloud_required",
        capabilityRefs: ["cloud_scene", "timeline"],
      },
    ],
    artifactProfiles: [
      {
        id: "legacy-cloud-artifacts",
        deliveryContract: "artifact_bundle",
        requiredParts: ["index.md"],
        viewerKind: "artifact_bundle",
        outputDestination: "workspace",
      },
    ],
    scorecardProfiles: [
      {
        id: "legacy-cloud-scorecard",
        metrics: ["success_rate"],
      },
    ],
    policyProfiles: [
      {
        id: "legacy-cloud-policy",
        enabled: true,
        rolloutStage: "limited",
      },
    ],
    compatibility: {
      minAppVersion: "1.11.0",
      requiredKernelCapabilities: ["cloud_scene"],
      seededFallback: true,
    },
  };
}

describe("sceneapp catalog", () => {
  it("应把基础设置包投影为 SceneApp 统一读模型", () => {
    const catalog = compileSceneAppCatalogFromPackage(buildSceneAppPackage(), {
      generatedAt: "2026-04-15T00:00:00.000Z",
    });

    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toEqual(
      expect.objectContaining({
        id: "story-video-suite",
        sceneappType: "hybrid",
        patternPrimary: "pipeline",
        patternStack: expect.arrayContaining([
          "pipeline",
          "inversion",
          "generator",
        ]),
        infraProfile: expect.arrayContaining([
          "composition_blueprint",
          "project_pack",
          "agent_turn",
          "workspace_storage",
        ]),
        linkedServiceSkillId: "story-video-service",
        linkedSceneKey: "story-video-suite",
        aliases: expect.arrayContaining([
          "story-video",
          "short-video-suite",
          "story-video-scene",
        ]),
      }),
    );
    expect(catalog.items[0]?.entryBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "service_skill",
          bindingFamily: "agent_turn",
        }),
        expect.objectContaining({
          kind: "scene",
          sceneKey: "story-video-suite",
          commandPrefix: "/story-video-suite",
        }),
      ]),
    );
    expect(catalog.items[0]?.launchRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_input" }),
        expect.objectContaining({ kind: "project" }),
      ]),
    );
    expect(catalog.items[0]?.launchRequirements).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "cloud_session" })]),
    );
    expect(catalog.items[0]?.capabilityRefs).not.toContain("cloud_scene");
    expect(catalog.items[0]?.infraProfile).not.toContain("cloud_runtime");
    expect(catalog.items[0]?.compositionProfile?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "music_refs",
          bindingFamily: "agent_turn",
        }),
        expect.objectContaining({
          id: "video_draft",
          bindingFamily: "agent_turn",
        }),
      ]),
    );
    expect(catalog.items[0]).toEqual(
      expect.objectContaining({
        deliveryContract: "project_pack",
        deliveryProfile: expect.objectContaining({
          artifactProfileRef: "story-video-artifacts",
          viewerKind: "artifact_bundle",
          primaryPart: "brief",
          requiredParts: [
            "brief",
            "storyboard",
            "script",
            "music_refs",
            "video_draft",
            "review_note",
          ],
        }),
        compositionProfile: expect.objectContaining({
          blueprintRef: "story-video-blueprint",
          stepCount: 6,
        }),
        scorecardProfile: {
          profileRef: "story-video-scorecard",
          metricKeys: [
            "complete_pack_rate",
            "review_pass_rate",
            "publish_conversion_rate",
          ],
          failureSignals: [
            "pack_incomplete",
            "review_blocked",
            "publish_stalled",
          ],
        },
      }),
    );
  });

  it("应把纯 compat cloud_scene SceneApp 正规化成当前本地目录语义", () => {
    const catalog = compileSceneAppCatalogFromPackage(
      buildLegacyCompatCloudOnlySceneAppPackage(),
      {
        generatedAt: "2026-04-21T00:00:00.000Z",
      },
    );

    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toEqual(
      expect.objectContaining({
        id: "legacy-cloud-service",
        sceneappType: "local_instant",
        capabilityRefs: ["agent_turn", "timeline"],
        infraProfile: expect.arrayContaining([
          "agent_turn",
          "artifact_bundle",
          "workspace_storage",
        ]),
        entryBindings: expect.arrayContaining([
          expect.objectContaining({
            kind: "service_skill",
            bindingFamily: "agent_turn",
          }),
          expect.objectContaining({
            kind: "scene",
            bindingFamily: "agent_turn",
          }),
        ]),
        launchRequirements: expect.arrayContaining([
          expect.objectContaining({ kind: "user_input" }),
        ]),
      }),
    );
    expect(catalog.items[0]?.infraProfile).not.toContain("cloud_runtime");
    expect(catalog.items[0]?.launchRequirements).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "cloud_session" })]),
    );
  });

  it("应支持从基础设置快照恢复 SceneApp 目录", () => {
    const catalog = compileSceneAppCatalogFromSnapshot(buildSnapshot());

    expect(catalog.version).toBe("2026-04-15");
    expect(catalog.generatedAt).toBe("2026-04-15T00:00:00.000Z");
    expect(catalog.items[0]?.sourcePackageId).toBe("lime-core-sceneapps");
    expect(catalog.items[0]?.sourcePackageVersion).toBe("2026-04-15");
  });
});
