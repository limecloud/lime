import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAppSidebarTest,
  flushEffects,
  mockGetProject,
  mockListRecentThreads,
  mountSidebarContainer,
  resetAppSidebarTest,
} from "./AppSidebar.testFixtures";
import type { AgentPageParams } from "./AppSidebar.testFixtures";

describe("AppSidebar conversation projects", () => {
  async function waitForProjectGroups(container: HTMLElement) {
    let projectGroups: HTMLElement[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await flushEffects(1);
      projectGroups = [
        ...container.querySelectorAll<HTMLElement>(
          '[data-testid="app-sidebar-project-conversation-group"]',
        ),
      ];
      if (projectGroups.length >= 2) {
        break;
      }
    }
    return projectGroups;
  }

  beforeEach(async () => {
    await resetAppSidebarTest();
    localStorage.setItem(
      "agent_opened_project_ids",
      JSON.stringify(["project-1", "project-2"]),
    );
    mockGetProject.mockImplementation(async (projectId: string) => ({
      id: projectId,
      name: projectId === "project-1" ? "项目一" : "项目二",
      rootPath: `/repo/${projectId}`,
      isFavorite: false,
    }));
  });

  afterEach(cleanupAppSidebarTest);

  it("进入项目对话后仍可选择全部已打开项目的会话", async () => {
    mockListRecentThreads.mockImplementation(
      async (options?: { limit?: number; cwd?: string | string[] }) =>
        options?.cwd === "/repo/project-1" || options?.cwd === "/repo/project-2"
          ? [
              {
                id:
                  options.cwd === "/repo/project-1"
                    ? "session-project-1"
                    : "session-project-2",
                name:
                  options.cwd === "/repo/project-1"
                    ? "项目一会话"
                    : "项目二会话",
                created_at: 1714000000,
                updated_at: 1714000600,
                archived_at: null,
                workspace_id:
                  options.cwd === "/repo/project-1" ? "project-1" : "project-2",
                working_dir: options.cwd,
              },
            ]
          : [],
    );

    const onNavigate = vi.fn();
    const container = mountSidebarContainer({
      onNavigate,
      currentPage: "agent",
      currentPageParams: {
        agentEntry: "conversation",
        projectId: "project-1",
        initialSessionId: "session-project-1",
      } as AgentPageParams,
    });
    const projectGroups = await waitForProjectGroups(container);

    expect(projectGroups.map((group) => group.textContent)).toHaveLength(2);
    expect(projectGroups[0]?.textContent).toContain("项目一");
    expect(projectGroups[0]?.textContent).toContain("项目一会话");
    expect(projectGroups[1]?.textContent).toContain("项目二");
    expect(projectGroups[1]?.textContent).toContain("项目二会话");
    expect(projectGroups[1]?.textContent).not.toContain("项目一会话");
    expect(mockListRecentThreads).toHaveBeenCalledWith({
      archived: false,
      limit: 11,
      sectionId: null,
    });
    expect(mockListRecentThreads).toHaveBeenCalledWith({
      archived: false,
      limit: 11,
      sectionId: null,
      cwd: "/repo/project-1",
    });
    expect(mockListRecentThreads).toHaveBeenCalledWith({
      archived: false,
      limit: 11,
      sectionId: null,
      cwd: "/repo/project-2",
    });
    const secondConversation =
      projectGroups[1]?.querySelector<HTMLButtonElement>(
        '[data-testid="app-sidebar-conversation-open"][data-session-id="session-project-2"]',
      );
    expect(secondConversation).not.toBeNull();
    act(() => secondConversation!.click());
    await flushEffects();
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-2",
        initialSessionId: "session-project-2",
      }),
    );
  });
});
