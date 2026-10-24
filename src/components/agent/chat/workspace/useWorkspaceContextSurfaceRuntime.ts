import type { AgentLocation } from "@/types/page";
import { useEffect, useMemo } from "react";
import type {
  AgentRuntimeThreadReadModel,
  AgentTodoItem,
} from "@/lib/api/agentRuntime/sessionTypes";
import type { ProjectMemory } from "@/lib/api/projectMemory";
import type { LayoutMode, ThemeType } from "@/lib/workspace/workbenchContract";
import type { AgentThreadItem, Message } from "../types";
import type { ActionRequired } from "../types";
import {
  deriveHarnessSessionShellState,
  deriveHarnessSessionState,
  type HarnessSessionState,
} from "../utils/harnessState";
import {
  resolveHarnessRuntimeVisible,
  shouldBuildFullThreadTimeline,
} from "./agentChatWorkspaceHelpers";
import { useWorkspaceContextHarnessRuntime } from "./useWorkspaceContextHarnessRuntime";
import { useWorkspaceRightSurfaceLocalStateRuntime } from "./useWorkspaceRightSurfaceLocalStateRuntime";
import { hasActiveThreadReadActivity } from "../projection/threadReadActivity";

interface UseWorkspaceContextSurfaceRuntimeParams {
  isSending: boolean;
  layoutMode: LayoutMode;
  mappedTheme: ThemeType;
  messages: Message[];
  onAgentStreamingChange?: (isStreaming: boolean) => void;
  onLocationChange?: (location: AgentLocation) => void;
  pendingActions: ActionRequired[];
  projectId?: string | null;
  projectMemory: ProjectMemory | null;
  runtimeWorkspaceId?: string | null;
  sessionId?: string | null;
  threadItems: AgentThreadItem[];
  threadRead?: AgentRuntimeThreadReadModel | null;
  todoItems: AgentTodoItem[];
}

interface WorkspaceContextTimelineRuntime {
  effectiveThreadItems: AgentThreadItem[];
  needsFullThreadTimeline: boolean;
}

export function useWorkspaceContextSurfaceRuntime({
  isSending,
  layoutMode,
  mappedTheme,
  messages,
  onAgentStreamingChange,
  onLocationChange,
  pendingActions,
  projectId,
  projectMemory,
  runtimeWorkspaceId,
  sessionId,
  threadItems,
  threadRead,
  todoItems,
}: UseWorkspaceContextSurfaceRuntimeParams) {
  const harnessShellState = useMemo(
    () => deriveHarnessSessionShellState(messages, pendingActions, todoItems),
    [messages, pendingActions, todoItems],
  );

  useEffect(() => {
    onLocationChange?.({
      sessionId: sessionId ?? null,
      workspaceId: runtimeWorkspaceId ?? projectId ?? null,
    });
  }, [onLocationChange, sessionId, runtimeWorkspaceId, projectId]);

  useEffect(() => {
    return () => {
      onAgentStreamingChange?.(false);
    };
  }, [onAgentStreamingChange]);

  const contextHarnessRuntime = useWorkspaceContextHarnessRuntime({
    enabled: true,
    messages,
    mappedTheme,
    isSending,
    projectMemory,
    harnessState: harnessShellState,
  });
  const rightSurfaceLocalState = useWorkspaceRightSurfaceLocalStateRuntime({
    workspaceId: runtimeWorkspaceId ?? projectId ?? null,
    sessionId: sessionId ?? null,
    threadId: threadRead?.thread_id ?? null,
  });
  const harnessRuntimeVisible = resolveHarnessRuntimeVisible({
    harnessPanelVisible: contextHarnessRuntime.harnessPanelVisible,
    rightSurfaceActive: rightSurfaceLocalState.manualRightSurface,
  });
  const timelineRuntime = useWorkspaceContextTimelineRuntime({
    harnessRuntimeVisible,
    layoutMode,
    threadItems,
  });
  const harnessState = useWorkspaceHarnessStateRuntime({
    effectiveThreadItems: timelineRuntime.effectiveThreadItems,
    harnessPanelVisible: contextHarnessRuntime.harnessPanelVisible,
    harnessShellState,
    messages,
    pendingActions,
    todoItems,
  });
  const inputbarIsSending =
    isSending || hasActiveThreadReadActivity(threadRead);

  useEffect(() => {
    onAgentStreamingChange?.(inputbarIsSending);
  }, [inputbarIsSending, onAgentStreamingChange]);

  return {
    ...timelineRuntime,
    contextHarnessRuntime,
    harnessState,
    harnessShellState,
    harnessRuntimeVisible,
    inputbarIsSending,
    rightSurfaceLocalState,
  };
}

function useWorkspaceHarnessStateRuntime({
  effectiveThreadItems,
  harnessPanelVisible,
  harnessShellState,
  messages,
  pendingActions,
  todoItems,
}: {
  effectiveThreadItems: AgentThreadItem[];
  harnessPanelVisible: boolean;
  harnessShellState: ReturnType<typeof deriveHarnessSessionShellState>;
  messages: Message[];
  pendingActions: ActionRequired[];
  todoItems: AgentTodoItem[];
}): HarnessSessionState {
  return useMemo(
    () =>
      harnessPanelVisible
        ? deriveHarnessSessionState(
            messages,
            pendingActions,
            effectiveThreadItems,
            todoItems,
          )
        : ({
            ...harnessShellState,
            reasoning: undefined,
            activity: {
              planning: 0,
              filesystem: 0,
              execution: 0,
              web: 0,
              skills: 0,
              delegation: 0,
            },
            delegatedTasks: [],
            outputSignals: [],
            activeFileWrites: [],
            recentFileEvents: [],
          } satisfies HarnessSessionState),
    [
      effectiveThreadItems,
      harnessPanelVisible,
      harnessShellState,
      messages,
      pendingActions,
      todoItems,
    ],
  );
}

function useWorkspaceContextTimelineRuntime({
  harnessRuntimeVisible,
  layoutMode,
  threadItems,
}: {
  harnessRuntimeVisible: boolean;
  layoutMode: LayoutMode;
  threadItems: AgentThreadItem[];
}): WorkspaceContextTimelineRuntime {
  const needsFullThreadTimeline = shouldBuildFullThreadTimeline({
    harnessPanelVisible: harnessRuntimeVisible,
    layoutMode,
  });

  return {
    effectiveThreadItems: threadItems,
    needsFullThreadTimeline,
  };
}
