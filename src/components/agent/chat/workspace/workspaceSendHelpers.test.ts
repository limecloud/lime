import { describe, expect, it, vi } from "vitest";
import {
  buildGeneralWorkbenchSendBoundaryState,
  buildGeneralWorkbenchResumePromptFromRunState,
  buildInitialDispatchKey,
  buildInitialDispatchPreviewMessages,
  buildRuntimeTeamDispatchPreviewMessages,
  buildSubmissionPreviewMessages,
  createSubmissionPreviewSnapshot,
  resolveRuntimeTeamDispatchPreviewState,
} from "./workspaceSendHelpers";

describe("workspaceSendHelpers runtime team preview", () => {
  it("initialDispatchKey 应稳定编码首轮 prompt 与图片签名", () => {
    expect(
      buildInitialDispatchKey("写一篇文章", [
        { data: "abcdef1234567890", mediaType: "image/png" },
      ]),
    ).toContain("写一篇文章");
  });

  it("bootstrap 预览消息应使用统一 initial-dispatch 结构", () => {
    const messages = buildInitialDispatchPreviewMessages({
      key: "initial-dispatch-1",
      prompt: "请开始处理这个任务",
      images: [],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "initial-dispatch:initial-dispatch-1:user",
      role: "user",
      content: "请开始处理这个任务",
    });
    expect(messages[1]).toMatchObject({
      id: "initial-dispatch:initial-dispatch-1:assistant",
      role: "assistant",
      content: "正在开始处理任务…",
      isThinking: true,
    });
  });

  it("工作区首条创作意图应包装成 current send boundary", () => {
    const boundary = buildGeneralWorkbenchSendBoundaryState({
      isThemeWorkbench: true,
      contentId: "content-1",
      initialDispatchKey: "dispatch-1",
      consumedInitialPromptKey: null,
      initialUserImages: [],
      mappedTheme: "general",
      socialArticleSkillKey: "content_post_with_cover",
      sourceText: "请生成今天的社媒主稿",
    });

    expect(boundary).toMatchObject({
      sourceText: "/content_post_with_cover 请生成今天的社媒主稿",
      shouldConsumePendingGeneralWorkbenchInitialPrompt: true,
      shouldDismissGeneralWorkbenchEntryPrompt: true,
      browserRequirementMatch: null,
    });
  });

  it("浏览器任务应在 current send boundary 中保留 requirement 检测", () => {
    const boundary = buildGeneralWorkbenchSendBoundaryState({
      isThemeWorkbench: true,
      contentId: "content-1",
      initialDispatchKey: "dispatch-1",
      consumedInitialPromptKey: null,
      initialUserImages: [],
      mappedTheme: "general",
      socialArticleSkillKey: "content_post_with_cover",
      sourceText: "帮我把这篇文章发布到微信公众号后台",
    });

    expect(boundary.sourceText).toBe(
      "/content_post_with_cover 帮我把这篇文章发布到微信公众号后台",
    );
    expect(boundary.browserRequirementMatch).toEqual(
      expect.objectContaining({
        requirement: "required_with_user_step",
        launchUrl: "https://mp.weixin.qq.com/",
        platformLabel: "微信公众号后台",
      }),
    );
  });

  it("run-state 应生成 resume prompt", () => {
    const prompt = buildGeneralWorkbenchResumePromptFromRunState({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-1",
          title: "撰写主稿",
          gate_key: "write_mode",
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: new Date().toISOString(),
        },
      ],
      latest_terminal: null,
      recent_terminals: [],
      updated_at: new Date().toISOString(),
    });

    expect(prompt).toMatchObject({
      kind: "resume",
      title: "发现上次未完成任务",
      actionLabel: "继续上次生成",
      description: expect.stringContaining("撰写主稿"),
    });
  });

  it("应在失败预览中覆盖 formationState 的错误信息", () => {
    const state = resolveRuntimeTeamDispatchPreviewState({
      key: "runtime-team-failed",
      prompt: "请继续处理",
      images: [],
      baseMessageCount: 0,
      status: "failed",
      failureMessage: "Provider 认证失败",
      formationState: {
        requestId: "runtime-1",
        status: "forming",
        label: "修复 Team",
        summary: "分析、执行、验证三段式推进。",
        members: [],
        blueprint: null,
        updatedAt: Date.now(),
      },
    });

    expect(state).toMatchObject({
      status: "failed",
      errorMessage: "Provider 认证失败",
    });
  });

  it("formed 预览消息应使用任务叙事", () => {
    const messages = buildRuntimeTeamDispatchPreviewMessages({
      key: "runtime-team-formed",
      prompt: "请拆成分析、执行、验证三个并行步骤继续推进",
      images: [],
      baseMessageCount: 0,
      status: "formed",
      formationState: {
        requestId: "runtime-formed-1",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证三段式推进。",
        members: [
          {
            id: "task-1",
            label: "分析",
            summary: "收敛问题边界。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "planned",
          },
          {
            id: "task-2",
            label: "执行",
            summary: "完成修复并汇报结果。",
            roleKey: "executor",
            profileId: "code-executor",
            skillIds: ["bounded-implementation"],
            status: "planned",
          },
        ],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        updatedAt: Date.now(),
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain("分工如下");
    expect(messages[1]?.content).toContain("这些任务会分别展开处理");
    expect(messages[1]?.runtimeStatus).toMatchObject({
      title: "任务分工已准备好",
      detail: "分析、执行、验证三段式推进。",
      checkpoints: [
        "当前方案：修复任务方案",
        "已安排 2 项任务",
        "主对话会持续同步关键进展",
      ],
    });
  });

  it("forming 预览消息应提示等待任务接手", () => {
    const messages = buildRuntimeTeamDispatchPreviewMessages({
      key: "runtime-team-forming",
      prompt: "请先拆任务再继续",
      images: [],
      baseMessageCount: 0,
      status: "forming",
      formationState: {
        requestId: "runtime-forming-1",
        status: "forming",
        label: "排障 Team",
        summary: "分析、执行两段式推进。",
        members: [],
        blueprint: null,
        updatedAt: Date.now(),
      },
    });

    expect(messages[1]?.isThinking).toBe(true);
    expect(messages[1]?.runtimeStatus).toMatchObject({
      title: "正在准备任务分工",
      detail:
        "系统正在根据当前任务安排分工，会先拆出合适的任务，再把关键进展持续汇总回主对话。",
      checkpoints: ["确认当前任务目标", "安排任务分工", "等待任务接手处理"],
    });
  });

  it("提交预览应生成等待态快照并映射成双消息预览", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_710_000_000_000);

    const snapshot = createSubmissionPreviewSnapshot({
      key: "submission-preview-1",
      prompt: "继续处理当前任务",
      images: [],
      executionStrategy: "react",
      webSearch: true,
      thinking: false,
    });

    expect(snapshot).toMatchObject({
      key: "submission-preview-1",
      prompt: "继续处理当前任务",
      createdAt: 1_710_000_000_000,
    });
    expect(snapshot.runtimeStatus).not.toBeNull();

    const messages = buildSubmissionPreviewMessages(snapshot);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "submission-preview:submission-preview-1:user",
      role: "user",
      content: "继续处理当前任务",
    });
    expect(messages[1]).toMatchObject({
      id: "submission-preview:submission-preview-1:assistant",
      role: "assistant",
      isThinking: true,
      runtimeStatus: snapshot.runtimeStatus,
    });

    vi.restoreAllMocks();
  });
});
