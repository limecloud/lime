import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  analyzeUnifiedMemories,
  createUnifiedMemory,
  deleteUnifiedMemory,
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  getUnifiedMemory,
  getUnifiedMemoryStats,
  hybridSearch,
  listUnifiedMemories,
  searchUnifiedMemories,
  semanticSearch,
  updateUnifiedMemory,
} from "./unifiedMemory";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("unifiedMemory API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("应代理统一记忆 CRUD 与查询命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "m1" }])
      .mockResolvedValueOnce([{ id: "m2" }])
      .mockResolvedValueOnce({ id: "m1" })
      .mockResolvedValueOnce({ id: "m3" })
      .mockResolvedValueOnce({ id: "m3", title: "更新后" })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        total_entries: 3,
        storage_used: 100,
        memory_count: 2,
        categories: [],
      })
      .mockResolvedValueOnce({
        analyzed_sessions: 1,
        analyzed_messages: 10,
        generated_entries: 2,
        deduplicated_entries: 0,
      });

    await expect(listUnifiedMemories()).resolves.toEqual([
      expect.objectContaining({ id: "m1" }),
    ]);
    await expect(searchUnifiedMemories("关键词")).resolves.toEqual([
      expect.objectContaining({ id: "m2" }),
    ]);
    await expect(getUnifiedMemory("m1")).resolves.toEqual(
      expect.objectContaining({ id: "m1" }),
    );
    await expect(
      createUnifiedMemory({
        session_id: "session-1",
        title: "标题",
        content: "内容",
        summary: "摘要",
        category: "experience",
        tags: ["复盘"],
        confidence: 0.9,
        importance: 8,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "m3" }));
    await expect(
      updateUnifiedMemory("m3", { title: "更新后" }),
    ).resolves.toEqual(expect.objectContaining({ title: "更新后" }));
    await expect(deleteUnifiedMemory("m3")).resolves.toBe(true);
    await expect(getUnifiedMemoryStats()).resolves.toEqual(
      expect.objectContaining({ total_entries: 3 }),
    );
    await expect(analyzeUnifiedMemories()).resolves.toEqual(
      expect.objectContaining({ analyzed_sessions: 1 }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(4, "unified_memory_create", {
      request: {
        session_id: "session-1",
        title: "标题",
        content: "内容",
        summary: "摘要",
        category: "experience",
        tags: ["复盘"],
        confidence: 0.9,
        importance: 8,
      },
    });
  });

  it("应代理语义搜索与混合搜索命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "m4" }])
      .mockResolvedValueOnce([{ id: "m5" }]);

    await expect(semanticSearch("语义", "context", 0.8, 5)).resolves.toEqual([
      expect.objectContaining({ id: "m4" }),
    ]);
    await expect(
      hybridSearch("混合", "identity", 0.7, 0.4, 6),
    ).resolves.toEqual([expect.objectContaining({ id: "m5" })]);

    expect(safeInvoke).toHaveBeenNthCalledWith(
      1,
      "unified_memory_semantic_search",
      {
        options: {
          query: "语义",
          category: "context",
          min_similarity: 0.8,
          limit: 5,
        },
      },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(
      2,
      "unified_memory_hybrid_search",
      {
        options: {
          query: "混合",
          category: "identity",
          semantic_weight: 0.7,
          min_similarity: 0.4,
          limit: 6,
        },
      },
    );
  });

  it("应格式化时间戳", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    const absoluteDate = new Date(Date.UTC(2024, 0, 15, 12, 30));
    const expectedAbsolute = `${absoluteDate.getFullYear()}-${String(
      absoluteDate.getMonth() + 1,
    ).padStart(2, "0")}-${String(absoluteDate.getDate()).padStart(
      2,
      "0",
    )} ${String(absoluteDate.getHours()).padStart(2, "0")}:${String(
      absoluteDate.getMinutes(),
    ).padStart(2, "0")}`;

    expect(formatRelativeTimestamp(Date.now())).toBe("刚刚");
    expect(formatRelativeTimestamp(Date.now() - 5 * 60 * 1000)).toBe(
      "5 分钟前",
    );
    expect(formatRelativeTimestamp(Date.now() - 2 * 60 * 60 * 1000)).toBe(
      "2 小时前",
    );
    expect(formatAbsoluteTimestamp(absoluteDate.getTime())).toBe(
      expectedAbsolute,
    );

    vi.useRealTimers();
  });
});
