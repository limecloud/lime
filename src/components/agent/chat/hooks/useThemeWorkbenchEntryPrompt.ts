import { useCallback, useEffect, useRef, useState } from "react";
import {
  executionRunGetThemeWorkbenchState,
  type ThemeWorkbenchRunState as BackendThemeWorkbenchRunState,
  type ThemeWorkbenchRunTerminalItem,
  type ThemeWorkbenchRunTodoItem,
} from "@/lib/api/executionRun";
import type { MessageImage } from "../types";

export interface ThemeWorkbenchEntryPromptState {
  kind: "initial_prompt" | "resume";
  signature: string;
  title: string;
  description: string;
  actionLabel: string;
  prompt: string;
}

export interface ThemeWorkbenchResumeWorkflowStep {
  id: string;
  title: string;
  status: "pending" | "active" | "completed" | "skipped" | "error";
  result?: unknown;
}

export interface ThemeWorkbenchResumeWorkflowState {
  id: string;
  current_step_index: number;
  updated_at: number;
  steps: ThemeWorkbenchResumeWorkflowStep[];
}

interface UseThemeWorkbenchEntryPromptOptions {
  activeTheme: string;
  contentId?: string;
  sessionId?: string;
  isThemeWorkbench: boolean;
  autoRunInitialPromptOnMount: boolean;
  shouldUseCompactThemeWorkbench: boolean;
  messagesCount: number;
  initialDispatchKey: string | null;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  consumedInitialPromptKey?: string | null;
  onHydrateInitialPrompt: (prompt: string, dispatchKey: string) => void;
  loadWorkflow?: (
    contentId: string,
  ) => Promise<ThemeWorkbenchResumeWorkflowState | null>;
  loadRunState?: (
    sessionId: string,
  ) => Promise<BackendThemeWorkbenchRunState | null>;
}

const defaultLoadThemeWorkbenchRunState = (sessionId: string) =>
  executionRunGetThemeWorkbenchState(sessionId, 3);

function resolveThemeWorkbenchGateLabel(
  gateKey?: ThemeWorkbenchRunTodoItem["gate_key"],
): string | null {
  switch (gateKey) {
    case "topic_select":
      return "选题确认";
    case "write_mode":
      return "写作推进";
    case "publish_confirm":
      return "发布确认";
    case null:
    case undefined:
    default:
      return null;
  }
}

function hasWorkflowMeaningfulProgress(
  workflow: ThemeWorkbenchResumeWorkflowState | null,
): boolean {
  if (!workflow) {
    return false;
  }

  if (workflow.current_step_index > 0) {
    return true;
  }

  return workflow.steps.some(
    (step) =>
      step.status === "completed" ||
      step.status === "skipped" ||
      step.status === "error" ||
      Boolean(step.result),
  );
}

export function buildThemeWorkbenchResumePromptFromWorkflow(
  workflow: ThemeWorkbenchResumeWorkflowState | null,
): ThemeWorkbenchEntryPromptState | null {
  if (!workflow || !hasWorkflowMeaningfulProgress(workflow)) {
    return null;
  }

  const hasPendingStep = workflow.steps.some(
    (step) => step.status !== "completed" && step.status !== "skipped",
  );
  if (!hasPendingStep) {
    return null;
  }

  const activeStep =
    workflow.steps.find(
      (step) =>
        step.status === "active" ||
        step.status === "pending" ||
        step.status === "error",
    ) || workflow.steps[workflow.current_step_index];
  const stepTitle = activeStep?.title?.trim() || "当前创作阶段";

  return {
    kind: "resume",
    signature: `workflow:${workflow.id}:${workflow.updated_at}:${activeStep?.id || ""}`,
    title: "发现上次未完成任务",
    description: `检测到当前文稿上次停留在“${stepTitle}”，可以直接衔接已有进度继续。`,
    actionLabel: "继续上次任务",
    prompt: `请基于当前文稿与已有上下文，继续推进上次未完成的任务。优先继续“${stepTitle}”阶段，不要从头重复已经完成的内容。先简要确认当前进度，再继续执行。`,
  };
}

function resolveThemeWorkbenchPendingRunCandidate(
  state: BackendThemeWorkbenchRunState | null,
): ThemeWorkbenchRunTodoItem | ThemeWorkbenchRunTerminalItem | null {
  if (!state) {
    return null;
  }

  const activeQueueItem = (state.queue_items || []).find((item) =>
    ["queued", "running", "error", "timeout"].includes(item.status),
  );
  if (activeQueueItem) {
    return activeQueueItem;
  }

  if (
    state.latest_terminal &&
    ["queued", "running", "error", "timeout"].includes(
      state.latest_terminal.status,
    )
  ) {
    return state.latest_terminal;
  }

  return null;
}

export function buildThemeWorkbenchResumePromptFromRunState(
  state: BackendThemeWorkbenchRunState | null,
): ThemeWorkbenchEntryPromptState | null {
  const pendingRun = resolveThemeWorkbenchPendingRunCandidate(state);
  if (!pendingRun) {
    return null;
  }

  const runTitle = pendingRun.title?.trim() || "最近一次创作任务";
  const gateLabel = resolveThemeWorkbenchGateLabel(pendingRun.gate_key);
  const stageSuffix = gateLabel ? `，当前停留在“${gateLabel}”附近` : "";

  return {
    kind: "resume",
    signature: `run:${pendingRun.run_id}:${pendingRun.status}:${pendingRun.started_at}:${"finished_at" in pendingRun ? pendingRun.finished_at || "" : ""}`,
    title: "发现上次未完成任务",
    description: `最近一次任务“${runTitle}”尚未完成${stageSuffix}。`,
    actionLabel: "继续上次任务",
    prompt: `请基于当前文稿与最近一次未完成的运行继续推进。任务标题：${runTitle}。${gateLabel ? `优先衔接“${gateLabel}”阶段。` : ""}不要从头开始，先概括已有进度，再继续执行。`,
  };
}

