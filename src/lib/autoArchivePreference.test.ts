import { beforeEach, describe, expect, it } from "vitest";
import {
  getAutoArchivePreference,
  resetAutoArchivePreferenceForTest,
  setAutoArchivePreference,
} from "./autoArchivePreference";

describe("autoArchivePreference", () => {
  beforeEach(() => resetAutoArchivePreferenceForTest());

  it("defaults to never and persists a selected interval", () => {
    expect(getAutoArchivePreference()).toEqual({ days: 0, lastRunAt: null });
    setAutoArchivePreference({ days: 30, lastRunAt: 123 });
    expect(getAutoArchivePreference()).toEqual({ days: 30, lastRunAt: 123 });
  });
});
