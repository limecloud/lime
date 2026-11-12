import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { MessageListDateDivider } from "./MessageListDateDivider";

let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("MessageListDateDivider", () => {
  it("renders today's label with time", () => {
    const root = createRoot(container);
    act(() =>
      root.render(<MessageListDateDivider timestamp={new Date()} />),
    );
    expect(container.textContent).toMatch(/Today \d{2}:\d{2}/);
    act(() => root.unmount());
  });

  it("renders yesterday's label", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const root = createRoot(container);
    act(() =>
      root.render(<MessageListDateDivider timestamp={yesterday} />),
    );
    expect(container.textContent).toMatch(/Yesterday \d{2}:\d{2}/);
    act(() => root.unmount());
  });

  it("renders nothing for invalid timestamps", () => {
    const root = createRoot(container);
    act(() => root.render(<MessageListDateDivider timestamp={null} />));
    expect(container.textContent).toBe("");
    act(() => root.unmount());
  });
});
