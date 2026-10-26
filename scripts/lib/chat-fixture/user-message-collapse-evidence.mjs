import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  sameInvokeTraceCollectorProvenance,
  validateInvokeTraceCollectorCapture,
} from "../invoke-trace-collector.mjs";

const INPUT_METHODS = new Set([
  "turn/start",
  "turn/steer",
  "thread/queue/add",
  "thread/queue/update",
  "thread/queue/delete",
  "thread/queue/reorder",
  "thread/queue/start",
]);

const CURRENT_COMMAND = "app_server_handle_json_lines";

const TRACE_LIMIT = 240;

export function collapseTextIdentity(text) {
  return typeof text === "string"
    ? {
        length: text.length,
        sha256: createHash("sha256").update(text).digest("hex"),
      }
    : null;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// The current transport parser is injected by the GUI helper. Validate its
// complete source first: a missing, saturated or malformed trace is no proof.
export function captureCollapseTraceBoundary(raw, parseRequests) {
  try {
    const entries = JSON.parse(raw);
    if (
      !Array.isArray(entries) ||
      entries.length === 0 ||
      entries.length >= TRACE_LIMIT ||
      typeof parseRequests !== "function"
    )
      throw new Error("incomplete trace");
    return captureTraceEntries(entries, parseRequests);
  } catch {
    return { complete: false, entryDigests: [], inputs: [] };
  }
}

function captureTraceEntries(entries, parseRequests) {
  const expectedRequests = [];
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.timestamp !== "string" ||
      typeof entry.command !== "string" ||
      typeof entry.transport !== "string" ||
      !["success", "error"].includes(entry.status) ||
      !Number.isFinite(entry.duration_ms)
    )
      throw new Error("invalid trace entry");
    if (entry.command !== CURRENT_COMMAND) continue;
    const lines = entry.args_preview?.request?.lines;
    if (!Array.isArray(lines) || lines.length === 0)
      throw new Error("missing request lines");
    for (const line of lines) {
      if (typeof line !== "string") throw new Error("invalid request line");
      const request = JSON.parse(line);
      // The current protocol emits { id, method, params } without a version
      // field. An explicitly supplied version must still identify 2.0.
      if (
        !request ||
        typeof request !== "object" ||
        Array.isArray(request) ||
        (Object.hasOwn(request, "jsonrpc") && request.jsonrpc !== "2.0") ||
        !Object.hasOwn(request, "id") ||
        !(
          (typeof request.id === "string" && request.id.length > 0) ||
          Number.isSafeInteger(request.id)
        ) ||
        typeof request.method !== "string" ||
        request.method.trim().length === 0
      )
        throw new Error("invalid JSON-RPC request");
      expectedRequests.push({
        command: entry.command,
        transport: entry.transport,
        status: entry.status,
        durationMs: entry.duration_ms,
        id: request.id,
        method: request.method,
        params: request.params ?? {},
      });
    }
  }
  const requests = parseRequests(JSON.stringify(entries));
  if (
    !Array.isArray(requests) ||
    !isDeepStrictEqual(requests, expectedRequests)
  )
    throw new Error("partial transport parse");
  return {
    complete: true,
    entryDigests: entries.map(digest),
    currentIpcOnly: entries
      .filter((entry) => entry.command === CURRENT_COMMAND)
      .every((entry) => entry.transport === "electron-ipc"),
    errorCount: entries.filter((entry) => entry.status === "error").length,
    inputs: requests
      .filter((request) => INPUT_METHODS.has(request.method))
      .map((request) => ({
        method: request.method,
        id: request.id,
        threadId: request.params?.threadId ?? null,
        clientId: request.params?.clientUserMessageId ?? null,
        digest: digest(request),
      })),
  };
}

export function captureContinuousTraceBoundary(capture, handle, parseRequests) {
  const observed = validateInvokeTraceCollectorCapture(capture, handle);
  if (!observed.complete || typeof parseRequests !== "function")
    return { complete: false, entryDigests: [], inputs: [], provenance: null };
  try {
    return {
      ...captureTraceEntries(observed.ledgerEntries, parseRequests),
      provenance: observed.provenance,
    };
  } catch {
    return {
      complete: false,
      entryDigests: [],
      inputs: [],
      provenance: observed.provenance,
    };
  }
}

function sameBoundaryProvenance(before, after) {
  if (before.provenance === undefined && after.provenance === undefined)
    return true;
  return sameInvokeTraceCollectorProvenance(
    before.provenance,
    after.provenance,
  );
}

