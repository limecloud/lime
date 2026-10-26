import { readJsonl, sanitizeJson, sleep } from "./utils.mjs";

export function sanitizeBackendLedgerForEvidence(backendLedger) {
  return backendLedger.map((entry) => {
    if (entry?.kind === "turnStart") {
      return sanitizeJson({
        kind: entry.kind,
        sessionId: entry.sessionId,
        turnId: entry.turnId,
        inputText: entry.inputText,
        providerPreference: entry.providerPreference,
        modelPreference: entry.modelPreference,
        runtimeModelPreference: entry.runtimeRequest?.modelPreference ?? null,
        runtimeReasoningEffort: entry.runtimeRequest?.reasoningEffort ?? null,
        collaborationMode: entry.runtimeRequest?.collaborationMode ?? null,
        recordedAt: entry.recordedAt,
      });
    }
    if (entry?.kind === "backendEmit") {
      return sanitizeJson({
        kind: entry.kind,
        sessionId: entry.sessionId,
        turnId: entry.turnId,
        eventCount: entry.eventCount,
        eventTypes: entry.eventTypes,
        recordedAt: entry.recordedAt,
      });
    }
    return sanitizeJson({
      kind: entry?.kind ?? null,
      sessionId: entry?.sessionId ?? null,
      turnId: entry?.turnId ?? null,
      recordedAt: entry?.recordedAt ?? null,
    });
  });
}

export async function waitForBackendLedgerEntry(filePath, predicate, options) {
  const startedAt = Date.now();
  let lastLedger = [];
  const timeoutMs = Math.min(options.timeoutMs, 10_000);
  while (Date.now() - startedAt < timeoutMs) {
    lastLedger = readJsonl(filePath);
    const matched = lastLedger.find(predicate);
    if (matched) {
      return { entry: matched, ledger: lastLedger };
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `external backend ledger 未记录预期事件: ${JSON.stringify(
      sanitizeBackendLedgerForEvidence(lastLedger),
    )}`,
  );
}

export async function waitForBackendLedgerTurnStart(
  filePath,
  inputText,
  options,
) {
  return waitForBackendLedgerEntry(
    filePath,
    (entry) => entry.kind === "turnStart" && entry.inputText === inputText,
    options,
  );
}

export function summarizeBackendLedger(backendLedger) {
  const turnStartEntries = backendLedger.filter(
    (entry) => entry.kind === "turnStart",
  );
  const turnCancelEntries = backendLedger.filter(
    (entry) => entry.kind === "turnCancel",
  );
  const backendEmitEntries = backendLedger.filter(
    (entry) => entry.kind === "backendEmit",
  );
  const latestTurnStart = turnStartEntries.at(-1) ?? null;
  const latestTurnCancel = turnCancelEntries.at(-1) ?? null;
  const latestTurnEmitEntries =
    latestTurnStart?.turnId == null
      ? []
      : backendEmitEntries.filter(
          (entry) => entry.turnId === latestTurnStart.turnId,
        );
  const latestTurnEmitTimes = latestTurnEmitEntries
    .map((entry) => Date.parse(entry.recordedAt))
    .filter((timestamp) => Number.isFinite(timestamp));
  const latestTurnEmitSpanMs =
    latestTurnEmitTimes.length >= 2
      ? Math.max(...latestTurnEmitTimes) - Math.min(...latestTurnEmitTimes)
      : 0;
  const runtimeRequest = latestTurnStart?.runtimeRequest ?? null;
  const collaborationMode = runtimeRequest?.collaborationMode?.mode ?? null;
  return {
    kinds: backendLedger.map((entry) => entry.kind),
    turnStartCount: turnStartEntries.length,
    turnCancelCount: turnCancelEntries.length,
    backendEmitCount: backendEmitEntries.length,
    latestTurnBackendEmitCount: latestTurnEmitEntries.length,
    latestTurnBackendEmitSpanMs: latestTurnEmitSpanMs,
    latestTurnBackendEmitTypes: latestTurnEmitEntries.map(
      (entry) => entry.eventTypes,
    ),
    latestTurnStart: latestTurnStart
      ? sanitizeJson({
          sessionId: latestTurnStart.sessionId,
          turnId: latestTurnStart.turnId,
          inputText: latestTurnStart.inputText,
          providerPreference: latestTurnStart.providerPreference,
          modelPreference: latestTurnStart.modelPreference,
          searchMode: runtimeRequest?.searchMode ?? null,
          webSearch: Object.prototype.hasOwnProperty.call(
            runtimeRequest || {},
            "webSearch",
          )
            ? runtimeRequest.webSearch
            : null,
          collaborationMode,
        })
      : null,
    latestTurnCancel: latestTurnCancel
      ? sanitizeJson({
          sessionId: latestTurnCancel.sessionId,
          turnId: latestTurnCancel.turnId,
        })
      : null,
  };
}
