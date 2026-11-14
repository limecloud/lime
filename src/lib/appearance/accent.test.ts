import { beforeEach, describe, expect, it } from "vitest";
import {
  getAccentColor,
  resetAccentColorForTest,
  setAccentColor,
  ACCENT_PALETTES,
} from "./accent";

describe("accent", () => {
  beforeEach(() => resetAccentColorForTest());

  it("persists an accent and exposes its palette", () => {
    expect(getAccentColor()).toBe("default");
    setAccentColor("purple");
    expect(getAccentColor()).toBe("purple");
    expect(ACCENT_PALETTES.purple?.brand).toBe("#8b5cf6");
  });
});
