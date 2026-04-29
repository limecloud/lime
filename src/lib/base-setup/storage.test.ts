import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASE_SETUP_PACKAGE_STORAGE_KEY,
  clearStoredBaseSetupPackageSnapshot,
  createStoredBaseSetupPackageSnapshot,
  readStoredBaseSetupPackageSnapshot,
  saveStoredBaseSetupPackageSnapshot,
} from "./storage";
import type { BaseSetupPackage, BaseSetupProjectionIndex } from "./types";

function buildBaseSetupPackage(): BaseSetupPackage {
  return {
    id: "storage-scene-pack",
    version: "tenant-2026-04-15",
    title: "Storage Scene Pack",
    summary: "用于测试基础设置快照存储",
    bundleRefs: [
      {
        id: "storage-bundle",
        source: "remote",
        pathOrUri: "lime://bundles/storage",
        kind: "skill_bundle",
      },
    ],
    catalogProjections: [
      {
        id: "storage-projection",
        targetCatalog: "service_skill_catalog",
        entryKey: "storage-projection",
        title: "Storage Projection",
        summary: "用于测试 projection index",
        category: "Storage",
        outputHint: "结果包",
        bundleRefId: "storage-bundle",
        slotProfileRef: "storage-slot-profile",
        bindingProfileRef: "storage-binding-profile",
        artifactProfileRef: "storage-artifact-profile",
        scorecardProfileRef: "storage-scorecard-profile",
        policyProfileRef: "storage-policy-profile",
      },
    ],
    slotProfiles: [
      {
        id: "storage-slot-profile",
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
        id: "storage-binding-profile",
        bindingFamily: "agent_turn",
      },
    ],
    artifactProfiles: [
      {
        id: "storage-artifact-profile",
        deliveryContract: "artifact_bundle",
        requiredParts: ["index.md"],
        viewerKind: "artifact_bundle",
      },
    ],
    scorecardProfiles: [
      {
        id: "storage-scorecard-profile",
        metrics: ["success_rate"],
      },
    ],
    policyProfiles: [
      {
        id: "storage-policy-profile",
      },
    ],
    compatibility: {
      minAppVersion: "1.11.0",
      requiredKernelCapabilities: ["agent_turn"],
    },
  };
}

function buildProjectionIndex(): BaseSetupProjectionIndex {
  return {
    artifactProfileRefsByProjectionId: {
      "storage-projection": "storage-artifact-profile",
    },
    scorecardProfileRefsByProjectionId: {
      "storage-projection": "storage-scorecard-profile",
    },
    policyProfileRefsByProjectionId: {
      "storage-projection": "storage-policy-profile",
    },
    automationProfileRefsByProjectionId: {},
    compositionBlueprintRefsByProjectionId: {},
  };
}

describe("base-setup storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("应支持保存并读取基础设置快照", () => {
    const snapshot = createStoredBaseSetupPackageSnapshot({
      package: buildBaseSetupPackage(),
      projectionIndex: buildProjectionIndex(),
      tenantId: "tenant-demo",
      syncedAt: "2026-04-15T12:00:00.000Z",
    });

    saveStoredBaseSetupPackageSnapshot(snapshot);

    const stored = readStoredBaseSetupPackageSnapshot();
    expect(stored).toEqual(snapshot);

    stored!.package.title = "Changed";
    expect(readStoredBaseSetupPackageSnapshot()?.package.title).toBe(
      "Storage Scene Pack",
    );
  });

  it("非法缓存不应被读取，且支持清空", () => {
    window.localStorage.setItem(
      BASE_SETUP_PACKAGE_STORAGE_KEY,
      JSON.stringify({ invalid: true }),
    );

    expect(readStoredBaseSetupPackageSnapshot()).toBeNull();

    clearStoredBaseSetupPackageSnapshot();

    expect(
      window.localStorage.getItem(BASE_SETUP_PACKAGE_STORAGE_KEY),
    ).toBeNull();
  });
});
