import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  clearDiagnosticLogHistory,
  clearLogs,
  getLogs,
  getPersistedLogsTail,
} from "./logs";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("logs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理读取日志命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ timestamp: "t", level: "info", message: "m" }])
      .mockResolvedValueOnce([
        { timestamp: "t2", level: "warn", message: "m2" },
      ]);

    await expect(getLogs()).resolves.toEqual([
      expect.objectContaining({ level: "info" }),
    ]);
    await expect(getPersistedLogsTail(250)).resolves.toEqual([
      expect.objectContaining({ level: "warn" }),
    ]);
  });

  it("应代理清理日志命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(clearLogs()).resolves.toBeUndefined();
    await expect(clearDiagnosticLogHistory()).resolves.toBeUndefined();
  });
});
