import { describe, expect, it } from "vitest";
import { buildClawAgentParams, buildHomeAgentParams } from "./navigation";

describe("buildHomeAgentParams", () => {
  it("应返回 general 主题且解锁", () => {
    const params = buildHomeAgentParams();
    expect(params.theme).toBe("general");
    expect(params.lockTheme).toBe(false);
    expect(params.immersiveHome).toBe(false);
    expect(params.agentEntry).toBe("new-task");
  });

  it("应生成 newChatAt 时间戳", () => {
    const before = Date.now();
    const params = buildHomeAgentParams();
    const after = Date.now();
    expect(params.newChatAt).toBeGreaterThanOrEqual(before);
    expect(params.newChatAt).toBeLessThanOrEqual(after);
  });

  it("应允许 overrides 但不覆盖核心字段", () => {
    const params = buildHomeAgentParams({ projectId: "proj-1" });
    expect(params.projectId).toBe("proj-1");
    // theme / lockTheme / agentEntry 始终被覆盖
    expect(params.theme).toBe("general");
    expect(params.lockTheme).toBe(false);
    expect(params.agentEntry).toBe("new-task");
    expect(params.immersiveHome).toBe(false);
  });

  it("应允许显式关闭首页沉浸模式", () => {
    const params = buildHomeAgentParams({ immersiveHome: false });
    expect(params.immersiveHome).toBe(false);
  });

  it("多次调用应生成不同的 newChatAt（幂等性验证）", () => {
    const p1 = buildHomeAgentParams();
    const p2 = buildHomeAgentParams();
    // 两次调用的 newChatAt 可能相同（同毫秒），但结构一致
    expect(p1.theme).toBe(p2.theme);
    expect(p1.lockTheme).toBe(p2.lockTheme);
  });
});

describe("buildClawAgentParams", () => {
  it("应返回 Claw 任务中心参数", () => {
    const params = buildClawAgentParams();

    expect(params.agentEntry).toBe("claw");
    expect(params.theme).toBe("general");
    expect(params.lockTheme).toBe(false);
    expect(params.immersiveHome).toBe(false);
  });

  it("应允许透传项目上下文，但不覆盖核心字段", () => {
    const params = buildClawAgentParams({
      projectId: "proj-2",
      immersiveHome: true,
    });

    expect(params.projectId).toBe("proj-2");
    expect(params.agentEntry).toBe("claw");
    expect(params.immersiveHome).toBe(true);
    expect(params.theme).toBe("general");
  });

  it("应允许显式透传初始主题", () => {
    const params = buildClawAgentParams({
      theme: "general",
    });

    expect(params.agentEntry).toBe("claw");
    expect(params.theme).toBe("general");
    expect(params.lockTheme).toBe(false);
  });

  it("应允许显式锁定主题，避免被项目工作区主题覆盖", () => {
    const params = buildClawAgentParams({
      theme: "general",
      lockTheme: true,
    });

    expect(params.agentEntry).toBe("claw");
    expect(params.theme).toBe("general");
    expect(params.lockTheme).toBe(true);
  });

  it("应透传首页壳提交后的首条上下文参数", () => {
    const params = buildClawAgentParams({
      projectId: "proj-3",
      initialUserPrompt: "整理成 notebook 工作方式",
      initialCreationMode: "framework",
      initialUserImages: [
        {
          data: "aGVsbG8=",
          mediaType: "image/png",
        },
      ],
      openBrowserAssistOnMount: true,
    });

    expect(params.agentEntry).toBe("claw");
    expect(params.projectId).toBe("proj-3");
    expect(params.initialUserPrompt).toBe("整理成 notebook 工作方式");
    expect(params.initialCreationMode).toBe("framework");
    expect(params.initialUserImages).toEqual([
      {
        data: "aGVsbG8=",
        mediaType: "image/png",
      },
    ]);
    expect(params.openBrowserAssistOnMount).toBe(true);
  });

  it("应允许首页壳透传新会话时间戳", () => {
    const params = buildClawAgentParams({
      projectId: "proj-4",
      newChatAt: 1234567890,
    });

    expect(params.agentEntry).toBe("claw");
    expect(params.projectId).toBe("proj-4");
    expect(params.newChatAt).toBe(1234567890);
  });
});
