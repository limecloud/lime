/**
 * Tauri event shim
 *
 * 在 Tauri dev 场景下通过 Vite alias 接管 `@tauri-apps/api/event`，
 * 允许 deep-link 等插件在事件 internals 尚未完全挂载时仍能安全完成注册与清理。
 */
import { invoke, transformCallback } from "@tauri-apps/api/core";

export type EventTarget =
  | { kind: "Any" }
  | { kind: "AnyLabel"; label: string }
  | { kind: "App" }
  | { kind: "Window"; label: string }
  | { kind: "Webview"; label: string }
  | { kind: "WebviewWindow"; label: string };

export interface Event<T> {
  event: EventName;
  id: number;
  payload: T;
}

export type EventCallback<T> = (event: Event<T>) => void;
export type UnlistenFn = () => void;
export type EventName = `${TauriEvent}` | (string & Record<never, never>);

export interface Options {
  target?: string | EventTarget;
}

export enum TauriEvent {
  WINDOW_RESIZED = "tauri://resize",
  WINDOW_MOVED = "tauri://move",
  WINDOW_CLOSE_REQUESTED = "tauri://close-requested",
  WINDOW_DESTROYED = "tauri://destroyed",
  WINDOW_FOCUS = "tauri://focus",
  WINDOW_BLUR = "tauri://blur",
  WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change",
  WINDOW_THEME_CHANGED = "tauri://theme-changed",
  WINDOW_CREATED = "tauri://window-created",
  WEBVIEW_CREATED = "tauri://webview-created",
  DRAG_ENTER = "tauri://drag-enter",
  DRAG_OVER = "tauri://drag-over",
  DRAG_DROP = "tauri://drag-drop",
  DRAG_LEAVE = "tauri://drag-leave",
}

async function _unlisten(event: string, eventId: number): Promise<void> {
  (
    window as Window & {
      __TAURI_EVENT_PLUGIN_INTERNALS__?: {
        unregisterListener: (event: string, eventId: number) => void;
      };
    }
  ).__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId,
  });
}

export async function listen<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: Options,
): Promise<UnlistenFn> {
  const target =
    typeof options?.target === "string"
      ? { kind: "AnyLabel" as const, label: options.target }
      : (options?.target ?? { kind: "Any" as const });

  const eventId = await invoke<number>("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler),
  });

  return () => {
    void _unlisten(event, eventId);
  };
}

export async function once<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: Options,
): Promise<UnlistenFn> {
  return listen<T>(
    event,
    (eventData) => {
      void _unlisten(event, eventData.id);
      handler(eventData);
    },
    options,
  );
}

export async function emit<T>(event: string, payload?: T): Promise<void> {
  await invoke("plugin:event|emit", {
    event,
    payload,
  });
}

export async function emitTo<T>(
  target: EventTarget | string,
  event: string,
  payload?: T,
): Promise<void> {
  const eventTarget =
    typeof target === "string"
      ? { kind: "AnyLabel" as const, label: target }
      : target;

  await invoke("plugin:event|emit_to", {
    target: eventTarget,
    event,
    payload,
  });
}
