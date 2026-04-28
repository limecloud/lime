import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

export type BrowserConnectorGuideMode = "extension" | "cdp";

const GUIDE_ROUTE = "/browser-connector-guide";
const GUIDE_WINDOW_LABEL = "browser-connector-guide";

export function buildBrowserConnectorGuideUrl(
  mode: BrowserConnectorGuideMode,
): string {
  return `${GUIDE_ROUTE}?mode=${encodeURIComponent(mode)}`;
}

async function openTauriGuideWindow(
  mode: BrowserConnectorGuideMode,
  url: string,
): Promise<boolean> {
  if (!hasTauriInvokeCapability()) {
    return false;
  }

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `${GUIDE_WINDOW_LABEL}-${mode}`;
    const existingWindow = await WebviewWindow.getByLabel(label).catch(
      () => null,
    );

    if (existingWindow) {
      await existingWindow.show().catch(() => undefined);
      await existingWindow.setFocus().catch(() => undefined);
      return true;
    }

    const guideWindow = new WebviewWindow(label, {
      url,
      title: mode === "extension" ? "浏览器扩展连接引导" : "浏览器直连配置引导",
      width: 900,
      height: 700,
      minWidth: 760,
      minHeight: 560,
      center: true,
      visible: true,
      focus: true,
      resizable: true,
      decorations: true,
    });

    await Promise.race([
      new Promise<void>((resolve) => {
        void guideWindow.once("tauri://created", () => resolve());
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 160)),
    ]);
    return true;
  } catch (error) {
    console.warn("[连接器引导] 打开独立窗口失败，回退到浏览器窗口:", error);
    return false;
  }
}

export async function openBrowserConnectorGuideWindow({
  mode,
}: {
  mode: BrowserConnectorGuideMode;
}): Promise<void> {
  const url = buildBrowserConnectorGuideUrl(mode);
  const openedInTauri = await openTauriGuideWindow(mode, url);

  if (!openedInTauri && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
