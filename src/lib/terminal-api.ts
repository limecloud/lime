/**
 * @deprecated 终端 API 已迁移到 `@/lib/api/terminal`
 *
 * 当前文件仅保留兼容导出，避免旧调用方立刻失效。
 * 新代码请直接依赖 `@/lib/api/terminal`。
 */

export {
  closeTerminal,
  createTerminalSession,
  decodeBase64,
  decodeBytes,
  encodeBase64,
  getTerminalSession,
  listTerminalSessions,
  onSessionOutput,
  onSessionStatus,
  onTerminalOutput,
  onTerminalStatus,
  resizeTerminal,
  TERMINAL_OUTPUT_EVENT,
  TERMINAL_STATUS_EVENT,
  writeToTerminal,
  writeToTerminalRaw,
} from "@/lib/api/terminal";

export type {
  CreateSessionResponse,
  SessionMetadata,
  SessionStatus,
  TerminalOutputEvent,
  TerminalStatusEvent,
} from "@/lib/api/terminal";
