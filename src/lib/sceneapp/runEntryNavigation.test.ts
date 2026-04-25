import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSceneAppRunEntryNavigationTarget } from "./runEntryNavigation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSceneAppRunEntryNavigationTarget", () => {
  it("应把生成上下文无会话的入口恢复为生成页自动续跑请求", () => {
    const target = resolveSceneAppRunEntryNavigationTarget({
      action: {
        kind: "open_service_scene_session",
        label: "恢复生成上下文",
        helperText: "继续执行最近一次场景运行。",
        sessionId: undefined,
        serviceSceneRuntimeRef: {
          projectId: "project-1",
          contentId: "content-1",
          sceneKey: "story-video-suite",
          skillId: "story-video-suite",
          userInput: "继续补齐这轮短视频结果包。",
        },
      },
      sceneappId: "story-video-suite",
      sceneTitle: "短视频编排",
      sourceLabel: "生成",
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
          entryBannerMessage: "已从生成恢复生成上下文。",
          initialAutoSendRequestMetadata: expect.objectContaining({
            harness: expect.objectContaining({
              service_scene_launch: expect.objectContaining({
                kind: "local_service_skill",
              }),
            }),
          }),
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
      sourceLabel: "做法复盘",
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
          entryBannerMessage: "已从做法复盘恢复本机技能入口。",
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
      sourceLabel: "生成",
    });

    expect(target).toBeNull();
  });
});
