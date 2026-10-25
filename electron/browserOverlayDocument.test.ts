// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserOverlayDocument } from "./browserOverlayDocument";
import type { BrowserMenuPresentation } from "./browserOverlayModel";

const select = vi.fn();
const dismiss = vi.fn();
const cleanupListeners: (() => void)[] = [];
let updateItems: (update: {
  menuId: string;
  items: BrowserMenuPresentation["items"];
}) => void;
function mount(
  items: BrowserMenuPresentation["items"],
  confirmation?: BrowserMenuPresentation["confirmation"],
  mode?: BrowserMenuPresentation["mode"],
) {
  const html = browserOverlayDocument({
    menuId: "more-1",
    anchor: { x: 900, y: 20, width: 24, height: 24 },
    items,
    ...(confirmation ? { confirmation } : {}),
    ...(mode ? { mode } : {}),
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  const state = parsed.querySelector("#state")!;
  document.body.append(state);
  const script = parsed.querySelector("script:not([type])")!.textContent!;
  // The production CSP hash authorizes this fixed script; tests provide its isolated DOM API.
  const api = window as unknown as {
    browserMenu: {
      select: typeof select;
      dismiss: typeof dismiss;
      onUpdate: (callback: typeof updateItems) => void;
    };
  };
  api.browserMenu = {
    select,
    dismiss,
    onUpdate: (callback) => {
      updateItems = callback;
    },
  };
  const execute = new Function(script);
  const addEventListener = document.addEventListener.bind(document);
  const listen = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, listener, options) => {
      addEventListener(type, listener, options);
      cleanupListeners.push(() =>
        document.removeEventListener(type, listener, options),
      );
    });
  execute();
  listen.mockRestore();
  return html;
}

afterEach(() => {
  cleanupListeners.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("trusted browser menu document", () => {
  it("renders safe address options without moving focus and updates the keyboard selection", () => {
    mount(
      [
        {
          id: "docs",
          label: "</script><img>",
          shortcut: "https://example.com/",
          checked: true,
        },
      ],
      undefined,
      "address",
    );
    expect(document.activeElement).toBe(document.body);
    expect(
      document.querySelector("[role=option]")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.querySelector("img")).toBeNull();
    updateItems({
      menuId: "more-1",
      items: [{ id: "other", label: "Other", checked: false }],
    });
    const option = document.querySelector<HTMLButtonElement>("[role=option]")!;
    const down = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.body);
    option.click();
    expect(select).toHaveBeenCalledExactlyOnceWith("more-1", "other");
  });
  it("renders a modal confirmation with cancel focused, a focus loop, safe text and one-shot actions", () => {
    mount(
      [
        { id: "cancel", label: "Cancel" },
        { id: "discard", label: "Discard" },
      ],
      {
        title: "Discard </script><img src=x>?",
        description: "All edits & comments",
      },
    );
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const buttons = dialog.querySelectorAll("button");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector("h1")?.textContent).toBe(
      "Discard </script><img src=x>?",
    );
    expect(document.querySelector("img")).toBeNull();
    expect(document.activeElement).toBe(buttons[0]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(buttons[1]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[0]);
    expect(dismiss).not.toHaveBeenCalled();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(dismiss).toHaveBeenCalledExactlyOnceWith("more-1", "escape");
    buttons[1].click();
    buttons[1].click();
    expect(select).toHaveBeenCalledExactlyOnceWith("more-1", "discard");
  });

  it("renders labels as text and escapes closing script carriers", () => {
    const label = "</script><img src=x onerror=alert(1)>&";
    const html = mount([{ id: "text", label }]);
    expect(document.querySelector(".label")?.textContent).toBe(label);
    expect(document.querySelector("img")).toBeNull();
    expect(html).toContain("script-src 'sha256-");
    expect(html).not.toContain("<img src=x");
  });

  it("renders zoom on one row and dispatches only enabled controls", () => {
    mount([
      {
        id: "zoom",
        label: "Zoom",
        controls: [
          { id: "out", label: "−" },
          { id: "reset", label: "100%" },
          { id: "in", label: "+", enabled: false },
        ],
      },
    ]);
    const row = document.querySelector('[role="group"]')!;
    expect(row.getAttribute("aria-label")).toBe("Zoom");
    expect(row.querySelectorAll("button")).toHaveLength(3);
    (row.querySelector('[data-id="reset"]') as HTMLButtonElement).click();
    (row.querySelector('[data-id="in"]') as HTMLButtonElement).click();
    expect(select.mock.calls).toEqual([["more-1", "reset"]]);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(select).toHaveBeenCalledTimes(1);
    const out = row.querySelector('[data-id="out"]') as HTMLButtonElement;
    out.focus();
    out.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.activeElement?.getAttribute("data-id")).toBe("reset");
  });

  it("opens submenus with the keyboard and returns focus to their parent", () => {
    mount([
      { id: "print", label: "Print" },
      {
        id: "tools",
        label: "Tools",
        submenu: [
          { id: "first", label: "First", enabled: false },
          { id: "second", label: "Second" },
        ],
      },
    ]);
    const tools = document.querySelector(
      '[data-id="tools"]',
    ) as HTMLButtonElement;
    tools.focus();
    tools.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(document.activeElement?.getAttribute("data-id")).toBe("second");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(document.activeElement).toBe(tools);
    expect(tools.getAttribute("aria-expanded")).toBe("false");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(document.activeElement?.getAttribute("data-id")).toBe("print");
  });

  it("updates the percentage and accessible names without replacing the focused control", () => {
    mount([
      {
        id: "zoom",
        label: "Zoom",
        controls: [
          { id: "out", label: "−", ariaLabel: "Zoom out" },
          { id: "reset", label: "100%", ariaLabel: "Reset zoom" },
        ],
      },
    ]);
    const control = document.querySelector(
      '[data-id="reset"]',
    ) as HTMLButtonElement;
    control.focus();
    updateItems({ menuId: "stale", items: [] });
    expect(control.textContent).toBe("100%");
    updateItems({
      menuId: "more-1",
      items: [
        {
          id: "zoom",
          label: "缩放",
          controls: [
            { id: "out", label: "−", ariaLabel: "缩小", enabled: false },
            { id: "reset", label: "125%", ariaLabel: "重置缩放" },
          ],
        },
      ],
    });
    expect(document.activeElement).toBe(control);
    expect(control.textContent).toBe("125%");
    expect(control.getAttribute("aria-label")).toBe("重置缩放");
    expect(
      (document.querySelector('[data-id="out"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
