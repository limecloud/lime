import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import {
  WINDOW_CLOSE_CONFIRMATION_EVENT,
  type ConfirmBeforeClose,
  type WindowCloseConfirmationResult,
} from "../src/lib/desktop-host/windowCloseConfirmation";

interface CloseWindow {
  isDestroyed(): boolean;
  close(): void;
}

/** Shipped controller lifecycle; settings and transport adapt to the current Host. */
export class WindowCloseConfirmation<W extends CloseWindow> {
  readonly keyboardRequests = new WeakSet<W>();
  readonly approved = new WeakSet<W>();
  readonly pending = new WeakSet<W>();

  constructor(
    readonly options: {
      getPreference(): ConfirmBeforeClose;
      confirm(window: W): Promise<WindowCloseConfirmationResult>;
      disableConfirmation(): Promise<void>;
      onError(error: unknown): void;
    },
  ) {}

  requestClose(window: W, keyboard = false): void {
    if (window.isDestroyed()) return;
    if (keyboard) this.keyboardRequests.add(window);
    try {
      window.close();
    } finally {
      this.keyboardRequests.delete(window);
    }
  }

  shouldPreventClose(window: W): boolean {
    if (this.approved.has(window)) return false;
    if (this.pending.has(window)) return true;
    const preference = this.options.getPreference();
    if (
      preference === "never" ||
      (preference === "keyboardOnly" && !this.keyboardRequests.has(window))
    )
      return false;
    this.pending.add(window);
    void this.confirmAndClose(window);
    return true;
  }

  async confirmAndClose(window: W): Promise<void> {
    try {
      const result = await this.options.confirm(window);
      if (!result.confirmed || window.isDestroyed()) return;
      if (result.doNotAskAgain) await this.options.disableConfirmation();
      if (window.isDestroyed()) return;
      this.approved.add(window);
      window.close();
    } catch (error) {
      this.options.onError(error);
    } finally {
      this.approved.delete(window);
      this.pending.delete(window);
    }
  }
}

/** Bind one confirmation to one current Renderer, cancelling on navigation/exit. */
export class WindowCloseConfirmationHost {
  readonly pending = new Map<
    BrowserWindow,
    {
      requestId: string;
      resolve(result: WindowCloseConfirmationResult): void;
      cancel(): void;
    }
  >();
  #disposed = false;

  confirm(window: BrowserWindow): Promise<WindowCloseConfirmationResult> {
    if (
      this.#disposed ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      window.webContents.isLoadingMainFrame()
    )
      return Promise.resolve({ confirmed: false, doNotAskAgain: false });
    if (this.pending.has(window))
      throw new Error("Window confirmation already pending");
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        if (this.pending.get(window)?.requestId !== requestId) return false;
        this.pending.delete(window);
        window.off("closed", cancel);
        window.webContents.off("destroyed", cancel);
        window.webContents.off("did-start-navigation", navigate);
        return true;
      };
      const finish = (result: WindowCloseConfirmationResult) => {
        if (cleanup()) resolve(result);
      };
      const cancel = () => finish({ confirmed: false, doNotAskAgain: false });
      const navigate = (
        _event: unknown,
        _url: string,
        inPlace: boolean,
        mainFrame: boolean,
      ) => {
        if (mainFrame && !inPlace) cancel();
      };
      this.pending.set(window, { requestId, resolve: finish, cancel });
      window.once("closed", cancel);
      window.webContents.once("destroyed", cancel);
      window.webContents.on("did-start-navigation", navigate);
      try {
        window.webContents.send(`evt:${WINDOW_CLOSE_CONFIRMATION_EVENT}`, {
          requestId,
        });
      } catch (error) {
        if (cleanup()) reject(error);
      }
    });
  }

  respond(window: BrowserWindow, senderId: number, value: unknown): void {
    if (
      !value ||
      typeof value !== "object" ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      senderId !== window.webContents.id
    )
      return;
    const result = value as Record<string, unknown>;
    const pending = this.pending.get(window);
    if (
      !pending ||
      result.requestId !== pending.requestId ||
      typeof result.confirmed !== "boolean" ||
      typeof result.doNotAskAgain !== "boolean"
    )
      return;
    pending.resolve({
      confirmed: result.confirmed,
      doNotAskAgain: result.doNotAskAgain,
    });
  }

  dispose(): void {
    this.#disposed = true;
    for (const request of this.pending.values()) request.cancel();
  }
}

/** Let the shared Renderer command registry own Close, including rebinding. */
export function installWindowCloseShortcut(
  window: BrowserWindow,
  platform: string,
): void {
  window.webContents.on("before-input-event", (_event, input) => {
    const primary = platform === "darwin" ? input.meta : input.control;
    window.webContents.setIgnoreMenuShortcuts(
      input.type === "keyDown" &&
        primary &&
        !input.alt &&
        !input.shift &&
        input.key.toLowerCase() === "w",
    );
  });
  window.on("blur", () => {
    if (!window.webContents.isDestroyed())
      window.webContents.setIgnoreMenuShortcuts(false);
  });
}
