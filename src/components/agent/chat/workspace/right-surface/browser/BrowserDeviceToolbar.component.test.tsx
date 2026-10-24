import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";
import type { BrowserTabState } from "@/lib/api/browserTab";
import zhCN from "@/i18n/resources/zh-CN/browserChrome.json";
import zhTW from "@/i18n/resources/zh-TW/browserChrome.json";
import enUS from "@/i18n/resources/en-US/browserChrome.json";
import jaJP from "@/i18n/resources/ja-JP/browserChrome.json";
import koKR from "@/i18n/resources/ko-KR/browserChrome.json";
import {
  browserState,
  createBrowserComponentHarness,
} from "./browserWorkspace.testFixtures";

const native = vi.hoisted(() => ({
  setDevice: vi.fn(),
  setZoom: vi.fn(),
  translations: {} as Record<string, string>,
}));
vi.mock("@/lib/api/browserTab", () => ({
  setBrowserTabDevice: native.setDevice,
  setBrowserTabZoom: native.setZoom,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => native.translations[key] ?? key,
  }),
}));
let harness: ReturnType<typeof createBrowserComponentHarness>;
const device = {
  presetId: "responsive" as const,
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  scale: 0.5,
  mobile: true,
};
const selected = (patch: Partial<BrowserTabState> = {}) =>
  browserState({ device, ...patch });
const run = vi.fn(async (operation: () => Promise<BrowserTabState>) => {
  await operation();
});
const render = (patch: Partial<BrowserTabState> = {}) =>
  harness.render(<BrowserDeviceToolbar selected={selected(patch)} run={run} />);
const input = (key: string) =>
  harness.query<HTMLInputElement>(`browser-device-${key}`);

