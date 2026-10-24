import { describe, expect, it } from "vitest";
import {
  createWindow,
  resetMocks,
  setBoundsMock,
  webContentsViewCtorMock,
  emitWebContentsEvent,
} from "./embeddedBrowserHost.testFixtures";
import { ElectronEmbeddedBrowserHost } from "./embeddedBrowserHost";

describe("native Browser device viewport", () => {
  it("round-trips preset identity without deriving it from dimensions and rejects unknown ids without native mutation", async () => {
    resetMocks();
    const host = new ElectronEmbeddedBrowserHost();
    const window = createWindow();
    await host.invoke(window as never, "embedded_browser_view_mount", {
      viewId: "device",
      bounds: { x: 10, y: 20, width: 640, height: 500 },
    });
    const invoke = (device: unknown) =>
      host.invoke(window as never, "embedded_browser_view_set_device", {
        viewId: "device",
        device,
      });
    const device = {
      width: 820,
      height: 1180,
      deviceScaleFactor: 3,
      mobile: true,
      scale: 1,
    };
    for (const presetId of ["ipad-air", "responsive"]) {
      expect(await invoke({ ...device, presetId })).toMatchObject({
        device: { ...device, presetId },
      });
    }
    const wc = webContentsViewCtorMock.mock.results.at(-1)!.value.webContents;
    const before = host.resolveNativeView("device");
    const nativeCalls = wc.enableDeviceEmulation.mock.calls.length;
    const boundsCalls = setBoundsMock.mock.calls.length;
    for (const presetId of [
      "phone",
      "tablet",
      "unknown",
      "__proto__",
      null,
      1,
    ]) {
      await expect(invoke({ ...device, presetId })).rejects.toThrow("presetId");
      expect(host.resolveNativeView("device")).toEqual(before);
    }
    expect(wc.enableDeviceEmulation).toHaveBeenCalledTimes(nativeCalls);
    expect(setBoundsMock).toHaveBeenCalledTimes(boundsCalls);
    for (const patch of [
      { width: 239 },
      { height: 159 },
      { width: 4097 },
      { height: 4097 },
    ]) {
      await expect(invoke({ ...device, ...patch })).rejects.toThrow(
        "supported range",
      );
      expect(host.resolveNativeView("device")).toEqual(before);
    }
    expect(wc.enableDeviceEmulation).toHaveBeenCalledTimes(nativeCalls);
    expect(setBoundsMock).toHaveBeenCalledTimes(boundsCalls);
    host.dispose();
  });

  it("fits the real WCV, preserves the container across resize and restores it on exit", async () => {
    resetMocks();
    const host = new ElectronEmbeddedBrowserHost();
    const window = createWindow();
    const container = { x: 10, y: 20, width: 640, height: 500 };
    await host.invoke(window as never, "embedded_browser_view_mount", {
      viewId: "device",
      bounds: container,
    });
    const device = {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      scale: 1,
    };
    const state = await host.invoke(
      window as never,
      "embedded_browser_view_set_device",
      { viewId: "device", device },
    );
    expect(state).toMatchObject({
      device,
      deviceViewport: {
        bounds: { x: 219, y: 20, width: 222, height: 480 },
        scale: 480 / 844,
      },
    });
    expect(setBoundsMock).toHaveBeenLastCalledWith({
      x: 219,
      y: 20,
      width: 222,
      height: 480,
    });
    const wc = webContentsViewCtorMock.mock.results.at(-1)!.value.webContents;
    expect(wc.enableDeviceEmulation).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: 480 / 844, deviceScaleFactor: 3 }),
    );
    const larger = { ...container, width: 900, height: 1000 };
    const resized = await host.invoke(
      window as never,
      "embedded_browser_view_set_bounds",
      { viewId: "device", bounds: larger },
    );
    expect(resized).toMatchObject({ deviceViewport: { scale: 1 } });
    expect(host.resolveNativeView("device")).toMatchObject({
      containerBounds: larger,
    });
    const closed = await host.invoke(
      window as never,
      "embedded_browser_view_set_device",
      { viewId: "device", device: null },
    );
    expect(closed).toMatchObject({ device: null, deviceViewport: null });
    expect(setBoundsMock).toHaveBeenLastCalledWith(larger);
    expect(wc.disableDeviceEmulation).toHaveBeenCalledOnce();
    expect(host.resolveNativeView("device")?.state.navigationRevision).toBe(0);
    emitWebContentsEvent(
      "did-start-navigation",
      {},
      "https://example.com/child",
      false,
      false,
    );
    expect(host.resolveNativeView("device")?.state.navigationRevision).toBe(0);
    emitWebContentsEvent(
      "did-start-navigation",
      {},
      "https://example.com/",
      false,
      true,
    );
    expect(host.resolveNativeView("device")?.state.navigationRevision).toBe(1);
    emitWebContentsEvent(
      "did-start-navigation",
      {},
      "https://example.com/#anchor",
      true,
      true,
    );
    expect(host.resolveNativeView("device")?.state.navigationRevision).toBe(2);
    host.dispose();
  });
  it("keeps hidden tabs hidden and restores the last full container after an unavailable layout", async () => {
    resetMocks();
    const host = new ElectronEmbeddedBrowserHost();
    const window = createWindow();
    const invoke = (command: string, args = {}) =>
      host.invoke(window as never, command as never, {
        viewId: "device",
        ...args,
      });
    await invoke("embedded_browser_view_mount", {
      bounds: { x: 10, y: 20, width: 20, height: 10 },
      visible: false,
    });
    const device = {
      width: 4096,
      height: 4096,
      deviceScaleFactor: 1,
      mobile: false,
      scale: 1,
    };
    const hidden = await invoke("embedded_browser_view_set_device", { device });
    expect(hidden).toMatchObject({
      deviceViewport: { scale: 0, bounds: { width: 0, height: 0 } },
    });
    const wc = webContentsViewCtorMock.mock.results.at(-1)!.value.webContents;
    expect(wc.enableDeviceEmulation).not.toHaveBeenCalled();
    const container = { x: 10, y: 20, width: 100, height: 100 };
    await invoke("embedded_browser_view_set_bounds", {
      bounds: container,
      visible: false,
    });
    expect(host.resolveNativeView("device")?.state.deviceViewport?.scale).toBe(
      60 / 4096,
    );
    const snapshot = host.resolveNativeView("device")!;
    snapshot.containerBounds.width = 1;
    expect(host.resolveNativeView("device")?.containerBounds).toEqual(
      container,
    );
    await invoke("embedded_browser_view_set_device", { device: null });
    expect(setBoundsMock).toHaveBeenLastCalledWith(container);
    host.dispose();
  });
});
