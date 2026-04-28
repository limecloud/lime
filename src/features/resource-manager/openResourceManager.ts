import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import {
  buildResourceManagerSession,
  writeResourceManagerSession,
} from "./resourceManagerSession";
import type { OpenResourceManagerInput } from "./types";

export const RESOURCE_MANAGER_WINDOW_LABEL = "resource-manager";
export const RESOURCE_MANAGER_SESSION_EVENT = "lime:resource-manager-session";

function buildResourceManagerUrl(sessionId: string): string {
  return `/resource-manager?session=${encodeURIComponent(sessionId)}`;
}

function openResourceManagerFallback(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function openTauriResourceManagerWindow(params: {
  url: string;
  sessionId: string;
}): Promise<boolean> {
  if (!hasTauriInvokeCapability()) {
    return false;
  }

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existingWindow = await WebviewWindow.getByLabel(
      RESOURCE_MANAGER_WINDOW_LABEL,
    ).catch(() => null);

    if (existingWindow) {
      await existingWindow.emit(RESOURCE_MANAGER_SESSION_EVENT, {
        sessionId: params.sessionId,
      });
      await existingWindow.show().catch(() => undefined);
      await existingWindow.setFocus().catch(() => undefined);
      return true;
    }

    const resourceWindow = new WebviewWindow(RESOURCE_MANAGER_WINDOW_LABEL, {
      url: params.url,
      title: "Lime 资源管理器",
      width: 1240,
      height: 820,
      minWidth: 860,
      minHeight: 560,
      center: true,
      visible: true,
      focus: true,
      resizable: true,
      decorations: true,
    });

    await Promise.race([
      new Promise<void>((resolve) => {
        void resourceWindow.once("tauri://created", () => resolve());
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 160)),
    ]);
    return true;
  } catch (error) {
    console.warn("[资源管理器] 打开 Tauri 独立窗口失败，回退到浏览器窗口:", error);
    return false;
  }
}

export async function openResourceManager(
  input: OpenResourceManagerInput,
): Promise<string | null> {
  const session = buildResourceManagerSession(input);
  if (!session) {
    return null;
  }

  writeResourceManagerSession(session);
  const url = buildResourceManagerUrl(session.id);
  const openedInTauri = await openTauriResourceManagerWindow({
    url,
    sessionId: session.id,
  });

  if (!openedInTauri) {
    openResourceManagerFallback(url);
  }

  return session.id;
}
