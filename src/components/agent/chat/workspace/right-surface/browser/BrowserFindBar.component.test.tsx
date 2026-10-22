import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserFindBar } from "./BrowserFindBar";
import { browserState, createBrowserComponentHarness } from "./browserWorkspace.testFixtures";

const host = vi.hoisted(() => ({ find: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/api/browserTab", () => ({
  findInBrowserTab: host.find,
  stopFindInBrowserTab: host.stop,
}));

const run = async (operation: () => Promise<unknown>) => {
  await operation();
};
let harness: ReturnType<typeof createBrowserComponentHarness>;
const keyDown = async (element: HTMLElement, options: ConstructorParameters<typeof KeyboardEvent>[1]) => harness.dispatch(element, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options }));
const translate = (key: string) => key;
const input = () => harness.query<HTMLInputElement>("browser-workspace-find-input");
const props = { selected: browserState(), translate, run, onClose: vi.fn() };

describe("BrowserFindBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = createBrowserComponentHarness();
    host.find.mockResolvedValue(browserState());
    host.stop.mockResolvedValue(browserState());
  });
  afterEach(async () => harness.unmount());

  it("finds while typing, then uses Enter and Shift+Enter for next and previous", async () => {
    await harness.render(<BrowserFindBar {...props} />);
    await harness.change(input(), "Example");
    expect(host.find).toHaveBeenLastCalledWith({
      tabId: props.selected.tabId,
      text: "Example",
      forward: true,
      findNext: false,
    });
    await keyDown(input(), { key: "Enter" });
    expect(host.find).toHaveBeenLastCalledWith({
      tabId: props.selected.tabId,
      text: "Example",
      forward: true,
      findNext: true,
    });
    await keyDown(input(), { key: "Enter", shiftKey: true });
    expect(host.find).toHaveBeenLastCalledWith({
      tabId: props.selected.tabId,
      text: "Example",
      forward: false,
      findNext: true,
    });
  });

  it("clears native matches without closing the input when its text is cleared", async () => {
    await harness.render(<BrowserFindBar {...props} />);
    await harness.change(input(), "Example");
    await harness.change(input(), "");
    expect(host.stop).toHaveBeenCalledExactlyOnceWith(props.selected.tabId);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
  });

  it("ignores IME Enter, closes on Escape, and clears only the original tab on unmount", async () => {
    await harness.render(<BrowserFindBar {...props} />);
    await harness.change(input(), "中文");
    host.find.mockClear();
    await keyDown(input(), { key: "Enter", isComposing: true });
    expect(host.find).not.toHaveBeenCalled();
    await keyDown(input(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
    await harness.unmount();
    expect(host.stop).toHaveBeenCalledExactlyOnceWith(props.selected.tabId);
  });
});
