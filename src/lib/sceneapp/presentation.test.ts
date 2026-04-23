import { describe, expect, it } from "vitest";
import type {
  SceneAppCompatType,
  SceneAppDescriptor,
} from "./types";
import {
  collectSceneAppInfraPresentationLabels,
  getSceneAppInfraSummary,
  getSceneAppPresentationCopy,
  getSceneAppTypeLabel,
  resolveSceneAppInfraPresentation,
  resolveSceneAppTypePresentation,
} from "./presentation";

function createCurrentDescriptor(
  overrides: Partial<SceneAppDescriptor> = {},
): SceneAppDescriptor {
  return {
    id: "local-sceneapp",
    title: "本地即时做法",
    summary: "当前目录里的即时做法。",
    category: "Current",
    sceneappType: "local_instant",
    patternPrimary: "pipeline",
    patternStack: ["pipeline"],
    capabilityRefs: ["agent_turn"],
    infraProfile: ["agent_turn", "workspace_storage"],
    deliveryContract: "artifact_bundle",
    outputHint: "结果包",
    entryBindings: [
      {
        kind: "service_skill",
        bindingFamily: "agent_turn",
      },
    ],
    launchRequirements: [],
    sourcePackageId: "local-sceneapp",
    sourcePackageVersion: "2026-04-21",
    ...overrides,
  };
}

describe("sceneapp presentation", () => {
  it("compat helper 应继续把 cloud_managed 显示为目录同步", () => {
    const compatType: SceneAppCompatType = "cloud_managed";

    expect(resolveSceneAppTypePresentation(compatType)).toEqual({
      label: "目录同步",
      legacyCompat: true,
    });
    expect(getSceneAppTypeLabel(compatType)).toBe("目录同步");
  });

  it("compat infra helper 应继续把 cloud_runtime 显示为目录同步", () => {
    expect(resolveSceneAppInfraPresentation("cloud_runtime")).toEqual({
      label: "目录同步",
      legacyCompat: true,
    });
    expect(
      collectSceneAppInfraPresentationLabels([
        "cloud_runtime",
        "agent_turn",
        "cloud_runtime",
      ]),
    ).toEqual(["目录同步", "Agent 工作区"]);
  });

  it("current descriptor copy 应只沿 current 本地执行语义生成", () => {
    const descriptor = createCurrentDescriptor();
    const copy = getSceneAppPresentationCopy(descriptor);

    expect(resolveSceneAppTypePresentation(descriptor.sceneappType)).toEqual({
      label: "本地即时",
      legacyCompat: false,
    });
    expect(getSceneAppTypeLabel(descriptor.sceneappType)).toBe("本地即时");
    expect(copy).toEqual(
      expect.objectContaining({
        businessLabel: "即时工作流",
        executionLabel: "当前会话继续",
        executionTone: "slate",
      }),
    );
    expect(getSceneAppInfraSummary(descriptor)).toBe(
      "Agent 工作区 · 项目沉淀",
    );
  });
});
