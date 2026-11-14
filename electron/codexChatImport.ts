import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Codex rollout (`~/.codex/sessions/**\/rollout-*.jsonl`) reader.
 *
 * This parser deliberately exposes only user/assistant message text and the
 * source turn boundaries. Provider credentials, shell commands, tool outputs,
 * reasoning payloads and encrypted content never leave this module.
 */

export type CodexChatRole = "user" | "assistant";
export type CodexChatTurnStatus = "completed" | "interrupted" | "failed";

export interface CodexChatMessage {
  role: CodexChatRole;
  text: string;
  createdAt: number;
  sourceItemId?: string;
}

export interface CodexChatTurn {
  sourceTurnId: string;
  status: CodexChatTurnStatus;
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
  /** The listing scan stopped before the end of the rollout. */
  truncated: boolean;
  /** Truncated or oversized conversations must not be imported implicitly. */
  importable: boolean;
}

export interface CodexChatConversationDetail extends CodexChatConversation {
  turns: CodexChatTurn[];
  skippedMessageCount: number;
}

export type CodexChatImportErrorCode =
  | "not_found"
  | "invalid_path"
  | "too_large";

export class CodexChatImportError extends Error {
  readonly code: CodexChatImportErrorCode;

  constructor(code: CodexChatImportErrorCode, message: string) {
    super(message);
    this.name = "CodexChatImportError";
    this.code = code;
  }
}

const SESSION_ROOT_SEGMENTS = [".codex", "sessions"] as const;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 20;
const DEFAULT_LIST_SCAN_BYTES = 2 * 1024 * 1024;
const DEFAULT_READ_SCAN_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_MESSAGES = 5000;
const MAX_MESSAGE_TEXT_CHARS = 200_000;

// These user-role messages are prompt scaffolding injected by Codex, not text
// the person typed. They are omitted rather than rendered as fake user turns.
const CONTEXT_USER_PREFIXES = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<user_instructions>",
  "<skills_instructions>",
  "<permissions instructions>",
  "<collaboration_mode>",
  "<multi_agent_role>",
  "<multi_agent_mode>",
  "<hook_prompt",
];

interface ScannedTurn {
  sourceTurnId: string;
  status: CodexChatTurnStatus;
  startedAt?: number;
  completedAt?: number;
  messages: CodexChatMessage[];
  inferred: boolean;
}

interface ScanState {
  id?: string;
  createdAt?: number;
  lastTimestamp?: number;
  cwd?: string;
  title?: string;
  turns: ScannedTurn[];
  currentTurn: ScannedTurn | null;
  messageCount: number;
  skippedMessageCount: number;
  explicitTurnEvents: boolean;
  nextInferredTurn: number;
  malformedLines: number;
}

export interface ScanCodexRolloutOptions {
  maxBytes: number;
  maxMessages: number;
  collectMessages: boolean;
}

export interface ScannedCodexRollout {
  conversation: CodexChatConversationDetail;
  truncated: boolean;
}

export interface ListCodexChatsOptions {
  home?: string;
  limit?: number;
  maxBytesPerConversation?: number;
  maxMessagesPerConversation?: number;
}

export interface ListCodexChatsResult {
  conversations: CodexChatConversation[];
  scannedFileCount: number;
  totalFileCount: number;
}

