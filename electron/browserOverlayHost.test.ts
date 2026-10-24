// @vitest-environment node
import { EventEmitter } from "node:events";
import process from "node:process";
import type { Input } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserOverlayHost,
  type BrowserOverlayEvent,
} from "./browserOverlayHost";
import {
  BROWSER_OVERLAY_ACTION_CHANNEL,
  type BrowserMenuPresentation,
} from "./browserOverlayModel";
import type { EmbeddedBrowserPageCommand } from "./embeddedBrowserPageActions";

interface TestContents extends EventEmitter {
  id: number;
  mainFrame: object;
  isDestroyed: () => boolean;
  focus: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}
interface TestView {
  webContents: TestContents;
  options: { webPreferences: { additionalArguments: string[] } };
}
const native = vi.hoisted(() => ({
  views: [] as TestView[],
  ipc: undefined as EventEmitter | undefined,
  nextLoad: undefined as Promise<void> | undefined,
}));

vi.mock("./electronRuntime", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = new EventEmitter();
  return {
    ipcMain: native.ipc,
    WebContentsView: class {
      options: TestView["options"];
      webContents: TestContents;
      constructor(options: TestView["options"]) {
        this.options = options;
        let destroyed = false;
        this.webContents = Object.assign(new EventEmitter(), {
          id: native.views.length + 100,
          mainFrame: {},
          isDestroyed: () => destroyed,
          focus: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          send: vi.fn(),
          loadURL: vi.fn(() => native.nextLoad ?? Promise.resolve()),
          close: vi.fn(() => {
            destroyed = true;
            this.webContents.emit("destroyed");
          }),
        });
        native.views.push(this);
      }
      setBounds = vi.fn();
      setBackgroundColor = vi.fn();
    },
  };
});

function fixture(
  windowId = 1,
  onCommand?: (viewId: string, command: EmbeddedBrowserPageCommand) => void,
) {
  let focused = true;
  const owner = Object.assign(new EventEmitter(), {
    id: windowId + 10,
    isDestroyed: () => false,
    focus: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    id: windowId,
    webContents: owner,
    isDestroyed: () => false,
    isFocused: () => focused,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  });
  const events: BrowserOverlayEvent[] = [];
  const host = new BrowserOverlayHost((event) => events.push(event), {
    preloadPath: "/isolated/browserOverlay.cjs",
    onCommand,
  });
  const show = (menuId = "more-1") =>
    host.show(
      window as never,
      "view-1",
      {
        menuId,
        anchor: { x: 700, y: 10, width: 24, height: 24 },
        items: [
          { id: "print", label: "Print" },
          { id: "disabled", label: "Disabled", enabled: false },
          {
            id: "zoom",
            label: "Zoom",
            controls: [
              { id: "out", label: "−" },
              { id: "in", label: "+", enabled: false },
            ],
          },
        ],
      } satisfies BrowserMenuPresentation,
      owner as never,
    );
  return {
    host,
    owner,
    window,
    show,
    events,
    blur: () => {
      focused = false;
      window.emit("blur");
    },
  };
}
function message(
  view: TestView,
  action: Record<string, unknown>,
  senderFrame = view.webContents.mainFrame,
  sender = view.webContents,
) {
  const token = view.options.webPreferences.additionalArguments[0].slice(
    "--browser-overlay-token=".length,
  );
  native.ipc!.emit(
    BROWSER_OVERLAY_ACTION_CHANNEL,
    { sender, senderFrame },
    { token, menuId: "more-1", ...action },
  );
}

function key(key: string, overrides: Partial<Input> = {}): Input {
  return {
    key,
    code: key,
    type: "keyDown",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: process.platform !== "darwin",
    meta: process.platform === "darwin",
    alt: false,
    location: 0,
    modifiers: [],
    ...overrides,
  };
}

function input(view: TestView, value: Input) {
  const event = { preventDefault: vi.fn() };
  view.webContents.emit("before-input-event", event, value);
  return event;
}

afterEach(() => {
  native.views.length = 0;
  native.nextLoad = undefined;
  native.ipc?.removeAllListeners();
});

