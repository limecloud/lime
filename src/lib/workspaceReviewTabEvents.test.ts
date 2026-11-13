import { describe, expect, it, vi } from "vitest";
import {
  requestWorkspaceReviewTab,
  subscribeWorkspaceReviewTabRequest,
} from "./workspaceReviewTabEvents";

describe("workspaceReviewTabEvents", () => {
  it("notifies subscribers and unsubscribes", () => {
    const listener = vi.fn();
    const stop = subscribeWorkspaceReviewTabRequest(listener);
    requestWorkspaceReviewTab();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    requestWorkspaceReviewTab();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
