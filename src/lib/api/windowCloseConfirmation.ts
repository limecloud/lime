import { getElectronHostBridge } from "@/lib/electron-host";
import {
  WINDOW_CLOSE_CONFIRMATION_EVENT,
  type WindowCloseConfirmationRequest,
  type WindowCloseConfirmationResponse,
} from "@/lib/desktop-host/windowCloseConfirmation";

export function canCloseWindow(): boolean {
  return Boolean(getElectronHostBridge()?.window);
}

export function listenWindowCloseConfirmation(
  handler: (request: WindowCloseConfirmationRequest) => void,
) {
  const bridge = getElectronHostBridge();
  if (!bridge?.window) return null;
  return Promise.resolve(
    bridge.listen<WindowCloseConfirmationRequest>(
      WINDOW_CLOSE_CONFIRMATION_EVENT,
      ({ payload }) => {
        if (typeof payload?.requestId === "string" && payload.requestId)
          handler(payload);
      },
    ),
  );
}

export function respondWindowCloseConfirmation(
  response: WindowCloseConfirmationResponse,
): Promise<void> {
  const bridge = getElectronHostBridge();
  if (!bridge?.window)
    return Promise.reject(
      new Error("Window close confirmation Host unavailable"),
    );
  return bridge.window.confirmClose(response);
}

export function requestWindowClose(): Promise<void> {
  const bridge = getElectronHostBridge();
  if (!bridge?.window)
    return Promise.reject(new Error("Window close Host unavailable"));
  return bridge.window.close(true);
}
