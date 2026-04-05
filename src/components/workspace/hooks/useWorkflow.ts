/**
 * @file useWorkflow Hook
 * @description 工作流步骤状态管理 Hook
 * @module components/workspace/hooks/useWorkflow
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  type CreationMode,
  type StepDefinition,
  type StepResult,
  type StepStatus,
  type ThemeType,
  type WorkflowStep,
} from "@/lib/workspace/workflowTypes";

export function getWorkflowSteps(
  theme: ThemeType,
  mode: CreationMode,
): StepDefinition[] {
  void theme;
  void mode;
  return [];
}

export function useWorkflow(theme: ThemeType, mode: CreationMode) {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    const definitions = getWorkflowSteps(theme, mode);
    const initialSteps: WorkflowStep[] = definitions.map((def, index) => ({
      ...def,
      status: index === 0 ? "active" : "pending",
    }));
    setSteps(initialSteps);
    setCurrentStepIndex(0);
  }, [theme, mode]);

  const currentStep = useMemo(
    () => steps[currentStepIndex] || null,
    [steps, currentStepIndex],
  );

  const progress = useMemo(() => {
    if (steps.length === 0) return 0;
    const completedCount = steps.filter(
      (step) => step.status === "completed" || step.status === "skipped",
    ).length;
    return Math.round((completedCount / steps.length) * 100);
  }, [steps]);

  const goToStep = useCallback(
    (index: number) => {
      if (index < 0 || index >= steps.length) {
        return;
      }
      const targetStep = steps[index];
      if (
        targetStep.status !== "completed" &&
        targetStep.status !== "skipped" &&
        index !== currentStepIndex
      ) {
        return;
      }

      setCurrentStepIndex(index);
      setSteps((previous) =>
        previous.map((step, stepIndex) =>
          stepIndex === index
            ? { ...step, status: "active" as StepStatus }
            : step,
        ),
      );
    },
    [currentStepIndex, steps],
  );

  const completeStep = useCallback(
    (result: StepResult) => {
      setCurrentStepIndex((previousIndex) => {
        setSteps((previous) =>
          previous.map((step, index) =>
            index === previousIndex
              ? { ...step, status: "completed" as StepStatus, result }
              : step,
          ),
        );

        const nextIndex = previousIndex + 1;
        if (nextIndex < steps.length) {
          setSteps((previous) =>
            previous.map((step, index) =>
              index === nextIndex
                ? { ...step, status: "active" as StepStatus }
                : step,
            ),
          );
          return nextIndex;
        }

        return previousIndex;
      });
    },
    [steps.length],
  );

  const skipStep = useCallback(() => {
    const step = steps[currentStepIndex];
    if (!step?.behavior.skippable) {
      return;
    }

    setSteps((previous) =>
      previous.map((current, index) =>
        index === currentStepIndex
          ? { ...current, status: "skipped" as StepStatus }
          : current,
      ),
    );

    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStepIndex(nextIndex);
      setSteps((previous) =>
        previous.map((current, index) =>
          index === nextIndex
            ? { ...current, status: "active" as StepStatus }
            : current,
        ),
      );
    }
  }, [currentStepIndex, steps]);

  const redoStep = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step?.behavior.redoable) {
        return;
      }

      setSteps((previous) =>
        previous.map((current, currentIndex) => {
          if (currentIndex === index) {
            return {
              ...current,
              status: "active" as StepStatus,
              result: undefined,
            };
          }
          if (currentIndex > index) {
            return {
              ...current,
              status: "pending" as StepStatus,
              result: undefined,
            };
          }
          return current;
        }),
      );
      setCurrentStepIndex(index);
    },
    [steps],
  );

  const submitStepForm = useCallback(
    (data: Record<string, unknown>) => {
      completeStep({ userInput: data });
    },
    [completeStep],
  );

  return {
    steps,
    currentStep,
    currentStepIndex,
    progress,
    canGoBack: currentStepIndex > 0,
    canGoForward: currentStepIndex < steps.length - 1,
    goToStep,
    completeStep,
    skipStep,
    redoStep,
    submitStepForm,
  };
}
