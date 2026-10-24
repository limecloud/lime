import { describe, expect, it } from "vitest";
import {
  resizeBrowserDevice,
  rotateBrowserDevice,
  isValidBrowserDevice,
} from "./browserDeviceModel";
import { layoutBrowserDevice } from "@/lib/browserDeviceLayout";

describe("native device layout and responsive resize", () => {
  const device = {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    scale: 1,
    mobile: true,
  };

  it.each([
    { width: 200, height: 1000 },
    { width: 1000, height: 300 },
    { width: 333, height: 555 },
  ])(
    "fits both axes without changing DPR or emulated dimensions: %j",
    (bounds) => {
      const fitted = layoutBrowserDevice({ x: 10, y: 20, ...bounds }, device);
      expect(fitted.bounds.width).toBeLessThanOrEqual(bounds.width - 40);
      expect(fitted.bounds.height).toBeLessThanOrEqual(bounds.height - 20);
      expect(fitted.bounds.x).toBeGreaterThanOrEqual(30);
      expect(fitted.bounds.y).toBe(20);
      expect(device.scale).toBe(1);
    },
  );

  it("caps fit at 100% instead of magnifying a small device", () => {
    expect(
      layoutBrowserDevice({ x: 0, y: 0, width: 2000, height: 2000 }, device)
        .scale,
    ).toBe(1);
  });

  it.each([
    { width: 0, height: 1000 },
    { width: 1, height: 1 },
  ])("hides a device with no available space %j", (bounds) => {
    expect(
      layoutBrowserDevice({ x: 0, y: 0, ...bounds }, device),
    ).toMatchObject({ scale: 0, bounds: { width: 0, height: 0 } });
  });

  it("allows automatic fit below the public 10% request minimum and honors a manual ceiling", () => {
    const bounds = { x: 0, y: 0, width: 50, height: 100 };
    expect(layoutBrowserDevice(bounds, device).scale).toBeLessThan(0.1);
    expect(
      layoutBrowserDevice(
        { ...bounds, width: 1000, height: 1000 },
        { ...device, scale: 0.25 },
      ).scale,
    ).toBe(0.25);
  });

  it.each([
    ["left", -10, 0, 430, 844],
    ["right", 10, 0, 430, 844],
    ["bottom", 10, 10, 390, 864],
    ["bottom-left", -10, 10, 430, 864],
    ["bottom-right", 10, 10, 430, 864],
  ] as const)(
    "resizes %s with a frozen scale and a centered horizontal origin",
    (edge, dx, dy, width, height) => {
      expect(resizeBrowserDevice(device, edge, dx, dy, 0.5)).toEqual({
        ...device,
        presetId: "responsive",
        width,
        height,
      });
    },
  );

  it("clamps responsive dimensions to the native contract", () => {
    expect(
      resizeBrowserDevice(device, "bottom-right", 10000, -10000, 0.1),
    ).toMatchObject({ width: 4096, height: 160 });
  });

  it.each([
    { width: 390.5 },
    { width: NaN },
    { height: 99 },
    { deviceScaleFactor: 9 },
    { scale: 0 },
  ])("does not repair or submit an invalid draft: %j", (patch) => {
    expect(isValidBrowserDevice({ ...device, ...patch })).toBe(false);
  });
});

describe("reference device rotation limits", () => {
  it("clamps the rotated dimensions and drops a mismatched named preset", () => {
    expect(
      rotateBrowserDevice({
        width: 240,
        height: 160,
        scale: 1,
        deviceScaleFactor: 2,
        mobile: false,
        presetId: "ipad-air",
      }),
    ).toMatchObject({ width: 240, height: 240, presetId: "responsive" });
    expect(
      rotateBrowserDevice({
        width: 1180,
        height: 820,
        scale: 1,
        deviceScaleFactor: 2,
        mobile: false,
        presetId: "ipad-air",
      }),
    ).toMatchObject({ width: 820, height: 1180, presetId: "ipad-air" });
  });
});
