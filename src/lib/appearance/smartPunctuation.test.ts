import { beforeEach, describe, expect, it } from "vitest";
import {
  applySmartPunctuation,
  getSmartPunctuationEnabled,
  resetSmartPunctuationForTest,
  setSmartPunctuationEnabled,
} from "./smartPunctuation";

describe("smartPunctuation", () => {
  beforeEach(() => resetSmartPunctuationForTest());

  it("converts quotes, dashes, ellipses, and arrows", () => {
    expect(applySmartPunctuation('"hi" -- ok... -> done')).toBe(
      "“hi” – ok… → done",
    );
  });

  it("persists the preference", () => {
    expect(getSmartPunctuationEnabled()).toBe(false);
    setSmartPunctuationEnabled(true);
    expect(getSmartPunctuationEnabled()).toBe(true);
  });
});
