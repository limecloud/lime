import { describe, expect, it } from "vitest";
import {
  buildOemLimeHubApiHost,
  DEFAULT_OEM_LIME_HUB_PROVIDER_NAME,
  isLegacyProxyCastHubProvider,
  OEM_LIME_HUB_PROVIDER_ID,
  resolveOemLimeHubProviderName,
} from "./oemLimeHubProvider";

describe("oemLimeHubProvider", () => {
  it("应从运行时配置提取 Lime Hub 网关地址", () => {
    expect(
      buildOemLimeHubApiHost({
        gatewayBaseUrl: "https://user.limeai.run/gateway-api/",
      }),
    ).toBe("https://user.limeai.run/gateway-api");
  });

  it("应在未配置品牌名时回退默认 Lime Hub 名称", () => {
    expect(resolveOemLimeHubProviderName(null)).toBe(
      DEFAULT_OEM_LIME_HUB_PROVIDER_NAME,
    );
    expect(
      resolveOemLimeHubProviderName({
        hubProviderName: "   ",
      }),
    ).toBe(DEFAULT_OEM_LIME_HUB_PROVIDER_NAME);
  });

  it("应识别旧 ProxyCast Hub 兼容项，但保留新的 lime-hub 系统 provider", () => {
    expect(
      isLegacyProxyCastHubProvider({
        id: OEM_LIME_HUB_PROVIDER_ID,
        name: "Lime Hub",
        api_host: "https://user.limeai.run/gateway-api",
      }),
    ).toBe(false);

    expect(
      isLegacyProxyCastHubProvider({
        id: "proxycast-hub",
        name: "ProxyCast Hub",
        api_host: "https://proxycast.example.com/v1",
      }),
    ).toBe(true);

    expect(
      isLegacyProxyCastHubProvider({
        id: "custom-provider",
        name: "Legacy Provider",
        api_host: "https://proxycast.example.com/v1",
      }),
    ).toBe(true);
  });
});
