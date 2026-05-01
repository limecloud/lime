import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

const WINDOW_DRAG_INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='slider']",
  "[role='switch']",
  "[tabindex]:not([tabindex='-1'])",
  "[data-tauri-no-drag]",
  "[data-lime-no-window-drag]",
].join(",");

interface WindowDragMouseEventLike {
  button: number;
  currentTarget: EventTarget | null;
  defaultPrevented?: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
}

interface StartWindowDragOptions {
  allowDescendantTargets?: boolean;
  source?: string;
}

function resolveTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

export function isWindowDragInteractiveTarget(
  target: EventTarget | null,
): boolean {
  return Boolean(
    resolveTargetElement(target)?.closest(WINDOW_DRAG_INTERACTIVE_SELECTOR),
  );
}

export function shouldStartWindowDragFromMouseEvent(
  event: WindowDragMouseEventLike,
  options: StartWindowDragOptions = {},
): boolean {
  if (!hasTauriInvokeCapability() || event.defaultPrevented) {
    return false;
  }

  if (event.button !== 0) {
    return false;
  }

  if (
    options.allowDescendantTargets === false &&
    event.target !== event.currentTarget
  ) {
    return false;
  }

  return !isWindowDragInteractiveTarget(event.target);
}

export async function startWindowDragFromMouseEvent(
  event: WindowDragMouseEventLike,
  options: StartWindowDragOptions = {},
): Promise<boolean> {
  if (!shouldStartWindowDragFromMouseEvent(event, options)) {
    return false;
  }

  event.preventDefault();

  try {
    await getCurrentWindow().startDragging();
    return true;
  } catch (error) {
    console.warn(
      `[窗口] 启动主窗口拖拽失败: ${options.source ?? "unknown"}`,
      error,
    );
    return false;
  }
}
