import { readArray, readRecord, readString, sanitizeJson } from "./utils.mjs";

export function readModelLatestTurnStatus(readModel) {
  const turns = collectReadModelTurns(readModel);
  return (
    turns.at(-1)?.status ??
    readModel?.detail?.thread_read?.runtime_summary?.latestTurnStatus ??
    readModel?.detail?.threadRead?.runtimeSummary?.latestTurnStatus ??
    readModel?.detail?.thread_read?.status ??
    readModel?.detail?.threadRead?.status ??
    readModel?.detail?.status ??
    null
  );
}

export function collectReadModelTurns(readModel) {
  const detail = readRecord(readModel?.detail) ?? readRecord(readModel) ?? {};
  const thread = readRecord(readModel?.thread) ?? {};
  const threadRead =
    readRecord(detail.thread_read) ?? readRecord(detail.threadRead) ?? {};
  return [
    ...readArray(readModel, "turns"),
    ...readArray(thread, "turns"),
    ...readArray(detail, "turns"),
    ...readArray(threadRead, "turns"),
  ]
    .map((turn) => readRecord(turn))
    .filter(Boolean);
}

export function collectReadModelItems(readModel) {
  const detail = readRecord(readModel?.detail) ?? readRecord(readModel) ?? {};
  const canonicalTurnItems = collectReadModelTurns(readModel).flatMap((turn) =>
    readArray(turn, "items"),
  );
  const threadRead =
    readRecord(detail.thread_read) ?? readRecord(detail.threadRead) ?? {};
  return [
    ...readArray(readModel, "items"),
    ...readArray(readModel, "thread_items", "threadItems"),
    ...canonicalTurnItems,
    ...readArray(detail, "items"),
    ...readArray(detail, "thread_items", "threadItems"),
    ...readArray(threadRead, "items"),
    ...readArray(threadRead, "thread_items", "threadItems"),
  ]
    .map((item) => readRecord(item))
    .filter(Boolean);
}

export function readModelQueuedTurns(readModel) {
  const detail = readRecord(readModel?.detail) ?? readRecord(readModel) ?? {};
  const threadRead =
    readRecord(detail.thread_read) ?? readRecord(detail.threadRead) ?? {};
  return [
    ...readArray(readModel, "queued_turns", "queuedTurns"),
    ...readArray(detail, "queued_turns", "queuedTurns"),
    ...readArray(threadRead, "queued_turns", "queuedTurns"),
  ]
    .map((turn) => readRecord(turn))
    .filter(Boolean);
}

export function readModelQueuedTurnId(value) {
  return readString(
    value,
    "queued_turn_id",
    "queuedTurnId",
    "turn_id",
    "turnId",
  );
}

export function readModelQueuedTurnText(value) {
  return readString(
    value,
    "message_text",
    "messageText",
    "message_preview",
    "messagePreview",
    "text",
  );
}

export function summarizeReadModelQueueState(readModel) {
  const detail = readRecord(readModel?.detail) ?? readRecord(readModel) ?? {};
  const thread = readRecord(readModel?.thread) ?? {};
  const threadRead =
    readRecord(detail.thread_read) ?? readRecord(detail.threadRead) ?? {};
  return sanitizeJson({
    sessionId:
      readString(thread, "sessionId", "session_id") ??
      readString(readModel?.session, "session_id", "sessionId"),
    threadId:
      readString(thread, "id") ??
      readString(threadRead, "thread_id", "threadId") ??
      readString(detail, "thread_id", "threadId"),
    detailStatus: readString(detail, "status"),
    threadStatus: readString(threadRead, "status"),
    activeTurnId: readString(threadRead, "active_turn_id", "activeTurnId"),
    latestTurnStatus:
      readString(threadRead?.diagnostics, "latest_turn_status") ??
      readString(threadRead?.runtime_summary, "latestTurnStatus"),
    queuedTurns: readModelQueuedTurns(readModel).map((queuedTurn) => ({
      turnId: readModelQueuedTurnId(queuedTurn),
      status: readModelTurnStatus(queuedTurn),
      text: readModelQueuedTurnText(queuedTurn),
    })),
    turns: collectReadModelTurns(readModel).map((turn) => ({
      turnId: readModelTurnId(turn),
      status: readModelTurnStatus(turn),
    })),
    items: collectReadModelItems(readModel).map((item) => ({
      itemId: readString(item, "item_id", "itemId", "id"),
      turnId: readModelScopedTurnId(item),
      type: readString(item, "type", "item_type", "itemType"),
    })),
  });
}

export function readModelTurnId(value) {
  return readString(value, "turn_id", "turnId", "runtimeTurnId", "id");
}

export function readModelScopedTurnId(value) {
  return readString(value, "turn_id", "turnId", "runtimeTurnId");
}

export function readModelTurnStatus(value) {
  return readString(value, "status", "native_status", "nativeStatus");
}
