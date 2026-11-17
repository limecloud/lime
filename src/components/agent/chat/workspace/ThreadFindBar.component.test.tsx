import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ThreadFindBar } from "./ThreadFindBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let root: Root;
let container: HTMLDivElement;
let registry: Map<string, FakeHighlight>;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  registry = new Map();
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: { highlights: registry },
  });
  Object.defineProperty(window, "Highlight", {
    configurable: true,
    value: FakeHighlight,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("ThreadFindBar", () => {
  it("打开后统计会话文本并建立高亮", async () => {
    const messages = document.createElement("div");
    messages.dataset.testid = "message-list";
    messages.textContent = "needle in one needle in two";
    document.body.append(messages);
    await act(async () => {
      root.render(<ThreadFindBar />);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("lime:open-thread-find"));
    });
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="thread-find-input"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "needle");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      document.querySelector('[data-testid="thread-find-count"]')?.textContent,
    ).toBe("1 / 2");
    expect(registry.get("lime-thread-find")?.ranges).toHaveLength(2);
    expect(registry.get("lime-thread-find-active")?.ranges).toHaveLength(1);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Next match"]')
        ?.click();
    });
    expect(
      document.querySelector('[data-testid="thread-find-count"]')?.textContent,
    ).toBe("2 / 2");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Previous match"]')
        ?.click();
    });
    expect(
      document.querySelector('[data-testid="thread-find-count"]')?.textContent,
    ).toBe("1 / 2");
  });
});
