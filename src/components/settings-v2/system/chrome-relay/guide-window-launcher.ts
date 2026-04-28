import {
  openBrowserConnectorGuideWindow as openBrowserConnectorGuideWindowCommand,
  type BrowserConnectorGuideMode,
} from "@/lib/webview-api";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

export type { BrowserConnectorGuideMode };

const GUIDE_ROUTE = "/browser-connector-guide";

export function buildBrowserConnectorGuideUrl(
  mode: BrowserConnectorGuideMode,
): string {
  return `${GUIDE_ROUTE}?mode=${encodeURIComponent(mode)}`;
}

export async function openBrowserConnectorGuideWindow({
  mode,
}: {
  mode: BrowserConnectorGuideMode;
}): Promise<void> {
  if (hasTauriInvokeCapability()) {
    await openBrowserConnectorGuideWindowCommand({ mode });
    return;
  }

  if (typeof window !== "undefined") {
    window.open(
      buildBrowserConnectorGuideUrl(mode),
      "_blank",
      "noopener,noreferrer",
    );
  }
}
