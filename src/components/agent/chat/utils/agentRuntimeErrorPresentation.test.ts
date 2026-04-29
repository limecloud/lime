import { describe, expect, it } from "vitest";

import { resolveAgentRuntimeErrorPresentation } from "./agentRuntimeErrorPresentation";

describe("agentRuntimeErrorPresentation", () => {
  it("普通错误应保留原始文案", () => {
    expect(resolveAgentRuntimeErrorPresentation("模型执行失败")).toEqual({
      displayMessage: "模型执行失败",
      toastMessage: "响应错误: 模型执行失败",
    });
  });

  it("鉴权失效错误应转换为友好提示", () => {
    expect(
      resolveAgentRuntimeErrorPresentation(
        "Request failed: 401 unauthorized, token expired",
      ),
    ).toEqual({
      displayMessage:
        "当前 Provider 鉴权未通过，请前往设置 -> AI 服务商检查 API Key、Base URL 或授权配置后重试。",
      toastMessage:
        "当前 Provider 鉴权未通过，请前往设置 -> AI 服务商检查 API Key、Base URL 或授权配置后重试。",
    });
  });

  it("SendMessage schema 错误应转换为模型通道配置提示", () => {
    expect(
      resolveAgentRuntimeErrorPresentation(
        "Agent provider execution failed: Request failed: Bad request (400): Invalid schema for function 'SendMessage': In context=('properties', 'message', 'oneOf', '2'), array schema missing items",
      ),
    ).toEqual({
      displayMessage:
        "当前模型通道返回了不兼容的工具 schema，请前往设置 -> AI 服务商检查 Provider 配置或切换模型后重试。",
      toastMessage:
        "当前模型通道返回了不兼容的工具 schema，请前往设置 -> AI 服务商检查 Provider 配置或切换模型后重试。",
    });
  });
});
