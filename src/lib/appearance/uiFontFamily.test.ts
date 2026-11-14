import { beforeEach, describe, expect, it } from "vitest";
import {
  getUiFontFamily,
  resetUiFontFamilyForTest,
  setUiFontFamily,
  resolveUiFontFamily,
} from "./uiFontFamily";

describe("uiFontFamily", () => {
  beforeEach(() => resetUiFontFamilyForTest());

  it("persists a supported family and resolves CSS stacks", () => {
    expect(getUiFontFamily()).toBe("system");
    setUiFontFamily("mono");
    expect(getUiFontFamily()).toBe("mono");
    expect(resolveUiFontFamily("mono")).toContain("monospace");
  });
});
