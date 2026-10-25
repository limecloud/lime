import { expect, it, vi } from "vitest";
import { subscribeCdpEvents } from "./browserCdpEventSubscription";
import { BrowserCdpEvents } from "./browserCdpEvents";
import { BrowserCdpSessions } from "./browserCdpSessions";
import { BrowserTabPolicy } from "./browserTabPolicy";
import type { BrowserTabState } from "./browserTabHost";

vi.mock("./browserNativePipeResources", () => ({
  browserNativePipeClientPath: () => "/fixture/client.mjs",
}));
vi.mock("./electronRuntime", () => ({
  app: { getPath: () => "/fixture/temp" },
}));

it("keeps a subscription across observation revisions but rejects native navigation and attachment replacement", async () => {
  const sessions = new BrowserCdpSessions();
  const events = new BrowserCdpEvents();
  const assertAttachment = vi.fn();
  vi.spyOn(sessions, "debuggerAttachmentGuard").mockReturnValue(
    assertAttachment,
  );
  const subscribe = vi.spyOn(events, "subscribe").mockResolvedValue({
    pipePath: "/fixture/events",
    token: "test-token",
    protocolVersion: 1,
  });
  const state = {
    tabId: "tab-1",
    viewId: "view-1",
    webContentsId: 42,
    url: "https://allowed.test/",
    pageRevision: 1,
    navigationRevision: 1,
  } as BrowserTabState;
  await subscribeCdpEvents({
    sessions,
    events,
    policy: new BrowserTabPolicy(),
    state: () => ({ ...state }),
    assertActive: vi.fn(),
    assertBrowseAllowed: vi.fn(),
    refreshSettings: vi.fn(async () => {}),
    onDisconnected: vi.fn(),
  });
  const input = subscribe.mock.calls[0][0];
  state.pageRevision += 1;
  expect(() => input.assertCurrent()).not.toThrow();
  state.navigationRevision += 1;
  expect(() => input.assertCurrent()).toThrow("stale");
  state.navigationRevision -= 1;
  assertAttachment.mockImplementation(() => {
    throw new Error("replacement attachment");
  });
  expect(() => input.assertCurrent()).toThrow("replacement attachment");
});
