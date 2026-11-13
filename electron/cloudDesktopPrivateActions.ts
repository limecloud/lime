import { METHOD_CLOUD_DESKTOP } from "@limecloud/app-server-client";

const privateActions = new Set([
  "sealModelConnection",
  "prepareRuntimeDistribution",
  "readRuntimeDistribution",
  "signRuntimeDistribution",
  "cleanupRuntimeDistribution",
]);

/** Validate the entire Renderer submission before forwarding any of its lines. */
export function assertRendererCloudDesktopAccess(
  lines: readonly string[],
): void {
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.method !== METHOD_CLOUD_DESKTOP) return;
    const params = message.params as { action?: unknown } | null;
    if (typeof params?.action === "string" && privateActions.has(params.action))
      throw new Error("CLOUD_RUNTIME_MAIN_ONLY");
  };
  for (const line of lines) inspect(JSON.parse(line));
}
