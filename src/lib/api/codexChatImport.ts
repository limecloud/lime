import { AppServerClient } from "@/lib/api/appServer";
import type { AppServerRequestResult } from "@/lib/api/appServer";
import { safeInvoke } from "@/lib/dev-bridge";

export interface CodexChatMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  sourceItemId?: string;
}

export interface CodexChatTurn {
  sourceTurnId: string;
  status: "completed" | "interrupted" | "failed";
  startedAt?: number;
  completedAt?: number;
  messages: CodexChatMessage[];
}

export interface CodexChatConversation {
  id: string;
  title: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  turnCount: number;
  cwd?: string;
  truncated: boolean;
  importable: boolean;
}

export interface CodexChatConversationDetail extends CodexChatConversation {
  turns: CodexChatTurn[];
  skippedMessageCount: number;
}

export interface CodexChatListResult {
  conversations: CodexChatConversation[];
  scannedFileCount: number;
  totalFileCount: number;
}

export interface CodexChatImportParams {
  source: "codex";
  sourceConversationId: string;
  sourcePath: string;
  title: string;
  cwd?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  turns: Array<{
    sourceTurnId: string;
    status: "completed" | "interrupted" | "failed";
    startedAtMs?: number;
    completedAtMs?: number;
    messages: Array<{
      role: "user" | "assistant";
      text: string;
      createdAtMs: number;
      sourceItemId?: string;
    }>;
  }>;
}

export interface CodexChatImportResult {
  threadId: string;
  sessionId: string;
  importedTurnCount: number;
  importedMessageCount: number;
  alreadyImported: boolean;
}

const THREAD_IMPORT_METHOD = "thread/import";

export async function listCodexChats(limit = 20): Promise<CodexChatListResult> {
  const result = await safeInvoke<unknown>("list_codex_chats", { limit });
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("list_codex_chats returned an invalid result");
  }
  const record = result as Record<string, unknown>;
  return {
    conversations: Array.isArray(record.conversations)
      ? record.conversations
          .map(projectConversation)
          .filter((item): item is CodexChatConversation => item !== null)
      : [],
    scannedFileCount:
      typeof record.scannedFileCount === "number" ? record.scannedFileCount : 0,
    totalFileCount:
      typeof record.totalFileCount === "number" ? record.totalFileCount : 0,
  };
}

export async function readCodexChat(
  sourcePath: string,
): Promise<CodexChatConversationDetail> {
  const result = await safeInvoke<unknown>("read_codex_chat", { sourcePath });
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("read_codex_chat returned an invalid result");
  }
  const conversation = projectConversation(result);
  if (!conversation) {
    throw new Error("read_codex_chat returned an invalid result");
  }
  const record = result as Record<string, unknown>;
  return {
    ...conversation,
    skippedMessageCount:
      typeof record.skippedMessageCount === "number"
        ? record.skippedMessageCount
        : 0,
    turns: Array.isArray(record.turns)
      ? record.turns
          .map(projectTurn)
          .filter((turn): turn is CodexChatTurn => turn !== null)
      : [],
  };
}

export async function importCodexChat(
  conversation: CodexChatConversationDetail,
  client: Pick<AppServerClient, "request"> = new AppServerClient(),
): Promise<CodexChatImportResult> {
  const result: AppServerRequestResult<unknown> = await client.request(
    THREAD_IMPORT_METHOD,
    buildCodexChatImportParams(conversation),
  );
  const payload = result?.result;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("thread/import returned an invalid result");
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.sessionId !== "string"
  ) {
    throw new Error("thread/import returned an invalid result");
  }
  return {
    threadId: record.threadId,
    sessionId: record.sessionId,
    importedTurnCount:
      typeof record.importedTurnCount === "number"
        ? record.importedTurnCount
        : 0,
    importedMessageCount:
      typeof record.importedMessageCount === "number"
        ? record.importedMessageCount
        : 0,
    alreadyImported: record.alreadyImported === true,
  };
}

export function buildCodexChatImportParams(
  conversation: CodexChatConversationDetail,
): CodexChatImportParams {
  return {
    source: "codex",
    sourceConversationId: conversation.id,
    sourcePath: conversation.sourcePath,
    title: conversation.title,
    ...(conversation.cwd ? { cwd: conversation.cwd } : {}),
    createdAtMs: conversation.createdAt,
    updatedAtMs: conversation.updatedAt,
    turns: conversation.turns.map((turn) => ({
      sourceTurnId: turn.sourceTurnId,
      status: turn.status,
      ...(turn.startedAt !== undefined ? { startedAtMs: turn.startedAt } : {}),
      ...(turn.completedAt !== undefined
        ? { completedAtMs: turn.completedAt }
        : {}),
      messages: turn.messages.map((message) => ({
        role: message.role,
        text: message.text,
        createdAtMs: message.createdAt,
        ...(message.sourceItemId ? { sourceItemId: message.sourceItemId } : {}),
      })),
    })),
  };
}

function projectConversation(value: unknown): CodexChatConversation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.sourcePath !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    title: record.title,
    sourcePath: record.sourcePath,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    messageCount:
      typeof record.messageCount === "number" ? record.messageCount : 0,
    turnCount: typeof record.turnCount === "number" ? record.turnCount : 0,
    ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
    truncated: record.truncated === true,
    importable: record.importable === true,
  };
}

function projectTurn(value: unknown): CodexChatTurn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sourceTurnId !== "string") return null;
  const status =
    record.status === "interrupted" || record.status === "failed"
      ? record.status
      : "completed";
  return {
    sourceTurnId: record.sourceTurnId,
    status,
    ...(typeof record.startedAt === "number"
      ? { startedAt: record.startedAt }
      : {}),
    ...(typeof record.completedAt === "number"
      ? { completedAt: record.completedAt }
      : {}),
    messages: Array.isArray(record.messages)
      ? record.messages
          .map(projectMessage)
          .filter((message): message is CodexChatMessage => message !== null)
      : [],
  };
}

function projectMessage(value: unknown): CodexChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const role =
    record.role === "user" || record.role === "assistant" ? record.role : null;
  if (!role || typeof record.text !== "string") return null;
  return {
    role,
    text: record.text,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    ...(typeof record.sourceItemId === "string"
      ? { sourceItemId: record.sourceItemId }
      : {}),
  };
}
