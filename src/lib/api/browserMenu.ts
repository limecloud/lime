import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type { BrowserTabEventIdentity } from "./browserTab";
import type {
  BrowserMenuPresentation,
  BrowserOverlayCloseReason,
} from "../../../electron/browserOverlayModel";
export type {
  BrowserMenuItem,
  BrowserMenuPresentation,
} from "../../../electron/browserOverlayModel";

export interface BrowserMenuReceipt {
  menuId: string;
  generation: number;
  visible: boolean;
}

export interface BrowserMenuEvent extends BrowserTabEventIdentity {
  viewId: string;
  menuId: string;
  generation: number;
  reason: BrowserOverlayCloseReason;
  itemId?: string;
}

export async function showBrowserTabMenu(
  tabId: string,
  presentation: BrowserMenuPresentation,
): Promise<BrowserMenuReceipt> {
  const result = await safeInvoke<unknown>("browser_tab_show_menu", {
    tabId,
    ...presentation,
  });
  const receipt = result as BrowserMenuReceipt | null;
  if (
    !receipt ||
    receipt.menuId !== presentation.menuId ||
    !Number.isSafeInteger(receipt.generation) ||
    receipt.generation < 1 ||
    typeof receipt.visible !== "boolean"
  )
    throw new Error("Browser menu receipt is invalid");
  return receipt;
}

export async function hideBrowserTabOverlay(
  tabId: string,
  identity?: { menuId: string; generation?: number },
): Promise<void> {
  await safeInvoke("browser_tab_hide_overlay", { tabId, ...identity });
}

export async function updateBrowserTabMenu(
  tabId: string,
  menuId: string,
  generation: number,
  items: BrowserMenuPresentation["items"],
): Promise<void> {
  const result = await safeInvoke<BrowserMenuReceipt>(
    "browser_tab_update_menu",
    { tabId, menuId, generation, items },
  );
  if (
    result?.menuId !== menuId ||
    result.generation !== generation ||
    result.visible !== true
  )
    throw new Error("Browser menu update receipt is invalid");
}

export function listenBrowserMenuEvent(
  handler: (event: BrowserMenuEvent) => void,
): Promise<() => void> {
  const stops: Array<() => void> = [];
  const register = async (event: string, action: boolean) => {
    stops.push(
      await safeListen<unknown>(event, ({ payload }) => {
        assertMenuEvent(payload, action);
        handler(payload);
      }),
    );
  };
  return (async () => {
    try {
      await register("browser-tab-menu-action", true);
      await register("browser-tab-overlay-closed", false);
      return () => stops.forEach((stop) => stop());
    } catch (error) {
      stops.forEach((stop) => stop());
      throw error;
    }
  })();
}

function assertMenuEvent(
  value: unknown,
  action: boolean,
): asserts value is BrowserMenuEvent {
  if (!value || typeof value !== "object")
    throw new Error("Browser menu event is invalid");
  const event = value as BrowserMenuEvent;
  const strings = [
    event.browserSessionId,
    event.tabId,
    event.threadId,
    event.viewId,
    event.menuId,
  ];
  const ids = [
    event.ownerWebContentsId,
    event.windowId,
    event.webContentsId,
    event.generation,
  ];
  const reasons = [
    "action",
    "escape",
    "outside",
    "replaced",
    "owner",
    "hidden",
    "navigation",
  ];
  if (
    strings.some((value) => typeof value !== "string" || !value.trim()) ||
    ids.some((value) => !Number.isSafeInteger(value) || Number(value) < 1) ||
    !reasons.includes(event.reason) ||
    (action &&
      (event.reason !== "action" ||
        typeof event.itemId !== "string" ||
        !event.itemId.trim()))
  )
    throw new Error("Browser menu event identity is invalid");
}
