import { describe, expect, it } from "vitest";

import { getProviderModelAutoFetchCapability } from "./providerModelFetchSupport";

describe("providerModelFetchSupport", () => {
  it("OpenAI 官方协议应支持自动获取且需要 API Key", () => {
    expect(
      getProviderModelAutoFetchCapability({
        providerId: "openai",
        providerType: "openai-response",
        apiHost: "https://api.openai.com",
      }),
    ).toEqual({
      supported: true,
      requiresApiKey: true,
    });
  });

  it("Anthropic 官方协议应支持自动获取且需要 API Key", () => {
    expect(
      getProviderModelAutoFetchCapability({
        providerId: "anthropic",
        providerType: "anthropic",
        apiHost: "https://api.anthropic.com",
      }),
    ).toEqual({
      supported: true,
      requiresApiKey: true,
    });
  });

  it("Gemini 官方协议应支持自动获取且需要 API Key", () => {
    expect(
      getProviderModelAutoFetchCapability({
        providerId: "google",
        providerType: "gemini",
        apiHost: "https://generativelanguage.googleapis.com",
      }),
    ).toEqual({
      supported: true,
      requiresApiKey: true,
    });
  });

  it("Ollama 应支持自动获取且不要求 API Key", () => {
    expect(
      getProviderModelAutoFetchCapability({
        providerId: "ollama",
        providerType: "ollama",
        apiHost: "http://127.0.0.1:11434",
      }),
    ).toEqual({
      supported: true,
      requiresApiKey: false,
    });
  });

  it("本地 OpenAI 兼容地址应允许免 Key 获取模型", () => {
    expect(
      getProviderModelAutoFetchCapability({
        providerId: "custom-local-openai",
        providerType: "openai",
        apiHost: "http://127.0.0.1:1234/v1",
      }),
    ).toEqual({
      supported: true,
      requiresApiKey: false,
    });
  });

  it("Azure OpenAI 当前不应展示自动获取入口", () => {
    const capability = getProviderModelAutoFetchCapability({
      providerId: "azure-openai",
      providerType: "azure-openai",
      apiHost: "https://example.openai.azure.com",
    });

    expect(capability.supported).toBe(false);
    expect(capability.unsupportedReason).toContain("当前不展示自动获取入口");
  });
});
