import { describe, expect, it } from "vitest";
import type { SceneAppDescriptor } from "./types";
import {
  getSceneAppInfraSummary,
  getSceneAppPresentationCopy,
  getSceneAppTypeLabel,
} from "./presentation";

function createDescriptor(
  overrides: Partial<SceneAppDescriptor> = {},
): SceneAppDescriptor {
  return {
    id: "legacy-cloud-sceneapp",
    title: "旧版目录场景",
    summary: "历史目录里的兼容场景。",
    category: "Legacy",
    sceneappType: "cloud_managed",
    patternPrimary: "pipeline",
    patternStack: ["pipeline"],
    capabilityRefs: ["agent_turn"],
    infraProfile: ["cloud_runtime", "agent_turn", "workspace_storage"],
    deliveryContract: "artifact_bundle",
    outputHint: "结果包",
    entryBindings: [
      {
        kind: "service_skill",
        bindingFamily: "agent_turn",
      },
    ],
    launchRequirements: [],
    sourcePackageId: "legacy-cloud-sceneapp",
    sourcePackageVersion: "2026-04-21",
    ...overrides,
  };
}

describe("sceneapp presentation", () => {
  it("compat cloud_managed 的类型和文案也应按目录同步口径展示", () => {
    const descriptor = createDescriptor();
    const copy = getSceneAppPresentationCopy(descriptor);

    expect(getSceneAppTypeLabel("cloud_managed")).toBe("目录同步");
    expect(copy).toEqual(
      expect.objectContaining({
        businessLabel: "目录同步",
        executionLabel: "客户端执行",
      }),
    );
    expect(copy.valueStatement).toContain("同步");
    expect(copy.valueStatement).toContain("客户端");
  });

  it("基础设施摘要应统一显示 current 执行面标签", () => {
    const descriptor = createDescriptor();

    expect(getSceneAppInfraSummary(descriptor)).toBe(
      "目录同步 · Agent 工作区 · 项目沉淀",
    );
  });
});