describe("trusted native browser menu lifecycle", () => {
  it("keeps confirmation actions finite, ignores page shortcuts and rejects dynamic updates", async () => {
    const onCommand = vi.fn();
    const f = fixture(1, onCommand);
    const shown = await f.host.show(
      f.window as never,
      "view-1",
      {
        menuId: "more-1",
        anchor: { x: 0, y: 0, width: 1, height: 1 },
        items: [
          { id: "cancel", label: "Cancel" },
          { id: "discard", label: "Discard" },
        ],
        confirmation: {
          title: "Discard?",
          description: "All edits will be removed",
        },
      },
      f.owner as never,
    );
    const view = native.views[0];
    input(view, key("r"));
    expect(onCommand).not.toHaveBeenCalled();
    expect(() =>
      f.host.update("view-1", {
        menuId: shown.menuId,
        generation: shown.generation,
        items: [{ id: "other", label: "Other" }],
      }),
    ).toThrow("immutable");
    message(view, { itemId: "other" });
    message(view, { itemId: "discard", token: "forged" });
    expect(f.events).toHaveLength(0);
    message(view, { itemId: "discard" });
    message(view, { itemId: "discard" });
    expect(f.events.filter((event) => event.itemId)).toEqual([
      {
        viewId: "view-1",
        menuId: shown.menuId,
        generation: shown.generation,
        itemId: "discard",
        reason: "action",
      },
    ]);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    f.host.dispose();
  });

  it("authorizes the exact overlay sender, frame, token and enabled leaf", async () => {
    const f = fixture();
    const shown = await f.show();
    const view = native.views[0];
    expect(shown).toEqual({ menuId: "more-1", generation: 1, visible: true });
    message(view, { itemId: "print", token: "forged" });
    message(view, { itemId: "print" }, {});
    message(view, { itemId: "print" }, view.webContents.mainFrame, {
      id: 10,
    } as TestContents);
    message(view, { itemId: "disabled" });
    message(view, { itemId: "zoom" });
    message(view, { itemId: "in" });
    expect(f.events).toEqual([]);
    message(view, { itemId: "out" });
    expect(f.events).toEqual([
      {
        viewId: "view-1",
        menuId: "more-1",
        generation: 1,
        itemId: "out",
        reason: "action",
      },
    ]);
    expect(view.webContents.close).not.toHaveBeenCalled();
    message(view, { itemId: "print" });
    expect(f.events.slice(1)).toEqual([
      {
        viewId: "view-1",
        menuId: "more-1",
        generation: 1,
        itemId: "print",
        reason: "action",
      },
      { viewId: "view-1", menuId: "more-1", generation: 1, reason: "action" },
    ]);
    expect(f.owner.focus).toHaveBeenCalledTimes(1);
    message(view, { itemId: "print" });
    expect(f.events).toHaveLength(3);
    f.host.dispose();
  });

  it("separates dismissal, owner navigation, focus restoration and cleanup", async () => {
    const f = fixture();
    await f.show();
    message(native.views[0], { reason: "escape" });
    expect(f.events.at(-1)?.reason).toBe("escape");
    expect(f.owner.focus).toHaveBeenCalledTimes(1);
    await f.show("more-2");
    f.blur();
    expect(f.events.at(-1)?.reason).toBe("outside");
    expect(f.owner.focus).toHaveBeenCalledTimes(1);
    await f.show("more-3");
    f.owner.emit("did-start-navigation");
    expect(f.events.at(-1)).toMatchObject({
      menuId: "more-3",
      generation: 3,
      reason: "navigation",
    });
    expect(f.window.listenerCount("blur")).toBe(0);
    expect(f.owner.listenerCount("destroyed")).toBe(0);
    f.host.dispose();
    expect(native.ipc!.listenerCount(BROWSER_OVERLAY_ACTION_CHANNEL)).toBe(0);
  });

  it("does not let a late failed load close a newer generation", async () => {
    const f = fixture();
    let fail!: (error: Error) => void;
    native.nextLoad = new Promise<void>((_, reject) => {
      fail = reject;
    });
    const first = f.show();
    const rejected = expect(first).rejects.toThrow("old load");
    native.nextLoad = undefined;
    expect(await f.show("more-2")).toEqual({
      menuId: "more-2",
      generation: 2,
      visible: true,
    });
    fail(new Error("old load"));
    await rejected;
    expect(native.views[1].webContents.close).not.toHaveBeenCalled();
    f.host.hide("view-1");
    expect(f.events.map((event) => [event.generation, event.reason])).toEqual([
      [1, "replaced"],
      [2, "hidden"],
    ]);
    f.host.dispose();
  });

  it("does not dismiss a replacement menu through an old permission receipt", async () => {
    const f = fixture();
    await f.show("site-permission-old");
    const current = await f.show("more-new");
    f.host.hideMenu("view-1", { menuId: "site-permission-old", generation: 1 });
    f.host.hideMenu("view-1", { menuId: current.menuId, generation: 1 });
    expect(native.views[1].webContents.close).not.toHaveBeenCalled();
    f.host.hideMenu("view-1", current);
    expect(native.views[1].webContents.close).toHaveBeenCalledOnce();
    f.host.dispose();
  });

  it("keeps overlays and teardown isolated to their owning window", async () => {
    const f = fixture();
    const other = fixture(2);
    await f.show();
    await other.show();
    f.host.hideWindow(2, "hidden");
    expect(f.events).toHaveLength(0);
    expect(other.events).toHaveLength(0);
    f.window.emit("closed");
    expect(f.events.at(-1)?.reason).toBe("owner");
    expect(native.views[1].webContents.close).not.toHaveBeenCalled();
    native.views[1].webContents.emit("render-process-gone");
    expect(other.events.at(-1)?.reason).toBe("owner");
    f.host.dispose();
    other.host.dispose();
  });

  it("updates only the current menu generation and its enabled action set", async () => {
    const f = fixture();
    const shown = await f.show();
    const view = native.views[0];
    expect(() =>
      f.host.update("wrong-view", { ...shown, items: [] } as never),
    ).toThrow();
    expect(() =>
      f.host.update("view-1", { menuId: "more-1", generation: 0, items: [] }),
    ).toThrow("stale");
    const items = [{ id: "only", label: "Only", enabled: false }];
    expect(
      f.host.update("view-1", { menuId: "more-1", generation: 1, items }),
    ).toEqual(shown);
    expect(view.webContents.send.mock.calls.at(-1)?.[1]).toMatchObject({
      menuId: "more-1",
      items,
    });
    message(view, { itemId: "print" });
    message(view, { itemId: "only" });
    expect(f.events).toHaveLength(0);
    f.host.dispose();
  });

  it.each([
    ["l", {}, "focus-address"],
    ["f", {}, "find"],
    ["w", {}, "close-tab"],
    ["+", { shift: true }, "zoom-in"],
    [">", { shift: true, code: "Period" }, "annotate"],
    ["ArrowLeft", { control: false, meta: false, alt: true }, "go-back"],
  ] as const)(
    "closes the overlay and restores page focus before dispatching %s once",
    async (pressed, modifiers, command) => {
      const onCommand = vi.fn(() => {
        expect(view.webContents.close).toHaveBeenCalledTimes(1);
        expect(f.owner.focus).toHaveBeenCalledTimes(1);
        expect(view.webContents.listenerCount("before-input-event")).toBe(0);
      });
      const f = fixture(1, onCommand);
      await f.show();
      const view = native.views[0];
      expect(
        input(view, key(pressed, modifiers)).preventDefault,
      ).toHaveBeenCalledTimes(1);
      expect(onCommand).toHaveBeenCalledExactlyOnceWith("view-1", command);
      expect(f.events).toEqual([
        { viewId: "view-1", menuId: "more-1", generation: 1, reason: "hidden" },
      ]);
      expect(
        input(view, key(pressed, modifiers)).preventDefault,
      ).not.toHaveBeenCalled();
      expect(onCommand).toHaveBeenCalledTimes(1);
      f.host.dispose();
    },
  );

  it("leaves recognized shortcuts untouched when no command consumer exists", async () => {
    const f = fixture();
    await f.show();
    const view = native.views[0];
    expect(input(view, key("l")).preventDefault).not.toHaveBeenCalled();
    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
    f.host.dispose();
  });

  it.each([
    ["x", { control: false, meta: false }],
    ["ArrowDown", { control: false, meta: false }],
    ["ArrowLeft", { control: false, meta: false }],
    ["Escape", { control: false, meta: false }],
    ["Enter", { control: false, meta: false }],
    ["l", { isComposing: true }],
    ["f", { isAutoRepeat: true }],
    ["w", { type: "keyUp" }],
  ] as const)(
    "keeps menu input %s %j on its existing path",
    async (pressed, modifiers) => {
      const onCommand = vi.fn();
      const f = fixture(1, onCommand);
      await f.show();
      const view = native.views[0];
      expect(
        input(view, key(pressed, modifiers)).preventDefault,
      ).not.toHaveBeenCalled();
      expect(onCommand).not.toHaveBeenCalled();
      expect(view.webContents.close).not.toHaveBeenCalled();
      expect(f.events).toEqual([]);
      if (pressed === "Escape") {
        message(view, { reason: "escape" });
        expect(f.events.at(-1)?.reason).toBe("escape");
        expect(f.owner.focus).toHaveBeenCalledTimes(1);
        expect(onCommand).not.toHaveBeenCalled();
      }
      f.host.dispose();
    },
  );

  it("removes input handlers on replacement and prevents a captured stale handler from closing the new overlay", async () => {
    const onCommand = vi.fn();
    const f = fixture(1, onCommand);
    await f.show();
    const old = native.views[0];
    const stale = old.webContents.listeners("before-input-event")[0];
    await f.show("more-2");
    expect(old.webContents.listenerCount("before-input-event")).toBe(0);
    const event = { preventDefault: vi.fn() };
    stale(event, key("l"));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    expect(native.views[1].webContents.close).not.toHaveBeenCalled();
    input(native.views[1], key("f"));
    expect(onCommand).toHaveBeenCalledExactlyOnceWith("view-1", "find");
    f.host.dispose();
  });

  it("does not route input from a loading overlay, and dispose invalidates its captured handler", async () => {
    const onCommand = vi.fn();
    const f = fixture(1, onCommand);
    let ready!: () => void;
    native.nextLoad = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const loading = f.show();
    const view = native.views[0];
    const stale = view.webContents.listeners("before-input-event")[0];
    expect(input(view, key("l")).preventDefault).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    f.host.dispose();
    expect(view.webContents.listenerCount("before-input-event")).toBe(0);
    ready();
    expect(await loading).toMatchObject({ visible: false });
    const event = { preventDefault: vi.fn() };
    stale(event, key("l"));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    expect(f.owner.focus).not.toHaveBeenCalled();
  });
});
