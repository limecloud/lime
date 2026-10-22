import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";
import type { BrowserTabState } from "@/lib/api/browserTab";
import {
  browserState,
  createBrowserComponentHarness,
  deferred,
} from "./browserWorkspace.testFixtures";

const native = vi.hoisted(() => ({ setDevice: vi.fn() }));
vi.mock("@/lib/api/browserTab", () => ({
  setBrowserTabDevice: native.setDevice,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
let harness: ReturnType<typeof createBrowserComponentHarness>;
const device = {
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
const submit = () =>
  harness.dispatch(
    input("width").closest("form")!,
    new Event("submit", { bubbles: true, cancelable: true }),
  );

describe("BrowserDeviceToolbar", () => {
  beforeEach(() => {
    harness = createBrowserComponentHarness();
    vi.clearAllMocks();
    native.setDevice.mockResolvedValue(selected());
  });
  afterEach(async () => harness.unmount());

  it("preserves the viewport draft across unrelated native snapshots and applies it to the same tab", async () => {
    await render();
    await harness.change(input("width"), "640");
    await harness.change(input("height"), "900");
    await render({
      title: "Changed title",
      isLoading: true,
      zoomFactor: 1.2,
      pageRevision: 8,
      device: { ...device },
    });
    expect(input("width").value).toBe("640");
    expect(input("height").value).toBe("900");
    await submit();
    expect(native.setDevice).toHaveBeenCalledExactlyOnceWith(selected().tabId, {
      ...device,
      width: 640,
      height: 900,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["width", "99"],
    ["height", "10001"],
    ["width", "101.5"],
    ["deviceScaleFactor", "9"],
    ["height", ""],
  ])("blocks invalid %s=%s before the native gateway", async (field, value) => {
    await render();
    await harness.change(input(field), value);
    await submit();
    expect(native.setDevice).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "browserChrome.deviceError",
    );
  });

  it("prevents duplicate native requests while a viewport change is pending", async () => {
    const pending = deferred<BrowserTabState>();
    native.setDevice.mockReturnValue(pending.promise);
    await render();
    await submit();
    await submit();
    expect(native.setDevice).toHaveBeenCalledTimes(1);
    expect(input("width").disabled).toBe(true);
    expect(input("width").closest("form")!.getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => pending.resolve(selected()));
    expect(input("width").disabled).toBe(false);
  });

  it("rotates the current viewport and closes emulation through the actual device gateway", async () => {
    await render();
    const rotate = document.querySelector<HTMLButtonElement>(
      "button[aria-label='browserChrome.rotate']",
    )!;
    await harness.dispatch(rotate, new MouseEvent("click", { bubbles: true }));
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, {
      ...device,
      width: 844,
      height: 390,
    });
    const close = document.querySelector<HTMLButtonElement>(
      "button[aria-label='browserChrome.closeDevice']",
    )!;
    await harness.dispatch(close, new MouseEvent("click", { bubbles: true }));
    expect(native.setDevice).toHaveBeenLastCalledWith(selected().tabId, null);
  });

  it("replaces the draft only when the native device settings or tab identity changes", async () => {
    await render();
    await harness.change(input("width"), "640");
    await render({ device: { ...device, width: 820 } });
    expect(input("width").value).toBe("820");
    await harness.change(input("width"), "900");
    await render({ tabId: "other-tab", device: { ...device, width: 768 } });
    expect(input("width").value).toBe("768");
  });
});
