import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserNewTabAddress } from "./BrowserNewTabAddress";
import {
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

let harness: ReturnType<typeof createBrowserComponentHarness>;
const openAddress = vi.fn();
const translate = (key: string) => key;
const address = () =>
  harness.query<HTMLInputElement>("browser-new-tab-address");
const submit = () =>
  harness.dispatch(
    address().closest("form")!,
    new Event("submit", { bubbles: true, cancelable: true }),
  );
const keyDown = (options: ConstructorParameters<typeof KeyboardEvent>[1]) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  return harness.dispatch(address(), event).then(() => event);
};
const render = (active = true, sourceTabId = "new-tab-1") =>
  harness.render(
    <BrowserNewTabAddress
      sourceTabId={sourceTabId}
      active={active}
      onOpenAddress={openAddress}
      translate={translate}
    />,
  );

describe("BrowserNewTabAddress", () => {
  beforeEach(() => {
    harness = createBrowserComponentHarness();
    openAddress.mockReset().mockResolvedValue(undefined);
  });
  afterEach(async () => harness.unmount());

  it.each([
    ["localhost:3000/app", "http://localhost:3000/app"],
    ["example.com", "https://example.com/"],
    [
      "搜索页面",
      "https://www.google.com/search?q=%E6%90%9C%E7%B4%A2%E9%A1%B5%E9%9D%A2",
    ],
  ])(
    "submits the normalized address %s with its source New tab identity",
    async (draft, expected) => {
      await render();
      expect(document.activeElement).toBe(address());
      await harness.change(address(), draft);
      await submit();
      expect(openAddress).toHaveBeenCalledExactlyOnceWith(
        "new-tab-1",
        expected,
      );
    },
  );

  it("ignores blank input without opening the default search page", async () => {
    await render();
    await harness.change(address(), "  ");
    await submit();
    expect(openAddress).not.toHaveBeenCalled();
    expect(
      harness.query<HTMLButtonElement>("browser-new-tab-open").disabled,
    ).toBe(true);
  });

  it("keeps an invalid address draft and reports normalization failures without dispatching navigation", async () => {
    await render();
    await harness.change(address(), "example.com:99999");
    await submit();
    expect(openAddress).not.toHaveBeenCalled();
    expect(address().value).toBe("example.com:99999");
    expect(address().getAttribute("aria-invalid")).toBe("true");
  });

  it("awaits the canonical open request and prevents duplicate submissions", async () => {
    const request = deferred<void>();
    openAddress.mockReturnValue(request.promise);
    await render();
    await harness.change(address(), "example.com");
    await submit();
    await submit();
    expect(openAddress).toHaveBeenCalledTimes(1);
    expect(address().readOnly).toBe(true);
    expect(address().closest("form")!.getAttribute("aria-busy")).toBe("true");
    expect(
      harness.query<HTMLButtonElement>("browser-new-tab-open").disabled,
    ).toBe(true);
    await act(async () => request.resolve());
    expect(address().readOnly).toBe(false);
    expect(address().value).toBe("example.com");
  });

  it("keeps the original draft after failure and permits a real retry", async () => {
    openAddress.mockRejectedValueOnce(new Error("fixture failed"));
    await render();
    await harness.change(address(), "  example.com/path  ");
    await submit();
    expect(address().value).toBe("  example.com/path  ");
    expect(address().getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "agentChat.browserWorkspace.loadFailedTitle",
    );
    await submit();
    expect(openAddress).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("leaves the draft intact when Escape exits address editing", async () => {
    await render();
    await harness.change(address(), "pending edit");
    const event = await keyDown({ key: "Escape" });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(address());
    expect(address().value).toBe("pending edit");
    expect(openAddress).not.toHaveBeenCalled();
  });

  it("does not submit an IME candidate confirmation, then permits the next ordinary submit", async () => {
    await render();
    await harness.dispatch(
      address(),
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await harness.change(address(), "浏览器");
    expect(
      (await keyDown({ key: "Enter", isComposing: true })).defaultPrevented,
    ).toBe(true);
    expect(
      (await keyDown({ key: "Escape", isComposing: true })).defaultPrevented,
    ).toBe(false);
    expect(document.activeElement).toBe(address());
    await submit();
    expect(openAddress).not.toHaveBeenCalled();
    await harness.dispatch(
      address(),
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await submit();
    expect(openAddress).toHaveBeenCalledExactlyOnceWith(
      "new-tab-1",
      "https://www.google.com/search?q=%E6%B5%8F%E8%A7%88%E5%99%A8",
    );
  });

  it("only the active New tab handles address shortcuts or submissions", async () => {
    await render(false);
    expect(address().disabled).toBe(true);
    await harness.change(address(), "example.com");
    await submit();
    expect(openAddress).not.toHaveBeenCalled();
    let event = new KeyboardEvent("keydown", {
      key: "l",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await harness.dispatch(window.document.body, event);
    expect(event.defaultPrevented).toBe(false);
    await render();
    await act(async () => address().blur());
    event = new KeyboardEvent("keydown", {
      key: "l",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await harness.dispatch(window.document.body, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(address());
    expect(address().selectionEnd).toBe(address().value.length);
  });

  it("does not publish a rejected request into a closed New tab", async () => {
    const request = deferred<void>();
    openAddress.mockReturnValue(request.promise);
    await render();
    await harness.change(address(), "example.com");
    await submit();
    await harness.render(<div>different surface</div>);
    await act(async () =>
      request.reject(new Error("request failed after close")),
    );
    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(document.body.textContent).toBe("different surface");
  });
});
