import { safeInvoke } from "@/lib/dev-bridge";

export interface BrowserExtensionSummary {
  id: string;
  name: string;
  version: string;
  manifestVersion: number | null;
  path: string;
  enabled: boolean;
}

function isExtensionSummary(value: unknown): value is BrowserExtensionSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.name === "string" &&
    typeof record.version === "string" &&
    typeof record.path === "string" &&
    typeof record.enabled === "boolean" &&
    (record.manifestVersion === null ||
      typeof record.manifestVersion === "number")
  );
}

function normalizeList(value: unknown): BrowserExtensionSummary[] {
  if (!Array.isArray(value) || !value.every(isExtensionSummary)) {
    throw new Error("browser extensions returned an invalid list");
  }
  return value;
}

export async function listBrowserExtensions(): Promise<
  BrowserExtensionSummary[]
> {
  const result = await safeInvoke<unknown>("browser_extensions_list");
  return normalizeList(result);
}

export async function loadBrowserExtension(
  path: string,
): Promise<BrowserExtensionSummary> {
  const result = await safeInvoke<unknown>("browser_extensions_load", { path });
  if (!isExtensionSummary(result)) {
    throw new Error("browser extension load returned an invalid result");
  }
  return result;
}

export async function removeBrowserExtension(id: string): Promise<void> {
  const result = await safeInvoke<unknown>("browser_extensions_remove", { id });
  if (result !== true) {
    throw new Error("browser extension remove failed");
  }
}

export async function setBrowserExtensionEnabled(
  id: string,
  enabled: boolean,
): Promise<BrowserExtensionSummary> {
  const result = await safeInvoke<unknown>("browser_extensions_set_enabled", {
    id,
    enabled,
  });
  if (!isExtensionSummary(result)) {
    throw new Error("browser extension update returned an invalid result");
  }
  return result;
}
