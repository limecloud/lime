import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSceneAppRunEntryNavigationTarget } from "./runEntryNavigation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSceneAppRunEntryNavigationTarget", () => {
  it("应把云端 Scene 无会话的入口恢复为生成页自动续跑请求", () => {
    const target = resolveSceneAppRunEntryNavigationTarget({
      action: {
        kind: "open_cloud_scene_session",
        label: "恢复云端 Scene",
        helperText: "继续执行最近一次云端 Scene 运行。",
        sessionId: undefined,
        cloudSceneRuntimeRef: {
          projectId: "project-1",
          contentId: "content-1",
          sceneKey: "story-video-suite",
          skillId: "story-video-suite",
          userInput: "继续补齐这轮短视频结果包。",
        },
      },
      sceneappId: "story-video-suite",
      sceneTitle: "短视频编排",
      sourceLabel: "生成主执行面",
    });

    expect(target).toEqual(
      expect.objectContaining({
        page: "agent",
        params: expect.objectContaining({
          agentEntry: "claw",
          projectId: "project-1",
          contentId: "content-1",
          autoRunInitialPromptOnMount: true,
          initialUserPrompt: "继续补齐这轮短视频结果包。",
          entryBannerMessage: "已从生成主执行面恢复云端 Scene 上下文。",
        }),
      }),
    );
  });

  it("应把本机技能无会话的入口恢复为待补参启动", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);

    const target = resolveSceneAppRunEntryNavigationTarget({
      action: {
        kind: "open_native_skill_session",
        label: "恢复本机技能",
        helperText: "继续这轮本机技能结果链。",
        sessionId: undefined,
        nativeSkillRuntimeRef: {
          projectId: "project-1",
          userInput: "继续生成导出内容。",
          slots: {
            topic: "AI 设计趋势",
          },
        },
      },
      sceneappId: "x-article-export",
      sceneTitle: "长文导出",
      sourceLabel: "创作场景复盘",
      projectId: "project-1",
      linkedServiceSkillId: "x-article-export",
      linkedSceneKey: "x-article-export",
    });

    expect(target).toEqual(
      expect.objectContaining({
        page: "agent",
        params: expect.objectContaining({
          agentEntry: "claw",
          projectId: "project-1",
          entryBannerMessage: "已从创作场景复盘恢复本机技能入口。",
          initialPendingServiceSkillLaunch: expect.objectContaining({
            skillId: "x-article-export",
            skillKey: "x-article-export",
            requestKey: 1234567890,
            launchUserInput: "继续生成导出内容。",
            initialSlotValues: {
              topic: "AI 设计趋势",
            },
          }),
        }),
      }),
    );

  });

  it("缺少 sceneappId 时应返回空", () => {
    const target = resolveSceneAppRunEntryNavigationTarget({
      action: {
        kind: "open_agent_session",
        label: "恢复会话",
        helperText: "继续查看这轮执行。",
        sessionId: "session-1",
      },
      sceneappId: "   ",
      sourceLabel: "生成主执行面",
    });

    expect(target).toBeNull();
  });
});
