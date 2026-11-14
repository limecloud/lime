import { safeListen } from "@/lib/dev-bridge";

export const APP_MENU_WINDOW_EVENT = "lime-app-menu-command";
export const APP_MENU_HOST_EVENT = "app-menu-command";

export type AppMenuCommand = "settings" | "about";

function readCommand(value: unknown): AppMenuCommand | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const payload =
    record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : record;
  const command = payload.command;
  return command === "settings" || command === "about" ? command : null;
}

export function listenAppMenuCommand(
  handler: (command: AppMenuCommand) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let disposed = false;
  let hostUnlisten: (() => void) | null = null;

  const handleWindowEvent = (event: Event) => {
    if (disposed) return;
    const command = readCommand(
      event instanceof CustomEvent ? event.detail : null,
    );
    if (command) handler(command);
  };
  window.addEventListener(APP_MENU_WINDOW_EVENT, handleWindowEvent);

  void safeListen<{ command?: string }>(APP_MENU_HOST_EVENT, (event) => {
    if (disposed) return;
    const command = readCommand(event?.payload);
    if (command) handler(command);
  })
    .then((unlisten) => {
      if (disposed) unlisten();
      else hostUnlisten = unlisten;
    })
    .catch((error) => {
      console.warn("[app-menu] 监听应用菜单事件失败:", error);
    });

  return () => {
    disposed = true;
    window.removeEventListener(APP_MENU_WINDOW_EVENT, handleWindowEvent);
    hostUnlisten?.();
    hostUnlisten = null;
  };
}
