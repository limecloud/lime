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
        "当前 Provider 鉴权已失效，请前往设置检查登录态、API Key 或重新授权后重试。",
      toastMessage:
        "当前 Provider 鉴权已失效，请前往设置检查登录态、API Key 或重新授权后重试。",
    });
  });

  it("SendMessage schema 错误应转换为登录态失效提示", () => {
    expect(
      resolveAgentRuntimeErrorPresentation(
        "Agent provider execution failed: Request failed: Bad request (400): Invalid schema for function 'SendMessage': In context=('properties', 'message', 'oneOf', '2'), array schema missing items",
      ),
    ).toEqual({
      displayMessage:
        "当前 Provider 登录态已失效，常见原因是 Token 已过期。请前往设置重新登录或刷新凭证后重试。",
      toastMessage:
        "当前 Provider 登录态已失效，常见原因是 Token 已过期。请前往设置重新登录或刷新凭证后重试。",
    });
  });
});
