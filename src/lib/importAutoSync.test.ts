import { beforeEach, describe, expect, it } from "vitest";
import {
  getImportAutoSyncEnabled,
  resetImportAutoSyncForTest,
  setImportAutoSyncEnabled,
} from "./importAutoSync";

describe("importAutoSync", () => {
  beforeEach(() => resetImportAutoSyncForTest());

  it("persists the auto sync preference", () => {
    expect(getImportAutoSyncEnabled()).toBe(false);
    setImportAutoSyncEnabled(true);
    expect(getImportAutoSyncEnabled()).toBe(true);
  });
});
