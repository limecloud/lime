import { describe, expect, it } from "vitest";
import { parseCodeWorkbenchCommand } from "./codeWorkbenchCommand";

describe("parseCodeWorkbenchCommand", () => {
  it("应解析带显式任务类型的 @代码 命令", () => {
    const result = parseCodeWorkbenchCommand(
      "@代码 类型:重构 重构聊天区时间线组件，合并重复状态分支并补测试",
    );

    expect(result).toMatchObject({
      trigger: "@代码",
      taskType: "refactor",
      prompt: "重构聊天区时间线组件，合并重复状态分支并补测试",
    });
  });

  it("应兼容英文触发并识别 code review 意图", () => {
    const result = parseCodeWorkbenchCommand(
      "@code review src/components/agent/chat/workspace/useWorkspaceSendActions.ts 的发送边界",
    );

    expect(result).toMatchObject({
      trigger: "@code",
      taskType: "code_review",
      prompt:
        "src/components/agent/chat/workspace/useWorkspaceSendActions.ts 的发送边界",
    });
  });

  it("未显式声明类型时也应从正文推断 bug fix 意图", () => {
    const result = parseCodeWorkbenchCommand(
      "@开发 帮我修复消息历史切换后图片卡片丢失的问题",
    );

    expect(result).toMatchObject({
      trigger: "@开发",
      taskType: "bug_fix",
      prompt: "帮我修复消息历史切换后图片卡片丢失的问题",
    });
  });

  it("非代码命令应返回空", () => {
    expect(parseCodeWorkbenchCommand("@表单 帮我做一个报名表")).toBeNull();
  });
});
