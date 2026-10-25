import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_TOOL_PREFERENCES,
  alignChatToolPreferencesWithExecutionStrategy,
  loadChatToolPreferences,
  saveChatToolPreferences,
} from "./chatToolPreferences";

describe("chatToolPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("通用对话主题默认不应强制联网搜索", () => {
    expect(loadChatToolPreferences("general")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
  });

  it("通用对话主题不应继承 legacy 全局偏好", () => {
    localStorage.setItem(
      "lime.chat.tool_preferences.v1",
      JSON.stringify({ webSearch: true, thinking: true }),
    );

    expect(loadChatToolPreferences("general")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
  });

  it("非通用主题回退 legacy 全局偏好时也应忽略搜索与思考旧开关", () => {
    localStorage.setItem(
      "lime.chat.tool_preferences.v1",
      JSON.stringify({
        webSearch: true,
        thinking: true,
        task: true,
        subagent: true,
      }),
    );

    expect(loadChatToolPreferences("custom-theme")).toEqual({
      task: true,
      subagent: true,
    });
  });

  it("应按主题作用域保存偏好，但不恢复搜索与思考旧开关", () => {
    saveChatToolPreferences({ task: true, subagent: false }, "general");
    saveChatToolPreferences({ task: false, subagent: true }, "custom-theme");

    expect(loadChatToolPreferences("general")).toEqual({
      task: true,
      subagent: false,
    });
    expect(loadChatToolPreferences("custom-theme")).toEqual({
      task: false,
      subagent: true,
    });
    expect(loadChatToolPreferences("another-theme")).toEqual(
      DEFAULT_CHAT_TOOL_PREFERENCES,
    );
  });

  it("legacy code_orchestrated 不应再自动打开任务与子代理偏好", () => {
    expect(
      alignChatToolPreferencesWithExecutionStrategy(
        {
          task: false,
          subagent: false,
        },
        "code_orchestrated" as never,
      ),
    ).toEqual({
      task: false,
      subagent: false,
    });
  });

  it("策略变化不应覆盖用户手动任务与子代理偏好", () => {
    expect(
      alignChatToolPreferencesWithExecutionStrategy(
        {
          task: true,
          subagent: true,
        },
        "react",
      ),
    ).toEqual({
      task: true,
      subagent: true,
    });
  });
});
