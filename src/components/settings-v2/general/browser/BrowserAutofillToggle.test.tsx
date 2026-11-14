import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAutofillToggle } from "./BrowserAutofillToggle";

const api = vi.hoisted(() => ({ read: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/api/browserAutofill", () => ({
  readBrowserAutofillEnabled: api.read,
  setBrowserAutofillEnabled: api.set,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.read.mockResolvedValue(true);
  api.set.mockResolvedValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BrowserAutofillToggle", () => {
  it("读取当前状态并切换", async () => {
    await act(async () => root.render(<BrowserAutofillToggle />));
    await act(async () => Promise.resolve());
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(api.set).toHaveBeenCalledWith(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});
