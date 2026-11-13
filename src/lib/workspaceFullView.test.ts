import { describe, expect, it, vi } from "vitest";
import {
  applyWorkspaceFullViewDefault,
  isWorkspaceFullViewDefaultEnabled,
  isWorkspaceFullViewEnabled,
  resetWorkspaceFullViewForTest,
  setWorkspaceFullView,
  setWorkspaceFullViewDefaultEnabled,
  subscribeWorkspaceFullView,
  toggleWorkspaceFullView,
} from "./workspaceFullView";

describe("workspaceFullView", () => {
  it("toggles and notifies subscribers", () => {
    resetWorkspaceFullViewForTest();
    const listener = vi.fn();
    const stop = subscribeWorkspaceFullView(listener);
    toggleWorkspaceFullView();
    expect(isWorkspaceFullViewEnabled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setWorkspaceFullView(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setWorkspaceFullView(false);
    expect(isWorkspaceFullViewEnabled()).toBe(false);
    stop();
    resetWorkspaceFullViewForTest();
  });

  it("applies the persisted default full view preference", () => {
    resetWorkspaceFullViewForTest();
    expect(isWorkspaceFullViewDefaultEnabled()).toBe(false);
    setWorkspaceFullView(false);
    setWorkspaceFullViewDefaultEnabled(true);
    setWorkspaceFullView(false);
    applyWorkspaceFullViewDefault();
    expect(isWorkspaceFullViewEnabled()).toBe(true);
    resetWorkspaceFullViewForTest();
    expect(isWorkspaceFullViewDefaultEnabled()).toBe(false);
  });
});
