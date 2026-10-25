import { canBroadcastRendererEvent } from "./rendererEventPolicy";
import { contextBridge, ipcRenderer } from "electron";
import process from "node:process";
import { readAgentRootArgument } from "./agentRoot";
import {
  ELECTRON_HOST_COMMANDS,
  IPC_DEEP_LINK_GET_CURRENT_CHANNEL,
  IPC_DEEP_LINK_GET_URLS_CHANNEL,
  IPC_DIALOG_OPEN_CHANNEL,
  IPC_DIALOG_SAVE_CHANNEL,
  IPC_EMIT_CHANNEL,
  IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
  IPC_INVOKE_CHANNEL,
  IPC_SHELL_OPEN_CHANNEL,
  IPC_WINDOW_COMMAND_CHANNEL,
  type ElectronInvokeResponse,
} from "./ipcChannels";

const supportedCommands = new Set<string>(ELECTRON_HOST_COMMANDS);

function unwrapInvokeResponse<T>(response: ElectronInvokeResponse<T>): T {
  if (response.ok) {
    return response.result;
  }
  const error = new Error(response.error.message);
  Object.assign(error, {
    code: response.error.code,
    data: response.error.data,
  });
  throw error;
}

contextBridge.exposeInMainWorld("electronAPI", {
  agentRoot: readAgentRootArgument(process.argv),
  devBridgeFallback: false,
  supportsCommand: (command: string) => supportedCommands.has(command),
  invoke: async <T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    const response = (await ipcRenderer.invoke(
      IPC_INVOKE_CHANNEL,
      command,
      args,
    )) as ElectronInvokeResponse<T>;
    return unwrapInvokeResponse(response);
  },
  listen: (event: string, handler: (event: unknown) => void) => {
    const channel = `evt:${event}`;
    const listener = (_ipcEvent: unknown, payload: unknown) => {
      handler(normalizeEvent(event, payload));
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  on: (event: string, handler: (event: unknown) => void) => {
    const channel = `evt:${event}`;
    const listener = (_ipcEvent: unknown, payload: unknown) => {
      handler(normalizeEvent(event, payload));
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  emit: async (event: string, payload?: unknown) => {
    if (!canBroadcastRendererEvent(event))
      throw new Error("Renderer event is not allowed");
    ipcRenderer.send(IPC_EMIT_CHANNEL, event, payload);
  },
  send: (event: string, payload?: unknown) => {
    if (!canBroadcastRendererEvent(event))
      throw new Error("Renderer event is not allowed");
    ipcRenderer.send(IPC_EMIT_CHANNEL, event, payload);
  },
  convertFileSrc: (filePath: string, protocol = "file") => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath)) {
      return filePath;
    }
    if (protocol === "file") {
      return `file://${filePath}`;
    }
    return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
  },
  dialog: {
    open: (options?: unknown) =>
      ipcRenderer.invoke(IPC_DIALOG_OPEN_CHANNEL, options),
    save: (options?: unknown) =>
      ipcRenderer.invoke(IPC_DIALOG_SAVE_CHANNEL, options),
  },
  shell: {
    open: (target: string, openWith?: string) =>
      ipcRenderer.invoke(IPC_SHELL_OPEN_CHANNEL, target, openWith),
  },
  window: {
    show: () => invokeWindow("show"),
    hide: () => invokeWindow("hide"),
    close: (keyboard = false) => invokeWindow("close", keyboard),
    confirmClose: (response: unknown) => invokeWindow("confirmClose", response),
    minimize: () => invokeWindow("minimize"),
    maximize: () => invokeWindow("maximize"),
    unmaximize: () => invokeWindow("unmaximize"),
    center: () => invokeWindow("center"),
    setFocus: () => invokeWindow("setFocus"),
    startDragging: () => invokeWindow("startDragging"),
    setTitle: (title: string) => invokeWindow("setTitle", title),
    setSize: (width: number, height: number) =>
      invokeWindow("setSize", width, height),
    setPosition: (x: number, y: number) => invokeWindow("setPosition", x, y),
    isVisible: () => invokeWindow<boolean>("isVisible"),
    isMaximized: () => invokeWindow<boolean>("isMaximized"),
    isFullscreen: () => invokeWindow<boolean>("isFullscreen"),
    isDecorated: () => invokeWindow<boolean>("isDecorated"),
    isResizable: () => invokeWindow<boolean>("isResizable"),
  },
  globalShortcut: {
    register: (shortcut: string) =>
      ipcRenderer.invoke(
        IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
        "register",
        shortcut,
      ),
    unregister: (shortcut: string) =>
      ipcRenderer.invoke(
        IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
        "unregister",
        shortcut,
      ),
    unregisterAll: () =>
      ipcRenderer.invoke(IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL, "unregisterAll"),
    isRegistered: (shortcut: string) =>
      ipcRenderer.invoke(
        IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
        "isRegistered",
        shortcut,
      ),
  },
  deepLink: {
    onOpenUrl: (handler: (urls: string[]) => void) => {
      const channel = "evt:deep-link-open-url";
      const listener = (_ipcEvent: unknown, event: { payload?: string[] }) => {
        handler(Array.isArray(event.payload) ? event.payload : []);
      };
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    getUrls: () => ipcRenderer.invoke(IPC_DEEP_LINK_GET_URLS_CHANNEL),
    getCurrent: () => ipcRenderer.invoke(IPC_DEEP_LINK_GET_CURRENT_CHANNEL),
  },
});

contextBridge.exposeInMainWorld("__LIME_ELECTRON__", true);

function normalizeEvent(event: string, payload: unknown): unknown {
  if (
    payload &&
    typeof payload === "object" &&
    "payload" in payload &&
    "event" in payload
  ) {
    return payload;
  }
  return { event, payload };
}

function invokeWindow<T = void>(
  command: string,
  ...args: unknown[]
): Promise<T> {
  return ipcRenderer.invoke(IPC_WINDOW_COMMAND_CHANNEL, command, ...args);
}
