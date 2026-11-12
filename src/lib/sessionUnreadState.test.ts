import { beforeEach, describe, expect, it } from "vitest";
import { isSessionUnread, markSessionRead } from "./sessionUnreadState";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";

function session(updatedAt: number): AgentSessionInfo {
  return {
    id: "session-unread",
    created_at: 1,
    updated_at: updatedAt,
  };
}

describe("sessionUnreadState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("treats sessions without a read marker as read", () => {
    expect(isSessionUnread(session(Date.now()))).toBe(false);
  });

  it("marks a session read and detects later updates as unread", () => {
    markSessionRead("session-unread");
    expect(isSessionUnread(session(Date.now() - 1000))).toBe(false);
    expect(isSessionUnread(session(Date.now() + 60_000))).toBe(true);
  });

  it("normalizes second-based updated_at timestamps", () => {
    markSessionRead("session-unread");
    const seconds = Math.floor(Date.now() / 1000) + 60;
    expect(isSessionUnread(session(seconds))).toBe(true);
    const pastSeconds = Math.floor(Date.now() / 1000) - 60;
    expect(isSessionUnread(session(pastSeconds))).toBe(false);
  });
});
