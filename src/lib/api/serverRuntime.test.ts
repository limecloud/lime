import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  exportSupportBundle,
  getLogStorageDiagnostics,
  getServerDiagnostics,
  getServerStatus,
  getWindowsStartupDiagnostics,
  startServer,
  stopServer,
} from "./serverRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("serverRuntime API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理服务控制命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce("started")
      .mockResolvedValueOnce("stopped");

    await expect(startServer()).resolves.toBe("started");
    await expect(stopServer()).resolves.toBe("stopped");
  });

  it("应代理诊断类命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ running: true, host: "127.0.0.1", port: 8080 })
      .mockResolvedValueOnce({ generated_at: "now", running: true })
      .mockResolvedValueOnce({
        current_log_exists: true,
        in_memory_log_count: 0,
      })
      .mockResolvedValueOnce({ bundle_path: "/tmp/a.zip" })
      .mockResolvedValueOnce({
        platform: "windows",
        checks: [],
        has_blocking_issues: false,
        has_warnings: false,
      });

    await expect(getServerStatus()).resolves.toEqual(
      expect.objectContaining({ running: true }),
    );
    await expect(getServerDiagnostics()).resolves.toEqual(
      expect.objectContaining({ running: true }),
    );
    await expect(getLogStorageDiagnostics()).resolves.toEqual(
      expect.objectContaining({ current_log_exists: true }),
    );
    await expect(exportSupportBundle()).resolves.toEqual(
      expect.objectContaining({ bundle_path: "/tmp/a.zip" }),
    );
    await expect(getWindowsStartupDiagnostics()).resolves.toEqual(
      expect.objectContaining({ platform: "windows" }),
    );
  });
});
