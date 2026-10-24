import { vi } from "vitest";
import type { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import type { AgentRuntimeAdapter } from "../hooks/agentRuntimeAdapter";
import type { AgentEvent } from "@/lib/api/agentProtocol";

export function captureCanonicalTurnEvents(runtime: {
  listenToTurnEvents: ReturnType<typeof vi.fn>;
}) {
  let listener:
    | Parameters<AgentRuntimeAdapter["listenToTurnEvents"]>[1]
    | null = null;
  runtime.listenToTurnEvents.mockImplementation(
    async (
      _eventName: string,
      handler: Parameters<AgentRuntimeAdapter["listenToTurnEvents"]>[1],
    ) => {
      listener = handler;
      return () => {
        if (listener === handler) listener = null;
      };
    },
  );
  return {
    emitTurnStarted(promptText: string) {
      if (!listener) throw new Error("Missing real turn-event consumer");
      const payload: Extract<AgentEvent, { type: "turn_started" }> = {
        type: "turn_started",
        turn: {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: promptText,
          status: "running",
          started_at: "2026-10-15T00:00:00.000Z",
          created_at: "2026-10-15T00:00:00.000Z",
          updated_at: "2026-10-15T00:00:00.000Z",
        },
      };
      listener({ payload });
    },
  };
}

type HookProps = Parameters<typeof useWorkspaceInputbarSceneRuntime>[0];
type HarnessPanelBaseProps = HookProps["generalWorkbenchHarnessPanelBaseProps"];
type HookPropsOverrides = Partial<
  Omit<HookProps, "generalWorkbenchHarnessPanelBaseProps">
> &
  Partial<HarnessPanelBaseProps> & {
    generalWorkbenchHarnessPanelBaseProps?: Partial<HarnessPanelBaseProps>;
  };

// Fixture-only peripheral defaults. The regression supplies every send/Stop owner.
function createDefaultHarnessPanelBaseProps(
  noop: ReturnType<typeof vi.fn>,
  overrides: Partial<HarnessPanelBaseProps> = {},
): HarnessPanelBaseProps {
  return {
    environment: {
      skillsCount: 0,
      skillNames: [],
      memorySignals: [],
    },
    canonicalChildren: [],
    threadRead: null,
    turns: [],
    threadItems: [],
    currentTurnId: null,
    pendingActions: [],
    submittedActionsInFlight: [],
    onRespondToAction: noop,
    messages: [],
    canInterrupt: false,
    onInterruptCurrentTurn: noop,
    onReplayPendingRequest: noop,
    onManageProviders: noop,
    onOpenExecutionPolicySettings: noop,
    diagnosticRuntimeContext: {
      sessionId: null,
      workspaceId: "project-1",
      workingDir: "/tmp/project-1",
      providerType: "openai",
      model: "gpt-5",
      executionStrategy: "react",
      activeTheme: "general",
    },
    toolInventory: null,
    toolInventoryLoading: false,
    toolInventoryError: null,
    onRefreshToolInventory: noop,
    onOpenSubagentSession: noop,
    onLoadFilePreview: noop,
    onOpenFile: noop,
    ...overrides,
  };
}

export function createSceneProps(
  overrides: HookPropsOverrides = {},
): HookProps {
  const noop = vi.fn();
  const {
    generalWorkbenchHarnessPanelBaseProps,
    pendingActions,
    submittedActionsInFlight,
    onRespondToAction,
    ...hookOverrides
  } = overrides;

  return {
    setMentionedCharacters: noop,
    isThemeWorkbench: true,
    sessionId: "session-1",
    threadId: null,
    threadGoal: null,
    threadGoalError: null,
    threadGoalLoading: false,
    generalWorkbenchHarnessPanelBaseProps: createDefaultHarnessPanelBaseProps(
      noop,
      {
        ...generalWorkbenchHarnessPanelBaseProps,
        ...(pendingActions ? { pendingActions } : {}),
        ...(submittedActionsInFlight ? { submittedActionsInFlight } : {}),
        ...(onRespondToAction ? { onRespondToAction } : {}),
      },
    ),
    currentSessionTitle: "当前会话",
    handleStopSending: noop,
    input: "",
    setInput: noop,
    currentGate: null,
    generalWorkbenchWorkflowSteps: [],
    steps: [],
    workflowRunState: "idle",
    handleSend: vi.fn().mockResolvedValue({ kind: "rejected" as const }),
    isPreparingSend: false,
    isSending: false,
    providerType: "openai",
    setProviderType: noop,
    model: "gpt-5",
    setModel: noop,
    reasoningEffort: "",
    setReasoningEffort: noop,
    sessionExecutionRuntime: null,
    projectId: "project-1",
    projectRootPath: "/tmp/project-1",
    accessMode: "current",
    setAccessMode: noop,
    activeTheme: "general",
    navigationActions: {
      handleManageProviders: noop,
      handleOpenExecutionPolicySettings: noop,
      handleOpenRuntimeMemoryWorkbench: noop,
    },
    characters: [],
    skills: [],
    serviceSkills: [],
    serviceSkillGroups: [],
    skillsLoading: false,
    onSelectServiceSkill: noop,
    initialInputCapability: undefined,
    setChatToolPreferences: noop,
    handleNavigateToSkillSettings: noop,
    handleRefreshSkills: noop,
    soulArtifactVoiceGenerationBrief: null,
    soulArtifactVoiceEnabledForTurn: true,
    onSoulArtifactVoiceEnabledForTurnChange: noop,
    generalWorkbenchEntryPrompt: null,
    handleRestartGeneralWorkbenchEntryPrompt: noop,
    handleContinueGeneralWorkbenchEntryPrompt: noop,
    generalWorkbenchEnabled: false,
    harnessPanelVisible: false,
    setHarnessPanelVisible: noop,
    harnessState: {
      runtimeStatus: null,
      pendingApprovals: [],
      latestContextTrace: [],
      plan: {
        phase: "idle",
        items: [],
      },
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
      hasSignals: false,
    },
    mappedTheme: "general",
    activeRuntimeStatusTitle: null,
    chatToolPreferences: {
      task: false,
      subagent: false,
    },
    defaultCuratedTaskReferenceMemoryIds: [],
    defaultCuratedTaskReferenceEntries: [],
    pathReferences: [],
    onAddPathReferences: noop,
    onRemovePathReference: noop,
    onClearPathReferences: noop,

    inputCompletionEnabled: true,
    ...hookOverrides,
  };
}
