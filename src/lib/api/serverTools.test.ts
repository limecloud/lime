import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { getNetworkInfo, testApi } from "./serverTools";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("serverTools API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理测试接口与网络信息命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        body: "ok",
        time_ms: 10,
      })
      .mockResolvedValueOnce({
        localhost: "127.0.0.1",
        lan_ip: null,
        all_ips: [],
      });

    await expect(testApi("GET", "/health", null, false)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
    await expect(getNetworkInfo()).resolves.toEqual(
      expect.objectContaining({ localhost: "127.0.0.1" }),
    );
  });
});
