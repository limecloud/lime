import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ForkFromTurnDialog } from "./ForkFromTurnDialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("ForkFromTurnDialog", () => {
  it("confirms and cancels the older-turn fork", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    act(() =>
      root.render(
        <ForkFromTurnDialog
          open
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />,
      ),
    );
    expect(document.body.textContent).toContain("Create chat fork from here");
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="fork-from-turn-confirm"]',
        )
        ?.click();
    });
    expect(onConfirm).toHaveBeenCalledWith("local");
  });

  it("selects the worktree option when available", () => {
    const onConfirm = vi.fn();
    act(() =>
      root.render(
        <ForkFromTurnDialog
          open
          worktreeAvailable
          onOpenChange={vi.fn()}
          onConfirm={onConfirm}
        />,
      ),
    );
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="fork-from-turn-use-worktree"]',
        )
        ?.click();
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="fork-from-turn-confirm"]',
        )
        ?.click();
    });
    expect(onConfirm).toHaveBeenCalledWith("worktree");
  });
});
