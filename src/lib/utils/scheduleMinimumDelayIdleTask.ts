interface ScheduleMinimumDelayIdleTaskOptions {
  minimumDelayMs?: number;
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 1_500;

export function scheduleMinimumDelayIdleTask(
  task: () => void,
  options: ScheduleMinimumDelayIdleTaskOptions = {},
): () => void {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  const minimumDelayMs = Math.max(0, options.minimumDelayMs ?? 0);
  const idleTimeoutMs = Math.max(
    0,
    options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
  );

  let cancelled = false;
  let idleId: number | null = null;
  const delayId = window.setTimeout(() => {
    if (cancelled) {
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) {
            task();
          }
        },
        { timeout: idleTimeoutMs },
      );
      return;
    }

    task();
  }, minimumDelayMs);

  return () => {
    cancelled = true;
    window.clearTimeout(delayId);
    if (idleId !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    }
  };
}
