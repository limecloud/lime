import type { OpenDialogOptions } from "./desktop-host/dialogOptions";
import type { WindowCloseConfirmationResponse } from "./desktop-host/windowCloseConfirmation";

export type ElectronHostEvent<T = unknown> = {
  event: string;
  payload: T;
};

export type ElectronHostUnlisten = () => void;

export type ElectronHostInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface ElectronHostDialogBridge {
  open(options?: OpenDialogOptions): Promise<string | string[] | null>;
  save(options?: unknown): Promise<string | null>;
}

export interface ElectronHostShellBridge {
  open(path: string, openWith?: string): Promise<void>;
}

export interface ElectronHostShortcutBridge {
  register(shortcut: string): Promise<void>;
  unregister(shortcut: string): Promise<void>;
  unregisterAll(): Promise<void>;
  isRegistered(shortcut: string): Promise<boolean>;
}

export interface ElectronHostWindowBridge {
  show(): Promise<void>;
  hide(): Promise<void>;
  close(keyboard?: boolean): Promise<void>;
  confirmClose(response: WindowCloseConfirmationResponse): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  center(): Promise<void>;
  setFocus(): Promise<void>;
  startDragging(): Promise<void>;
  setTitle(title: string): Promise<void>;
  setSize(width: number, height: number): Promise<void>;
  setPosition(x: number, y: number): Promise<void>;
  isVisible(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  isDecorated(): Promise<boolean>;
  isResizable(): Promise<boolean>;
}

export interface ElectronHostDeepLinkBridge {
  onOpenUrl(handler: (urls: string[]) => void): ElectronHostUnlisten;
  getUrls(): Promise<string[]>;
  getCurrent(): Promise<string[] | null>;
}

export interface ElectronHostBridge {
  readonly agentRoot?: string;
  invoke: ElectronHostInvoke;
  devBridgeFallback?: boolean;
  supportsCommand?(command: string): boolean;
  listen<T = unknown>(
    event: string,
    handler: (event: ElectronHostEvent<T>) => void,
  ): Promise<ElectronHostUnlisten> | ElectronHostUnlisten;
  on?<T = unknown>(
    event: string,
    handler: (event: ElectronHostEvent<T>) => void,
  ): ElectronHostUnlisten;
  emit(event: string, payload?: unknown): Promise<void>;
  send?(event: string, payload?: unknown): void;
  convertFileSrc?(filePath: string, protocol?: string): string;
  dialog?: ElectronHostDialogBridge;
  shell?: ElectronHostShellBridge;
  globalShortcut?: ElectronHostShortcutBridge;
  window?: ElectronHostWindowBridge;
  deepLink?: ElectronHostDeepLinkBridge;
}

declare global {
  interface Window {
    __LIME_ELECTRON__?: boolean;
    electronAPI?: ElectronHostBridge;
  }
}

export function getElectronHostBridge(): ElectronHostBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = window.electronAPI;
  return bridge && typeof bridge.invoke === "function" ? bridge : null;
}

export function isElectronHostCommandAvailable(command: string): boolean {
  const bridge = getElectronHostBridge();
  if (!bridge) {
    return false;
  }
  return bridge.supportsCommand ? bridge.supportsCommand(command) : true;
}

export function isElectronDevBridgeFallbackAvailable(): boolean {
  return getElectronHostBridge()?.devBridgeFallback === true;
}
