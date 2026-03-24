import { describe, expect, it } from "vitest";
import { parseOemCloudDesktopOAuthCallbackUrl } from "./oemCloudDesktopAuth";

describe("oemCloudDesktopAuth", () => {
  it("应解析桌面端 OAuth 回调", () => {
    expect(
      parseOemCloudDesktopOAuthCallbackUrl(
        "lime://oauth/callback?tenantId=tenant-0001&token=session-token&next=%2Fwelcome",
      ),
    ).toEqual({
      tenantId: "tenant-0001",
      token: "session-token",
      nextPath: "/welcome",
      error: null,
    });
  });

  it("缺少 next 时应回退默认欢迎页", () => {
    expect(
      parseOemCloudDesktopOAuthCallbackUrl(
        "lime://oauth/callback?tenantId=tenant-0001&token=session-token",
      ),
    ).toEqual({
      tenantId: "tenant-0001",
      token: "session-token",
      nextPath: "/welcome",
      error: null,
    });
  });
});
