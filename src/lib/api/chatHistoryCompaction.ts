import { safeInvoke } from "@/lib/dev-bridge";

export interface ChatHistoryCompactionResult {
  beforeBytes: number;
  afterBytes: number;
  databases: number;
}

export async function compactChatHistory(): Promise<ChatHistoryCompactionResult> {
  const result = await safeInvoke<unknown>("compact_chat_history");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("compact_chat_history returned an invalid result");
  }
  const record = result as Record<string, unknown>;
  const beforeBytes = record.beforeBytes;
  const afterBytes = record.afterBytes;
  const databases = record.databases;
  if (
    typeof beforeBytes !== "number" ||
    typeof afterBytes !== "number" ||
    typeof databases !== "number"
  ) {
    throw new Error("compact_chat_history returned an invalid result");
  }
  return { beforeBytes, afterBytes, databases };
}
