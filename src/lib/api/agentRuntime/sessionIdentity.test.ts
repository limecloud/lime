import { describe, expect, it } from "vitest";
import { isAuxiliaryAgentSessionId } from "./sessionIdentity";

describe("agentRuntime sessionIdentity", () => {
  it("应把 标题生成会话识别为非用户对话", () => {
    expect(
      isAuxiliaryAgentSessionId("title-gen-ip-v1-0-20260508T073339Z"),
    ).toBe(true);
  });

  it("普通用户会话不应被隐藏", () => {
    expect(isAuxiliaryAgentSessionId("session-visible")).toBe(false);
  });
});
