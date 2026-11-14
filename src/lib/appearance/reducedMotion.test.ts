import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReducedMotionPreference,
  isReducedMotionPreferred,
  resetReducedMotionForTest,
  resolveReducedMotionAttribute,
  setReducedMotionPreference,
} from "./reducedMotion";

describe("reducedMotion", () => {
  beforeEach(() => resetReducedMotionForTest());

  it("defaults to the system and resolves explicit values", () => {
    expect(getReducedMotionPreference()).toBe("system");
    expect(resolveReducedMotionAttribute("system")).toBeNull();
    expect(resolveReducedMotionAttribute("on")).toBe("true");
    expect(resolveReducedMotionAttribute("off")).toBe("false");
  });

  it("persists and honors an explicit preference over the OS", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
    );
    setReducedMotionPreference("off");
    expect(getReducedMotionPreference()).toBe("off");
    expect(isReducedMotionPreferred()).toBe(false);
    setReducedMotionPreference("on");
    expect(isReducedMotionPreferred()).toBe(true);
    setReducedMotionPreference("system");
    expect(isReducedMotionPreferred()).toBe(true);
    vi.unstubAllGlobals();
  });
});
