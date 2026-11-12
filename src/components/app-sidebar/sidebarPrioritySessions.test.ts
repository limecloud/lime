import { beforeEach, describe, expect, it } from "vitest";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { markSessionRead } from "@/lib/sessionUnreadState";
import {
  isPrioritySession,
  selectPrioritySessions,
} from "./sidebarPrioritySessions";

function session(
  id: string,
  overrides: Partial<AgentSessionInfo> = {},
): AgentSessionInfo {
  return {
    id,
    created_at: Date.now() / 1000 - 3600,
    updated_at: Date.now() / 1000,
    ...overrides,
  };
}

describe("sidebarPrioritySessions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("includes unread sessions", () => {
    markSessionRead("unread");
    const target = session("unread", {
      updated_at: Date.now() / 1000 + 60,
    });
    expect(isPrioritySession(target)).toBe(true);
  });

  it("includes sessions waiting for action", () => {
    expect(
      isPrioritySession(session("waiting", { thread_status: "waitingAction" })),
    ).toBe(true);
  });

  it("excludes idle read sessions and applies the limit", () => {
    markSessionRead("idle");
    expect(isPrioritySession(session("idle"))).toBe(false);
    const waiting = Array.from({ length: 7 }, (_, index) =>
      session(`waiting-${index}`, { thread_status: "waitingAction" }),
    );
    expect(selectPrioritySessions(waiting)).toHaveLength(5);
  });
});
