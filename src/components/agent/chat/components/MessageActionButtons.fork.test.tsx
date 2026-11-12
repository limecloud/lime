import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { MessageActionButtons } from "./MessageActionButtons";

let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("MessageActionButtons fork", () => {
  it("renders the retry action and calls the handler", () => {
    const onRetry = vi.fn();
    const root = createRoot(container);
    act(() =>
      root.render(
        <MessageActionButtons
          actionContent="reply"
          canCopyMessage
          canQuoteMessage={false}
          copied={false}
          isImageWorkbenchMessage={false}
          messageId="message-1"
          onRetry={onRetry}
        />,
      ),
    );
    const more = container.querySelector<HTMLButtonElement>(
      '[data-testid="message-actions-more"]',
    );
    act(() => more?.click());
    const retry = document.body.querySelector<HTMLElement>(
      '[data-testid="message-action-retry"]',
    );
    expect(retry).not.toBeNull();
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("renders the fork action and calls the handler", () => {
    const onFork = vi.fn();
    const root = createRoot(container);
    act(() =>
      root.render(
        <MessageActionButtons
          actionContent="reply"
          canCopyMessage
          canQuoteMessage={false}
          copied={false}
          isImageWorkbenchMessage={false}
          messageId="message-1"
          onFork={onFork}
        />,
      ),
    );
    const more = container.querySelector<HTMLButtonElement>(
      '[data-testid="message-actions-more"]',
    );
    expect(more).not.toBeNull();
    act(() => more?.click());
    const fork = document.body.querySelector<HTMLElement>(
      '[data-testid="message-action-fork"]',
    );
    expect(fork).not.toBeNull();
    act(() => fork?.click());
    expect(onFork).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
