import { describe, expect, it } from "vitest";

import { resolveWebsiteOpenNavigation } from "./websiteLaunch";

describe("resolveWebsiteOpenNavigation", () => {
  it("应把官网 skill slug 解析成可直接进入 Agent 的服务技能启动参数", () => {
    const result = resolveWebsiteOpenNavigation({
      kind: "skill",
      slug: "short-video-script-replication",
      source: "website",
      version: "1",
    });

    expect(result).toMatchObject({
      page: "agent",
      params: {
        agentEntry: "new-task",
        initialPendingServiceSkillLaunch: {
          skillId: "short-video-script-replication",
          requestKey: expect.any(Number),
        },
        initialSessionName: "复制视频脚本",
      },
    });
  });

  it("应把官网 prompt slug 解析成带初始 prompt 的 Agent 入口", () => {
    const result = resolveWebsiteOpenNavigation({
      kind: "prompt",
      slug: "gemini-longform-master",
      source: "website",
      version: "1",
    });

    expect(result).toMatchObject({
      page: "agent",
      params: {
        agentEntry: "new-task",
        initialSessionName: "Gemini 3 长文主稿提示词",
        initialUserPrompt: expect.stringContaining("长文起稿"),
      },
    });
  });

  it("遇到未知 slug 时应返回 null", () => {
    expect(
      resolveWebsiteOpenNavigation({
        kind: "skill",
        slug: "unknown-skill",
        source: "website",
        version: "1",
      }),
    ).toBeNull();
  });
});
