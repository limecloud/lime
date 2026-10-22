import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type { BrowserMenuEvent, BrowserMenuItem } from "@/lib/api/browserMenu";
import { useBrowserNativeMenu } from "./useBrowserNativeMenu";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const native = vi.hoisted(() => ({
  listen: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/api/browserMenu", () => ({
  listenBrowserMenuEvent: native.listen,
  showBrowserTabMenu: native.show,
  hideBrowserTabOverlay: native.hide,
  updateBrowserTabMenu: native.update,
}));

let harness: ReturnType<typeof createBrowserComponentHarness>;
let menu: ReturnType<typeof useBrowserNativeMenu>;
let receive: (event: BrowserMenuEvent) => void;
const unsubscribe = vi.fn();
const onAction = vi.fn();
const onError = vi.fn();
const items: BrowserMenuItem[] = [
  { id: "find", label: "Find" },
  { id: "zoom", label: "Zoom", controls: [{ id: "zoom-in", label: "+" }] },
];
function Probe({
  selected,
  active = true,
}: {
  selected: BrowserTabState | null;
  active?: boolean;
}) {
  menu = useBrowserNativeMenu({ selected, active, onAction, onError });
  return (
    <button data-testid="menu-anchor" aria-expanded={menu.open}>
      Menu
    </button>
  );
}
const render = (
  selected: BrowserTabState | null = browserState(),
  active = true,
) => harness.render(<Probe selected={selected} active={active} />);
const anchor = () => harness.query("menu-anchor");
const show = () =>
  act(async () => {
    await menu.show(anchor(), items);
  });
const event = (
  overrides: Partial<BrowserMenuEvent> = {},
): BrowserMenuEvent => ({
  ...browserState(),
  menuId: native.show.mock.calls.at(-1)![1].menuId,
  generation: 7,
  reason: "action",
  itemId: "find",
  ...overrides,
});
const dispatch = (value: BrowserMenuEvent) =>
  act(async () => {
    receive(value);
  });

