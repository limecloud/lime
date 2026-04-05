const IDLE_PRELOAD_TIMEOUT_MS = 1_500;
const IDLE_PRELOAD_FALLBACK_DELAY_MS = 180;

function shouldSkipIdleModulePreload(): boolean {
  return Boolean(import.meta.env?.MODE === "test" || import.meta.env?.VITEST);
}

export function scheduleIdleModulePreload(task: () => void): () => void {
  if (shouldSkipIdleModulePreload()) {
    return () => {};
  }

  if (typeof window === "undefined") {
    task();
    return () => {};
  }

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(task, {
      timeout: IDLE_PRELOAD_TIMEOUT_MS,
    });

    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(task, IDLE_PRELOAD_FALLBACK_DELAY_MS);

  return () => {
    window.clearTimeout(timeoutId);
  };
}
