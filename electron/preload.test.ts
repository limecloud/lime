import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";
import { buildAgentRootArgument } from "./agentRoot";
import { decodeLocalAssetFilePath } from "./localAsset";

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
} from "./ipcChannels";

const exposedGlobals = new Map<string, unknown>();
const originalArgv = process.argv;
const ipcInvoke = vi.hoisted(() => vi.fn());
const ipcSend = vi.hoisted(() => vi.fn());
const ipcOn = vi.hoisted(() => vi.fn());
const ipcRemoveListener = vi.hoisted(() => vi.fn());
const exposeInMainWorld = vi.hoisted(() =>
  vi.fn((key: string, value: unknown) => {
    exposedGlobals.set(key, value);
  }),
);

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcInvoke,
    send: ipcSend,
    on: ipcOn,
    removeListener: ipcRemoveListener,
  },
}));

type PreloadApi = {
  readonly agentRoot?: string;
  devBridgeFallback: false;
  supportsCommand(command: string): boolean;
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  listen(event: string, handler: (event: unknown) => void): () => void;
  on(event: string, handler: (event: unknown) => void): () => void;
  emit(event: string, payload?: unknown): Promise<void>;
  send(event: string, payload?: unknown): void;
  convertFileSrc(filePath: string, protocol?: string): string;
  dialog: {
    open(options?: unknown): Promise<unknown>;
    save(options?: unknown): Promise<unknown>;
  };
  shell: {
    open(target: string, openWith?: string): Promise<unknown>;
  };
  window: {
    show(): Promise<unknown>;
    setTitle(title: string): Promise<unknown>;
    setSize(width: number, height: number): Promise<unknown>;
    isVisible(): Promise<boolean>;
  };
  globalShortcut: {
    register(shortcut: string): Promise<unknown>;
    unregister(shortcut: string): Promise<unknown>;
    unregisterAll(): Promise<unknown>;
    isRegistered(shortcut: string): Promise<unknown>;
  };
  deepLink: {
    onOpenUrl(handler: (urls: string[]) => void): () => void;
    getUrls(): Promise<unknown>;
    getCurrent(): Promise<unknown>;
  };
};

async function loadPreloadApi(): Promise<PreloadApi> {
  vi.resetModules();
  exposedGlobals.clear();
  await import("./preload");
  const api = exposedGlobals.get("electronAPI");
  if (!api || typeof api !== "object") {
    throw new Error("preload did not expose electronAPI");
  }
  return api as PreloadApi;
}

