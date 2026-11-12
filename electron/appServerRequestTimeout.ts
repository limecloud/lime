import process from "node:process";
import { commandExecRequestTimeoutMs } from "../packages/app-server-client/src/command-exec-timeout";
import { cloudDesktopRequestTimeoutMs } from "../packages/app-server-client/src/cloud-desktop-timeout";

const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;
const APP_SERVER_BACKEND_TIMEOUT_GRACE_MS = 30_000;
const APP_SERVER_TURN_START_METHOD = "turn/start";
const APP_SERVER_REQUEST_TIMEOUT_OVERRIDE_CEILING_MS = 600_000;

export function parsePositiveInteger(
  value: string | undefined,
): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveAppServerRequestTimeoutMs(
  method: string,
  requestedTimeoutMs?: unknown,
  params?: unknown,
): number | undefined {
  if (method === "command/exec")
    return commandExecRequestTimeoutMs(params) || undefined;
  if (method === "cloud/desktop") {
    const timeout = cloudDesktopRequestTimeoutMs(params);
    if (timeout !== undefined) return timeout;
  }
  const defaultTimeoutMs = resolveDefaultAppServerRequestTimeoutMs(method);
  const overrideTimeoutMs = parsePositiveIntegerValue(requestedTimeoutMs);
  if (!overrideTimeoutMs) {
    return defaultTimeoutMs;
  }
  return Math.min(
    Math.max(defaultTimeoutMs, overrideTimeoutMs),
    APP_SERVER_REQUEST_TIMEOUT_OVERRIDE_CEILING_MS,
  );
}

function resolveDefaultAppServerRequestTimeoutMs(method: string): number {
  if (
    [
      "plugin/install",
      "plugin/reconcile",
    ].includes(method)
  )
    return 150_000;
  if (method !== APP_SERVER_TURN_START_METHOD) {
    return DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS;
  }
  const backendTimeoutMs = parsePositiveInteger(
    process.env.APP_SERVER_BACKEND_TIMEOUT_MS,
  );
  return backendTimeoutMs
    ? backendTimeoutMs + APP_SERVER_BACKEND_TIMEOUT_GRACE_MS
    : DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS;
}

function parsePositiveIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
