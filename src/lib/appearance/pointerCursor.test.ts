import { beforeEach, describe, expect, it } from "vitest";
import {
  getPointerCursorsEnabled,
  resetPointerCursorsForTest,
  setPointerCursorsEnabled,
} from "./pointerCursor";

describe("pointerCursor", () => {
  beforeEach(() => resetPointerCursorsForTest());

  it("persists the pointer cursor preference", () => {
    expect(getPointerCursorsEnabled()).toBe(false);
    setPointerCursorsEnabled(true);
    expect(getPointerCursorsEnabled()).toBe(true);
  });
});
