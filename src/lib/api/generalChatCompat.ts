import { safeInvoke } from "@/lib/dev-bridge";

export interface GeneralChatCompatSessionRecord {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface GeneralChatCompatMessageRecord {
  id: string;
  session_id: string;
  role: string;
  content: string;
  blocks: Array<{
    type: string;
    content: string;
    language?: string;
    filename?: string;
    mime_type?: string;
  }> | null;
  status: string;
  created_at: number;
  metadata: Record<string, unknown> | null;
}

export interface GeneralChatCompatSessionDetailRecord {
  session: GeneralChatCompatSessionRecord;
  messages: GeneralChatCompatMessageRecord[];
  message_count: number;
}

export const listGeneralChatCompatSessions = () =>
  safeInvoke<GeneralChatCompatSessionRecord[]>("general_chat_list_sessions");

export const getGeneralChatCompatSession = (
  sessionId: string,
  messageLimit: number,
) =>
  safeInvoke<GeneralChatCompatSessionDetailRecord>("general_chat_get_session", {
    sessionId,
    messageLimit,
  });

export const createGeneralChatCompatSession = (
  name?: string,
  metadata?: Record<string, unknown>,
) =>
  safeInvoke<GeneralChatCompatSessionRecord>("general_chat_create_session", {
    name,
    metadata,
  });

export const deleteGeneralChatCompatSession = (sessionId: string) =>
  safeInvoke<void>("general_chat_delete_session", { sessionId });

export const renameGeneralChatCompatSession = (
  sessionId: string,
  name: string,
) =>
  safeInvoke<void>("general_chat_rename_session", {
    sessionId,
    name,
  });

export const getGeneralChatCompatMessages = (
  sessionId: string,
  limit: number,
  beforeId?: string | null,
) =>
  safeInvoke<GeneralChatCompatMessageRecord[]>("general_chat_get_messages", {
    sessionId,
    limit,
    beforeId,
  });
