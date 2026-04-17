/**
 * @file SkillExecutionDialog.tsx
 * @description Skill 执行对话框组件，显示 skill 详情、输入表单和执行进度
 *
 * 功能：
 * - 显示 Skill 详情信息（名称、描述、执行模式等）
 * - 提供用户输入表单
 * - 支持 Provider 选择覆盖
 * - 集成 WorkflowProgress 组件显示执行进度
 * - 显示执行结果或错误
 *
 * @module components/skills
 * @requirements 6.2, 6.3, 6.5
 */

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowProgress } from "./WorkflowProgress";
import { useSkillExecution } from "@/hooks/useSkillExecution";
import { skillExecutionApi } from "@/lib/api/skill-execution";
import type {
  SkillDetailInfo,
  StepResult,
  SkillExecutionResult,
} from "@/lib/api/skill-execution";
import { cn } from "@/lib/utils";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Workflow,
  Bot,
} from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 可用的 Provider 选项
 */
const PROVIDER_OPTIONS = [
  { value: "", label: "自动选择" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "gemini", label: "Google Gemini" },
  { value: "kiro", label: "Kiro" },
] as const;

/**
 * 执行模式图标映射
 */
const EXECUTION_MODE_ICONS = {
  prompt: Zap,
  workflow: Workflow,
  agent: Bot,
} as const;

/**
 * 执行模式标签映射
 */
const EXECUTION_MODE_LABELS = {
  prompt: "提示词模式",
  workflow: "工作流模式",
  agent: "Agent 模式",
} as const;

/**
 * SkillExecutionDialog 组件属性
 */
export interface SkillExecutionDialogProps {
  /** Skill 名称 */
  skillName: string;
  /** 是否打开对话框 */
  open: boolean;
  /** 关闭对话框回调 */
  onOpenChange: (open: boolean) => void;
  /** 执行完成回调 */
  onExecutionComplete?: (result: SkillExecutionResult) => void;
}

// ============================================================================
// 子组件
// ============================================================================

/**
 * Skill 详情头部组件
 */
function SkillDetailHeader({ skill }: { skill: SkillDetailInfo }) {
  const ModeIcon = EXECUTION_MODE_ICONS[skill.execution_mode] || Zap;
  const modeLabel = EXECUTION_MODE_LABELS[skill.execution_mode] || "未知模式";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ModeIcon className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{modeLabel}</span>
        {skill.has_workflow && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            包含工作流
          </span>
        )}
      </div>
      {skill.when_to_use && (
        <p className="text-sm text-muted-foreground">{skill.when_to_use}</p>
      )}
      {skill.argument_hint && (
        <p className="text-xs text-muted-foreground italic">
          提示: {skill.argument_hint}
        </p>
      )}
    </div>
  );
}

/**
 * 执行结果展示组件
 */
