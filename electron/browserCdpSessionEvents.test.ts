import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import { BrowserCdpSessions } from "./browserCdpSessions";
import { createHarness, mount } from "./browserTabHost.testHarness";

let sessions: BrowserCdpSessions;
let native: WebContents;
let changed: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const h = createHarness();
  const state = (await mount(h)) as { viewId: string };
  native = h.views.get(state.viewId)!.webContents as unknown as WebContents;
  sessions = new BrowserCdpSessions();
  changed = vi.fn();
  await sessions.attachDebugger("tab-1", native, vi.fn(), changed);
});

afterEach(() => {
  sessions.unregisterDebuggerListener("tab-1");
  vi.restoreAllMocks();
});

function attach(targetId: string, sessionId: string, parentSessionId?: string) {
  native.debugger.emit(
    "message",
    {},
    "Target.attachedToTarget",
    { sessionId, targetInfo: { targetId } },
    parentSessionId,
  );
}

function detach(sessionId: string, parentSessionId?: string) {
  native.debugger.emit(
    "message",
    {},
    "Target.detachedFromTarget",
    { sessionId },
    parentSessionId,
  );
}

function expectMissing(...sessionIds: string[]) {
  for (const sessionId of sessionIds) {
    expect(() => sessions.resolveTarget("tab-1", { sessionId })).toThrow(
      /matching.*session|not attached/iu,
    );
  }
}

it("revokes every nested frame when its parent detaches, preserving siblings", () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  attach("grandchild", "grandchild-session", "child-session");
  attach("sibling", "sibling-session");
  expect(
    sessions.resolveTarget("tab-1", { sessionId: "grandchild-session" }),
  ).toEqual({ targetId: "grandchild", sessionId: "grandchild-session" });

  detach("parent-session");

  expectMissing("parent-session", "child-session", "grandchild-session");
  expect(sessions.resolveTarget("tab-1", { targetId: "sibling" })).toEqual({
    targetId: "sibling",
    sessionId: "sibling-session",
  });
  expect(sessions.debuggerSessionIdForTarget("tab-1", "child")).toBeNull();
  expect(changed).toHaveBeenCalledTimes(5);
});

it("does not accept child events from unknown or expired parent sessions", () => {
  attach("orphan", "orphan-session", "unknown-parent");
  expectMissing("orphan-session");
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  detach("parent-session");
  attach("late-child", "late-session", "parent-session");
  expectMissing("child-session", "late-session");
});

it("invalidates descendants when a target is attached with a new native session", () => {
  attach("parent", "old-parent");
  attach("child", "child-session", "old-parent");
  attach("parent", "new-parent");
  expectMissing("old-parent", "child-session");
  expect(sessions.resolveTarget("tab-1", { targetId: "parent" })).toEqual({
    targetId: "parent",
    sessionId: "new-parent",
  });
  attach("stale", "stale-session", "old-parent");
  expectMissing("stale-session");
});

it("does not let a child source detach an unrelated frame", () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  attach("sibling", "sibling-session");
  detach("sibling-session", "parent-session");
  expect(
    sessions.resolveTarget("tab-1", { sessionId: "sibling-session" }),
  ).toEqual({ targetId: "sibling", sessionId: "sibling-session" });
  detach("child-session", "parent-session");
  expectMissing("child-session");
});

it("uses the same descendant revocation after explicit native target detach", async () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  await sessions.detachDebuggerTarget("tab-1", "parent");
  expectMissing("parent-session", "child-session");
  expect(native.debugger.sendCommand).toHaveBeenCalledWith(
    "Target.detachFromTarget",
    { sessionId: "parent-session" },
  );
});

it("revokes descendants even when the native detach command fails", async () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  vi.mocked(native.debugger.sendCommand).mockRejectedValueOnce(
    new Error("native target closed"),
  );
  await expect(
    sessions.detachDebuggerTarget("tab-1", "parent"),
  ).rejects.toThrow("native target closed");
  expectMissing("parent-session", "child-session");
});

it("keeps descendants on duplicate attach and clears them if their session changes target", () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  attach("grandchild", "grandchild-session", "child-session");
  attach("child", "child-session", "parent-session");
  expect(changed).toHaveBeenCalledTimes(3);
  expect(
    sessions.resolveTarget("tab-1", { sessionId: "grandchild-session" }),
  ).toEqual({ targetId: "grandchild", sessionId: "grandchild-session" });
  attach("replacement", "child-session", "parent-session");
  expectMissing("grandchild-session");
  expect(sessions.debuggerSessionIdForTarget("tab-1", "child")).toBeNull();
  expect(
    sessions.resolveTarget("tab-1", { sessionId: "child-session" }),
  ).toEqual({ targetId: "replacement", sessionId: "child-session" });
});

it("rejects self-parent and ancestor cycles without destroying the live tree", () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  attach("cycle", "parent-session", "child-session");
  attach("parent", "replacement-session", "child-session");
  attach("self", "child-session", "child-session");
  expect(
    sessions.resolveTarget("tab-1", { sessionId: "parent-session" }),
  ).toEqual({ targetId: "parent", sessionId: "parent-session" });
  expect(
    sessions.resolveTarget("tab-1", { sessionId: "child-session" }),
  ).toEqual({ targetId: "child", sessionId: "child-session" });
  expectMissing("replacement-session");
  expect(changed).toHaveBeenCalledTimes(2);
});

it("clears the entire detached subtree before invalidating pending approvals", () => {
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  changed.mockImplementation(() =>
    expectMissing("parent-session", "child-session"),
  );
  detach("parent-session");
});

it("does not process a late callback from an older debugger attachment", async () => {
  sessions.unregisterDebuggerListener("tab-1");
  const on = vi.spyOn(native.debugger, "on");
  await sessions.attachDebugger("tab-1", native, vi.fn(), changed);
  const oldListener = on.mock.calls.find(
    ([event]) => event === "message",
  )![1] as (...args: unknown[]) => void;
  attach("parent", "parent-session");
  attach("child", "child-session", "parent-session");
  sessions.unregisterDebuggerListener("tab-1");
  await sessions.attachDebugger("tab-1", native, vi.fn(), changed);
  oldListener({}, "Target.attachedToTarget", {
    sessionId: "stale-session",
    targetInfo: { targetId: "stale-target" },
  });
  attach("late-child", "late-session", "parent-session");
  expectMissing(
    "parent-session",
    "child-session",
    "stale-session",
    "late-session",
  );
  attach("new-parent", "new-session");
  expect(sessions.resolveTarget("tab-1", { sessionId: "new-session" })).toEqual(
    { targetId: "new-parent", sessionId: "new-session" },
  );
  expect(native.debugger.listenerCount("message")).toBe(1);
});
