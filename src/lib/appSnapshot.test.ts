import { afterEach, describe, expect, it, vi } from "vitest";
import {
  base64PngToFile,
  deliverAppSnapshot,
  DoubleCommandDetector,
  pickFrontmostWindow,
} from "./appSnapshot";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("appSnapshot", () => {
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

  it("没有 composer 时返回 false", () => {
    expect(deliverAppSnapshot(base64PngToFile(pngBase64))).toBe(false);
  });
});
