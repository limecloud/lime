import React, { memo } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Plus,
  Trash2,
} from "lucide-react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type { AgentRun } from "@/lib/api/executionRun";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  TopicBranchItem,
  TopicBranchStatus,
} from "../hooks/useTopicBranchBoard";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import {
  buildWorkflowStepSnapshot,
  buildWorkflowSummaryText,
  formatWorkflowProgressLabel,
  getWorkflowStatusLabel,
} from "../utils/workflowStepPresentation";
import type {
  GeneralWorkbenchActivityLogGroup,
  GeneralWorkbenchCreationTaskGroup,
  GeneralWorkbenchRunMetadataSummary,
} from "./generalWorkbenchWorkflowData";

interface GeneralWorkbenchWorkflowPanelProps {
  isVersionMode: boolean;
  onNewTopic: () => void;
  onSwitchTopic: (topicId: string) => void;
  onDeleteTopic: (topicId: string) => void;
  branchItems: TopicBranchItem[];
  onSetBranchStatus: (topicId: string, status: TopicBranchStatus) => void;
  workflowSteps: Array<{ id: string; title: string; status: StepStatus }>;
  completedSteps: number;
  progressPercent: number;
  onAddImage?: () => Promise<void> | void;
  onImportDocument?: () => Promise<void> | void;
  creationTaskEventsCount: number;
  showCreationTasks: boolean;
  onToggleCreationTasks: () => void;
  groupedCreationTaskEvents: GeneralWorkbenchCreationTaskGroup[];
  showActivityLogs: boolean;
  onToggleActivityLogs: () => void;
  groupedActivityLogs: GeneralWorkbenchActivityLogGroup[];
  onViewRunDetail?: (runId: string) => void;
  activeRunDetail?: AgentRun | null;
  activeRunDetailLoading?: boolean;
  activeRunStagesLabel?: string | null;
  runMetadataText: string;
  runMetadataSummary: GeneralWorkbenchRunMetadataSummary;
  onCopyText: (text: string) => Promise<void> | void;
  onRevealArtifactInFinder: (
    artifactPath: string,
    sessionId?: string | null,
  ) => Promise<void> | void;
  onOpenArtifactWithDefaultApp: (
    artifactPath: string,
    sessionId?: string | null,
  ) => Promise<void> | void;
}

const WORKFLOW_SECTION_CLASSNAME = "border-b border-slate-200/70 px-4 py-3";

const WORKFLOW_SECTION_TITLE_CLASSNAME =
  "mb-2.5 flex items-center justify-between text-[11px] font-semibold text-slate-500";

const WORKFLOW_SECTION_BADGE_CLASSNAME =
  "inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-slate-500";

const WORKFLOW_NEW_TOPIC_BUTTON_CLASSNAME =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900";

const WORKFLOW_STEP_LIST_CLASSNAME = "mt-3 flex flex-col gap-2";

const WORKFLOW_TASK_SUMMARY_CLASSNAME =
  "mt-2 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5";

const WORKFLOW_TASK_SUMMARY_PILL_CLASSNAME =
  "inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500";

const TOGGLE_BUTTON_CLASSNAME =
  "inline-flex items-center text-slate-500 transition-colors hover:text-slate-900";

const WORKFLOW_INLINE_LABEL_CLASSNAME =
  "text-[10px] font-semibold text-slate-500";

function createDiv(baseClassName: string) {
  return function ClassedDiv({
    className,
    ...props
  }: React.ComponentPropsWithoutRef<"div">) {
    return <div className={cn(baseClassName, className)} {...props} />;
  };
}

function createButton(baseClassName: string) {
  return function ClassedButton({
    className,
    ...props
  }: React.ComponentPropsWithoutRef<"button">) {
    return <button className={cn(baseClassName, className)} {...props} />;
  };
}

function createCode(baseClassName: string) {
  return function ClassedCode({
    className,
    ...props
  }: React.ComponentPropsWithoutRef<"code">) {
    return <code className={cn(baseClassName, className)} {...props} />;
  };
}

function createPre(baseClassName: string) {
  return function ClassedPre({
    className,
    ...props
  }: React.ComponentPropsWithoutRef<"pre">) {
    return <pre className={cn(baseClassName, className)} {...props} />;
  };
}

const BranchList = createDiv("flex flex-col gap-1.5");

