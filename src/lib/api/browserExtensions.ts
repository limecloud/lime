import { safeInvoke } from "@/lib/dev-bridge";

export interface BrowserExtensionSummary {
  id: string;
  name: string;
  version: string;
  manifestVersion: number | null;
  path: string;
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
