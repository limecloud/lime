import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getComposerPermissionVisibility,
  resetComposerPermissionVisibilityForTest,
  setComposerPermissionVisibility,
  subscribeComposerPermissionVisibility,
} from "./composerPermissionVisibility";

describe("composerPermissionVisibility", () => {
  beforeEach(() => resetComposerPermissionVisibilityForTest());

  it("persists composer permission visibility and notifies listeners", () => {
    const listener = vi.fn();
    const stop = subscribeComposerPermissionVisibility(listener);
    setComposerPermissionVisibility({ defaultPermission: false, fullAccess: false });
    expect(getComposerPermissionVisibility()).toEqual({
      defaultPermission: false,
      fullAccess: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
