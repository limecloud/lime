import { describe, expect, it } from "vitest";
import { getDefaultContentPaneWidth } from "./contentPaneWidth";

describe("content pane default geometry", () => {
  it("reserves usable content and chat widths in the shipped unified layout", () => {
    expect(getDefaultContentPaneWidth(1100, 1000)).toBe(640);
    expect(getDefaultContentPaneWidth(1600, 1000)).toBe(1100);
    expect(getDefaultContentPaneWidth(1600, 400)).toBe(640);
    expect(getDefaultContentPaneWidth(700, 800)).toBe(348);
    expect(getDefaultContentPaneWidth(640, 800)).toBe(320);
    expect(getDefaultContentPaneWidth(1200, 800, 500)).toBe(500);
    expect(getDefaultContentPaneWidth(800, 800, 1000)).toBe(520);
  });
});