export function useThemeWorkbenchEntryPrompt({
  activeTheme,
  contentId,
  sessionId,
  isThemeWorkbench,
  autoRunInitialPromptOnMount,
  shouldUseCompactThemeWorkbench,
  messagesCount,
  initialDispatchKey,
  initialUserPrompt,
  initialUserImages,
  consumedInitialPromptKey,
  onHydrateInitialPrompt,
  loadWorkflow,
  loadRunState = defaultLoadThemeWorkbenchRunState,
}: UseThemeWorkbenchEntryPromptOptions) {
  const [themeWorkbenchEntryPrompt, setThemeWorkbenchEntryPrompt] =
    useState<ThemeWorkbenchEntryPromptState | null>(null);
  const [themeWorkbenchEntryCheckPending, setThemeWorkbenchEntryCheckPending] =
    useState(false);
  const hydratedPromptSignatureRef = useRef<string | null>(null);
  const dismissedPromptSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    hydratedPromptSignatureRef.current = null;
    dismissedPromptSignatureRef.current = null;
    setThemeWorkbenchEntryPrompt(null);
    setThemeWorkbenchEntryCheckPending(false);
  }, [activeTheme, contentId, initialDispatchKey]);

  useEffect(() => {
    if (shouldUseCompactThemeWorkbench) {
      return;
    }

    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];
    if (
      !isThemeWorkbench ||
      autoRunInitialPromptOnMount ||
      !contentId ||
      !initialDispatchKey ||
      !pendingInitialPrompt ||
      pendingInitialImages.length > 0 ||
      messagesCount > 0
    ) {
      return;
    }

    if (
      consumedInitialPromptKey === initialDispatchKey ||
      hydratedPromptSignatureRef.current === initialDispatchKey
    ) {
      return;
    }

    hydratedPromptSignatureRef.current = initialDispatchKey;
    onHydrateInitialPrompt(pendingInitialPrompt, initialDispatchKey);
    setThemeWorkbenchEntryPrompt({
      kind: "initial_prompt",
      signature: initialDispatchKey,
      title: "已恢复待执行创作意图",
      description: "进入页面后不会自动开始生成，确认后再继续。",
      actionLabel: "继续生成",
      prompt: pendingInitialPrompt,
    });
  }, [
    consumedInitialPromptKey,
    contentId,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isThemeWorkbench,
    messagesCount,
    onHydrateInitialPrompt,
    autoRunInitialPromptOnMount,
    shouldUseCompactThemeWorkbench,
  ]);

  useEffect(() => {
    if (shouldUseCompactThemeWorkbench) {
      setThemeWorkbenchEntryCheckPending(false);
      return;
    }

    if (
      !isThemeWorkbench ||
      !contentId ||
      !sessionId ||
      messagesCount > 0 ||
      Boolean(initialDispatchKey)
    ) {
      setThemeWorkbenchEntryCheckPending(false);
      return;
    }

    let disposed = false;
    setThemeWorkbenchEntryCheckPending(true);

    void (async () => {
      try {
        const [workflow, backendState] = await Promise.all([
          loadWorkflow ? loadWorkflow(contentId).catch(() => null) : null,
          loadRunState(sessionId).catch(() => null),
        ]);

        if (disposed) {
          return;
        }

        const nextPrompt =
          buildThemeWorkbenchResumePromptFromWorkflow(workflow) ??
          buildThemeWorkbenchResumePromptFromRunState(backendState);

        if (!nextPrompt) {
          setThemeWorkbenchEntryPrompt((current) =>
            current?.kind === "resume" ? null : current,
          );
          return;
        }

        if (dismissedPromptSignatureRef.current === nextPrompt.signature) {
          return;
        }

        setThemeWorkbenchEntryPrompt((current) =>
          current?.kind === "initial_prompt" ? current : nextPrompt,
        );
      } finally {
        if (!disposed) {
          setThemeWorkbenchEntryCheckPending(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    contentId,
    initialDispatchKey,
    isThemeWorkbench,
    loadRunState,
    loadWorkflow,
    messagesCount,
    sessionId,
    shouldUseCompactThemeWorkbench,
  ]);

  const clearThemeWorkbenchEntryPrompt = useCallback(() => {
    setThemeWorkbenchEntryPrompt(null);
  }, []);

  const dismissThemeWorkbenchEntryPrompt = useCallback(
    (options?: {
      consumeInitialPrompt?: boolean;
      onConsumeInitialPrompt?: () => void;
    }) => {
      setThemeWorkbenchEntryPrompt((current) => {
        if (!current) {
          return current;
        }

        if (
          current.kind === "initial_prompt" &&
          options?.consumeInitialPrompt &&
          initialDispatchKey
        ) {
          options.onConsumeInitialPrompt?.();
        } else {
          dismissedPromptSignatureRef.current = current.signature;
        }

        return null;
      });
    },
    [initialDispatchKey],
  );

  return {
    themeWorkbenchEntryPrompt,
    themeWorkbenchEntryCheckPending,
    clearThemeWorkbenchEntryPrompt,
    dismissThemeWorkbenchEntryPrompt,
  };
}
