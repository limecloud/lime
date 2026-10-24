import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
import { assertEmbeddedBrowserPermissionRequestEvent } from "./embeddedBrowser";

const event = {
  viewId: "view",
  requestId: "request",
  permission: "media",
  url: "https://example.com/",
  requestingUrl: "https://example.com/",
  embeddingOrigin: null,
  isMainFrame: true,
  decision: "pending",
  mediaTypes: ["audio"],
};
describe("native site permission event boundary", () => {
  it("retains native frame and media disclosure", () => {
    expect(() =>
      assertEmbeddedBrowserPermissionRequestEvent(event),
    ).not.toThrow();
    expect(() =>
      assertEmbeddedBrowserPermissionRequestEvent({
        ...event,
        isMainFrame: false,
        mediaTypes: ["video", "audio"],
      }),
    ).not.toThrow();
  });
  it.each([
    { isMainFrame: undefined },
    { isMainFrame: "true" },
    { mediaTypes: "audio" },
    { mediaTypes: ["unknown"] },
    { decision: "approved" },
    { requestingUrl: undefined },
  ])("rejects malformed request scope %j", (override) => {
    expect(() =>
      assertEmbeddedBrowserPermissionRequestEvent({ ...event, ...override }),
    ).toThrow();
  });
});
