import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { subscribeSysinfo, unsubscribeSysinfo } from "./sysinfo";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("sysinfo API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理系统信息订阅命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(subscribeSysinfo()).resolves.toBeUndefined();
    await expect(unsubscribeSysinfo()).resolves.toBeUndefined();
  });
});
