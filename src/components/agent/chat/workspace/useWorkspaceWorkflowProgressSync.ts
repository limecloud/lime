import { useEffect, useMemo, useRef } from "react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type { WorkflowProgressSnapshot } from "../agentChatWorkspaceContract";

interface WorkflowProgressStep {
  id: string;
  title: string;
  status: StepStatus;
}

interface UseWorkspaceWorkflowProgressSyncParams {
  enabled: boolean;
  currentStepIndex: number;
  steps: WorkflowProgressStep[];
  onWorkflowProgressChange?: (
    snapshot: WorkflowProgressSnapshot | null,
  ) => void;
}

export function useWorkspaceWorkflowProgressSync({
  enabled,
  currentStepIndex,
  steps,
  onWorkflowProgressChange,
}: UseWorkspaceWorkflowProgressSyncParams) {
  const workflowProgressSignature = useMemo(() => {
    if (!enabled) {
      return "hidden";
    }

    const stepSignature = steps
      .map((step) => `${step.id}:${step.status}:${step.title}`)
      .join("|");
    return `${currentStepIndex}:${stepSignature}`;
  }, [currentStepIndex, enabled, steps]);

  const lastWorkflowProgressSignatureRef = useRef<string>("");

  useEffect(() => {
    if (!onWorkflowProgressChange) {
      return;
    }

    if (
      lastWorkflowProgressSignatureRef.current === workflowProgressSignature
    ) {
      return;
    }
    lastWorkflowProgressSignatureRef.current = workflowProgressSignature;

    if (!enabled) {
      onWorkflowProgressChange(null);
      return;
    }

    onWorkflowProgressChange({
      currentIndex: currentStepIndex,
      steps: steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
      })),
    });
  }, [
    currentStepIndex,
    enabled,
    onWorkflowProgressChange,
    steps,
    workflowProgressSignature,
  ]);

  useEffect(() => {
    return () => {
      onWorkflowProgressChange?.(null);
    };
  }, [onWorkflowProgressChange]);
}
