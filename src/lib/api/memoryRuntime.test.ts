import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  getMemoryAutoIndex,
  getMemoryEffectiveSources,
  getMemoryOverview,
  toggleMemoryAuto,
  updateMemoryAutoNote,
} from "./memoryRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("memoryRuntime API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理记忆查询命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ stats: {}, categories: [], entries: [] })
      .mockResolvedValueOnce({ sources: [] })
      .mockResolvedValueOnce({ items: [] });

    await expect(getMemoryOverview(200)).resolves.toEqual(
      expect.objectContaining({ entries: [] }),
    );
    await expect(getMemoryEffectiveSources()).resolves.toEqual(
      expect.objectContaining({ sources: [] }),
    );
    await expect(getMemoryAutoIndex()).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
  });

  it("应代理自动记忆开关与写入命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ items: [] });

    await expect(toggleMemoryAuto(true)).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(updateMemoryAutoNote("note", "topic")).resolves.toEqual(
      expect.objectContaining({ items: [] }),
    );
  });
});
