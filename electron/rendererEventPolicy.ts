import { IPC_EMIT_CHANNEL } from "./ipcChannels";
import { WINDOW_CLOSE_CONFIRMATION_EVENT } from "../src/lib/desktop-host/windowCloseConfirmation";

/** Persisted-state acknowledgements are emitted only by their Main owner. */
export function canBroadcastRendererEvent(event: unknown): event is string {
  return (
    typeof event === "string" &&
    event !== "persisted-atom-update" &&
    event !== WINDOW_CLOSE_CONFIRMATION_EVENT
  );
}

type RendererEventListener = (
  sender: unknown,
  event: unknown,
  payload?: unknown,
) => void;

export function registerRendererEventHandler(
  ipc: { on(channel: string, listener: RendererEventListener): unknown },
  broadcast: (event: string, payload?: unknown) => void,
  route?: (sender: unknown, event: string, payload?: unknown) => boolean,
): void {
  ipc.on(IPC_EMIT_CHANNEL, (sender, event, payload) => {
    if (canBroadcastRendererEvent(event) && !route?.(sender, event, payload))
      broadcast(event, payload);
  });
}