describe("electron/preload", () => {
  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    ipcInvoke.mockReset();
    ipcSend.mockReset();
    ipcOn.mockReset();
    ipcRemoveListener.mockReset();
    exposeInMainWorld.mockClear();
    exposedGlobals.clear();
  });

  it("只读元数据投影 Main 传入的真实 Agent 根，不调用 renderer IPC", async () => {
    process.argv = [
      "electron",
      buildAgentRootArgument("/tmp/隔离根/app-server"),
    ];
    const api = await loadPreloadApi();
    expect(api.agentRoot).toBe("/tmp/隔离根/app-server");
    expect(ipcInvoke).not.toHaveBeenCalled();
  });

  it("缺少 Main 元数据时不猜测用户数据根", async () => {
    process.argv = ["electron"];
    const api = await loadPreloadApi();
    expect(api.agentRoot).toBeUndefined();
  });

  it.each([true, false])(
    "默认浏览器身份 %s 经真实 command allowlist 和 invoke 解包",
    async (value) => {
      const api = await loadPreloadApi();
      expect(api.supportsCommand("is_default_browser")).toBe(true);
      ipcInvoke.mockResolvedValueOnce({ ok: true, result: value });
      await expect(api.invoke("is_default_browser")).resolves.toBe(value);
      expect(ipcInvoke).toHaveBeenCalledExactlyOnceWith(
        IPC_INVOKE_CHANNEL,
        "is_default_browser",
        undefined,
      );
    },
  );

  it("Host persistence commands cross the same invoke boundary", async () => {
    const api = await loadPreloadApi();
    expect(api.supportsCommand("persisted_atom_read")).toBe(true);
    expect(api.supportsCommand("persisted_atom_update")).toBe(true);
    const args = {
      key: "composer-drafts-v1",
      query: {
        kind: "scope",
        scope: { workspaceId: null, kind: "home", id: "new-conversation" },
      },
    };
    const result = {
      key: "composer-drafts-v1",
      storeRevision: 0,
      persistence: { state: "saved", savedRevision: 0 },
      outcome: "ready",
      data: {
        queryKind: "scope",
        view: { scope: args.query.scope, entry: null },
      },
    };
    ipcInvoke.mockResolvedValueOnce({ ok: true, result });
    await expect(api.invoke("persisted_atom_read", args)).resolves.toEqual(
      result,
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_INVOKE_CHANNEL,
      "persisted_atom_read",
      args,
    );
  });

  it.each(["workspace", null])(
    "workspace-index query and ready data cross the same public IPC",
    async (workspaceId) => {
      const api = await loadPreloadApi();
      const args = {
        key: "composer-drafts-v1",
        query: { kind: "workspace-index", workspaceId },
      };
      const result = {
        key: "composer-drafts-v1",
        storeRevision: 0,
        persistence: { state: "saved", savedRevision: 0 },
        outcome: "ready",
        data: { queryKind: "workspace-index", workspaceId, items: [] },
      };
      ipcInvoke.mockResolvedValueOnce({ ok: true, result });
      await expect(api.invoke("persisted_atom_read", args)).resolves.toEqual(
        result,
      );
      expect(ipcInvoke).toHaveBeenCalledExactlyOnceWith(
        IPC_INVOKE_CHANNEL,
        "persisted_atom_read",
        args,
      );
    },
  );

  it("Summary pin uses the existing public persisted-atom IPC", async () => {
    const api = await loadPreloadApi();
    const key = "app-shell-summary-panel-pinned";
    const args = { key, query: { kind: "value" } };
    const result = {
      key,
      storeRevision: 0,
      persistence: { state: "saved", savedRevision: 0 },
      outcome: "ready",
      data: { queryKind: "value", value: true },
    };
    ipcInvoke.mockResolvedValueOnce({ ok: true, result });
    await expect(api.invoke("persisted_atom_read", args)).resolves.toEqual(
      result,
    );
    expect(ipcInvoke).toHaveBeenCalledExactlyOnceWith(
      IPC_INVOKE_CHANNEL,
      "persisted_atom_read",
      args,
    );
  });

  it("preload rejects renderer persistence notifications before sending IPC", async () => {
    const api = await loadPreloadApi();
    await expect(
      api.emit("persisted-atom-update", { state: "saved" }),
    ).rejects.toThrow("Renderer event is not allowed");
    expect(() => api.send("persisted-atom-update", { state: "saved" })).toThrow(
      "Renderer event is not allowed",
    );
    expect(ipcSend).not.toHaveBeenCalled();
  });

  it("real Main persistence notifications remain observable and removable", async () => {
    const api = await loadPreloadApi();
    const handler = vi.fn();
    const stop = api.listen("persisted-atom-update", handler);
    const listener = ipcOn.mock.calls[0][1];
    const payload = {
      key: "composer-drafts-v1",
      storeRevision: 1,
      persistence: { state: "saved", savedRevision: 1 },
    };
    listener({}, { event: "persisted-atom-update", payload });
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      event: "persisted-atom-update",
      payload,
    });
    stop();
    expect(ipcRemoveListener).toHaveBeenCalledWith(
      "evt:persisted-atom-update",
      listener,
    );
  });

  it("暴露真实 Electron bridge 标记并用 host command 白名单判断支持命令", async () => {
    const api = await loadPreloadApi();

    expect(exposeInMainWorld).toHaveBeenCalledWith("electronAPI", api);
    expect(exposeInMainWorld).toHaveBeenCalledWith("__LIME_ELECTRON__", true);
    expect(api.devBridgeFallback).toBe(false);
    expect(api.supportsCommand(ELECTRON_HOST_COMMANDS[0])).toBe(true);
    expect(api.supportsCommand("browser_tab_list")).toBe(true);
    expect(api.supportsCommand("capability_draft_list_registered_skills")).toBe(
      false,
    );
  });

  it("通过统一 app:invoke 通道转发命令并解包成功响应", async () => {
    const api = await loadPreloadApi();
    ipcInvoke.mockResolvedValueOnce({
      ok: true,
      result: { lines: ["{}"] },
    });

    await expect(
      api.invoke("app_server_handle_json_lines", { lines: ["{}"] }),
    ).resolves.toEqual({ lines: ["{}"] });
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_INVOKE_CHANNEL,
      "app_server_handle_json_lines",
      { lines: ["{}"] },
    );
  });

  it("Electron invoke 失败响应必须 fail closed 并保留错误元数据", async () => {
    const api = await loadPreloadApi();
    ipcInvoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "unsupported_command",
        message: "Desktop Host 尚未支持命令",
        data: { command: "legacy_command" },
      },
    });

    await expect(api.invoke("legacy_command")).rejects.toMatchObject({
      message: "Desktop Host 尚未支持命令",
      code: "unsupported_command",
      data: { command: "legacy_command" },
    });
  });

  it("事件监听统一归一化 payload，并返回反注册函数", async () => {
    const api = await loadPreloadApi();
    const handler = vi.fn();

    const dispose = api.listen("agent-runtime:event", handler);
    const listener = ipcOn.mock.calls[0]?.[1] as
      | ((_event: unknown, payload: unknown) => void)
      | undefined;

    expect(ipcOn).toHaveBeenCalledWith("evt:agent-runtime:event", listener);
    expect(listener).toBeTypeOf("function");

    listener?.({}, { step: "ready" });
    expect(handler).toHaveBeenCalledWith({
      event: "agent-runtime:event",
      payload: { step: "ready" },
    });

    listener?.({}, { event: "agent-runtime:event", payload: { step: "done" } });
    expect(handler).toHaveBeenCalledWith({
      event: "agent-runtime:event",
      payload: { step: "done" },
    });

    dispose();
    expect(ipcRemoveListener).toHaveBeenCalledWith(
      "evt:agent-runtime:event",
      listener,
    );
  });

  it("桌面壳能力保持固定 IPC channel，不绕过 Electron Host", async () => {
    const api = await loadPreloadApi();
    ipcInvoke.mockResolvedValue(undefined);

    await api.dialog.open({ properties: ["openFile"] });
    await api.dialog.save({ defaultPath: "draft.md" });
    await api.shell.open("/tmp/draft.md", "Preview");
    await api.window.show();
    await api.window.setTitle("Lime");
    await api.window.setSize(1024, 768);
    await api.globalShortcut.register("CommandOrControl+L");
    await api.globalShortcut.unregister("CommandOrControl+L");
    await api.globalShortcut.unregisterAll();
    await api.globalShortcut.isRegistered("CommandOrControl+L");
    await api.deepLink.getUrls();
    await api.deepLink.getCurrent();
    api.send("frontend:ready", { ok: true });
    await api.emit("frontend:loaded");

    expect(ipcInvoke).toHaveBeenCalledWith(IPC_DIALOG_OPEN_CHANNEL, {
      properties: ["openFile"],
    });
    expect(ipcInvoke).toHaveBeenCalledWith(IPC_DIALOG_SAVE_CHANNEL, {
      defaultPath: "draft.md",
    });
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_SHELL_OPEN_CHANNEL,
      "/tmp/draft.md",
      "Preview",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(IPC_WINDOW_COMMAND_CHANNEL, "show");
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_WINDOW_COMMAND_CHANNEL,
      "setTitle",
      "Lime",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_WINDOW_COMMAND_CHANNEL,
      "setSize",
      1024,
      768,
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
      "register",
      "CommandOrControl+L",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
      "unregister",
      "CommandOrControl+L",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
      "unregisterAll",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_GLOBAL_SHORTCUT_COMMAND_CHANNEL,
      "isRegistered",
      "CommandOrControl+L",
    );
    expect(ipcInvoke).toHaveBeenCalledWith(IPC_DEEP_LINK_GET_URLS_CHANNEL);
    expect(ipcInvoke).toHaveBeenCalledWith(IPC_DEEP_LINK_GET_CURRENT_CHANNEL);
    expect(ipcSend).toHaveBeenCalledWith("app:emit", "frontend:ready", {
      ok: true,
    });
    expect(ipcSend).toHaveBeenCalledWith(
      IPC_EMIT_CHANNEL,
      "frontend:loaded",
      undefined,
    );
  });

  it("deep link 事件只向 renderer 传递数组 URL 列表", async () => {
    const api = await loadPreloadApi();
    const handler = vi.fn();

    const dispose = api.deepLink.onOpenUrl(handler);
    const listener = ipcOn.mock.calls[0]?.[1] as
      | ((_event: unknown, payload: unknown) => void)
      | undefined;

    expect(ipcOn).toHaveBeenCalledWith("evt:deep-link-open-url", listener);
    listener?.({}, { payload: ["lime://connect?id=1"] });
    listener?.({}, { payload: "lime://connect?id=2" });

    expect(handler).toHaveBeenNthCalledWith(1, ["lime://connect?id=1"]);
    expect(handler).toHaveBeenNthCalledWith(2, []);

    dispose();
    expect(ipcRemoveListener).toHaveBeenCalledWith(
      "evt:deep-link-open-url",
      listener,
    );
  });

  it("convertFileSrc 只处理本地路径，不改写已有 URL", async () => {
    const api = await loadPreloadApi();

    expect(api.convertFileSrc("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(api.convertFileSrc("/tmp/a.png")).toBe("file:///tmp/a.png");
    expect(api.convertFileSrc("/tmp/a b.png", "asset")).toBe(
      "asset://localhost/%2Ftmp%2Fa%20b.png",
    );
  });

  it.each([
    "/Users/Case/中文图片 #1?%.png",
    "C:\\Users\\Case\\图片 #1?%.png",
    "\\\\Server\\Share\\图片 #1.png",
  ])("asset URL 经标准解析仍保留完整文件路径：%s", async (filePath) => {
    const api = await loadPreloadApi();
    const url = new URL(api.convertFileSrc(filePath, "asset"));
    expect(url.protocol).toBe("asset:");
    expect(url.hostname).toBe("localhost");
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(filePath);
    expect(decodeLocalAssetFilePath(url.href)).toBe(filePath);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });
});