export async function listCodexChats({
  home = homedir(),
  limit = DEFAULT_LIST_LIMIT,
  maxBytesPerConversation = DEFAULT_LIST_SCAN_BYTES,
  maxMessagesPerConversation = 200,
}: ListCodexChatsOptions = {}): Promise<ListCodexChatsResult> {
  const root = path.join(home, ...SESSION_ROOT_SEGMENTS);
  const files = await listRolloutFiles(root);
  const boundedLimit = Math.max(
    1,
    Math.min(MAX_LIST_LIMIT, Math.floor(limit) || DEFAULT_LIST_LIMIT),
  );
  const recent = files
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, boundedLimit);
  const conversations: CodexChatConversation[] = [];
  for (const file of recent) {
    try {
      const scanned = await scanCodexRollout(file.path, {
        maxBytes: maxBytesPerConversation,
        maxMessages: maxMessagesPerConversation,
        collectMessages: false,
      });
      const conversation = scanned.conversation;
      if (conversation.messageCount === 0) continue;
      conversations.push({
        ...toConversationSummary(conversation),
        updatedAt: Math.max(conversation.updatedAt, file.modifiedAt),
        truncated: scanned.truncated,
        importable: !scanned.truncated,
      });
    } catch (error) {
      if (error instanceof CodexChatImportError && error.code === "not_found") {
        continue;
      }
      throw error;
    }
  }
  conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  return {
    conversations,
    scannedFileCount: recent.length,
    totalFileCount: files.length,
  };
}

export async function readCodexChat({
  home = homedir(),
  sourcePath,
  maxBytes = DEFAULT_READ_SCAN_BYTES,
  maxMessages = DEFAULT_MAX_MESSAGES,
}: {
  home?: string;
  sourcePath: string;
  maxBytes?: number;
  maxMessages?: number;
}): Promise<CodexChatConversationDetail> {
  const resolved = await resolveSessionPath(home, sourcePath);
  const scanned = await scanCodexRollout(resolved, {
    maxBytes,
    maxMessages,
    collectMessages: true,
  });
  const conversation = scanned.conversation;
  if (scanned.truncated) {
    throw new CodexChatImportError(
      "too_large",
      "Codex conversation exceeds the safe import scan limit",
    );
  }
  if (conversation.messageCount === 0) {
    throw new CodexChatImportError(
      "not_found",
      "Codex conversation has no user or assistant messages",
    );
  }
  const oversizedMessage = conversation.turns
    .flatMap((turn) => turn.messages)
    .find((message) => message.text.length > MAX_MESSAGE_TEXT_CHARS);
  if (oversizedMessage) {
    throw new CodexChatImportError(
      "too_large",
      "Codex conversation contains a message above the safe import limit",
    );
  }
  return conversation;
}

export async function resolveSessionPath(
  home: string,
  sourcePath: string,
): Promise<string> {
  if (!path.isAbsolute(sourcePath) || path.extname(sourcePath) !== ".jsonl") {
    throw new CodexChatImportError(
      "invalid_path",
      "Codex conversation path must be an absolute .jsonl file",
    );
  }
  const root = path.join(home, ...SESSION_ROOT_SEGMENTS);
  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(root).catch(() => null),
    realpath(sourcePath).catch(() => null),
  ]);
  if (!resolvedRoot || !resolvedFile) {
    throw new CodexChatImportError("not_found", "Codex conversation not found");
  }
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !relative.endsWith(".jsonl")
  ) {
    throw new CodexChatImportError(
      "invalid_path",
      "Codex conversation is outside the sessions directory",
    );
  }
  return resolvedFile;
}

