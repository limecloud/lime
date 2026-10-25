import { describe, expect, it } from "vitest";
import {
  buildWorkspaceDebugMountContext,
  buildWorkspaceDebugStateSnapshotDedupeKey,
  buildWorkspaceDebugUnmountContext,
  type WorkspaceDebugStateSnapshot,
} from "./useWorkspaceDebugRuntime";

const snapshot: WorkspaceDebugStateSnapshot = {
  activeTheme: "general",
  contentId: null,
  initialContentLoadError: null,
  isAutoRestoringSession: false,
  isInitialContentLoading: false,
  isSessionHydrating: false,
  isSending: true,
  layoutMode: "chat-canvas",
  messagesCount: 3,
  projectId: "project-1",
  sessionId: "session-1",
  skillsCount: 4,
  skillsLoading: false,
  topicsCount: 2,
  workspaceHealthError: false,
};

describe("workspaceDebugRuntime", () => {
  it("mount context 应把可选字段归一为 null", () => {
    expect(
      buildWorkspaceDebugMountContext({
        agentEntry: "conversation",
        lockTheme: false,
      }),
    ).toEqual({
      agentEntry: "conversation",
      contentId: null,
      externalProjectId: null,
      initialCreationMode: null,
      initialTheme: null,
      lockTheme: false,
    });
  });

  it("unmount context 应包含 lifetimeMs 并归一可选字段", () => {
    expect(
      buildWorkspaceDebugUnmountContext({
        lifetimeMs: 120,
      }),
    ).toEqual({
      contentId: null,
      externalProjectId: null,
      lifetimeMs: 120,
    });
  });

  it("state snapshot dedupe key 应由完整 snapshot 生成", () => {
    expect(buildWorkspaceDebugStateSnapshotDedupeKey(snapshot)).toBe(
      JSON.stringify(snapshot),
    );
  });
});
