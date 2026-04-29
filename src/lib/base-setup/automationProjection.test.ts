import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import { createStoredBaseSetupPackageSnapshot } from "./storage";
import {
  resolveBaseSetupAutomationProjectionForSkill,
  resolveBaseSetupProjectionRefsForSkill,
} from "./automationProjection";
import type { BaseSetupPackage, BaseSetupProjectionIndex } from "./types";

function createSkill(
  overrides: Partial<ServiceSkillItem> = {},
): ServiceSkillItem {
  return {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary: "围绕指定平台与关键词输出趋势摘要。",
    category: "内容运营",
    outputHint: "趋势摘要 + 调度建议",
    source: "cloud_catalog",
    runnerType: "scheduled",
    defaultExecutorBinding: "automation_job",
    executionLocation: "client_default",
    version: "seed-v1",
    slotSchema: [],
    skillBundle: {
      name: "daily-trend-briefing",
      description: "seeded skill",
      resourceSummary: {
        hasScripts: false,
        hasReferences: false,
        hasAssets: false,
      },
      standardCompliance: {
        isStandard: true,
      },
      metadata: {
        Lime_base_setup_package_id: "skill-metadata-pack",
        Lime_base_setup_package_version: "0.3.0",
        Lime_projection_id: "daily-trend-briefing",
        Lime_automation_profile_ref: "trend-automation",
      },
    },
    ...overrides,
  };
}

function createPackage(): BaseSetupPackage {
  return {
    id: "base-setup-pack",
    version: "0.4.0",
    title: "Base Setup Pack",
    summary: "用于测试 automation projection",
    bundleRefs: [
      {
        id: "bundle-1",
        source: "remote",
        pathOrUri: "lime://bundle-1",
        kind: "skill_bundle",
      },
    ],
    catalogProjections: [
      {
        id: "daily-trend-briefing",
        targetCatalog: "service_skill_catalog",
        entryKey: "daily-trend-briefing",
        title: "每日趋势摘要",
        summary: "趋势摘要",
        category: "内容运营",
        outputHint: "摘要",
        bundleRefId: "bundle-1",
        slotProfileRef: "slot-1",
        bindingProfileRef: "binding-1",
        artifactProfileRef: "artifact-1",
        scorecardProfileRef: "scorecard-1",
        policyProfileRef: "policy-1",
        automationProfileRef: "trend-automation",
      },
    ],
    slotProfiles: [
      {
        id: "slot-1",
        slots: [],
      },
    ],
    bindingProfiles: [
      {
        id: "binding-1",
        bindingFamily: "automation_job",
        runnerType: "scheduled",
        executionLocation: "client_default",
      },
    ],
    artifactProfiles: [
      {
        id: "artifact-1",
        deliveryContract: "artifact_bundle",
        requiredParts: ["index.md"],
        viewerKind: "artifact_bundle",
      },
    ],
    scorecardProfiles: [
      {
        id: "scorecard-1",
        metrics: ["success_rate"],
      },
    ],
    automationProfiles: [
      {
        id: "trend-automation",
        enabledByDefault: true,
        schedule: {
          kind: "cron",
          cronExpr: "0 9 * * *",
          cronTz: "Asia/Shanghai",
          slotKey: "schedule_time",
        },
        maxRetries: 2,
      },
    ],
    policyProfiles: [
      {
        id: "policy-1",
      },
    ],
    compatibility: {
      minAppVersion: "1.11.0",
      requiredKernelCapabilities: ["automation_job"],
    },
  };
}

function createProjectionIndex(): BaseSetupProjectionIndex {
  return {
    artifactProfileRefsByProjectionId: {
      "daily-trend-briefing": "artifact-1",
    },
    scorecardProfileRefsByProjectionId: {
      "daily-trend-briefing": "scorecard-1",
    },
    policyProfileRefsByProjectionId: {
      "daily-trend-briefing": "policy-1",
    },
    automationProfileRefsByProjectionId: {
      "daily-trend-briefing": "trend-automation",
    },
    compositionBlueprintRefsByProjectionId: {},
  };
}

describe("automationProjection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("应优先从基础设置快照解析 automation profile", () => {
    const snapshot = createStoredBaseSetupPackageSnapshot({
      package: createPackage(),
      projectionIndex: createProjectionIndex(),
      tenantId: "tenant-demo",
      syncedAt: "2026-04-15T12:00:00.000Z",
    });
    window.localStorage.setItem(
      "lime:base-setup-package:v1",
      JSON.stringify(snapshot),
    );

    const resolved =
      resolveBaseSetupAutomationProjectionForSkill(createSkill());

    expect(resolved.refs).toEqual(
      expect.objectContaining({
        packageId: "base-setup-pack",
        packageVersion: "0.4.0",
        projectionId: "daily-trend-briefing",
        automationProfileRef: "trend-automation",
      }),
    );
    expect(resolved.profile).toEqual(
      expect.objectContaining({
        id: "trend-automation",
        schedule: expect.objectContaining({
          kind: "cron",
          cronExpr: "0 9 * * *",
          slotKey: "schedule_time",
        }),
      }),
    );
  });

  it("在没有快照时仍应从 skill bundle metadata 读取 refs", () => {
    const refs = resolveBaseSetupProjectionRefsForSkill(createSkill(), null);
    const resolved = resolveBaseSetupAutomationProjectionForSkill(
      createSkill(),
      null,
    );

    expect(refs).toEqual(
      expect.objectContaining({
        packageId: "skill-metadata-pack",
        packageVersion: "0.3.0",
        projectionId: "daily-trend-briefing",
        automationProfileRef: "trend-automation",
      }),
    );
    expect(resolved.profile).toBeNull();
  });
});
