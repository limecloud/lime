import { describe, expect, it } from "vitest";
import { getRegistryIdFromType } from "@/lib/constants/providerMappings";
import {
  getProviderPromptCacheMode,
  isKnownAutomaticAnthropicCompatibleHost,
  resolveKnownAnthropicCompatibleProvider,
  resolvePromptCacheSupportNotice,
} from "./providerPromptCacheSupport";

describe("providerPromptCacheSupport", () => {
  it("自定义 anthropic-compatible Provider 应提示仅支持显式缓存", () => {
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "custom-provider-id",
        configuredProviderType: "anthropic-compatible",
      }),
    ).toEqual(
      expect.objectContaining({
        label: "未声明自动缓存",
        source: "configured_provider",
      }),
    );
  });

  it("官方 Anthropic Provider 不应展示自动缓存提示", () => {
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "anthropic",
        configuredProviderType: "anthropic",
      }),
    ).toBeNull();
  });

  it("显式声明 automatic 的 anthropic-compatible Provider 不应展示提示", () => {
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "custom-provider-id",
        configuredProviderType: "anthropic-compatible",
        configuredPromptCacheMode: "automatic",
      }),
    ).toBeNull();
  });

  it.each([
    "https://open.bigmodel.cn/api/anthropic",
    "https://api.moonshot.cn/anthropic",
    "https://api.minimaxi.com/anthropic",
    "https://token-plan-cn.xiaomimimo.com/anthropic",
  ])("已知官方 Anthropic 兼容 Host %s 不应误报显式缓存提示", (apiHost) => {
    expect(isKnownAutomaticAnthropicCompatibleHost(apiHost)).toBe(true);
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "official-anthropic-compatible-provider",
        configuredProviderType: "anthropic-compatible",
        configuredApiHost: apiHost,
      }),
    ).toBeNull();
    expect(
      getProviderPromptCacheMode("anthropic-compatible", null, apiHost),
    ).toBe("automatic");
  });

  it("仅有 anthropic-compatible 选择器时应回退提示", () => {
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "anthropic-compatible",
      }),
    ).toEqual(
      expect.objectContaining({
        label: "未声明自动缓存",
        source: "selection_fallback",
      }),
    );
  });

  it("未知 custom 选择器在未解析真实类型前不应误报", () => {
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "custom-ba4e7574-dd00-4784-945a-0f383dfa1272",
      }),
    ).toBeNull();
  });

  it("已解析为非 Anthropic 兼容 Provider 时不应回退误报", () => {
    expect(
      resolvePromptCacheSupportNotice({
        providerType: "anthropic-compatible",
        configuredProviderType: "openai",
      }),
    ).toBeNull();
  });

  it("应按 Provider 类型返回统一的 prompt cache 模式", () => {
    expect(getProviderPromptCacheMode("anthropic")).toBe("automatic");
    expect(getProviderPromptCacheMode("claude_oauth")).toBe("automatic");
    expect(getProviderPromptCacheMode("anthropic-compatible")).toBe(
      "explicit_only",
    );
    expect(
      getProviderPromptCacheMode("anthropic-compatible", "automatic"),
    ).toBe("automatic");
    expect(getProviderPromptCacheMode("openai")).toBe("not_applicable");
  });

  it("模型注册表映射应在已知官方 Anthropic 兼容 Host 上落到真实厂商目录", () => {
    expect(getRegistryIdFromType("anthropic-compatible")).toBe("anthropic");
    expect(
      getRegistryIdFromType(
        "anthropic-compatible",
        "https://api.minimaxi.com/anthropic",
      ),
    ).toBe("minimax");
    expect(
      resolveKnownAnthropicCompatibleProvider(
        "https://open.bigmodel.cn/api/anthropic",
      ),
    ).toBe("zhipuai");
    expect(getProviderPromptCacheMode("anthropic-compatible")).toBe(
      "explicit_only",
    );
  });
});
