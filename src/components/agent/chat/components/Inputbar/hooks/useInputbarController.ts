import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BuiltinCommandBadge } from "../components/BuiltinCommandBadge";
import { RuntimeSceneBadge } from "../components/RuntimeSceneBadge";
import { CuratedTaskBadge } from "../../../skill-selection/CuratedTaskBadge";
import { SkillBadge } from "../../../skill-selection/SkillBadge";
import { CuratedTaskLauncherDialog } from "../../CuratedTaskLauncherDialog";
import { useHintRoutes } from "./useHintRoutes";
import { useImageAttachments } from "./useImageAttachments";
import { useInputbarAdapter } from "./useInputbarAdapter";
import { useInputbarSend } from "./useInputbarSend";
import {
  type InputbarToolStates,
  useInputbarToolState,
} from "./useInputbarToolState";
import {
  buildSkillSelectionProps,
  type SkillSelectionSourceProps,
} from "../../../skill-selection/skillSelectionBindings";
import type {
  WorkflowGateState,
  WorkflowStep,
} from "../../../utils/workflowInputState";
import { useWorkflowInputState } from "../../../utils/workflowInputState";
import { TeamSuggestionBar } from "@/components/agent/chat/components/TeamSuggestionBar";
import { getTeamSuggestion } from "@/components/agent/chat/utils/teamSuggestion";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type { MessageImage, MessagePathReference } from "../../../types";
import {
  resolveInputCapabilitySelectionFromRoute,
  type InputCapabilitySelection,
} from "../../../skill-selection/inputCapabilitySelection";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { HandleSendOptions } from "../../../hooks/handleSendTypes";
import type { InputbarKnowledgePackSelection } from "../types";
import type { AgentInitialInputCapabilityParams } from "@/types/page";
import {
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  hasFilledAllCuratedTaskRequiredInputs,
  replaceCuratedTaskLaunchPromptInInput,
  type CuratedTaskInputValues,
} from "../../../utils/curatedTaskTemplates";
import {
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceSelection,
} from "../../../utils/curatedTaskReferenceSelection";
import {
  readCustomPathReferencesFromDataTransfer,
  readSystemPathReferencesFromFiles,
} from "../../../utils/pathReferences";
import { toast } from "sonner";

interface UseInputbarControllerParams {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
    autoContinuePayload?: AutoContinueRequestPayload,
    sendOptions?: HandleSendOptions,
  ) => void | Promise<boolean> | boolean;
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  activeTheme?: string;
  initialInputCapability?: AgentInitialInputCapabilityParams;
  variant?: "default" | "workspace";
  workflowGate?: WorkflowGateState | null;
  workflowSteps?: WorkflowStep[];
  workflowRunState?: "idle" | "auto_running" | "await_user_decision";
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
  projectId?: string | null;
  sessionId?: string | null;
  pathReferences?: MessagePathReference[];
  onAddPathReferences?: (references: MessagePathReference[]) => void;
  onClearPathReferences?: () => void;
}

