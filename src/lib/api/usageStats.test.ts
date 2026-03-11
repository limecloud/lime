import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getDailyUsageTrends,
  getModelUsageRanking,
  getUsageStats,
} from "./usageStats";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("usageStats API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理使用统计查询命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ total_conversations: 1 })
      .mockResolvedValueOnce([{ model: "gpt-4.1", conversations: 1 }])
      .mockResolvedValueOnce([{ date: "2025-01-01", conversations: 1 }]);

    await expect(getUsageStats("month")).resolves.toEqual(
      expect.objectContaining({ total_conversations: 1 }),
    );
    await expect(getModelUsageRanking("month")).resolves.toEqual([
      expect.objectContaining({ model: "gpt-4.1" }),
    ]);
    await expect(getDailyUsageTrends("month")).resolves.toEqual([
      expect.objectContaining({ date: "2025-01-01" }),
    ]);
  });
});