describe("useBrowserNativeMenu", () => {
  beforeEach(() => {
    harness = createBrowserComponentHarness();
    vi.clearAllMocks();
    native.listen.mockImplementation(async (handler) => {
      receive = handler;
      return unsubscribe;
    });
    native.show.mockImplementation(async (_tabId, presentation) => ({
      menuId: presentation.menuId,
      generation: 7,
      visible: true,
    }));
    native.hide.mockResolvedValue(undefined);
    native.update.mockResolvedValue(undefined);
  });
  afterEach(async () => harness.unmount());

  it("dispatches only events matching the complete owner identity, menu id and native generation", async () => {
    await render();
    await show();
    expect(menu.open).toBe(true);
    for (const override of [
      { browserSessionId: "foreign-session" },
      { threadId: "foreign-thread" },
      { tabId: "foreign-tab" },
      { viewId: "foreign-view" },
      { webContentsId: 999 },
      { ownerWebContentsId: 999 },
      { windowId: 999 },
      { menuId: "foreign-menu" },
      { generation: 6 },
    ])
      await dispatch(event(override));
    expect(onAction).not.toHaveBeenCalled();
    await dispatch(event());
    expect(onAction).toHaveBeenCalledExactlyOnceWith("find");
    await dispatch(event({ reason: "outside", itemId: undefined }));
    expect(menu.open).toBe(false);
    await dispatch(event());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("queues actions before show resolves and replays only the receipt generation", async () => {
    const receipt = deferred<{
      menuId: string;
      generation: number;
      visible: boolean;
    }>();
    native.show.mockReturnValue(receipt.promise);
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = menu.show(anchor(), items);
    });
    await dispatch(event({ generation: 6, itemId: "stale" }));
    await dispatch(event({ itemId: "zoom-in" }));
    expect(onAction).not.toHaveBeenCalled();
    await act(async () => {
      receipt.resolve({ menuId: event().menuId, generation: 7, visible: true });
      await opening;
    });
    expect(onAction).toHaveBeenCalledExactlyOnceWith("zoom-in");
    expect(menu.open).toBe(true);
  });

  it("keeps a pre-receipt close terminal and ignores later queued actions", async () => {
    const receipt = deferred<{
      menuId: string;
      generation: number;
      visible: boolean;
    }>();
    native.show.mockReturnValue(receipt.promise);
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = menu.show(anchor(), items);
    });
    const menuId = event().menuId;
    await dispatch(event({ reason: "escape", itemId: undefined }));
    await dispatch(event());
    await act(async () => {
      receipt.resolve({ menuId, generation: 7, visible: true });
      await opening;
    });
    expect(menu.open).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["tab", "inactive", "navigation", "owner"])(
    "does not revive a pending menu after %s changes",
    async (change) => {
      const receipt = deferred<{
        menuId: string;
        generation: number;
        visible: boolean;
      }>();
      native.show.mockReturnValue(receipt.promise);
      await render();
      let opening!: Promise<void>;
      await act(async () => {
        opening = menu.show(anchor(), items);
      });
      const previous = event();
      await render(
        browserState(
          change === "tab"
            ? { tabId: "other" }
            : change === "navigation"
              ? { url: "https://other.example.com" }
              : change === "owner"
                ? { webContentsId: 999 }
                : {},
        ),
        change !== "inactive",
      );
      expect(native.hide).toHaveBeenCalledExactlyOnceWith(browserState().tabId);
      await act(async () => {
        receipt.resolve({
          menuId: previous.menuId,
          generation: 7,
          visible: true,
        });
        await opening;
      });
      await dispatch(previous);
      expect(menu.open).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    },
  );

  it("updates an open native menu in place using its exact generation without opening a second menu", async () => {
    await render();
    await show();
    const updated = [
      {
        id: "zoom",
        label: "Zoom",
        controls: [{ id: "zoom-in", label: "110%" }],
      },
    ];
    await act(async () => {
      await menu.update(updated);
    });
    expect(native.update).toHaveBeenCalledExactlyOnceWith(
      browserState().tabId,
      event().menuId,
      7,
      updated,
    );
    expect(native.show).toHaveBeenCalledTimes(1);
    expect(native.hide).not.toHaveBeenCalled();
    await dispatch(event({ reason: "outside", itemId: undefined }));
    await act(async () => {
      await menu.update(items);
    });
    expect(native.update).toHaveBeenCalledTimes(1);
  });

  it("cleans a late subscription and hides an outstanding native menu when unmounted", async () => {
    await render();
    await show();
    await harness.render(<div>Closed</div>);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(native.hide).toHaveBeenCalledExactlyOnceWith(browserState().tabId);
    await dispatch(event());
    expect(onAction).not.toHaveBeenCalled();
    const subscription = deferred<() => void>();
    const lateUnsubscribe = vi.fn();
    native.listen.mockReturnValue(subscription.promise);
    await render();
    await harness.render(<div>Closed again</div>);
    await act(async () => subscription.resolve(lateUnsubscribe));
    expect(lateUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected subscription, leaves the menu closed and never dispatches show", async () => {
    const failure = new Error("subscription failed");
    native.listen.mockRejectedValue(failure);
    await render();
    await act(async () => {
      await menu.show(anchor(), items);
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(menu.open).toBe(false);
    expect(native.show).not.toHaveBeenCalled();
  });

  it("does not open against a stale native owner while waiting for the subscription", async () => {
    const subscription = deferred<() => void>();
    native.listen.mockImplementation((handler) => {
      receive = handler;
      return subscription.promise;
    });
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = menu.show(anchor(), items);
    });
    await render(browserState({ webContentsId: 999 }));
    await act(async () => {
      subscription.resolve(unsubscribe);
      await opening;
    });
    expect(native.show).not.toHaveBeenCalled();
    expect(menu.open).toBe(false);
  });

  it("does not open a menu after unmount while the event subscription is still pending", async () => {
    const subscription = deferred<() => void>();
    native.listen.mockImplementation((handler) => {
      receive = handler;
      return subscription.promise;
    });
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = menu.show(anchor(), items);
    });
    await harness.render(<div>Closed</div>);
    await act(async () => {
      subscription.resolve(unsubscribe);
      await opening;
    });
    expect(native.show).not.toHaveBeenCalled();
  });
});