function BranchItem({
  $active,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  $active: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[14px] border px-3 py-2.5",
        $active
          ? "border-sky-200/80 bg-sky-50/40"
          : "border-slate-200/80 bg-slate-50/70",
        className,
      )}
      {...props}
    />
  );
}

const BranchHead = createDiv("flex items-start gap-2");

const BranchTitleButton = createButton(
  "flex-1 truncate border-0 bg-transparent p-0 text-left text-[12px] font-medium leading-5 text-slate-900",
);

function StatusBadge({
  $status,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"span"> & {
  $status: TopicBranchStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        $status === "merged" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        $status === "in_progress" &&
          "border-sky-200 bg-sky-50 text-sky-700",
        $status === "pending" &&
          "border-amber-200 bg-amber-50 text-amber-700",
        $status !== "merged" &&
          $status !== "in_progress" &&
          $status !== "pending" &&
          "border-slate-200 bg-slate-100 text-slate-500",
        className,
      )}
      {...props}
    />
  );
}

const BranchMeta = createDiv("mt-1 text-[10px] leading-4 text-slate-500");

const ActionRow = createDiv("mt-2 flex flex-wrap gap-1.5");

const TinyButton = createButton(
  "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
);

const DeleteButton = createButton(
  "rounded-full p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600",
);

const ActivityList = createDiv("flex flex-col gap-[5px]");

const ActivityItem = createDiv(
  "rounded-lg border border-slate-200/80 bg-white px-[7px] py-[6px] text-[11px]",
);

const ActivityGroupHeader = createDiv(
  "flex items-center gap-1.5 text-slate-900",
);

const ActivityTitle = createDiv("flex items-center gap-1.5 text-slate-900");

const ActivityMeta = createDiv(
  "mt-2 rounded-lg bg-slate-50/90 px-3 py-2 text-[11px] leading-6 text-slate-500",
);

const ActivityStepList = createDiv("mt-1.5 flex flex-col gap-1");

const ActivityStepItem = createDiv(
  "rounded-md border border-slate-200/80 bg-slate-50/80 px-1.5 py-[5px]",
);

const RunLinkButton = createButton(
  "border-0 bg-transparent p-0 text-[11px] leading-[1.35] text-sky-700 transition-colors hover:text-slate-900 disabled:cursor-default disabled:text-slate-400",
);

const RunDetailPanel = createDiv(
  "mt-2 rounded-lg border border-slate-200/80 bg-white p-2",
);

const RunDetailTitle = createDiv(
  "mb-1.5 text-[11px] font-semibold text-slate-900",
);

const RunDetailRow = createDiv(
  "break-all text-[11px] leading-[1.45] text-slate-500",
);

const RunDetailArtifacts = createDiv("mt-1.5 flex flex-col gap-1");

const RunDetailArtifactRow = createDiv("flex items-center gap-1.5");

const RunDetailArtifactPath = createCode(
  "min-w-0 flex-1 truncate rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-900",
);

const RunDetailCode = createPre(
  "mt-1.5 max-h-[120px] overflow-auto rounded-md bg-slate-100 p-1.5 text-[10px] leading-[1.4] text-slate-900",
);

const RunDetailActions = createDiv("mt-1.5 flex gap-1.5");

const RunDetailActionButton = createButton(
  "rounded-md border border-slate-200 bg-white px-[7px] py-[3px] text-[11px] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:text-slate-400",
);

function getWorkflowStepRowClassName(status: StepStatus) {
  return cn(
    "flex items-start gap-2.5 rounded-[14px] border bg-white px-3 py-2.5 text-sm leading-5 shadow-sm shadow-slate-950/5",
    status === "completed" && "border-slate-200 text-slate-700",
    status === "error" && "border-rose-200 text-slate-900",
    status === "active" && "border-sky-200 text-slate-900",
    status !== "completed" &&
      status !== "error" &&
      status !== "active" &&
      "border-slate-200 text-slate-600",
  );
}

function getStepIcon(status: StepStatus) {
  if (status === "completed") {
    return <CheckCircle2 size={13} />;
  }
  if (status === "error") {
    return <AlertCircle size={13} />;
  }
  if (status === "active") {
    return <Clock3 size={13} />;
  }
  return <Circle size={11} />;
}

