import { readTraceMessages } from "./rpc.mjs";
import { sleep } from "./utils.mjs";

const INVOKE_TRACE_BUFFER_KEY = "lime_invoke_trace_buffer_v1";

const ROUTINE_DRAIN_COMMAND = "app_server_drain_events";

export function mergeInvokeTraceEvidence(...batches) {
  const entries = [];
  const fingerprints = new Set();

  for (const batch of batches) {
    for (const entry of Array.isArray(batch) ? batch : []) {
      if (!entry || typeof entry !== "object" || isRoutineDrain(entry)) {
        continue;
      }
      const fingerprint = JSON.stringify(entry);
      if (fingerprints.has(fingerprint)) {
        continue;
      }
      fingerprints.add(fingerprint);
      entries.push(entry);
    }
  }

  return entries;
}

export function startInvokeTraceEvidenceCollector(
  page,
  { intervalMs = 500 } = {},
) {
  let active = true;
  let collected = [];
  let stopPromise = null;

  const collect = async () => {
    try {
      const traceRaw = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        INVOKE_TRACE_BUFFER_KEY,
      );
      collected = mergeInvokeTraceEvidence(
        collected,
        readTraceMessages(traceRaw),
      );
    } catch {
      // Navigation can briefly invalidate the renderer execution context.
    }
  };

  const loop = (async () => {
    while (active) {
      await collect();
      if (active) {
        await sleep(intervalMs);
      }
    }
  })();

  return {
    snapshot() {
      return [...collected];
    },
    stop() {
      if (!stopPromise) {
        active = false;
        stopPromise = loop.then(async () => {
          await collect();
          return [...collected];
        });
      }
      return stopPromise;
    },
  };
}

function isRoutineDrain(entry) {
  return (
    entry.command === ROUTINE_DRAIN_COMMAND &&
    entry.transport === "electron-ipc" &&
    entry.status === "success"
  );
}
