import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base64PngToFile,
  deliverAppSnapshot,
  DoubleCommandDetector,
  flattenAccessibilityText,
  pickFrontmostWindow,
  startBareModifierMonitor,
} from "./appSnapshot";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("appSnapshot", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("检测 500ms 内两次 command down，其他修饰键会重置", () => {
    const detector = new DoubleCommandDetector();
    expect(
      detector.handle({ modifier: "command", phase: "down", timestamp: 10 }),
    ).toBe(false);
    expect(
      detector.handle({ modifier: "option", phase: "down", timestamp: 10.1 }),
    ).toBe(false);
    expect(
      detector.handle({ modifier: "command", phase: "down", timestamp: 10.2 }),
    ).toBe(false);
    expect(
      detector.handle({ modifier: "command", phase: "up", timestamp: 10.25 }),
    ).toBe(false);
    expect(
      detector.handle({ modifier: "command", phase: "down", timestamp: 10.6 }),
    ).toBe(true);
    expect(
      detector.handle({ modifier: "command", phase: "down", timestamp: 11.5 }),
    ).toBe(false);
    expect(
      detector.handle({ modifier: "command", phase: "down", timestamp: 11.8 }),
    ).toBe(true);
  });

  it("选择最前的非 Lime 窗口", () => {
    expect(
      pickFrontmostWindow([
        {
          windowId: 1,
          ownerName: "Lime",
          bundleIdentifier: "com.limecloud.lime",
          layer: 0,
          bounds: { width: 100, height: 100 },
        },
        {
          windowId: 2,
          ownerName: "Background",
          layer: 3,
          bounds: { width: 10, height: 10 },
        },
        {
          windowId: 3,
          ownerName: "Empty",
          layer: 0,
          bounds: { width: 0, height: 0 },
        },
        {
          windowId: 4,
          ownerName: "Editor",
          layer: 0,
          bounds: { width: 800, height: 600 },
        },
      ])?.windowId,
    ).toBe(4);
    expect(pickFrontmostWindow([])).toBeNull();
  });

  it("base64 PNG 转成 File", async () => {
    const file = base64PngToFile(pngBase64);
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("app-snapshot.png");
    expect(file.size).toBeGreaterThan(0);
  });

  it("把快照作为 paste 投递给 composer", () => {
    class FakeDataTransfer {
      items = { add: vi.fn() };
      readonly #data = new Map<string, string>();
      setData(type: string, value: string) {
        this.#data.set(type, value);
      }
      getData(type: string) {
        return this.#data.get(type) ?? "";
      }
    }
    vi.stubGlobal("DataTransfer", FakeDataTransfer);
    class FakeClipboardEvent extends Event {
      clipboardData: unknown;
      constructor(type: string, init?: { clipboardData?: unknown }) {
        super(type, init);
        this.clipboardData = init?.clipboardData;
      }
    }
    vi.stubGlobal("ClipboardEvent", FakeClipboardEvent);
    const editor = document.createElement("div");
    editor.dataset.testid = "composer-editor";
    document.body.append(editor);
    const listener = vi.fn();
    editor.addEventListener("paste", listener);
    const file = base64PngToFile(pngBase64);
    expect(deliverAppSnapshot(file)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe("paste");
    vi.unstubAllGlobals();
  });

  it("快照文本作为第二个 paste 投递", () => {
    class FakeDataTransfer {
      items = { add: vi.fn() };
      readonly data = new Map<string, string>();
      setData(type: string, value: string) {
        this.data.set(type, value);
      }
      getData(type: string) {
        return this.data.get(type) ?? "";
      }
    }
    vi.stubGlobal("DataTransfer", FakeDataTransfer);
    class FakeClipboardEvent extends Event {
      clipboardData: unknown;
      constructor(type: string, init?: { clipboardData?: unknown }) {
        super(type, init);
        this.clipboardData = init?.clipboardData;
      }
    }
    vi.stubGlobal("ClipboardEvent", FakeClipboardEvent);
    const editor = document.createElement("div");
    editor.dataset.testid = "composer-editor";
    document.body.append(editor);
    const events: Event[] = [];
    editor.addEventListener("paste", (event) => events.push(event));
    const text = "应用快照文本内容".repeat(5);
    deliverAppSnapshot(base64PngToFile(pngBase64), text);
    expect(events).toHaveLength(2);
    const clipboard = (
      events[1] as unknown as { clipboardData: FakeDataTransfer }
    ).clipboardData;
    expect(clipboard.getData("text/plain")).toBe(text);
    expect(clipboard.getData("application/x-lime-paste-atom")).toBe("1");
    vi.unstubAllGlobals();
  });

  it("扁平化 AX 文本并去重/忽略按钮", () => {
    expect(
      flattenAccessibilityText({
        role: "AXWindow",
        children: [
          { role: "AXStaticText", value: "第一行" },
          { role: "AXButton", title: "忽略" },
          {
            role: "AXGroup",
            children: [{ role: "AXStaticText", value: "第一行" }],
          },
          { role: "AXHeading", title: "标题" },
          { role: "AXTextField", value: "输入" },
        ],
      }),
    ).toBe("第一行\n标题\n输入");
    expect(flattenAccessibilityText(null)).toBe("");
  });

  it("没有 composer 时返回 false", () => {
    expect(deliverAppSnapshot(base64PngToFile(pngBase64))).toBe(false);
  });

  it("已获输入监控权限时启动监听，不主动请求权限", async () => {
    invoke.mockResolvedValueOnce({ status: "ready" });
    invoke.mockResolvedValueOnce({ started: true });

    await expect(startBareModifierMonitor()).resolves.toEqual({
      started: true,
    });
    expect(invoke.mock.calls).toEqual([
      [
        "macos_native_host_invoke",
        { method: "inputMonitoring.read", params: undefined },
      ],
      [
        "macos_native_host_invoke",
        {
          method: "bareModifierMonitor.start",
          params: { requestPermission: false },
        },
      ],
    ]);
  });

  it.each([{ status: "not_granted" }, { status: "unavailable" }, {}, null])(
    "权限未就绪时不启动监听：%j",
    async (permission) => {
      invoke.mockResolvedValueOnce(permission);

      await expect(startBareModifierMonitor()).resolves.toEqual({
        started: false,
      });
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenCalledWith("macos_native_host_invoke", {
        method: "inputMonitoring.read",
        params: undefined,
      });
    },
  );

  it("权限查询失败时保留错误，不尝试启动监听", async () => {
    const error = new Error("native host unavailable");
    invoke.mockRejectedValueOnce(error);

    await expect(startBareModifierMonitor()).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledOnce();
  });
});
