import { safeInvoke } from "@/lib/dev-bridge";

export interface ChromeCookieImportResult {
  imported: number;
  failed: number;
  total: number;
}

export async function importChromeBrowserCookies(): Promise<ChromeCookieImportResult> {
  const result = await safeInvoke<unknown>("browser_cookies_import_chrome");
  if (!result || typeof result !== "object") {
    throw new Error("browser cookie import returned an invalid result");
  }
  const record = result as {
    imported?: unknown;
    failed?: unknown;
    total?: unknown;
  };
  if (
    typeof record.imported !== "number" ||
    typeof record.failed !== "number" ||
    typeof record.total !== "number"
  ) {
    throw new Error("browser cookie import returned an invalid result");
  }
  return {
    imported: record.imported,
    failed: record.failed,
    total: record.total,
  };
}
