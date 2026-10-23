import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { BrowserAnnotationOriginalButton } from "./BrowserAnnotationOriginalButton";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const native = vi.hoisted(() => ({ original: vi.fn() }));
vi.mock("@/lib/api/browserAnnotation", () => ({
  setBrowserAnnotationOriginal: native.original,
}));
let harness: ReturnType<typeof createBrowserComponentHarness>;
const tab = browserState();
const onError = vi.fn();
const onFailure = vi.fn();
const text = (key: string) =>
  String(getLimeI18n().t(`browserAnnotation.${key}`, { ns: "agent" }));
const render = (selected = tab, disabled = false) =>
  harness.render(
    <BrowserAnnotationOriginalButton
      selected={selected}
      disabled={disabled}
      label={text("original")}
      hint={text("holdOriginal")}
      onFailure={onFailure}
      onError={onError}
    />,
  );
const button = () => document.querySelector("button")!;
const pointer = (type: string, mouseButton = 0) =>
  act(async () => {
    button().dispatchEvent(
      new MouseEvent(type, { bubbles: true, button: mouseButton }),
    );
  });
const key = (type: string, key: string, repeat = false) =>
  act(async () => {
    button().dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, key, repeat }),
    );
  });

beforeEach(async () => {
  await changeLimeLocale("en-US");
  vi.clearAllMocks();
  native.original.mockResolvedValue(undefined);
  harness = createBrowserComponentHarness();
});
afterEach(async () => {
  await harness.unmount();
  await changeLimeLocale("zh-CN");
});

describe("hold original page control", () => {
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "holds with the pointer and releases without toggling or sending in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      await render();
      const resources = getLimeI18n().getResourceBundle(locale, "agent");
      for (const key of ["original", "holdOriginal", "originalFailed"]) {
        const value =
          resources.browserAnnotation?.[key] ??
          resources[`browserAnnotation.${key}`];
        expect(value).toEqual(expect.any(String));
        expect(value.trim()).not.toBe("");
      }
      expect(button().textContent).toBe(text("original"));
      expect(button().getAttribute("aria-label")).toBe(text("holdOriginal"));
      await pointer("pointerdown", 2);
      expect(native.original).not.toHaveBeenCalled();
      await pointer("pointerdown");
      expect(button().getAttribute("aria-pressed")).toBe("true");
      const id = native.original.mock.calls[0][1];
      expect(native.original).toHaveBeenNthCalledWith(1, tab, id, true);
      await pointer("pointerup");
      expect(native.original).toHaveBeenNthCalledWith(2, tab, id, false);
      await act(async () => button().click());
      expect(native.original).toHaveBeenCalledTimes(2);
      expect(button().getAttribute("aria-pressed")).toBe("false");
    },
  );

  it.each([" ", "Enter"])(
    "supports holding %j and ignores keyboard repeat",
    async (pressed) => {
      await render();
      await key("keydown", pressed);
      await key("keydown", pressed, true);
      expect(native.original).toHaveBeenCalledTimes(1);
      await key("keyup", pressed);
      expect(native.original.mock.calls.map((call) => call[2])).toEqual([
        true,
        false,
      ]);
    },
  );

  it("serializes fast release/repress behind a delayed receipt with distinct gestures", async () => {
    const first = deferred<void>();
    native.original.mockImplementationOnce(() => first.promise);
    await render();
    await pointer("pointerdown");
    await pointer("pointerup");
    await pointer("pointerdown");
    await pointer("pointerup");
    expect(native.original).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve());
    expect(native.original.mock.calls.map((call) => call[2])).toEqual([
      true,
      false,
      true,
      false,
    ]);
    const ids = native.original.mock.calls.map((call) => call[1]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it.each(["pointercancel", "lostpointercapture", "focusout", "window-blur"])(
    "releases on %s",
    async (type) => {
      await render();
      await pointer("pointerdown");
      await act(async () => {
        if (type === "window-blur") window.dispatchEvent(new Event("blur"));
        else button().dispatchEvent(new Event(type, { bubbles: true }));
      });
      expect(native.original.mock.calls.map((call) => call[2])).toEqual([
        true,
        false,
      ]);
    },
  );

  it("releases the old page on navigation, disabling or unmount, without using the new identity", async () => {
    await render();
    await pointer("pointerdown");
    const oldId = native.original.mock.calls[0][1];
    const next = { ...tab, pageRevision: tab.pageRevision + 1 };
    await render(next);
    expect(native.original).toHaveBeenLastCalledWith(tab, oldId, false);
    await pointer("pointerdown");
    await render(next, true);
    expect(native.original).toHaveBeenLastCalledWith(
      next,
      expect.any(String),
      false,
    );
    await pointer("pointerdown");
    expect(native.original).toHaveBeenCalledTimes(4);
    await render(next);
    await pointer("pointerdown");
    await harness.unmount();
    expect(native.original).toHaveBeenLastCalledWith(
      next,
      expect.any(String),
      false,
    );
  });

  it("reports a rejected start and clears its pressed state while still attempting release", async () => {
    native.original.mockRejectedValueOnce(new Error("stale page"));
    await render();
    await pointer("pointerdown");
    expect(onError).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenLastCalledWith(true);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(native.original.mock.calls.map((call) => call[2])).toEqual([
      true,
      false,
    ]);
  });
});
