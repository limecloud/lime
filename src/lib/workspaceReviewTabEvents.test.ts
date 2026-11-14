import { describe, expect, it, vi } from "vitest";
import {
  requestWorkspaceReviewTab,
  requestWorkspaceReviewTabClose,
  requestWorkspaceReviewTabToggle,
  subscribeWorkspaceReviewTabRequest,
} from "./workspaceReviewTabEvents";

describe("workspaceReviewTabEvents", () => {
  it("向订阅者派发 open/toggle/close 并在退订后停止", () => {
    const listener = vi.fn();
    const stop = subscribeWorkspaceReviewTabRequest(listener);
    requestWorkspaceReviewTab();
    requestWorkspaceReviewTabToggle();
    requestWorkspaceReviewTabClose();
    expect(listener.mock.calls).toEqual([["open"], ["toggle"], ["close"]]);
    stop();
    requestWorkspaceReviewTabToggle();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
