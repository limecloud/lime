import { beforeEach, describe, expect, it, vi } from "vitest";
import { isDevBridgeAvailable, safeInvoke } from "@/lib/dev-bridge";
import { reportFrontendDebugLog } from "./frontendDebug";

vi.mock("@/lib/dev-bridge", () => ({
  isDevBridgeAvailable: vi.fn(() => false),
  safeInvoke: vi.fn(),
}));

describe("frontendDebug API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理前端调试日志上报命令", async () => {
    vi.mocked(isDevBridgeAvailable).mockReturnValue(false);
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(
      reportFrontendDebugLog({
        message: "AgentChatPage.loadData.start",
        category: "agent",
      }),
    ).resolves.toBeUndefined();
  });

  it("浏览器 dev shell 下应跳过远端调试日志上报", async () => {
    vi.mocked(isDevBridgeAvailable).mockReturnValue(true);

    await expect(
      reportFrontendDebugLog({
        message: "AgentChatPage.loadData.start",
        category: "agent",
      }),
    ).resolves.toBeUndefined();

    expect(safeInvoke).not.toHaveBeenCalled();
  });
});
