import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));
import { compactChatHistory } from "./chatHistoryCompaction";

describe("compactChatHistory", () => {
  beforeEach(() => invoke.mockReset());

  it("returns the host compaction result", async () => {
    invoke.mockResolvedValueOnce({
      beforeBytes: 1000,
      afterBytes: 400,
      databases: 2,
    });
    await expect(compactChatHistory()).resolves.toEqual({
      beforeBytes: 1000,
      afterBytes: 400,
      databases: 2,
    });
    expect(invoke).toHaveBeenCalledWith("compact_chat_history");
  });

  it("rejects malformed host results", async () => {
    invoke.mockResolvedValueOnce({ beforeBytes: "bad" });
    await expect(compactChatHistory()).rejects.toThrow("invalid result");
  });
});
