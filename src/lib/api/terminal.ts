import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type SessionStatus = "connecting" | "running" | "done" | "error";

export interface CreateSessionResponse {
  session_id: string;
}

export interface SessionMetadata {
  id: string;
  status: SessionStatus;
  created_at: number;
  rows: number;
  cols: number;
}

export interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

export interface TerminalStatusEvent {
  session_id: string;
  status: SessionStatus;
  exit_code?: number;
  error?: string;
}

export const TERMINAL_OUTPUT_EVENT = "terminal:output";
export const TERMINAL_STATUS_EVENT = "terminal:status";

export async function createTerminalSession(cwd?: string): Promise<string> {
  const response = await safeInvoke<CreateSessionResponse>(
    "terminal_create_session",
    { cwd },
  );
  return response.session_id;
}

export function encodeBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  return btoa(String.fromCharCode(...bytes));
}

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function decodeBytes(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

export async function writeToTerminal(
  sessionId: string,
  data: string,
): Promise<void> {
  await safeInvoke("terminal_write", {
    sessionId,
    data: encodeBase64(data),
  });
}

export async function writeToTerminalRaw(
  sessionId: string,
  data: string,
): Promise<void> {
  await safeInvoke("terminal_write", {
    sessionId,
    data,
  });
}

export async function resizeTerminal(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  await safeInvoke("terminal_resize", {
    sessionId,
    rows,
    cols,
  });
}

export async function closeTerminal(sessionId: string): Promise<void> {
  await safeInvoke("terminal_close", {
    sessionId,
  });
}

export async function listTerminalSessions(): Promise<SessionMetadata[]> {
  return safeInvoke<SessionMetadata[]>("terminal_list_sessions");
}

export async function getTerminalSession(
  sessionId: string,
): Promise<SessionMetadata | null> {
  return safeInvoke<SessionMetadata | null>("terminal_get_session", {
    sessionId,
  });
}

export async function onTerminalOutput(
  callback: (event: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return safeListen<TerminalOutputEvent>(TERMINAL_OUTPUT_EVENT, (event) => {
    callback(event.payload);
  });
}

export async function onTerminalStatus(
  callback: (event: TerminalStatusEvent) => void,
): Promise<UnlistenFn> {
  return safeListen<TerminalStatusEvent>(TERMINAL_STATUS_EVENT, (event) => {
    callback(event.payload);
  });
}

export async function onSessionOutput(
  sessionId: string,
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return safeListen<TerminalOutputEvent>(TERMINAL_OUTPUT_EVENT, (event) => {
    if (event.payload.session_id === sessionId) {
      callback(decodeBase64(event.payload.data));
    }
  });
}

export async function onSessionStatus(
  sessionId: string,
  callback: (event: TerminalStatusEvent) => void,
): Promise<UnlistenFn> {
  return safeListen<TerminalStatusEvent>(TERMINAL_STATUS_EVENT, (event) => {
    if (event.payload.session_id === sessionId) {
      callback(event.payload);
    }
  });
}
