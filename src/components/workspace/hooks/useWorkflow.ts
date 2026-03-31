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

function getSocialMediaWorkflowSteps(mode: CreationMode): StepDefinition[] {
  if (mode === "fast") {
    return [
      {
        id: "brief",
        type: "clarify",
        title: "明确需求",
        description: "定义内容主题、平台和风格",
        aiTask: { taskType: "brief", streaming: true },
        behavior: { skippable: false, redoable: true, autoAdvance: true },
      },
      {
        id: "create",
        type: "write",
        title: "生成内容",
        description: "AI 生成社媒内容",
        aiTask: { taskType: "create", streaming: true },
        behavior: { skippable: false, redoable: true, autoAdvance: false },
      },
      {
        id: "adapt",
        type: "adapt",
        title: "平台适配",
        description: "适配目标平台格式",
        aiTask: { taskType: "adapt", streaming: true },
        behavior: { skippable: true, redoable: true, autoAdvance: false },
      },
    ];
  }

  return [
    {
      id: "brief",
      type: "clarify",
      title: "明确需求",
      description: "定义内容主题、目标受众和平台",
      aiTask: { taskType: "brief", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: true },
    },
    {
      id: "create",
      type: "write",
      title: "创作内容",
      description: "AI 生成社媒文案",
      aiTask: { taskType: "create", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: false },
    },
    {
      id: "polish",
      type: "polish",
      title: "润色优化",
      description: "优化文案表达和吸引力",
      aiTask: { taskType: "polish", streaming: true },
      behavior: { skippable: true, redoable: true, autoAdvance: false },
    },
    {
      id: "adapt",
      type: "adapt",
      title: "平台适配",
      description: "适配不同平台的格式要求",
      aiTask: { taskType: "adapt", streaming: true },
      behavior: { skippable: true, redoable: true, autoAdvance: false },
    },
  ];
}

function getVideoWorkflowSteps(mode: CreationMode): StepDefinition[] {
  if (mode === "fast") {
    return [
      {
        id: "brief",
        type: "clarify",
        title: "明确需求",
        description: "定义视频主题、时长和风格",
        aiTask: { taskType: "brief", streaming: true },
        behavior: { skippable: false, redoable: true, autoAdvance: true },
      },
      {
        id: "script",
        type: "write",
        title: "生成剧本",
        description: "AI 生成视频脚本",
        aiTask: { taskType: "script", streaming: true },
        behavior: { skippable: false, redoable: true, autoAdvance: false },
      },
      {
        id: "polish",
        type: "polish",
        title: "润色优化",
        description: "优化剧本内容",
        aiTask: { taskType: "polish", streaming: true },
        behavior: { skippable: true, redoable: true, autoAdvance: false },
      },
    ];
  }

  return [
    {
      id: "brief",
      type: "clarify",
      title: "明确需求",
      description: "定义视频主题、时长和目标受众",
      aiTask: { taskType: "brief", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: true },
    },
    {
      id: "outline",
      type: "outline",
      title: "剧情大纲",
      description: "规划视频整体结构和节奏",
      aiTask: { taskType: "outline", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: false },
    },
    {
      id: "storyboard",
      type: "research",
      title: "分镜设计",
      description: "设计关键画面和镜头",
      aiTask: { taskType: "storyboard", streaming: true },
      behavior: { skippable: true, redoable: true, autoAdvance: false },
    },
    {
      id: "script",
      type: "write",
      title: "撰写剧本",
      description: "撰写完整视频脚本",
      aiTask: { taskType: "script", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: false },
    },
    {
      id: "polish",
      type: "polish",
      title: "润色优化",
      description: "优化台词和节奏",
      aiTask: { taskType: "polish", streaming: true },
      behavior: { skippable: true, redoable: true, autoAdvance: false },
    },
  ];
}

function getDocumentWorkflowSteps(mode: CreationMode): StepDefinition[] {
  if (mode === "fast") {
    return [
      {
        id: "brief",
        type: "clarify",
        title: "明确需求",
        description: "定义文档主题、类型和受众",
        aiTask: { taskType: "brief", streaming: true },
        behavior: { skippable: false, redoable: true, autoAdvance: true },
      },
      {
        id: "write",
        type: "write",
        title: "生成文档",
        description: "AI 生成文档内容",
        aiTask: { taskType: "write", streaming: true },
        behavior: { skippable: false, redoable: true, autoAdvance: false },
      },
      {
        id: "polish",
        type: "polish",
        title: "润色优化",
        description: "优化文档结构和表达",
        aiTask: { taskType: "polish", streaming: true },
        behavior: { skippable: true, redoable: true, autoAdvance: false },
      },
    ];
  }

  return [
    {
      id: "brief",
      type: "clarify",
      title: "明确需求",
      description: "定义文档主题、类型和目标读者",
      aiTask: { taskType: "brief", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: true },
    },
    {
      id: "outline",
      type: "outline",
      title: "文档大纲",
      description: "规划文档结构和章节",
      aiTask: { taskType: "outline", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: false },
    },
    {
      id: "write",
      type: "write",
      title: "撰写内容",
      description: "撰写文档正文",
      aiTask: { taskType: "write", streaming: true },
      behavior: { skippable: false, redoable: true, autoAdvance: false },
    },
    {
      id: "polish",
      type: "polish",
      title: "润色优化",
      description: "优化结构和语言表达",
      aiTask: { taskType: "polish", streaming: true },
      behavior: { skippable: true, redoable: true, autoAdvance: false },
    },
  ];
}

export function getWorkflowSteps(
  theme: ThemeType,
  mode: CreationMode,
): StepDefinition[] {
  switch (theme) {
    case "social-media":
      return getSocialMediaWorkflowSteps(mode);
    case "video":
      return getVideoWorkflowSteps(mode);
    case "document":
      return getDocumentWorkflowSteps(mode);
    case "general":
    case "knowledge":
    case "planning":
    default:
      return [];
  }
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
