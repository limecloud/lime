export const WINDOW_CLOSE_CONFIRMATION_EVENT = "window-close-confirmation";

export type ConfirmBeforeClose = "never" | "keyboardOnly" | "always";

export interface WindowCloseConfirmationRequest {
  requestId: string;
}

export interface WindowCloseConfirmationResult {
  confirmed: boolean;
  doNotAskAgain: boolean;
}

export interface WindowCloseConfirmationResponse
  extends WindowCloseConfirmationRequest, WindowCloseConfirmationResult {}