function ExecutionResultDisplay({
  result,
  error,
}: {
  result: SkillExecutionResult | null;
  error: string | null;
}) {
  if (!result && !error) return null;

  const isSuccess = result?.success ?? false;
  const displayError = error || result?.error;
  const displayOutput = result?.output;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-2",
        isSuccess
          ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
          : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
      )}
    >
      <div className="flex items-center gap-2">
        {isSuccess ? (
          <>
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="font-medium text-green-700 dark:text-green-300">
              执行成功
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <span className="font-medium text-red-700 dark:text-red-300">
              执行失败
            </span>
          </>
        )}
      </div>
      {displayError && (
        <p className="text-sm text-red-600 dark:text-red-400">{displayError}</p>
      )}
      {displayOutput && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            输出:
          </p>
          <pre className="text-sm whitespace-pre-wrap bg-background/50 rounded p-2 max-h-48 overflow-auto">
            {displayOutput}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * Skill 执行对话框组件
 *
 * 提供 Skill 执行的完整界面，包括：
 * - Skill 详情展示
 * - 用户输入表单
 * - Provider 选择
 * - 执行进度展示（WorkflowProgress）
 * - 执行结果展示
 *
 * @param props - 组件属性
 * @returns React 组件
 *
 * @example
 * ```tsx
 * <SkillExecutionDialog
 *   skillName="code-review"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onExecutionComplete={(result) => console.log(result)}
 * />
 * ```
 *
 * @requirements 6.2, 6.3, 6.5
 */
export function SkillExecutionDialog({
  skillName,
  open,
  onOpenChange,
  onExecutionComplete,
}: SkillExecutionDialogProps) {
  // 状态
  const [skillDetail, setSkillDetail] = useState<SkillDetailInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [executionResult, setExecutionResult] =
    useState<SkillExecutionResult | null>(null);
  const [completedSteps, setCompletedSteps] = useState<StepResult[]>([]);

  // 使用 Skill 执行 Hook
  const {
    execute,
    isExecuting,
    currentStep,
    progress,
    error: executionError,
    totalSteps,
    currentStepIndex,
  } = useSkillExecution({
    onStepComplete: (stepId, output) => {
      setCompletedSteps((prev) => [
        ...prev,
        {
          step_id: stepId,
          step_name: stepId,
          success: true,
          output,
        },
      ]);
    },
    onStepError: (stepId, error, willRetry) => {
      if (!willRetry) {
        setCompletedSteps((prev) => [
          ...prev,
          {
            step_id: stepId,
            step_name: stepId,
            success: false,
            error,
          },
        ]);
      }
    },
  });

  // 加载 Skill 详情
  useEffect(() => {
    if (!open || !skillName) return;

    const loadSkillDetail = async () => {
      setLoading(true);
      setLoadError(null);
      setExecutionResult(null);
      setCompletedSteps([]);

      try {
        const detail = await skillExecutionApi.getSkillDetail(skillName);
        setSkillDetail(detail);
        // 如果 skill 指定了 provider，设置为默认选择
        if (detail.provider) {
          setSelectedProvider(detail.provider);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    loadSkillDetail();
  }, [open, skillName]);

  // 重置状态当对话框关闭时
  useEffect(() => {
    if (!open) {
      setUserInput("");
      setSelectedProvider("");
      setExecutionResult(null);
      setCompletedSteps([]);
    }
  }, [open]);

  // 执行 Skill
  const handleExecute = useCallback(async () => {
    if (!skillName || isExecuting) return;

    setExecutionResult(null);
    setCompletedSteps([]);

    try {
      const result = await execute(
        skillName,
        userInput,
        selectedProvider || undefined,
      );
      setExecutionResult(result);
      onExecutionComplete?.(result);
    } catch (_err) {
      // 错误已在 hook 中处理
    }
  }, [
    skillName,
    userInput,
    selectedProvider,
    isExecuting,
    execute,
    onExecutionComplete,
  ]);

  // 渲染加载状态
  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // 渲染加载错误
  if (loadError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>加载失败</DialogTitle>
            <DialogDescription>{loadError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // 渲染主内容
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{skillDetail?.display_name || skillName}</DialogTitle>
          <DialogDescription>
            {skillDetail?.description || "执行此 Skill"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Skill 详情 */}
          {skillDetail && <SkillDetailHeader skill={skillDetail} />}

          {/* 用户输入 */}
          <div className="space-y-2">
            <Label htmlFor="user-input">输入内容</Label>
            <Textarea
              id="user-input"
              placeholder="请输入要处理的内容..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={isExecuting}
              className="min-h-[100px]"
            />
          </div>

          {/* Provider 选择 */}
          <div className="space-y-2">
            <Label>Provider 选择</Label>
            <Select
              value={selectedProvider}
              onValueChange={setSelectedProvider}
              disabled={isExecuting}
            >
              <SelectTrigger>
                <SelectValue placeholder="自动选择" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              留空将根据 Skill 配置和可用凭证自动选择
            </p>
          </div>

          {/* 工作流进度 */}
          {skillDetail?.has_workflow && skillDetail.workflow_steps && (
            <div className="space-y-2">
              <Label>执行进度</Label>
              <WorkflowProgress
                steps={skillDetail.workflow_steps}
                currentStepId={currentStep}
                completedSteps={completedSteps}
                currentStepIndex={currentStepIndex}
                totalSteps={totalSteps}
                progress={progress}
                isExecuting={isExecuting}
                error={executionError}
              />
            </div>
          )}

          {/* 非工作流模式的简单进度 */}
          {isExecuting && !skillDetail?.has_workflow && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在执行...</span>
            </div>
          )}

          {/* 执行结果 */}
          <ExecutionResultDisplay
            result={executionResult}
            error={executionError}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExecuting}
          >
            {executionResult ? "关闭" : "取消"}
          </Button>
          <Button
            onClick={handleExecute}
            disabled={isExecuting || !userInput.trim()}
          >
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                执行中...
              </>
            ) : executionResult ? (
              <>
                <Play className="mr-2 h-4 w-4" />
                重新执行
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                执行
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
