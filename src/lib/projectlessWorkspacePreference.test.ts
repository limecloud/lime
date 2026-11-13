import { beforeEach, describe, expect, it } from "vitest";
import {
  getProjectlessWorkspaceRoot,
  resetProjectlessWorkspaceRootForTest,
  setProjectlessWorkspaceRoot,
} from "./projectlessWorkspacePreference";

describe("projectlessWorkspacePreference", () => {
  beforeEach(() => resetProjectlessWorkspaceRootForTest());

  it("persists and clears the projectless workspace root", () => {
    expect(getProjectlessWorkspaceRoot()).toBeNull();
    setProjectlessWorkspaceRoot("/tmp/lime-projectless");
    expect(getProjectlessWorkspaceRoot()).toBe("/tmp/lime-projectless");
    setProjectlessWorkspaceRoot(null);
    expect(getProjectlessWorkspaceRoot()).toBeNull();
  });
});
