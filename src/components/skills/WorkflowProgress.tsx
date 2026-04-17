/**
 * @file WorkflowProgress.tsx
 * @description Workflow 进度展示组件，显示 Skill 执行的步骤进度
 *
 * 功能：
 * - 显示步骤列表和当前进度
 * - 高亮当前执行的步骤
 * - 显示成功/失败状态
 * - 显示整体完成百分比
 *
 * @module components/skills
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { WorkflowStepInfo, StepResult } from "@/lib/api/skill-execution";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 步骤状态类型
 */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "retrying";

/**
 * 步骤显示信息
 */
export interface StepDisplayInfo {
  /** 步骤 ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 步骤状态 */
  status: StepStatus;
  /** 错误信息（失败时） */
  error?: string;
  /** 是否正在重试 */
  willRetry?: boolean;
}

/**
 * WorkflowProgress 组件属性
 */
export interface WorkflowProgressProps {
  /** Workflow 步骤定义列表 */
  steps: WorkflowStepInfo[];
  /** 当前执行的步骤 ID */
  currentStepId?: string | null;
  /** 已完成的步骤结果 */
  completedSteps?: StepResult[];
  /** 当前步骤序号（从 1 开始） */
  currentStepIndex?: number;
  /** 总步骤数 */
  totalSteps?: number;
  /** 整体进度（0-100） */
  progress?: number;
  /** 是否正在执行 */
  isExecuting?: boolean;
  /** 当前错误信息 */
  error?: string | null;
  /** 是否正在重试 */
  isRetrying?: boolean;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 根据步骤信息计算步骤状态
 *
 * @param step - 步骤定义
 * @param currentStepId - 当前执行的步骤 ID
 * @param completedSteps - 已完成的步骤结果
 * @param isRetrying - 是否正在重试
 * @returns 步骤显示信息
 */
function getStepDisplayInfo(
  step: WorkflowStepInfo,
  currentStepId: string | null | undefined,
  completedSteps: StepResult[] = [],
  isRetrying: boolean = false,
): StepDisplayInfo {
  // 查找已完成的步骤结果
  const completedStep = completedSteps.find((s) => s.step_id === step.id);

  if (completedStep) {
    return {
      id: step.id,
      name: step.name,
      status: completedStep.success ? "completed" : "failed",
      error: completedStep.error,
    };
  }

  // 当前正在执行的步骤
  if (currentStepId === step.id) {
    return {
      id: step.id,
      name: step.name,
      status: isRetrying ? "retrying" : "running",
    };
  }

  // 待执行的步骤
  return {
    id: step.id,
    name: step.name,
    status: "pending",
  };
}

// ============================================================================
// 子组件
// ============================================================================

/**
 * 步骤状态图标组件
 */
function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "running":
      return <Loader2 className="h-5 w-5 text-emerald-500 animate-spin" />;
    case "retrying":
      return <RotateCcw className="h-5 w-5 text-yellow-500 animate-spin" />;
    case "pending":
    default:
      return <Circle className="h-5 w-5 text-gray-300 dark:text-gray-600" />;
  }
}

/**
 * 单个步骤项组件
 */
function StepItem({ step }: { step: StepDisplayInfo }) {
  const isActive = step.status === "running" || step.status === "retrying";
  const isFailed = step.status === "failed";

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg transition-colors",
        isActive &&
          "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800",
        isFailed &&
          "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800",
        !isActive && !isFailed && "hover:bg-muted/50",
      )}
    >
      <div className="flex-shrink-0 mt-0.5">
        <StepStatusIcon status={step.status} />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            isActive && "text-emerald-700 dark:text-emerald-300",
            isFailed && "text-red-700 dark:text-red-300",
            step.status === "completed" && "text-green-700 dark:text-green-300",
            step.status === "pending" && "text-muted-foreground",
          )}
        >
          {step.name}
        </p>
        {step.error && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            {step.error}
          </p>
        )}
        {step.status === "retrying" && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
            正在重试...
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * Workflow 进度展示组件
 *
 * 显示 Skill 执行的步骤进度，包括：
 * - 步骤列表和当前进度
 * - 高亮当前执行的步骤
 * - 成功/失败状态指示
 * - 整体完成百分比
 *
 * @param props - 组件属性
 * @returns React 组件
 *
 * @example
 * ```tsx
 * <WorkflowProgress
 *   steps={workflowSteps}
 *   currentStepId="step-2"
 *   completedSteps={completedSteps}
 *   progress={50}
 *   isExecuting={true}
 * />
 * ```
 *
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */
export function WorkflowProgress({
  steps,
  currentStepId,
  completedSteps = [],
  currentStepIndex = 0,
  totalSteps = 0,
  progress = 0,
  isExecuting = false,
  error,
  isRetrying = false,
  className,
}: WorkflowProgressProps) {
  // 如果没有步骤，显示空状态
  if (steps.length === 0) {
    return (
      <div className={cn("text-center text-muted-foreground py-4", className)}>
        暂无工作流步骤
      </div>
    );
  }

  // 计算步骤显示信息
  const stepDisplayInfos = steps.map((step) =>
    getStepDisplayInfo(step, currentStepId, completedSteps, isRetrying),
  );

  // 计算完成的步骤数
  const completedCount = stepDisplayInfos.filter(
    (s) => s.status === "completed",
  ).length;
  const failedCount = stepDisplayInfos.filter(
    (s) => s.status === "failed",
  ).length;

  // 使用传入的 totalSteps 或步骤列表长度
  const effectiveTotalSteps = totalSteps > 0 ? totalSteps : steps.length;

  // 计算显示的进度百分比
  const displayProgress =
    progress > 0
      ? progress
      : effectiveTotalSteps > 0
        ? (completedCount / effectiveTotalSteps) * 100
        : 0;

  return (
    <div className={cn("space-y-4", className)}>
      {/* 进度概览 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {isExecuting ? (
              <>
                执行中: 步骤 {currentStepIndex}/{effectiveTotalSteps}
              </>
            ) : failedCount > 0 ? (
              <span className="text-red-600 dark:text-red-400">
                执行失败: {failedCount} 个步骤出错
              </span>
            ) : completedCount === effectiveTotalSteps ? (
              <span className="text-green-600 dark:text-green-400">
                执行完成
              </span>
            ) : (
              <>
                已完成: {completedCount}/{effectiveTotalSteps}
              </>
            )}
          </span>
          <span className="font-medium">{Math.round(displayProgress)}%</span>
        </div>
        <Progress
          value={displayProgress}
          className="h-2"
          indicatorClassName={cn(
            failedCount > 0 && "bg-red-500",
            completedCount === effectiveTotalSteps &&
              failedCount === 0 &&
              "bg-green-500",
          )}
        />
      </div>

      {/* 全局错误信息 */}
      {error && !isRetrying && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* 步骤列表 */}
      <div className="space-y-2">
        {stepDisplayInfos.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
