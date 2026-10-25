import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { useAppSidebarSessions } from "./useAppSidebarSessions";

const { listSessions, listSections } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSections: vi.fn(),
}));
vi.mock("@/lib/api/threadSections", () => ({
  listThreadSections: listSections,
  PINNED_THREAD_SECTION: { id: "pinned", name: "Pinned" },
}));
vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  AGENT_RUNTIME_SESSIONS_CHANGED_EVENT: "test-sessions-changed",
  listRecentThreads: listSessions,
}));

describe("sidebar catalog pagination", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    listSections.mockResolvedValue([
      { id: "pinned", name: "Pinned" },
      { id: "custom", name: "Custom" },
    ]);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("fills Recents independently of project and custom-section records, then loads more", async () => {
    const makeSession = (
      id: string,
      workspaceId?: string,
    ): AgentSessionInfo => ({
      id,
      name: id,
      created_at: 1,
      updated_at: 1,
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
    });
    const projects = Array.from({ length: 35 }, (_, index) =>
      makeSession(`p${index}`, "project"),
    );
    const global = [
      ...projects,
      ...Array.from({ length: 25 }, (_, index) => makeSession(`r${index}`)),
    ];
    listSessions.mockImplementation(
      async ({
        cwd,
        limit,
        sectionId,
        cursor,
      }: {
        cwd?: string;
        limit: number;
        sectionId: string | null;
        cursor?: string;
      }) =>
        sectionId
          ? {
              sessions: [
                {
                  ...makeSession(`${sectionId}-thread`),
                  section: { id: sectionId, name: sectionId },
                },
              ],
              nextCursor: null,
            }
          : (() => {
              const source = cwd ? projects : global;
              const start = Number(cursor ?? 0);
              return {
                sessions: source.slice(start, start + limit),
                nextCursor:
                  start + limit < source.length ? String(start + limit) : null,
              };
            })(),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Surface() {
      const state = useAppSidebarSessions({
        currentSessionId: null,
        activeProjectIds: ["project"],
        openedProjectCwds: ["/repo"],
        shouldShowConversationList: true,
        sidebarSearchOpen: false,
        sidebarSearchQuery: "",
        isNewTaskHome: false,
        isConversation: false,
        conversationUntitledLabel: "Untitled",
      });
      return (
        <button
          onClick={state.showMoreRecentSessions}
          data-has-more={state.hasMoreRecentSidebarSessions}
        >
          {state.visibleRecentSidebarSessions.map((item) => item.id).join(",")}
        </button>
      );
    }
    try {
      await act(async () => root.render(<Surface />));
      expect(container.textContent).toContain("p34");
      expect(container.textContent).toContain("r10");
      expect(container.textContent).toContain("pinned-thread");
      expect(container.textContent).toContain("custom-thread");
      expect(container.querySelector("button")?.dataset.hasMore).toBe("true");
      await act(async () => container.querySelector("button")!.click());
      expect(listSessions).toHaveBeenCalledWith({
        archived: false,
        limit: 21,
        sectionId: null,
      });
      expect(container.textContent).toContain("r24");
      expect(container.querySelector("button")?.dataset.hasMore).toBe("false");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
