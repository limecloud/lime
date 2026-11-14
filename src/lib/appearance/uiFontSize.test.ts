import { beforeEach, describe, expect, it } from "vitest";
import { getUiFontSize, resetUiFontSizeForTest, setUiFontSize } from "./uiFontSize";

describe("uiFontSize", () => {
  beforeEach(() => resetUiFontSizeForTest());

  it("persists a supported UI font size", () => {
    expect(getUiFontSize()).toBe(14);
    setUiFontSize(16);
    expect(getUiFontSize()).toBe(16);
  });
});
