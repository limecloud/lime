import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserNewTabAddress } from "./BrowserNewTabAddress";
import { BrowserNavigationBar } from "./BrowserNavigationBar";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const history = vi.hoisted(() => ({ list: vi.fn(), listen: vi.fn() }));
const menu = vi.hoisted(() => ({
  show: vi.fn(),
  update: vi.fn(),
  hide: vi.fn(),
  listen: vi.fn(),
}));
const host = vi.hoisted(() => ({
  navigate: vi.fn(),
  reload: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("@/lib/api/browserHistory", () => ({
  listBrowserHistory: history.list,
  listenBrowserHistoryChanged: history.listen,
}));
vi.mock("@/lib/api/browserMenu", () => ({
  showBrowserTabMenu: menu.show,
  updateBrowserTabMenu: menu.update,
  hideBrowserTabOverlay: menu.hide,
  listenBrowserMenuEvent: menu.listen,
}));
vi.mock("@/lib/api/browserTab", () => ({
  navigateBrowserTab: host.navigate,
  reloadBrowserTab: host.reload,
  focusBrowserTabPage: host.focus,
  stopBrowserTab: vi.fn(),
  goBackBrowserTab: vi.fn(),
  goForwardBrowserTab: vi.fn(),
}));
vi.mock("@/hooks/useBrowserPreferences", () => ({
  useBrowserPreferences: () => ({ show_full_url: false }),
}));
const entries = [
  {
    id: "example",
    url: "https://example.org/docs",
    title: "Example docs",
    visitCount: 4,
    firstVisitedAt: 1,
    lastVisitedAt: 10,
  },
  {
    id: "other",
    url: "https://other.example/",
    title: "Other example",
    visitCount: 2,
    firstVisitedAt: 1,
    lastVisitedAt: 8,
  },
];
const page = (rows = entries) => ({
  entries: rows,
  total: rows.length,
  revision: 1,
  nextCursor: null,
});
const translate = (key: string) => key;
const open = vi.fn();
let harness: ReturnType<typeof createBrowserComponentHarness>;
const input = () =>
  document.querySelector<HTMLInputElement>("[role=combobox]")!;
function NewTab({ owner = "new-1" }: { owner?: string }) {
  const [draft, setDraft] = useState("");
  return (
    <BrowserNewTabAddress
      sourceTabId={owner}
      active
      draft={draft}
      onDraftChange={setDraft}
      onOpenAddress={open}
      translate={translate}
    />
  );
}
const key = async (
  key: string,
  extra: ConstructorParameters<typeof KeyboardEvent>[1] = {},
) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  await harness.dispatch(input(), event);
  return event;
};
const submit = () =>
  harness.dispatch(
    input().closest("form")!,
    new Event("submit", { bubbles: true, cancelable: true }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  harness = createBrowserComponentHarness();
  history.list.mockResolvedValue(page());
  history.listen.mockResolvedValue(() => undefined);
  menu.listen.mockResolvedValue(() => undefined);
  menu.show.mockImplementation((_tab, presentation) =>
    Promise.resolve({
      menuId: presentation.menuId,
      generation: 4,
      visible: true,
    }),
  );
  menu.update.mockResolvedValue(undefined);
  menu.hide.mockResolvedValue(undefined);
  host.navigate.mockResolvedValue(browserState());
  host.reload.mockResolvedValue(browserState());
  host.focus.mockResolvedValue(browserState());
  open.mockResolvedValue(undefined);
});
afterEach(async () => harness.unmount());

describe("address history suggestions", () => {
  it("retains the original HTTP destination when the inline suffix is accepted with ArrowRight", async () => {
    history.list.mockResolvedValue(
      page([{ ...entries[0], url: "http://example.org/docs" }]),
    );
    await harness.render(<NewTab />);
    await harness.change(input(), "exa");
    await key("ArrowRight");
    await submit();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "new-1",
      "http://example.org/docs",
    );
  });
  it("selects only the inline suffix and submits the full retained history URL", async () => {
    await harness.render(<NewTab />);
    await harness.change(input(), "exa");
    expect(history.list).toHaveBeenCalledWith({ query: "exa", limit: 50 });
    expect(input().value).toBe("example.org/docs");
    expect([input().selectionStart, input().selectionEnd]).toEqual([3, 16]);
    expect(
      document.querySelector("[role=option][aria-selected=true]")?.textContent,
    ).toContain("Example docs");
    await submit();
    expect(open).toHaveBeenCalledExactlyOnceWith("new-1", entries[0].url);
  });
  it("cycles suggestions with arrows and restores the typed query before searching", async () => {
    await harness.render(<NewTab />);
    await harness.change(input(), "example query");
    expect(input().value).toBe("example query");
    expect((await key("ArrowDown")).defaultPrevented).toBe(true);
    expect(input().value).toBe(entries[0].url);
    await key("ArrowDown");
    expect(input().value).toBe(entries[1].url);
    await key("ArrowDown");
    expect(input().value).toBe("example query");
    await submit();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "new-1",
      "https://www.google.com/search?q=example%20query",
    );
  });
  it("opens a mouse-selected suggestion without issuing a duplicate form submit", async () => {
    await harness.render(<NewTab />);
    await harness.change(input(), "query");
    const option = document.querySelector<HTMLButtonElement>("[role=option]")!;
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await harness.dispatch(option, down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    await harness.dispatch(option, new MouseEvent("click", { bubbles: true }));
    expect(open).toHaveBeenCalledExactlyOnceWith("new-1", entries[0].url);
  });
  it("does not reinsert a deleted suffix and never completes an IME candidate", async () => {
    await harness.render(<NewTab />);
    await harness.change(input(), "exa");
    await key("Backspace");
    await harness.change(input(), "exa");
    expect(input().value).toBe("exa");
    await harness.dispatch(
      input(),
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await harness.change(input(), "ex");
    expect(input().value).toBe("ex");
    expect((await key("Enter", { isComposing: true })).defaultPrevented).toBe(
      true,
    );
    await submit();
    expect(open).not.toHaveBeenCalled();
    await harness.dispatch(
      input(),
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(input().value).toBe("ex");
  });
  it("ignores stale queries and results for a replaced source tab", async () => {
    const first = deferred<ReturnType<typeof page>>();
    history.list.mockReturnValueOnce(first.promise);
    await harness.render(<NewTab />);
    await harness.change(input(), "exa");
    await harness.change(input(), "other");
    expect(input().value).toBe("other.example/");
    await act(async () => first.resolve(page()));
    expect(input().value).toBe("other.example/");
    const next = deferred<ReturnType<typeof page>>();
    history.list.mockReturnValueOnce(next.promise);
    await harness.change(input(), "exa");
    await harness.render(<NewTab owner="new-2" />);
    await act(async () => next.resolve(page()));
    expect(input().value).toBe("exa");
    expect(document.querySelector("[role=listbox]")).toBeNull();
  });
  it("removes suggestions on history clear and preserves navigation when history is unavailable", async () => {
    await harness.render(<NewTab />);
    await harness.change(input(), "query");
    history.list.mockResolvedValueOnce(page([]));
    const changed = history.listen.mock.calls[0][0] as () => void;
    await act(async () => changed());
    expect(document.querySelector("[role=listbox]")).toBeNull();
    history.list.mockRejectedValueOnce(new Error("unavailable"));
    await harness.change(input(), "typed.example");
    await submit();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "new-1",
      "https://typed.example/",
    );
  });
  it("uses the trusted native popup and cleans up by menu identity", async () => {
    await harness.render(
      <BrowserNavigationBar
        selected={browserState()}
        translate={translate}
        run={async (operation) => {
          await operation();
        }}
      />,
    );
    await act(async () => input().focus());
    await harness.change(input(), "query");
    expect(document.activeElement).toBe(input());
    expect(document.querySelector("[role=listbox]")).toBeNull();
    expect(menu.show).toHaveBeenCalledOnce();
    const presentation = menu.show.mock.calls[0][1];
    expect(presentation.mode).toBe("address");
    await key("ArrowDown");
    expect(menu.update).toHaveBeenCalledWith(
      browserState().tabId,
      presentation.menuId,
      4,
      expect.arrayContaining([
        expect.objectContaining({ id: entries[0].id, checked: true }),
      ]),
    );
    await submit();
    expect(host.navigate).toHaveBeenCalledExactlyOnceWith(
      browserState().tabId,
      entries[0].url,
    );
    expect(menu.hide).toHaveBeenCalledWith(browserState().tabId, {
      menuId: presentation.menuId,
      generation: 4,
    });
  });
});