function getStatusBadgeClassName(status: StepStatus) {
  return cn(
    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
    status === "completed" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "error" && "border-rose-200 bg-rose-50 text-rose-700",
    status === "active" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "pending" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "skipped" && "border-slate-200 bg-slate-50 text-slate-500",
  );
}

function getWorkflowStepIconClassName(status: StepStatus) {
  return cn(
    status === "completed" && "text-emerald-600",
    status === "error" && "text-rose-600",
    status === "active" && "text-sky-600",
    status !== "completed" &&
      status !== "error" &&
      status !== "active" &&
      "text-slate-400",
  );
}

function getBranchStatusText(status: TopicBranchStatus): string {
  if (status === "in_progress") return "进行中";
  if (status === "pending") return "待评审";
  if (status === "merged") return "已合并";
  return "备选";
}

function getBranchSectionTitle(isVersionMode: boolean): string {
  return isVersionMode ? "相关版本" : "相关分支";
}

function getBranchCreateLabel(isVersionMode: boolean): string {
  return isVersionMode ? "新增版本" : "新增分支";
}

function getBranchPrimaryActionLabel(isVersionMode: boolean): string {
  return isVersionMode ? "设为主稿" : "采纳";
}

function getBranchSecondaryActionLabel(isVersionMode: boolean): string {
  return isVersionMode ? "待评审" : "待决策";
}

function getEmptyBranchText(isVersionMode: boolean): string {
  return isVersionMode
    ? "暂无相关版本，当前任务还没有沉淀出可切换记录"
    : "暂无相关分支，当前任务还在主线上推进";
}

function getBranchMetaText(
  item: TopicBranchItem,
  isVersionMode: boolean,
): string {
  if (item.isCurrent) {
    return isVersionMode
      ? "当前任务正在围绕这一版内容继续推进"
      : "当前任务正在围绕这条分支继续推进";
  }
  if (item.status === "merged") {
    return isVersionMode ? "这版内容已经收进主稿" : "这条分支已经并入主稿";
  }
  if (item.status === "pending") {
    return isVersionMode
      ? "等待评审后再决定是否继续推进"
      : "等待决策后再决定是否继续推进";
  }
  if (item.status === "candidate") {
    return isVersionMode ? "保留为可回看的候选版本" : "保留为可回看的候选分支";
  }
  return isVersionMode
    ? "记录一版正在推进中的内容"
    : "记录一条正在推进中的相关分支";
}

function formatGateLabel(
  gateKey?: SidebarActivityLog["gateKey"],
): string | null {
  if (!gateKey || gateKey === "idle") {
    return null;
  }
  if (gateKey === "topic_select") {
    return "选题闸门";
  }
  if (gateKey === "write_mode") {
    return "写作闸门";
  }
  if (gateKey === "publish_confirm") {
    return "发布闸门";
  }
  return null;
}

