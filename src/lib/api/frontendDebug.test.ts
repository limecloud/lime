import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { reportFrontendDebugLog } from "./frontendDebug";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("frontendDebug API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过 Electron Host current 通道上报前端调试日志并保持参数投影", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(null);
    const report = {
      message: "LocalConversationPage.loadData.start",
      category: "agent",
    };

    await expect(reportFrontendDebugLog(report)).resolves.toBeUndefined();

    expect(safeInvoke).toHaveBeenCalledWith("report_frontend_debug_log", {
      report,
    });
  });

  it("遇到 Electron degraded diagnostic facade 时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      diagnostic: {
        category: "electron-diagnostic-facade",
        source: "electron-host-diagnostic",
      },
    });

    await expect(
      reportFrontendDebugLog({
        message: "LocalConversationPage.loadData.start",
        category: "agent",
      }),
    ).rejects.toThrow(
      "report_frontend_debug_log 尚未接入前端调试日志 Electron Host current 通道",
    );
  });

  it("遇到异常成功形态时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ success: true });

    await expect(
      reportFrontendDebugLog({
        message: "LocalConversationPage.loadData.start",
        category: "agent",
      }),
    ).rejects.toThrow(
      "report_frontend_debug_log did not return debug log result",
    );
  });
});
