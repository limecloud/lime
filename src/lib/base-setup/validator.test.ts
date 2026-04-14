import { describe, expect, it } from "vitest";
import type { BaseSetupPackage } from "./types";
import { validateBaseSetupPackage } from "./validator";

function createBaseSetupPackage(): BaseSetupPackage {
  return {
    id: "multimodal-starter-pack",
    version: "0.1.0",
    title: "Multimodal Starter Pack",
    summary: "把文本目标装配成短视频草稿场景。",
    bundleRefs: [
      {
        id: "short-video-skills",
        source: "remote",
        pathOrUri: "lime://bundles/short-video",
        kind: "skill_bundle",
      },
    ],
    catalogProjections: [
      {
        id: "short-video-scene",
        targetCatalog: "service_skill_catalog",
        entryKey: "short-video-draft",
        title: "文本生成短视频草稿",
        summary: "把文本目标整理成短视频草稿 project pack。",
        category: "创作",
        outputHint: "project pack + 视频草稿",
        bundleRefId: "short-video-skills",
        slotProfileRef: "short-video-input",
        bindingProfileRef: "hybrid-composition",
        artifactProfileRef: "short-video-project-pack",
        scorecardProfileRef: "short-video-scorecard",
        policyProfileRef: "default-exposure",
        compositionBlueprintRef: "short-video-composition-blueprint",
      },
    ],
    slotProfiles: [
      {
        id: "short-video-input",
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
        id: "hybrid-composition",
        bindingFamily: "agent_turn",
        runnerType: "instant",
      },
    ],
    compositionBlueprints: [
      {
        id: "short-video-composition-blueprint",
        artifactProfileRef: "short-video-project-pack",
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
            id: "generate-script",
            bindingProfileRef: "hybrid-composition",
          },
        ],
      },
    ],
    artifactProfiles: [
      {
        id: "short-video-project-pack",
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
        defaultArtifactKind: "brief",
        outputDestination: "workspace",
      },
    ],
    scorecardProfiles: [
      {
        id: "short-video-scorecard",
        metrics: ["completion_rate", "acceptance_rate"],
      },
    ],
    policyProfiles: [
      {
        id: "default-exposure",
        enabled: true,
        surfaceScopes: ["home", "mention", "workspace"],
        rolloutStage: "limited",
      },
    ],
    compatibility: {
      minAppVersion: "1.11.0",
      requiredKernelCapabilities: ["agent_turn", "artifact_viewer"],
      seededFallback: true,
      compatCatalogProjection: true,
    },
  };
}

describe("validateBaseSetupPackage", () => {
  it("通过完整包的结构、引用和宿主边界校验", () => {
    const result = validateBaseSetupPackage(createBaseSetupPackage());

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("在 projection 引用缺失时返回 L1 error", () => {
    const pkg = createBaseSetupPackage();
    pkg.catalogProjections[0].artifactProfileRef = "missing-artifact";

    const result = validateBaseSetupPackage(pkg);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "L1",
          code: "missing_projection_ref",
          path: "catalogProjections[0].artifactProfileRef",
        }),
      ]),
    );
  });

  it("在宿主边界不支持时返回 L2 error", () => {
    const pkg = createBaseSetupPackage();
    pkg.compatibility.requiredKernelCapabilities = ["managed_agents"];

    const result = validateBaseSetupPackage(pkg);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "L2",
          code: "unsupported_kernel_capability",
        }),
      ]),
    );
  });
});
