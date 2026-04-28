const MODULE_IMPORT_FAILURE_PATTERNS = [
  "Importing a module script failed",
  "Failed to fetch dynamically imported module",
] as const;

const DEFAULT_RETRY_DELAYS_MS = [120, 320] as const;

function isRetryableModuleImportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return MODULE_IMPORT_FAILURE_PATTERNS.some((pattern) =>
    error.message.includes(pattern),
  );
}

function waitForDelay(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export async function loadModuleWithRetry<TModule>(
  loader: () => Promise<TModule>,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<TModule> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      const nextDelayMs = retryDelaysMs[attempt];
      if (nextDelayMs === undefined || !isRetryableModuleImportFailure(error)) {
        throw error;
      }

      await waitForDelay(nextDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("模块加载失败");
}

export function loadAgentChatWorkspaceModule() {
  return loadModuleWithRetry(() => import("./AgentChatWorkspace"));
}

export function preloadAgentChatWorkspaceModule(): void {
  void loadAgentChatWorkspaceModule();
}
