import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeInvoke } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
}));

import {
  createGeneralChatCompatSession,
  deleteGeneralChatCompatSession,
  getGeneralChatCompatMessages,
  getGeneralChatCompatSession,
  listGeneralChatCompatSessions,
  renameGeneralChatCompatSession,
} from "./generalChatCompat";

describe("generalChatCompat API 网关", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应统一委托会话与消息 compat 命令", async () => {
    mockSafeInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await listGeneralChatCompatSessions();
    await getGeneralChatCompatSession("session-1", 20);
    await createGeneralChatCompatSession("新会话", { theme: "general" });
    await deleteGeneralChatCompatSession("session-1");
    await renameGeneralChatCompatSession("session-1", "已重命名");
    await getGeneralChatCompatMessages("session-1", 50, "message-1");

    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      1,
      "general_chat_list_sessions",
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      2,
      "general_chat_get_session",
      {
        sessionId: "session-1",
        messageLimit: 20,
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      3,
      "general_chat_create_session",
      {
        name: "新会话",
        metadata: { theme: "general" },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      4,
      "general_chat_delete_session",
      { sessionId: "session-1" },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      5,
      "general_chat_rename_session",
      {
        sessionId: "session-1",
        name: "已重命名",
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      6,
      "general_chat_get_messages",
      {
        sessionId: "session-1",
        limit: 50,
        beforeId: "message-1",
      },
    );
  });
});