export async function scanCodexRollout(
  filePath: string,
  options: ScanCodexRolloutOptions,
): Promise<ScannedCodexRollout> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new CodexChatImportError("not_found", "Codex conversation not found");
  }
  const state: ScanState = {
    turns: [],
    currentTurn: null,
    messageCount: 0,
    skippedMessageCount: 0,
    explicitTurnEvents: false,
    nextInferredTurn: 1,
    malformedLines: 0,
  };
  let bytes = 0;
  let lineLimitHit = false;
  const maxBytes = Math.max(1, options.maxBytes);
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    end: Math.max(0, Math.min(fileStat.size, maxBytes) - 1),
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line, "utf8") + 1;
      if (bytes > maxBytes) {
        lineLimitHit = true;
        break;
      }
      if (
        options.collectMessages &&
        state.messageCount >= options.maxMessages
      ) {
        lineLimitHit = true;
        break;
      }
      handleRolloutLine(state, line, options.collectMessages);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  closeCurrentTurn(
    state,
    "completed",
    state.lastTimestamp ?? state.currentTurn?.startedAt,
  );
  const id = state.id || fallbackConversationId(filePath);
  const createdAt =
    state.createdAt ?? state.turns[0]?.startedAt ?? fileStat.birthtimeMs;
  const updatedAt =
    state.lastTimestamp ??
    state.turns[state.turns.length - 1]?.completedAt ??
    fileStat.mtimeMs;
  const title =
    state.title?.trim() ||
    state.turns
      .flatMap((turn) => turn.messages)
      .find((message) => message.role === "user")
      ?.text.trim() ||
    fallbackTitle(state.cwd, id);
  const truncated =
    lineLimitHit ||
    fileStat.size > maxBytes ||
    (options.collectMessages && state.messageCount >= options.maxMessages);
  const conversation: CodexChatConversationDetail = {
    id,
    title: truncate(title, 120),
    sourcePath: filePath,
    createdAt,
    updatedAt,
    messageCount: state.messageCount,
    turnCount: state.turns.filter((turn) => turn.messages.length > 0).length,
    ...(state.cwd ? { cwd: state.cwd } : {}),
    truncated,
    importable: !truncated,
    skippedMessageCount: state.skippedMessageCount,
    turns: state.turns
      .filter((turn) => turn.messages.length > 0)
      .map((turn) => ({
        sourceTurnId: turn.sourceTurnId,
        status: turn.status,
        ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
        ...(turn.completedAt !== undefined
          ? { completedAt: turn.completedAt }
          : {}),
        messages: turn.messages,
      })),
  };
  return { conversation, truncated };
}

function handleRolloutLine(
  state: ScanState,
  line: string,
  collectMessages: boolean,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      state.malformedLines += 1;
      return;
    }
    record = parsed as Record<string, unknown>;
  } catch {
    state.malformedLines += 1;
    return;
  }
  const lineTimestamp = parseTimestamp(record.timestamp);
  if (lineTimestamp !== undefined) {
    state.lastTimestamp = Math.max(state.lastTimestamp ?? 0, lineTimestamp);
  }
  const type = typeof record.type === "string" ? record.type : "";
  const payload = asRecord(record.payload);
  if (!payload) return;
  if (type === "session_meta") {
    handleSessionMeta(state, payload, lineTimestamp);
    return;
  }
  if (type === "event_msg") {
    handleEventMessage(state, payload, lineTimestamp);
    return;
  }
  if (type === "response_item") {
    handleResponseItem(state, payload, lineTimestamp, collectMessages);
  }
}

function handleSessionMeta(
  state: ScanState,
  payload: Record<string, unknown>,
  lineTimestamp: number | undefined,
): void {
  const id = readString(payload.id) ?? readString(payload.session_id);
  if (id) state.id = id;
  const createdAt = parseTimestamp(payload.timestamp) ?? lineTimestamp;
  if (createdAt !== undefined) state.createdAt = createdAt;
  const cwd = readString(payload.cwd);
  if (cwd) state.cwd = cwd;
}

function handleEventMessage(
  state: ScanState,
  payload: Record<string, unknown>,
  lineTimestamp: number | undefined,
): void {
  const eventType = readString(payload.type);
  if (eventType === "task_started") {
    const turnId = readString(payload.turn_id);
    if (!turnId) return;
    state.explicitTurnEvents = true;
    const startedAt = parseTimestamp(payload.started_at) ?? lineTimestamp;
    openTurn(state, turnId, startedAt, false);
    return;
  }
  if (eventType === "task_complete" || eventType === "turn_aborted") {
    const turnId = readString(payload.turn_id);
    const completedAt = parseTimestamp(payload.completed_at) ?? lineTimestamp;
    closeCurrentTurn(
      state,
      eventType === "turn_aborted" ? "interrupted" : "completed",
      completedAt,
      turnId,
    );
  }
}

