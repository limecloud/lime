import type { EmbeddedBrowserNativeView } from "./embeddedBrowserHost";
import { asRecord, readRequiredString } from "./browserTabState";

export function focusBrowserTabPage(
  native: EmbeddedBrowserNativeView,
  selected: boolean,
  args: unknown,
): void {
  const viewId = readRequiredString(args, "viewId");
  const webContentsId = asRecord(args)?.webContentsId;
  if (
    typeof webContentsId !== "number" ||
    !Number.isInteger(webContentsId) ||
    webContentsId <= 0
  ) {
    throw new Error("Browser webContentsId must be a positive integer");
  }
  const { window, view } = native;
  if (native.state.viewId !== viewId || view.webContents.id !== webContentsId) {
    throw new Error("Browser page focus targets a stale native view");
  }
  if (
    !selected ||
    window.isDestroyed() ||
    view.webContents.isDestroyed() ||
    !view.getVisible() ||
    !window.contentView.children.includes(view) ||
    !window.webContents.isFocused()
  )
    return;
  view.webContents.focus();
}