function userItems(read) {
  return (read?.result?.thread?.turns ?? []).flatMap((turn) =>
    (turn.items ?? [])
      .filter((item) => item.type === "userMessage")
      .map((item) => ({ turnId: turn.id, item })),
  );
}

function expectedUser(read, expected) {
  return userItems(read).filter(
    ({ turnId, item }) =>
      turnId === expected.turnId && item.id === expected.itemId,
  );
}

function observedRead(read, expected) {
  const observation = read?.ipcObservation;
  return (
    observation?.electron === true &&
    observation.fallback === false &&
    observation.command === CURRENT_COMMAND &&
    observation.transport === "electron-ipc" &&
    observation.status === "success" &&
    observation.method === "thread/read" &&
    observation.params?.threadId === expected.threadId &&
    observation.params?.includeTurns === true &&
    typeof observation.requestId === "string" &&
    observation.requestId.length > 0 &&
    observation.responseId === observation.requestId &&
    read?.result?.thread?.id === expected.threadId &&
    Array.isArray(read.result.thread.turns) &&
    read.result.thread.turns.every(
      (turn) =>
        turn &&
        typeof turn.id === "string" &&
        turn.id.length > 0 &&
        Array.isArray(turn.items) &&
        turn.items.every(
          (item) =>
            item &&
            typeof item.type === "string" &&
            typeof item.id === "string" &&
            item.id.length > 0,
        ),
    )
  );
}

export function summarizeUserMessageCanonicalPreservation({
  expected,
  beforeRead,
  afterRead,
}) {
  const reads = [beforeRead, afterRead];
  const readsObserved = reads.every((read) => observedRead(read, expected));
  const beforeUsers = readsObserved ? expectedUser(beforeRead, expected) : [];
  const afterUsers = readsObserved ? expectedUser(afterRead, expected) : [];
  const beforeItem = beforeUsers[0]?.item;
  const afterItem = afterUsers[0]?.item;
  const text = Array.isArray(beforeItem?.content)
    ? beforeItem.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    : null;
  return {
    readsObserved,
    canonicalIdentity:
      beforeUsers.length === 1 &&
      afterUsers.length === 1 &&
      beforeItem?.clientId === expected.clientId &&
      afterItem?.clientId === expected.clientId &&
      reads.every(
        (read) =>
          userItems(read).filter(({ item }) => item.id === expected.itemId)
            .length === 1 &&
          userItems(read).filter(
            ({ item }) => item.clientId === expected.clientId,
          ).length === 1,
      ),
    canonicalFullText: typeof text === "string" && text === expected.text,
    canonicalPartsUnchanged:
      Array.isArray(beforeItem?.content) &&
      beforeItem.content.length > 0 &&
      isDeepStrictEqual(beforeItem.content, afterItem?.content) &&
      (expected.contentParts === undefined ||
        isDeepStrictEqual(beforeItem.content, expected.contentParts)),
    canonicalTextElementsUnchanged:
      Array.isArray(beforeItem?.content) &&
      isDeepStrictEqual(
        beforeItem.content.filter((part) => part.type === "text"),
        afterItem?.content?.filter((part) => part.type === "text"),
      ),
    canonicalUserItemsAndTurnsUnchanged:
      readsObserved &&
      isDeepStrictEqual(userItems(beforeRead), userItems(afterRead)) &&
      isDeepStrictEqual(
        beforeRead.result.thread.turns.map((turn) => turn.id),
        afterRead.result.thread.turns.map((turn) => turn.id),
      ),
  };
}

export function summarizeCollapseInputBoundary({
  traceBefore,
  traceAfter,
  expected = {},
}) {
  const baseline = traceBefore ?? {};
  const final = traceAfter ?? {};
  return {
    completeInputBoundary:
      baseline.complete === true &&
      final.complete === true &&
      sameBoundaryProvenance(baseline, final) &&
      baseline.currentIpcOnly === true &&
      final.currentIpcOnly === true &&
      baseline.errorCount === 0 &&
      final.errorCount === 0 &&
      final.entryDigests?.length >= baseline.entryDigests?.length &&
      isDeepStrictEqual(
        baseline.entryDigests,
        final.entryDigests?.slice(0, baseline.entryDigests.length),
      ),
    noAdditionalInput:
      baseline.complete === true &&
      final.complete === true &&
      sameBoundaryProvenance(baseline, final) &&
      isDeepStrictEqual(baseline.inputs, final.inputs),
    acceptedSubmissionBoundary:
      expected.requireAcceptedSubmission !== true ||
      baseline.inputs?.some(
        (input) =>
          input.method === "turn/start" &&
          input.threadId === expected.threadId &&
          input.clientId === expected.clientId,
      ) === true,
  };
}
