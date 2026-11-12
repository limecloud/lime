import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { PanelRenderErrorBoundary } from "./PanelRenderErrorBoundary";

let container: HTMLDivElement;
let root: Root;
let shouldThrow = true;

function Child() {
  if (shouldThrow) throw new Error("panel-boom");
  return <span>panel-ok</span>;
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

describe("PanelRenderErrorBoundary", () => {
  it("shows the fallback and retries rendering", () => {
    act(() =>
      root.render(
        <PanelRenderErrorBoundary
          messageKey="agentChat.messageList.summaryRenderError"
          defaultMessage="Summary panel failed to render"
          testId="summary-panel-render-error"
        >
          <Child />
        </PanelRenderErrorBoundary>,
      ),
    );
    expect(
      container.querySelector('[data-testid="summary-panel-render-error"]'),
    ).not.toBeNull();

    shouldThrow = false;
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(container.textContent).toContain("panel-ok");
  });
});