export function useInputbarController({
  input,
  setInput,
  onSend,
  onStop,
  isLoading,
  disabled,
  providerType,
  setProviderType,
  model,
  setModel,
  executionStrategy,
  toolStates,
  onToolStatesChange,
  activeTheme,
  initialInputCapability,
  variant = "default",
  workflowGate,
  workflowSteps = [],
  workflowRunState,
  onEnableSuggestedTeam,
  knowledgePackSelection,
  projectId = null,
  sessionId = null,
  pathReferences = [],
  onAddPathReferences,
  onClearPathReferences,
  skills,
  serviceSkills,
  serviceSkillGroups,
  isSkillsLoading,
  onSelectServiceSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
}: UseInputbarControllerParams & SkillSelectionSourceProps) {
  const [activeCapability, setActiveCapability] =
    useState<InputCapabilitySelection | null>(null);
  const [editingCuratedTaskCapability, setEditingCuratedTaskCapability] =
    useState<Extract<
      InputCapabilitySelection,
      { kind: "curated_task" }
    > | null>(null);
  const [curatedTaskEditorPrefillHint, setCuratedTaskEditorPrefillHint] =
    useState<string | null>(null);
  const handledInitialInputCapabilitySignatureRef = useRef("");
  const {
    pendingImages,
    fileInputRef,
    handleFileSelect,
    handlePaste,
    handleDragOver,
    handleDrop: handleImageDrop,
    handleRemoveImage,
    clearPendingImages,
    openFileDialog,
  } = useImageAttachments();
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const customReferences = readCustomPathReferencesFromDataTransfer(
        event.dataTransfer,
      );
      if (customReferences.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        onAddPathReferences?.(customReferences);
        return;
      }

      const files = event.dataTransfer.files;
      const systemReferences =
        files && files.length > 0
          ? readSystemPathReferencesFromFiles(files)
          : [];
      if (systemReferences.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        onAddPathReferences?.(systemReferences);
        return;
      }

      if (files && files.length > 0) {
        const hasImageFile = Array.from(files).some((file) =>
          file.type.startsWith("image/"),
        );
        if (!hasImageFile) {
          toast.error("无法读取系统文件路径，请从内置文件管理器拖入。");
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      handleImageDrop(event);
    },
    [handleImageDrop, onAddPathReferences],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isWorkspaceVariant = variant === "workspace";
  const activeSkill =
    activeCapability?.kind === "installed_skill"
      ? activeCapability.skill
      : null;
  const activeBuiltinCommand =
    activeCapability?.kind === "builtin_command"
      ? activeCapability.command
      : null;
  const activeRuntimeScene =
    activeCapability?.kind === "runtime_scene"
      ? activeCapability.command
      : null;
  const activeCuratedTask =
    activeCapability?.kind === "curated_task" ? activeCapability.task : null;
  const activeCuratedTaskReferenceEntries =
    activeCapability?.kind === "curated_task"
      ? activeCapability.referenceEntries
      : undefined;
  const initialInputCapabilitySignature = useMemo(() => {
    const route = initialInputCapability?.capabilityRoute;
    if (!route) {
      return "";
    }

    return JSON.stringify({
      requestKey: initialInputCapability.requestKey ?? 0,
      route,
    });
  }, [initialInputCapability]);

  useEffect(() => {
    if (!initialInputCapabilitySignature) {
      handledInitialInputCapabilitySignatureRef.current = "";
      return;
    }

    if (
      handledInitialInputCapabilitySignatureRef.current ===
      initialInputCapabilitySignature
    ) {
      return;
    }

    const route = initialInputCapability?.capabilityRoute;
    if (!route) {
      return;
    }

    handledInitialInputCapabilitySignatureRef.current =
      initialInputCapabilitySignature;
    const resolvedCapability = resolveInputCapabilitySelectionFromRoute({
      route,
      skills,
    });
    const shouldOpenCuratedTaskLauncherOnBootstrap =
      resolvedCapability.kind === "curated_task" &&
      resolvedCapability.task.requiredInputFields.length > 0 &&
      !hasFilledAllCuratedTaskRequiredInputs({
        task: resolvedCapability.task,
        inputValues: resolvedCapability.launchInputValues ?? {},
      });

    if (
      route.kind === "curated_task" &&
      !shouldOpenCuratedTaskLauncherOnBootstrap &&
      !input.trim() &&
      route.prompt.trim().length > 0
    ) {
      setInput(route.prompt);
    }

    setActiveCapability(resolvedCapability);
    if (
      shouldOpenCuratedTaskLauncherOnBootstrap &&
      resolvedCapability.kind === "curated_task"
    ) {
      setCuratedTaskEditorPrefillHint(null);
      setEditingCuratedTaskCapability(resolvedCapability);
    }
  }, [
    initialInputCapability,
    initialInputCapabilitySignature,
    input,
    setInput,
    skills,
  ]);

  const {
    activeTools,
    handleToolClick,
    setSubagentEnabled,
    isFullscreen,
    thinkingEnabled,
    subagentEnabled,
    webSearchEnabled,
  } = useInputbarToolState({
    toolStates,
    onToolStatesChange,
    openFileDialog,
  });

  const {
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleSetInput,
    handleHintSelect,
    handleHintKeyDown,
  } = useHintRoutes({
    setInput,
    textareaRef,
  });

  const handleSend = useInputbarSend({
    input,
    pendingImages,
    pathReferences,
    webSearchEnabled,
    thinkingEnabled,
    executionStrategy,
    activeCapability,
    knowledgePackSelection,
    onSend,
    clearPendingImages,
    clearPathReferences: onClearPathReferences,
    clearActiveCapability: () => setActiveCapability(null),
  });

  const inputAdapter = useInputbarAdapter({
    input,
    setInput: handleSetInput,
    isLoading,
    disabled,
    providerType,
    setProviderType,
    model,
    setModel,
    handleSend,
    onStop,
    pendingImages,
  });

  const {
    workflowQuickActions,
    workflowQueueItems,
    workflowActiveItem,
    workflowQueueTotalCount,
    workflowCompletedCount,
    workflowTotalCount,
    workflowProgressLabel,
    workflowSummaryLabel,
    renderWorkflowGeneratingPanel,
  } = useWorkflowInputState({
    isWorkspaceVariant,
    workflowGate,
    workflowSteps,
    workflowRunState,
    isSending: inputAdapter.state.isSending,
  });

  const [dismissedTeamSuggestionKey, setDismissedTeamSuggestionKey] = useState<
    string | null
  >(null);
  const teamSuggestionKey = `${activeTheme ?? "default"}:${input
    .trim()
    .toLowerCase()}`;
  const teamSuggestion = useMemo(
    () =>
      getTeamSuggestion({
        input,
        activeTheme,
        subagentEnabled,
      }),
    [activeTheme, input, subagentEnabled],
  );
  const shouldShowTeamSuggestion =
    activeTheme === "general" &&
    teamSuggestion.shouldSuggest &&
    dismissedTeamSuggestionKey !== teamSuggestionKey;

  const topExtra =
    activeSkill ||
    activeBuiltinCommand ||
    activeRuntimeScene ||
    activeCuratedTask ||
    shouldShowTeamSuggestion
      ? React.createElement(
          React.Fragment,
          null,
          activeBuiltinCommand
            ? React.createElement(BuiltinCommandBadge, {
                command: activeBuiltinCommand,
                onClear: () => setActiveCapability(null),
              })
            : null,
          activeRuntimeScene
            ? React.createElement(RuntimeSceneBadge, {
                command: activeRuntimeScene,
                onClear: () => setActiveCapability(null),
              })
            : null,
          activeSkill
            ? React.createElement(SkillBadge, {
                skill: activeSkill,
                onClear: () => setActiveCapability(null),
              })
            : null,
          activeCuratedTask
            ? React.createElement(CuratedTaskBadge, {
                task: activeCuratedTask,
                projectId,
                sessionId,
                referenceEntries: activeCuratedTaskReferenceEntries,
                onEdit: () => {
                  if (activeCapability?.kind !== "curated_task") {
                    return;
                  }
                  setCuratedTaskEditorPrefillHint(null);
                  setEditingCuratedTaskCapability(activeCapability);
                },
                onApplyReviewSuggestion: (task) => {
                  if (activeCapability?.kind !== "curated_task") {
                    return;
                  }

                  const resolvedTask =
                    findCuratedTaskTemplateById(task.id) ?? task;
                  const nextReferenceEntries = mergeCuratedTaskReferenceEntries(
                    activeCapability.referenceEntries ?? [],
                  );
                  const nextLaunchInputValues =
                    activeCapability.launchInputValues ?? {};
                  const nextReferenceMemoryIds =
                    normalizeCuratedTaskReferenceMemoryIds(
                      activeCapability.referenceMemoryIds,
                    ) ?? [];
                  const nextPrompt = buildCuratedTaskLaunchPrompt({
                    task: resolvedTask,
                    inputValues: nextLaunchInputValues,
                    referenceEntries: nextReferenceEntries,
                  });

                  setInput(
                    replaceCuratedTaskLaunchPromptInInput({
                      currentInput: input,
                      previousPrompt: activeCapability.task.prompt,
                      nextPrompt,
                    }),
                  );
                  setActiveCapability({
                    kind: "curated_task",
                    task: {
                      ...resolvedTask,
                      prompt: nextPrompt,
                    },
                    launchInputValues: nextLaunchInputValues,
                    referenceMemoryIds: nextReferenceMemoryIds,
                    referenceEntries: nextReferenceEntries,
                  });
                },
                onClear: () => setActiveCapability(null),
              })
            : null,
          shouldShowTeamSuggestion
            ? React.createElement(TeamSuggestionBar, {
                compact: true,
                score: teamSuggestion.score,
                reasons: teamSuggestion.reasons,
                suggestedRoles: teamSuggestion.suggestedRoles,
                suggestedPresetLabel: teamSuggestion.suggestedPresetLabel,
                onEnableTeam: () => {
                  setSubagentEnabled(true);
                  onEnableSuggestedTeam?.(teamSuggestion.suggestedPresetId);
                  setDismissedTeamSuggestionKey(teamSuggestionKey);
                },
                onContinueSingleAgent: () => {
                  setDismissedTeamSuggestionKey(teamSuggestionKey);
                },
              })
            : null,
        )
      : undefined;
  const handleCuratedTaskEditorOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setCuratedTaskEditorPrefillHint(null);
      setEditingCuratedTaskCapability(null);
    }
  }, []);
  const handleApplyCuratedTaskEditorReviewSuggestion = useCallback(
    (
      task: NonNullable<typeof editingCuratedTaskCapability>["task"],
      options: {
        inputValues: CuratedTaskInputValues;
        referenceSelection: CuratedTaskReferenceSelection;
      },
    ) => {
      const resolvedTask = findCuratedTaskTemplateById(task.id) ?? task;
      setEditingCuratedTaskCapability((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          task: resolvedTask,
          launchInputValues: options.inputValues,
          referenceMemoryIds:
            normalizeCuratedTaskReferenceMemoryIds(
              options.referenceSelection.referenceMemoryIds,
            ) ?? [],
          referenceEntries: mergeCuratedTaskReferenceEntries(
            options.referenceSelection.referenceEntries,
          ),
        };
      });
      setCuratedTaskEditorPrefillHint(
        "已按最近判断切到更适合的结果模板，你可以继续改后再发。",
      );
    },
    [],
  );
  const handleConfirmCuratedTaskEdit = useCallback(
    (
      task: NonNullable<typeof editingCuratedTaskCapability>["task"],
      inputValues: CuratedTaskInputValues,
      referenceSelection: CuratedTaskReferenceSelection,
    ) => {
      const previousPrompt = editingCuratedTaskCapability?.task.prompt;
      const resolvedTask = findCuratedTaskTemplateById(task.id) ?? task;
      const nextPrompt = buildCuratedTaskLaunchPrompt({
        task: resolvedTask,
        inputValues,
        referenceEntries: referenceSelection.referenceEntries,
      });
      setInput(
        replaceCuratedTaskLaunchPromptInInput({
          currentInput: input,
          previousPrompt,
          nextPrompt,
        }),
      );
      setActiveCapability({
        kind: "curated_task",
        task: {
          ...resolvedTask,
          prompt: nextPrompt,
        },
        launchInputValues: inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });
      setCuratedTaskEditorPrefillHint(null);
      setEditingCuratedTaskCapability(null);
    },
    [editingCuratedTaskCapability, input, setInput],
  );
  const dialogLayer = editingCuratedTaskCapability
    ? React.createElement(CuratedTaskLauncherDialog, {
        open: true,
        task: editingCuratedTaskCapability.task,
        projectId,
        sessionId,
        initialInputValues: editingCuratedTaskCapability.launchInputValues,
        initialReferenceMemoryIds:
          editingCuratedTaskCapability.referenceMemoryIds,
        initialReferenceEntries: editingCuratedTaskCapability.referenceEntries,
        prefillHint: curatedTaskEditorPrefillHint,
        onOpenChange: handleCuratedTaskEditorOpenChange,
        onApplyReviewSuggestion: handleApplyCuratedTaskEditorReviewSuggestion,
        onConfirm: handleConfirmCuratedTaskEdit,
      })
    : undefined;
  const handleSelectServiceSkill = (skill: ServiceSkillHomeItem) => {
    setActiveCapability(null);
    onSelectServiceSkill?.(skill);
  };
  const handleSelectInputCapability = (
    capability: InputCapabilitySelection,
  ) => {
    if (capability.kind === "service_skill") {
      handleSelectServiceSkill(capability.skill);
      return;
    }
    setActiveCapability(capability);
  };
  const skillSelection = buildSkillSelectionProps({
    skills,
    serviceSkills,
    serviceSkillGroups,
    activeSkill,
    isSkillsLoading,
    onSelectInputCapability: handleSelectInputCapability,
    onClearSkill: () => setActiveCapability(null),
    onNavigateToSettings,
    onImportSkill,
    onRefreshSkills,
  });

  return {
    textareaRef,
    isWorkspaceVariant,
    pendingImages,
    fileInputRef,
    handleFileSelect,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleHintSelect,
    handleHintKeyDown,
    activeTools,
    handleToolClick,
    isFullscreen,
    handleSend,
    inputAdapter,
    topExtra,
    dialogLayer,
    workflowQuickActions,
    workflowQueueItems,
    workflowActiveItem,
    workflowQueueTotalCount,
    workflowCompletedCount,
    workflowTotalCount,
    workflowProgressLabel,
    workflowSummaryLabel,
    renderWorkflowGeneratingPanel,
    skillSelection,
    handleSelectInputCapability,
    activeCapability,
  };
}