describe("BrowserDeviceToolbar", () => {
  beforeEach(() => {
    harness = createBrowserComponentHarness();
    vi.clearAllMocks();
    native.translations = {};
    native.setDevice.mockResolvedValue(selected());
    native.setZoom.mockResolvedValue(selected());
  });
  afterEach(async () => {
    await harness.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the native preset identity instead of inferring it from the dimensions", async () => {
    await render({
      device: { ...device, presetId: "ipad-air", width: 820, height: 1180 },
    });
    const preset = document.querySelector<HTMLSelectElement>(
      "select[aria-label='browserChrome.device']",
    )!;
    expect(preset.value).toBe("ipad-air");
    await render({
      device: { ...device, presetId: "ipad-air", width: 1180, height: 820 },
    });
    expect(preset.value).toBe("ipad-air");
    await render({
      device: { ...device, presetId: "responsive", width: 820, height: 1180 },
    });
    expect(preset.value).toBe("responsive");
  });

  it("exposes every preset from the pinned reference in its original order", async () => {
    await render();
    const preset = document.querySelector<HTMLSelectElement>(
      "select[aria-label='browserChrome.device']",
    )!;
    expect(Array.from(preset.options, (option) => option.value)).toEqual([
      "responsive",
      "4k",
      "laptop-l",
      "laptop",
      "surface-pro-7",
      "ipad-air",
      "ipad-mini",
      "surface-duo",
      "iphone-15-pro-max",
      "pixel-8",
      "iphone-15-pro",
      "samsung-galaxy-s24-ultra",
      "iphone-se",
    ]);
  });

  it("selects a preset without changing native DPR/mobile/scale and resets page zoom", async () => {
    await render();
    const preset = document.querySelector<HTMLSelectElement>(
      "select[aria-label='browserChrome.device']",
    )!;
    preset.value = "ipad-air";
    await harness.dispatch(preset, new Event("change", { bubbles: true }));
    const tablet = native.setDevice.mock.calls.at(-1)![1];
    expect(tablet).toMatchObject({
      width: 820,
      height: 1180,
      presetId: "ipad-air",
      deviceScaleFactor: 3,
      mobile: true,
    });
    expect(tablet.scale).toBe(device.scale);
    expect(native.setZoom).toHaveBeenCalledWith(selected().tabId, 1);
    await render({ device: tablet });
    expect(preset.value).toBe("ipad-air");
    preset.value = "responsive";
    await harness.dispatch(preset, new Event("change", { bubbles: true }));
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
      ...tablet,
      presetId: "responsive",
    });
  });

  it.each([
    ["zh-CN", zhCN],
    ["zh-TW", zhTW],
    ["en-US", enUS],
    ["ja-JP", jaJP],
    ["ko-KR", koKR],
  ] as const)(
    "renders translated catalog labels and selects a named device in %s",
    async (_locale, translations) => {
      native.translations = translations;
      await render();
      const preset = document.querySelector<HTMLSelectElement>(
        `select[aria-label='${native.translations["browserChrome.device"]}']`,
      )!;
      const options = Array.from(
        preset.options,
        (option) => option.textContent,
      );
      expect(options).toHaveLength(13);
      expect(
        options.every((label) => label && !label.includes("browserChrome.")),
      ).toBe(true);
      expect(options).toContain("iPhone 15 Pro Max");
      expect(
        document.querySelector("label[for=browser-device-preset]")?.textContent,
      ).toBe(translations["browserChrome.dimensions"]);
      expect(
        document.querySelector(
          `select[aria-label='${translations["browserChrome.zoom"]}']`,
        ),
      ).not.toBeNull();
      preset.focus();
      preset.value = "iphone-15-pro-max";
      await harness.dispatch(preset, new Event("change", { bubbles: true }));
      expect(document.activeElement).not.toBe(preset);
      expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
        ...device,
        presetId: "iphone-15-pro-max",
        width: 430,
        height: 932,
        scale: device.scale,
      });
    },
  );

  it("edits dimensions immediately as responsive and preserves DPR/mobile", async () => {
    await render({
      device: { ...device, presetId: "ipad-air", width: 820, height: 1180 },
    });
    await harness.change(input("width"), "821");
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
      ...device,
      presetId: "responsive",
      width: 821,
      height: 1180,
    });
    expect(native.setZoom).not.toHaveBeenCalled();
  });

  it("does not send device commands for passive viewport or unrelated native updates", async () => {
    await render({ controlOwner: "agent", activeTurnId: "turn-1" });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    await render({ controlOwner: "agent", title: "Page changed" });
    expect(native.setDevice).not.toHaveBeenCalled();
  });

  it("preserves focused raw text through native receipts and clears it on tab identity changes", async () => {
    await render();
    await harness.change(input("width"), "640.2");
    await render({ device: { ...device, width: 640 } });
    expect(input("width").value).toBe("640.2");
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
      ...device,
      width: 640,
    });
    await render({ tabId: "other-tab", device: { ...device, width: 768 } });
    expect(input("width").value).toBe("768");
  });

  it("restores an empty dimension to native state on blur without sending an invalid request", async () => {
    await render();
    await harness.change(input("width"), "");
    expect(input("width").value).toBe("");
    await harness.dispatch(
      input("width"),
      new FocusEvent("focusout", { bubbles: true }),
    );
    expect(input("width").value).toBe("390");
    expect(native.setDevice).not.toHaveBeenCalled();
  });

  it("uses Enter to blur and round the focused number, without a separate form submission", async () => {
    await render();
    await act(async () => input("width").focus());
    await harness.change(input("width"), "640.6");
    await harness.dispatch(
      input("width"),
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(document.activeElement).not.toBe(input("width"));
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
      ...device,
      width: 641,
    });
    expect(document.querySelector("form")).toBeNull();
  });

  it("rotates and exits through the native gateway, clearing raw input and blurring buttons", async () => {
    await render();
    await harness.change(input("width"), "99");
    const rotate = document.querySelector<HTMLButtonElement>(
      "button[aria-label='browserChrome.rotate']",
    )!;
    await act(async () => rotate.focus());
    await harness.dispatch(rotate, new MouseEvent("click", { bubbles: true }));
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
      ...device,
      width: 844,
      height: 390,
    });
    expect(input("width").value).toBe("390");
    expect(document.activeElement).not.toBe(rotate);
    expect(native.setZoom).not.toHaveBeenCalled();
    const close = document.querySelector<HTMLButtonElement>(
      "button[aria-label='browserChrome.closeDevice']",
    )!;
    await harness.dispatch(close, new MouseEvent("click", { bubbles: true }));
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, null);
  });

  it("adds the current rendered zoom to the sorted reference options", async () => {
    await render({
      zoomFactor: 1.66,
      deviceViewport: {
        bounds: { x: 0, y: 0, width: 195, height: 422 },
        scale: 0.5,
      },
    });
    const zoom = document.querySelector<HTMLSelectElement>(
      "select[aria-label='browserChrome.zoom']",
    )!;
    expect(Array.from(zoom.options, (option) => option.value)).toEqual([
      "50",
      "75",
      "83",
      "100",
      "125",
      "150",
      "200",
    ]);
    expect(zoom.value).toBe("83");
  });

  it("hides zoom below 600px and makes Dimensions visually hidden below 460px", async () => {
    let resize = () => {};
    let width = 700;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width }) as DOMRect,
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    await render();
    const zoom = () =>
      document.querySelector("select[aria-label='browserChrome.zoom']");
    const label = () =>
      document.querySelector("label[for=browser-device-preset]")!;
    expect(zoom()).not.toBeNull();
    width = 599;
    await act(async () => resize());
    expect(zoom()).toBeNull();
    expect(label().className).not.toBe("sr-only");
    width = 459;
    await act(async () => resize());
    expect(label().className).toBe("sr-only");
    expect(native.setDevice).not.toHaveBeenCalled();
    expect(native.setZoom).not.toHaveBeenCalled();
  });
});
