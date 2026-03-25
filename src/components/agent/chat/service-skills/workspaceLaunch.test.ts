import { describe, expect, it } from "vitest";
import { buildServiceSkillWorkspaceSeed } from "./workspaceLaunch";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";

function createSkill(
  overrides: Partial<ServiceSkillItem> = {},
): ServiceSkillItem {
  return {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary: "围绕指定平台输出趋势摘要。",
    category: "社媒运营",
    outputHint: "趋势摘要",
    source: "cloud_catalog",
    runnerType: "scheduled",
    defaultExecutorBinding: "automation_job",
    executionLocation: "client_default",
    themeTarget: "social-media",
    version: "seed-v1",
    slotSchema: [],
    ...overrides,
  };
}

describe("service skill workspace launch", () => {
  it("内容创作类服务型技能应生成内容种子与 artifact metadata", () => {
    const seed = buildServiceSkillWorkspaceSeed(
      createSkill({
        defaultArtifactKind: "analysis",
      }),
    );

    expect(seed).toEqual({
      title: "每日趋势摘要",
      contentType: "post",
      requestMetadata: {
        artifact: {
          artifact_mode: "draft",
          artifact_kind: "analysis",
          workbench_surface: "right_panel",
        },
      },
      metadata: {
        source: "service_skill",
        serviceSkill: {
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          runnerType: "scheduled",
          executionLocation: "client_default",
          themeTarget: "social-media",
          artifactKind: "analysis",
        },
      },
    });
  });

  it("非内容创作主题不应强制生成内容种子", () => {
    expect(
      buildServiceSkillWorkspaceSeed(
        createSkill({
          themeTarget: "general",
          defaultArtifactKind: "brief",
        }),
      ),
    ).toBeNull();
  });
});
