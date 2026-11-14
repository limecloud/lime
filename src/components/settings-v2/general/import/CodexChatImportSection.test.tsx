import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { CodexChatImportSection } from "./CodexChatImportSection";
import type {
  CodexChatConversation,
  CodexChatConversationDetail,
} from "@/lib/api/codexChatImport";

const api = vi.hoisted(() => ({
  listCodexChats: vi.fn(),
  readCodexChat: vi.fn(),
  importCodexChat: vi.fn(),
  recordImport: vi.fn(),
}));

vi.mock("@/lib/api/codexChatImport", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/codexChatImport")>();
  return {
    ...original,
    listCodexChats: api.listCodexChats,
    readCodexChat: api.readCodexChat,
    importCodexChat: api.importCodexChat,
  };
});
vi.mock("@/lib/importHistory", () => ({
  recordImport: api.recordImport,
}));

const conversation: CodexChatConversation = {
  id: "conversation-1",
  title: "整理导入流程",
  sourcePath: "/Users/test/.codex/sessions/2026/11/14/rollout-1.jsonl",
  createdAt: 1,
  updatedAt: 2,
  messageCount: 4,
  turnCount: 2,
  truncated: false,
  importable: true,
};

const detail: CodexChatConversationDetail = {
  ...conversation,
  skippedMessageCount: 0,
  turns: [
    {
      sourceTurnId: "turn-1",
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      messages: [
        { role: "user", text: "问题", createdAt: 1 },
        { role: "assistant", text: "回答", createdAt: 2 },
      ],
    },
  ],
};

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.listCodexChats.mockResolvedValue({
    conversations: [conversation],
    scannedFileCount: 1,
    totalFileCount: 1,
  });
  api.readCodexChat.mockResolvedValue(detail);
  api.importCodexChat.mockResolvedValue({
    threadId: "thread-1",
    sessionId: "thread-1",
    importedTurnCount: 1,
    importedMessageCount: 2,
    alreadyImported: false,
  });
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CodexChatImportSection />));
  await act(async () => Promise.resolve());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

describe("CodexChatImportSection", () => {
  it("lists importable Codex conversations and marks truncated files", async () => {
    api.listCodexChats.mockResolvedValue({
      conversations: [
        conversation,
        {
          ...conversation,
          id: "conversation-2",
          title: "超大文件",
          truncated: true,
          importable: false,
        },
      ],
      scannedFileCount: 2,
      totalFileCount: 2,
    });
    await act(async () => button("刷新会话列表").click());
    await act(async () => Promise.resolve());
    const text = container.textContent ?? "";
    expect(text).toContain("整理导入流程");
    expect(text).toContain("4 条消息");
    expect(text).toContain("文件过大，无法安全导入");
    expect(button("导入")).toBeInstanceOf(HTMLButtonElement);
  });

  it("imports a selected conversation and records chats history", async () => {
    await act(async () => button("导入").click());
    await act(async () => Promise.resolve());
    expect(api.readCodexChat).toHaveBeenCalledWith(conversation.sourcePath);
    expect(api.importCodexChat).toHaveBeenCalledWith(detail);
    expect(api.recordImport).toHaveBeenCalledWith({
      kind: "chats",
      summary: "已导入「整理导入流程」",
    });
    expect(button("已导入").disabled).toBe(true);
  });

  it("treats an already imported conversation as idempotent", async () => {
    api.importCodexChat.mockResolvedValue({
      threadId: "thread-1",
      sessionId: "thread-1",
      importedTurnCount: 1,
      importedMessageCount: 2,
      alreadyImported: true,
    });
    await act(async () => button("导入").click());
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("已在 Lime 中导入");
    expect(api.recordImport).not.toHaveBeenCalled();
  });

  it("imports recent conversations in sequence", async () => {
    const second = {
      ...conversation,
      id: "conversation-2",
      title: "第二个会话",
    };
    api.listCodexChats.mockResolvedValue({
      conversations: [conversation, second],
      scannedFileCount: 2,
      totalFileCount: 2,
    });
    await act(async () => button("刷新会话列表").click());
    await act(async () => Promise.resolve());
    await act(async () => button("导入最近会话").click());
    await act(async () => Promise.resolve());
    expect(api.importCodexChat).toHaveBeenCalledTimes(2);
    expect(api.recordImport).toHaveBeenCalledWith({
      kind: "chats",
      summary: "已导入 2 个会话",
    });
  });
});
