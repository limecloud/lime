import { cloudDesktopRequestTimeoutMs } from "../../../packages/app-server-client/src/cloud-desktop-timeout";

/** Project archive budgets through the same IPC and HTTP bridge boundary. */
export function cloudDesktopBridgeTimeout(args: unknown): number | null {
  const lines = (args as { request?: { lines?: unknown } } | null)?.request
    ?.lines;
  if (!Array.isArray(lines)) return null;
  let timeout: number | null = null;
  for (const line of lines) {
    try {
      const request: unknown = JSON.parse(line);
      if (
        !request ||
        typeof request !== "object" ||
        !("id" in request) ||
        request.id == null ||
        !("method" in request) ||
        request.method !== "cloud/desktop"
      )
        continue;
      const next = cloudDesktopRequestTimeoutMs(
        "params" in request ? request.params : undefined,
      );
      if (next !== undefined) timeout = Math.max(timeout ?? 0, next);
    } catch {
      /* Invalid JSON remains the App Server's responsibility. */
    }
  }
  return timeout;
}
