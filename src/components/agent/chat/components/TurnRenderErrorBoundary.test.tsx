import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { TurnRenderErrorBoundary } from "./TurnRenderErrorBoundary";

let container: HTMLDivElement;
let root: Root;
let shouldThrow = true;

function Child() {
  if (shouldThrow) throw new Error("boom");
  return <span>turn-ok</span>;
}

beforeEach(async () => {
  await changeLimeLocale("en-US");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  shouldThrow = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TurnRenderErrorBoundary", () => {
  it("shows the fallback and retries rendering", () => {
    act(() =>
      root.render(
        <TurnRenderErrorBoundary turnId="turn-1">
          <Child />
        </TurnRenderErrorBoundary>,
      ),
    );
    expect(
      container.querySelector('[data-testid="turn-render-error"]'),
    ).not.toBeNull();

    shouldThrow = false;
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="turn-render-error-retry"]',
        )
        ?.click();
    });
    expect(container.textContent).toContain("turn-ok");
  });
});
