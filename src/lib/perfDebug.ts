export const EDITOR_PERF_DEBUG_KEY = "lime:editor-perf-debug";
export const INPUT_LATENCY_DEBUG_KEY = "lime:input-latency-debug";

interface RenderPerfPayload {
  [key: string]: string | number | boolean | null | undefined;
}

export function isEditorPerfDebugEnabled(): boolean {
  return isDebugFlagEnabled(EDITOR_PERF_DEBUG_KEY);
}

export function isInputLatencyDebugEnabled(): boolean {
  return isDebugFlagEnabled(INPUT_LATENCY_DEBUG_KEY);
}

export function isDebugFlagEnabled(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function logRenderPerf(
  component: string,
  renderCount: number,
  sinceLastCommitMs: number | null,
  payload: RenderPerfPayload,
): void {
  if (!isEditorPerfDebugEnabled()) {
    return;
  }
  const shouldLog =
    renderCount <= 5 ||
    renderCount % 20 === 0 ||
    (sinceLastCommitMs !== null && sinceLastCommitMs < 8);
  if (!shouldLog) {
    return;
  }
  console.debug(
    `[RenderPerf] ${component}`,
    JSON.stringify({
      renderCount,
      sinceLastCommitMs:
        sinceLastCommitMs === null
          ? null
          : Number(sinceLastCommitMs.toFixed(2)),
      ...payload,
    }),
  );
}