function handleResponseItem(
  state: ScanState,
  payload: Record<string, unknown>,
  lineTimestamp: number | undefined,
  collectMessages: boolean,
): void {
  if (payload.type !== "message") return;
  const role = payload.role;
  if (role !== "user" && role !== "assistant") return;
  const text = extractMessageText(payload.content);
  if (!text) {
    state.skippedMessageCount += 1;
    return;
  }
  if (role === "user" && isContextUserMessage(text)) {
    state.skippedMessageCount += 1;
    return;
  }
  const createdAt = lineTimestamp ?? state.lastTimestamp ?? Date.now();
  if (!state.title && role === "user") {
    state.title = normalizeTitle(text);
  }
  ensureTurn(state, createdAt);
  const message: CodexChatMessage = {
    role,
    text: truncate(text, MAX_MESSAGE_TEXT_CHARS),
    createdAt,
  };
  const sourceItemId = readString(payload.id);
  if (sourceItemId) message.sourceItemId = sourceItemId;
  state.currentTurn?.messages.push(message);
  state.messageCount += 1;
  if (!collectMessages && state.messageCount >= 1) {
    // Listing only needs counts and a title; text is retained for the title
    // and dropped once the message is recorded.
    message.text = "";
  }
}

function openTurn(
  state: ScanState,
  sourceTurnId: string,
  startedAt: number | undefined,
  inferred: boolean,
): void {
  closeCurrentTurn(state, "completed", startedAt, undefined, true);
  const turn: ScannedTurn = {
    sourceTurnId,
    status: "completed",
    messages: [],
    inferred,
  };
  if (startedAt !== undefined) turn.startedAt = startedAt;
  state.currentTurn = turn;
  state.turns.push(turn);
}

function ensureTurn(state: ScanState, timestamp: number): void {
  if (!state.currentTurn) {
    if (!state.explicitTurnEvents) {
      openTurn(
        state,
        `inferred-turn-${state.nextInferredTurn}`,
        timestamp,
        true,
      );
      state.nextInferredTurn += 1;
      return;
    }
    openTurn(
      state,
      `inferred-turn-${state.nextInferredTurn}-${timestamp}`,
      timestamp,
      true,
    );
    state.nextInferredTurn += 1;
    return;
  }
  if (
    !state.explicitTurnEvents &&
    state.currentTurn.messages.some((message) => message.role === "assistant")
  ) {
    openTurn(state, `inferred-turn-${state.nextInferredTurn}`, timestamp, true);
    state.nextInferredTurn += 1;
  }
}

function closeCurrentTurn(
  state: ScanState,
  status: CodexChatTurnStatus,
  completedAt: number | undefined,
  turnId?: string,
  _onlyCurrent = false,
): void {
  const turn = state.currentTurn;
  if (!turn) return;
  if (turnId && turn.sourceTurnId !== turnId) return;
  turn.status = status;
  if (completedAt !== undefined) turn.completedAt = completedAt;
  state.currentTurn = null;
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;
    const type = readString(record.type);
    const text = readString(record.text);
    if (
      text &&
      (type === "input_text" || type === "output_text" || type === "text")
    ) {
      parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function isContextUserMessage(text: string): boolean {
  const normalized = text.trimStart();
  return CONTEXT_USER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fallbackTitle(cwd: string | undefined, id: string): string {
  if (cwd) {
    const basename = cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop();
    if (basename) return basename;
  }
  return id;
}

function fallbackConversationId(filePath: string): string {
  return path.basename(filePath, ".jsonl");
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed)) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function toConversationSummary(
  conversation: CodexChatConversationDetail,
): CodexChatConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    sourcePath: conversation.sourcePath,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageCount,
    turnCount: conversation.turnCount,
    ...(conversation.cwd ? { cwd: conversation.cwd } : {}),
    truncated: conversation.truncated,
    importable: conversation.importable,
  };
}

async function listRolloutFiles(
  root: string,
): Promise<Array<{ path: string; modifiedAt: number }>> {
  const files: Array<{ path: string; modifiedAt: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const info = await stat(child);
          files.push({ path: child, modifiedAt: info.mtimeMs });
        } catch {
          // Ignore a session file that disappeared during the scan.
        }
      }
    }
  };
  await visit(root);
  return files;
}