function formatRunIdShort(runId?: string): string | null {
  const trimmed = runId?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…`;
}

function formatRunStatusLabel(status: AgentRun["status"]): string {
  if (status === "queued") return "稍后开始";
  if (status === "running") return "处理中";
  if (status === "success") return "成功";
  if (status === "error") return "失败";
  if (status === "canceled") return "已取消";
  if (status === "timeout") return "超时";
  return status;
}

function renderActivityLogItem(
  group: GeneralWorkbenchActivityLogGroup,
  onViewRunDetail: GeneralWorkbenchWorkflowPanelProps["onViewRunDetail"],
  onRevealArtifactInFinder: GeneralWorkbenchWorkflowPanelProps["onRevealArtifactInFinder"],
  onOpenArtifactWithDefaultApp: GeneralWorkbenchWorkflowPanelProps["onOpenArtifactWithDefaultApp"],
) {
  const gateLabel = formatGateLabel(group.gateKey);
  const runLabel = formatRunIdShort(group.runId);
  const sourceLabel = group.source?.trim() || "-";
  const primaryLog =
    group.logs.find((log) => log.source === "skill") || group.logs[0];

  return (
    <ActivityItem key={`activity-${group.key}`}>
      <ActivityGroupHeader>
        <span>●</span>
        <span>
          {primaryLog?.source === "skill"
            ? `技能：${primaryLog.name}`
            : primaryLog?.name || "活动日志"}
        </span>
        <span className="ml-auto">{group.timeLabel}</span>
      </ActivityGroupHeader>
      {gateLabel || sourceLabel ? (
        <ActivityMeta>
          {gateLabel ? `闸门：${gateLabel}` : ""}
          {gateLabel && sourceLabel ? " · " : ""}
          {sourceLabel ? `来源：${sourceLabel}` : ""}
        </ActivityMeta>
      ) : null}
      {group.artifactPaths.length > 0 ? (
        <ActivityMeta>修改：{group.artifactPaths.join("、")}</ActivityMeta>
      ) : null}
      <ActivityStepList>
        {group.logs.map((log) => (
          <ActivityStepItem key={log.id}>
            <ActivityTitle>
              <span>•</span>
              <span>{log.name}</span>
              <span className="ml-auto">{log.timeLabel}</span>
            </ActivityTitle>
            {log.inputSummary ? (
              <ActivityMeta>输入：{log.inputSummary}</ActivityMeta>
            ) : null}
            {log.outputSummary ? (
              <ActivityMeta>输出：{log.outputSummary}</ActivityMeta>
            ) : null}
          </ActivityStepItem>
        ))}
      </ActivityStepList>
      <ActionRow>
        {group.runId && onViewRunDetail ? (
          <RunLinkButton
            type="button"
            onClick={() => onViewRunDetail(group.runId!)}
          >
            运行：{runLabel || group.runId}
          </RunLinkButton>
        ) : null}
        {group.artifactPaths.map((artifactPath) => (
          <ActivityMetaFragment
            key={`${group.key}-${artifactPath}`}
            artifactPath={artifactPath}
            sessionId={group.sessionId || null}
            onRevealArtifactInFinder={onRevealArtifactInFinder}
            onOpenArtifactWithDefaultApp={onOpenArtifactWithDefaultApp}
          />
        ))}
      </ActionRow>
    </ActivityItem>
  );
}

function ActivityMetaFragment({
  artifactPath,
  sessionId,
  onRevealArtifactInFinder,
  onOpenArtifactWithDefaultApp,
}: {
  artifactPath: string;
  sessionId?: string | null;
  onRevealArtifactInFinder: GeneralWorkbenchWorkflowPanelProps["onRevealArtifactInFinder"];
  onOpenArtifactWithDefaultApp: GeneralWorkbenchWorkflowPanelProps["onOpenArtifactWithDefaultApp"];
}) {
  return (
    <>
      <TinyButton
        type="button"
        aria-label={`定位活动产物路径-${artifactPath}`}
        onClick={() => {
          void onRevealArtifactInFinder(artifactPath, sessionId);
        }}
      >
        定位产物
      </TinyButton>
      <TinyButton
        type="button"
        aria-label={`打开活动产物路径-${artifactPath}`}
        onClick={() => {
          void onOpenArtifactWithDefaultApp(artifactPath, sessionId);
        }}
      >
        打开产物
      </TinyButton>
    </>
  );
}

function GeneralWorkbenchWorkflowPanelComponent({
  isVersionMode,
  onNewTopic,
  onSwitchTopic,
  onDeleteTopic,
  branchItems,
  onSetBranchStatus,
  workflowSteps,
  completedSteps,
  progressPercent,
  onAddImage,
  onImportDocument,
  creationTaskEventsCount,
  showCreationTasks,
  onToggleCreationTasks,
  groupedCreationTaskEvents,
  showActivityLogs,
  onToggleActivityLogs,
  groupedActivityLogs,
  onViewRunDetail,
  activeRunDetail,
  activeRunDetailLoading = false,
  activeRunStagesLabel,
  runMetadataText,
  runMetadataSummary,
  onCopyText,
  onRevealArtifactInFinder,
  onOpenArtifactWithDefaultApp,
}: GeneralWorkbenchWorkflowPanelProps) {
  const workflowSnapshot = buildWorkflowStepSnapshot(workflowSteps, 3);
  const currentWorkflowStep = workflowSnapshot.leadingStep;
  const remainingSteps = workflowSnapshot.remainingCount;
  const sortedWorkflowSteps = workflowSnapshot.sortedSteps;
  const sortedBranchItems = [...branchItems].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }
    const statusPriority: Record<TopicBranchStatus, number> = {
      in_progress: 0,
      pending: 1,
      candidate: 2,
      merged: 3,
    };
    const statusDiff =
      statusPriority[left.status] - statusPriority[right.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });
  const workflowSummaryText = buildWorkflowSummaryText({
    leadingStep: currentWorkflowStep,
    remainingCount: remainingSteps,
    emptyLabel: workflowSteps.length > 0 ? "当前流程已完成" : "等待创建第一条任务",
  });
  const workflowProgressLabel = formatWorkflowProgressLabel({
    completedCount: completedSteps,
    totalCount: workflowSteps.length,
  });
  const branchSectionTitle = getBranchSectionTitle(isVersionMode);
  const branchCreateLabel = getBranchCreateLabel(isVersionMode);
  const branchPrimaryActionLabel = getBranchPrimaryActionLabel(isVersionMode);
  const branchSecondaryActionLabel = getBranchSecondaryActionLabel(isVersionMode);

  return (
    <>
      <section
        className={WORKFLOW_SECTION_CLASSNAME}
        data-testid="workflow-sidebar-task-section"
      >
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>任务视图</span>
          <span className={WORKFLOW_SECTION_BADGE_CLASSNAME}>
            {remainingSteps}
          </span>
        </div>
        <div
          className={WORKFLOW_TASK_SUMMARY_CLASSNAME}
          data-testid="workflow-sidebar-task-summary"
        >
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5",
                getWorkflowStepIconClassName(
                  currentWorkflowStep?.status ?? "active",
                ),
              )}
            >
              {getStepIcon(currentWorkflowStep?.status ?? "active")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={WORKFLOW_INLINE_LABEL_CLASSNAME}>
                  当前任务
                </span>
                <span
                  className="break-words text-sm font-semibold leading-5 text-slate-900"
                  data-testid="workflow-sidebar-current-step"
                >
                  {currentWorkflowStep?.title || "当前流程已完成"}
                </span>
                <span
                  className={getStatusBadgeClassName(
                    currentWorkflowStep?.status ?? "completed",
                  )}
                >
                  {getWorkflowStatusLabel(
                    currentWorkflowStep?.status ?? "completed",
                  )}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-5 text-slate-500">
                {workflowSummaryText}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={WORKFLOW_TASK_SUMMARY_PILL_CLASSNAME}>
                  {workflowProgressLabel}
                </span>
                <span className={WORKFLOW_TASK_SUMMARY_PILL_CLASSNAME}>
                  {remainingSteps > 0
                    ? `剩余 ${remainingSteps} 项待处理`
                    : "当前流程已全部完成"}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="inline-flex h-1 w-14 overflow-hidden rounded-full bg-slate-200">
                    <span
                      className="h-full rounded-full bg-sky-500/70 transition-[width] duration-200"
                      style={{
                        width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                      }}
                    />
                  </span>
                  {Math.max(0, Math.min(100, Math.round(progressPercent)))}%
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className={WORKFLOW_STEP_LIST_CLASSNAME}>
          {sortedWorkflowSteps.map((step) => (
            <div
              key={step.id}
              className={getWorkflowStepRowClassName(step.status)}
              data-testid="workflow-sidebar-step"
              data-status={step.status}
            >
              <span
                className={cn("mt-0.5", getWorkflowStepIconClassName(step.status))}
              >
                {getStepIcon(step.status)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm leading-5">{step.title}</div>
              </div>
              <span className={getStatusBadgeClassName(step.status)}>
                {getWorkflowStatusLabel(step.status)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section
        className={cn(WORKFLOW_SECTION_CLASSNAME, "relative z-10")}
        data-testid="workflow-sidebar-branch-section"
      >
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>{branchSectionTitle}</span>
          <span className="inline-flex items-center gap-2">
            <span className={WORKFLOW_SECTION_BADGE_CLASSNAME}>
              {branchItems.length}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={WORKFLOW_NEW_TOPIC_BUTTON_CLASSNAME}
                >
                  <Plus size={13} />
                  {branchCreateLabel}
                  <ChevronDown size={11} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" style={{ width: "260px" }}>
                <DropdownMenuItem onClick={onNewTopic}>
                  <GitBranch size={14} />
                  <span>{branchCreateLabel}</span>
                </DropdownMenuItem>
                {onAddImage ? (
                  <DropdownMenuItem onClick={onAddImage}>
                    <ImageIcon size={14} />
                    <span>添加图片</span>
                  </DropdownMenuItem>
                ) : null}
                {onImportDocument ? (
                  <DropdownMenuItem onClick={onImportDocument}>
                    <FileText size={14} />
                    <span>导入文稿</span>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        <BranchList className="custom-scrollbar">
          {branchItems.length === 0 ? (
            <ActivityMeta>{getEmptyBranchText(isVersionMode)}</ActivityMeta>
          ) : (
            sortedBranchItems.map((item) => (
              <BranchItem key={item.id} $active={item.isCurrent}>
                <BranchHead>
                  <GitBranch
                    size={13}
                    className={cn(
                      "mt-0.5 shrink-0",
                      item.isCurrent ? "text-sky-600" : "text-slate-400",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <BranchTitleButton onClick={() => onSwitchTopic(item.id)}>
                        {item.title}
                      </BranchTitleButton>
                      <StatusBadge $status={item.status}>
                        {item.isCurrent
                          ? "当前焦点"
                          : getBranchStatusText(item.status)}
                      </StatusBadge>
                      {!isVersionMode ? (
                        <DeleteButton
                          onClick={() => onDeleteTopic(item.id)}
                          aria-label="删除分支"
                        >
                          <Trash2 size={12} />
                        </DeleteButton>
                      ) : null}
                    </div>
                    <BranchMeta>{getBranchMetaText(item, isVersionMode)}</BranchMeta>
                  </div>
                </BranchHead>
                <ActionRow>
                  <TinyButton
                    onClick={() => onSetBranchStatus(item.id, "merged")}
                  >
                    {branchPrimaryActionLabel}
                  </TinyButton>
                  <TinyButton
                    onClick={() => onSetBranchStatus(item.id, "pending")}
                  >
                    {branchSecondaryActionLabel}
                  </TinyButton>
                </ActionRow>
              </BranchItem>
            ))
          )}
        </BranchList>
      </section>

      <section className={WORKFLOW_SECTION_CLASSNAME}>
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>任务提交</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={WORKFLOW_SECTION_BADGE_CLASSNAME}>
              {creationTaskEventsCount}
            </span>
            <button
              type="button"
              aria-label="切换任务提交记录"
              className={TOGGLE_BUTTON_CLASSNAME}
              onClick={onToggleCreationTasks}
            >
              {showCreationTasks ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          </span>
        </div>
        {showCreationTasks ? (
          <ActivityList className="custom-scrollbar">
            {groupedCreationTaskEvents.length === 0 ? (
              <ActivityMeta>暂无任务提交</ActivityMeta>
            ) : (
              groupedCreationTaskEvents.map((group) => (
                <ActivityItem key={`creation-task-${group.key}`}>
                  <ActivityGroupHeader>
                    <span>●</span>
                    <span>{group.label}</span>
                    <span className="ml-auto">{group.latestTimeLabel}</span>
                  </ActivityGroupHeader>
                  <ActivityMeta>
                    类型：{group.taskType} · 本组 {group.tasks.length} 条
                  </ActivityMeta>
                  <ActivityStepList>
                    {group.tasks.map((task) => (
                      <ActivityStepItem key={`${task.taskId}-${task.path}`}>
                        <ActivityTitle>
                          <span>•</span>
                          <span>{task.path}</span>
                          <span className="ml-auto">{task.timeLabel}</span>
                        </ActivityTitle>
                        <ActivityMeta>任务ID：{task.taskId}</ActivityMeta>
                        {task.absolutePath ? (
                          <RunDetailArtifacts>
                            <RunDetailArtifactRow>
                              <RunDetailArtifactPath>
                                {task.absolutePath}
                              </RunDetailArtifactPath>
                              <RunDetailActionButton
                                type="button"
                                aria-label={`复制任务文件绝对路径-${task.taskId}`}
                                onClick={() => {
                                  void onCopyText(task.absolutePath || "");
                                }}
                              >
                                复制绝对路径
                              </RunDetailActionButton>
                            </RunDetailArtifactRow>
                          </RunDetailArtifacts>
                        ) : (
                          <RunDetailActions>
                            <RunDetailActionButton
                              type="button"
                              aria-label={`复制任务文件路径-${task.taskId}`}
                              onClick={() => {
                                void onCopyText(task.path);
                              }}
                            >
                              复制路径
                            </RunDetailActionButton>
                          </RunDetailActions>
                        )}
                      </ActivityStepItem>
                    ))}
                  </ActivityStepList>
                </ActivityItem>
              ))
            )}
          </ActivityList>
        ) : null}
      </section>

      <section className={WORKFLOW_SECTION_CLASSNAME}>
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>活动日志</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={WORKFLOW_SECTION_BADGE_CLASSNAME}>
              {groupedActivityLogs.length}
            </span>
            <button
              type="button"
              aria-label="切换活动日志"
              className={TOGGLE_BUTTON_CLASSNAME}
              onClick={onToggleActivityLogs}
            >
              {showActivityLogs ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          </span>
        </div>
        {showActivityLogs ? (
          <>
            <ActivityList className="custom-scrollbar">
              {groupedActivityLogs.length === 0 ? (
                <ActivityMeta>暂无活动日志</ActivityMeta>
              ) : (
                groupedActivityLogs.map((group) =>
                  renderActivityLogItem(
                    group,
                    onViewRunDetail,
                    onRevealArtifactInFinder,
                    onOpenArtifactWithDefaultApp,
                  ),
                )
              )}
            </ActivityList>
            {activeRunDetailLoading ? (
              <ActivityMeta>运行详情加载中...</ActivityMeta>
            ) : activeRunDetail ? (
              <RunDetailPanel>
                <RunDetailTitle>运行详情</RunDetailTitle>
                <RunDetailRow>ID：{activeRunDetail.id}</RunDetailRow>
                <RunDetailRow>
                  状态：{formatRunStatusLabel(activeRunDetail.status)}
                </RunDetailRow>
                {runMetadataSummary.workflow ? (
                  <RunDetailRow>
                    工作流：{runMetadataSummary.workflow}
                  </RunDetailRow>
                ) : null}
                {runMetadataSummary.executionId ? (
                  <RunDetailRow>
                    执行ID：{runMetadataSummary.executionId}
                  </RunDetailRow>
                ) : null}
                {runMetadataSummary.versionId ? (
                  <RunDetailRow>
                    版本ID：{runMetadataSummary.versionId}
                  </RunDetailRow>
                ) : null}
                {activeRunStagesLabel ? (
                  <RunDetailRow>阶段：{activeRunStagesLabel}</RunDetailRow>
                ) : null}
                <RunDetailActions>
                  <RunDetailActionButton
                    type="button"
                    aria-label="复制运行ID"
                    onClick={() => {
                      void onCopyText(activeRunDetail.id);
                    }}
                  >
                    复制运行ID
                  </RunDetailActionButton>
                  <RunDetailActionButton
                    type="button"
                    aria-label="复制运行元数据"
                    onClick={() => {
                      void onCopyText(runMetadataText);
                    }}
                  >
                    复制运行元数据
                  </RunDetailActionButton>
                </RunDetailActions>
                {runMetadataSummary.artifactPaths.length > 0 ? (
                  <RunDetailArtifacts>
                    {runMetadataSummary.artifactPaths.map((artifactPath) => (
                      <RunDetailArtifactRow key={`run-detail-${artifactPath}`}>
                        <RunDetailArtifactPath>
                          {artifactPath}
                        </RunDetailArtifactPath>
                        <RunDetailActionButton
                          type="button"
                          aria-label={`复制产物路径-${artifactPath}`}
                          onClick={() => {
                            void onCopyText(artifactPath);
                          }}
                        >
                          复制路径
                        </RunDetailActionButton>
                        <RunDetailActionButton
                          type="button"
                          aria-label={`定位产物路径-${artifactPath}`}
                          onClick={() => {
                            void onRevealArtifactInFinder(artifactPath);
                          }}
                        >
                          定位
                        </RunDetailActionButton>
                        <RunDetailActionButton
                          type="button"
                          aria-label={`打开产物路径-${artifactPath}`}
                          onClick={() => {
                            void onOpenArtifactWithDefaultApp(artifactPath);
                          }}
                        >
                          打开
                        </RunDetailActionButton>
                      </RunDetailArtifactRow>
                    ))}
                  </RunDetailArtifacts>
                ) : null}
                <RunDetailCode>{runMetadataText}</RunDetailCode>
              </RunDetailPanel>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
}

export const GeneralWorkbenchWorkflowPanel = memo(
  GeneralWorkbenchWorkflowPanelComponent,
);
