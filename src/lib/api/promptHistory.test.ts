import { describe, expect, it, vi } from "vitest";
import { readPromptHistory, type PromptHistoryClient } from "./promptHistory";

describe("promptHistory", () => {
  it("continues across empty malformed-row pages without treating them as exhaustion", async () => {
    const readPromptHistoryMock = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          logId: "inode-1",
          entryCount: 250,
          data: [],
          nextCursor: "150",
        },
      })
      .mockResolvedValueOnce({
        result: {
          logId: "inode-1",
          entryCount: 250,
          data: [],
          nextCursor: "50",
        },
      })
      .mockResolvedValueOnce({
        result: {
          logId: "inode-1",
          entryCount: 250,
          data: [
            {
              offset: 0,
              threadId: "historic-thread",
              ts: 1,
              text: "oldest valid",
            },
          ],
          nextCursor: null,
        },
      });
    const client = {
      readPromptHistory: readPromptHistoryMock,
      appendPromptHistory: vi.fn(),
    } as unknown as PromptHistoryClient;
    await expect(readPromptHistory(client, 100)).resolves.toEqual([
      { offset: 0, threadId: "historic-thread", ts: 1, text: "oldest valid" },
    ]);
    expect(readPromptHistoryMock).toHaveBeenNthCalledWith(2, {
      cursor: "150",
      limit: 100,
      logId: "inode-1",
    });
    expect(readPromptHistoryMock).toHaveBeenNthCalledWith(3, {
      cursor: "50",
      limit: 100,
      logId: "inode-1",
    });
  });
  it("reads bounded newest-first pages with a stable log identity", async () => {
    const readPromptHistoryMock = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          logId: "inode-1",
          entryCount: 3,
          data: [
            { offset: 2, threadId: "thread-2", ts: 2, text: "newest" },
            { offset: 1, threadId: "thread-1", ts: 1, text: "middle" },
          ],
          nextCursor: "1",
        },
      })
      .mockResolvedValueOnce({
        result: {
          logId: "inode-1",
          entryCount: 3,
          data: [{ offset: 0, threadId: "thread-0", ts: 0, text: "oldest" }],
          nextCursor: null,
        },
      });
    const client = {
      readPromptHistory: readPromptHistoryMock,
      appendPromptHistory: vi.fn(),
    } as unknown as PromptHistoryClient;

    await expect(readPromptHistory(client, 3)).resolves.toMatchObject([
      { threadId: "thread-2", text: "newest" },
      { threadId: "thread-1", text: "middle" },
      { threadId: "thread-0", text: "oldest" },
    ]);
    expect(readPromptHistoryMock).toHaveBeenNthCalledWith(2, {
      cursor: "1",
      limit: 3,
      logId: "inode-1",
    });
  });
});
