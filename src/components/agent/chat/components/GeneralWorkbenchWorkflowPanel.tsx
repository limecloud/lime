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
  showBranchRecords: boolean;
  onToggleBranchRecords: () => void;
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

const WORKFLOW_RESULT_HANDOFF_HINT_CLASSNAME =
  "mt-2 rounded-[12px] border border-slate-200/80 bg-white/90 px-3 py-2";

const TOGGLE_BUTTON_CLASSNAME =
  "inline-flex items-center text-slate-500 transition-colors hover:text-slate-900";

const WORKFLOW_INLINE_LABEL_CLASSNAME =
  "text-[10px] font-semibold text-slate-500";

const WORKFLOW_QUEUE_HEADER_CLASSNAME =
  "mt-3 flex items-center justify-between text-[10px] font-semibold text-slate-500";

const WORKFLOW_QUEUE_LIST_CLASSNAME = "mt-2 flex flex-col gap-1.5";

function WorkflowQueueRow({
  $status,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  $status: StepStatus;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border px-2.5 py-2",
        $status === "error" && "border-rose-200/80 bg-rose-50/50",
        $status === "active" && "border-sky-200/80 bg-sky-50/40",
        $status === "pending" && "border-slate-200/80 bg-white",
        $status === "completed" && "border-slate-200/80 bg-slate-50/70",
        $status === "skipped" && "border-slate-200/80 bg-slate-50/70",
        className,
      )}
      {...props}
    />
  );
}

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

const BranchList = createDiv("flex flex-col gap-1.5");

const BranchSectionSummary = createDiv(
  "mt-2 text-[11px] leading-5 text-slate-500",
);

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
        "rounded-xl border px-3 py-2",
        $active
          ? "border-sky-200/80 bg-white"
          : "border-slate-200/80 bg-slate-50/60",
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

const BranchHint = createDiv("mt-1 text-[10px] leading-4 text-slate-400");

const ActionRow = createDiv("mt-2 flex flex-wrap gap-1.5");

const TinyButton = createButton(
  "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
);

const DeleteButton = createButton(
  "rounded-full p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600",
);

const ActivityList = createDiv("flex flex-col gap-[5px]");

const ActivityMeta = createDiv(
  "mt-2 rounded-lg bg-slate-50/90 px-3 py-2 text-[11px] leading-6 text-slate-500",
);

const SecondarySectionSummaryCard = createDiv(
  "mt-1 rounded-[12px] border border-slate-200/70 bg-slate-50/70 px-3 py-2",
);

const SecondarySectionSummaryTitle = createDiv(
  "text-[11px] font-medium leading-5 text-slate-700",
);

const SecondarySectionSummaryMeta = createDiv(
  "mt-0.5 text-[10px] leading-5 text-slate-500",
);

const CreationTaskGroupCard = createDiv(
  "rounded-[14px] border border-slate-200/80 bg-white px-3 py-2.5",
);

const CreationTaskGroupHeader = createDiv(
  "flex items-center gap-2 text-slate-900",
);

const CreationTaskGroupCount = createDiv(
  "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500",
);

const CreationTaskList = createDiv("mt-2 flex flex-col gap-1.5");

const CreationTaskRow = createDiv(
  "flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-2.5 py-2",
);

const CreationTaskContent = createDiv("min-w-0 flex-1");

const CreationTaskTitleRow = createDiv("flex items-start gap-2");

const CreationTaskTitle = createDiv(
  "min-w-0 flex-1 truncate text-[11px] font-medium leading-5 text-slate-900",
);

const CreationTaskTime = createDiv(
  "shrink-0 text-[10px] leading-5 text-slate-400",
);

const CreationTaskPath = createCode(
  "mt-1 block truncate rounded-md bg-white px-1.5 py-1 font-mono text-[10px] text-slate-500",
);

const ActivityLogCard = createDiv(
  "rounded-[14px] border border-slate-200/80 bg-white px-3 py-2.5",
);

const ActivityLogHeader = createDiv("flex items-start gap-2");

const ActivityLogTitleBlock = createDiv("min-w-0 flex-1");

const ActivityLogTitle = createDiv(
  "truncate text-[12px] font-medium leading-5 text-slate-900",
);

const ActivityLogMetaRow = createDiv("mt-1 flex flex-wrap items-center gap-1.5");

const ActivityLogBadge = createDiv(
  "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500",
);

const ActivityLogSummary = createDiv(
  "mt-2 text-[11px] leading-5 text-slate-500",
);

const ActivityLogSteps = createDiv("mt-2 flex flex-col gap-1.5");

const ActivityLogStepRow = createDiv(
  "rounded-xl border border-slate-200/80 bg-slate-50/70 px-2.5 py-2",
);

const ActivityLogStepHead = createDiv(
  "flex items-start gap-2 text-[11px] leading-5 text-slate-900",
);

const ActivityLogStepSummary = createDiv(
  "mt-1 text-[10px] leading-4 text-slate-500",
);

const RunLinkButton = createButton(
  "border-0 bg-transparent p-0 text-[11px] leading-[1.35] text-sky-700 transition-colors hover:text-slate-900 disabled:cursor-default disabled:text-slate-400",
);

const RunDetailPanel = createDiv(
  "mt-2 rounded-[14px] border border-slate-200/80 bg-slate-50/80 px-3 py-2.5",
);

const RunDetailHeader = createDiv("flex items-start gap-2");

const RunDetailTitleBlock = createDiv("min-w-0 flex-1");

const RunDetailMetaRow = createDiv("mt-1 flex flex-wrap items-center gap-1.5");

const RunDetailSummary = createDiv("mt-2 text-[11px] leading-5 text-slate-500");

const RunDetailBadge = createDiv(
  "inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500",
);

const RunDetailTitle = createDiv(
  "text-[12px] font-medium leading-5 text-slate-900",
);

const RunDetailRow = createDiv(
  "break-all text-[11px] leading-[1.45] text-slate-500",
);

const RunDetailArtifacts = createDiv("mt-2 flex flex-col gap-2");

const RunDetailArtifactsTitle = createDiv(
  "text-[10px] font-semibold text-slate-500",
);

const RunDetailArtifactRow = createDiv(
  "rounded-xl border border-slate-200/80 bg-white px-2.5 py-2",
);

const RunDetailArtifactPath = createCode(
  "block truncate rounded-md bg-slate-50 px-1.5 py-1 font-mono text-[10px] text-slate-900",
);

const RunDetailArtifactActions = createDiv("mt-1.5 flex flex-wrap gap-1.5");

const RunDetailArtifactActionButton = createButton(
  "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900",
);

const RunDetailActions = createDiv("mt-1.5 flex gap-1.5");

const RunDetailActionButton = createButton(
  "rounded-md border border-slate-200 bg-white px-[7px] py-[3px] text-[11px] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:text-slate-400",
);

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
  if (status === "pending") return "稍后再看";
  if (status === "merged") return "已收进主稿";
  return "候选";
}

function getBranchSectionTitle(isVersionMode: boolean): string {
  return isVersionMode ? "可继续版本" : "可继续稿件";
}

function getBranchCreateLabel(isVersionMode: boolean): string {
  return isVersionMode ? "留一版" : "留一稿";
}

function getBranchPrimaryActionLabel(isVersionMode: boolean): string {
  return isVersionMode ? "设为主稿" : "收进主稿";
}

function getBranchSecondaryActionLabel(isVersionMode: boolean): string {
  return isVersionMode ? "稍后再看" : "稍后再看";
}

function getEmptyBranchText(isVersionMode: boolean): string {
  return isVersionMode
    ? "还没有可继续的版本，当前内容仍在主线上推进。"
    : "还没有可继续的稿件，当前内容仍在主线上推进。";
}

function getBranchMetaText(
  item: TopicBranchItem,
  isVersionMode: boolean,
): string {
  if (item.isCurrent) {
    return isVersionMode
      ? "当前正在沿着这一版内容继续打磨"
      : "当前正在沿着这一稿继续打磨";
  }
  if (item.status === "merged") {
    return isVersionMode ? "这版内容已经收进主稿" : "这一稿已经收进主稿";
  }
  if (item.status === "pending") {
    return "先保留下来，稍后再决定是否继续推进";
  }
  if (item.status === "candidate") {
    return isVersionMode ? "保留为可回看的候选版本" : "保留为可回看的候选稿件";
  }
  return isVersionMode
    ? "记录一版仍在推进中的内容"
    : "记录一稿仍在推进中的内容";
}

function buildBranchSectionSummaryText(params: {
  currentBranch: TopicBranchItem | null;
  relatedCount: number;
  isVersionMode: boolean;
}): string {
  const { currentBranch, relatedCount, isVersionMode } = params;
  if (!currentBranch) {
    return isVersionMode
      ? "当前还没有沉淀出可继续的版本。"
      : "当前还没有沉淀出可继续的稿件。";
  }
  if (relatedCount <= 0) {
    return `当前焦点落在「${currentBranch.title}」，目前只保留这一${isVersionMode ? "版" : "稿"}可继续打磨。`;
  }
  return `当前焦点落在「${currentBranch.title}」，另有 ${relatedCount} ${isVersionMode ? "个可继续版本" : "个可继续稿件"}可在需要时切换。`;
}

function buildCreationTaskSectionSummary(params: {
  groups: GeneralWorkbenchCreationTaskGroup[];
  totalCount: number;
}): {
  title: string;
  meta: string;
} {
  const { groups, totalCount } = params;
  if (totalCount <= 0 || groups.length === 0) {
    return {
      title: "最近还没有新的产出记录",
      meta: "后续生成的任务文件与结果索引会按类型留在这里。",
    };
  }

  const latestGroup = groups[0];
  const latestTime = latestGroup.latestTimeLabel || "最近";
  return {
    title: `最近一次：${latestGroup.label}`,
    meta: `${latestTime} · 共 ${totalCount} 条产出记录，按 ${groups.length} 类归档。`,
  };
}

function formatCreationTaskCountLabel(count: number): string {
  return `${count} 条记录`;
}

function buildWorkflowResultHandoffText(params: {
  branchSectionTitle: string;
  hasRecordedOutputs: boolean;
}): string {
  const { branchSectionTitle, hasRecordedOutputs } = params;
  const recordVerb = hasRecordedOutputs ? "会继续收进" : "会收进";
  return `主稿、任务文件和运行产物${recordVerb}下方“产出记录 / 执行经过”；需要继续改写时，可从${branchSectionTitle}或首页“继续上次做法”接着跑。`;
}

function getCreationTaskTitle(path: string): string {
  const normalized = path.trim();
  if (!normalized) {
    return "未命名任务";
  }
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || normalized;
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

function getPrimaryActivityLog(
  group: GeneralWorkbenchActivityLogGroup,
): GeneralWorkbenchActivityLogGroup["logs"][number] | undefined {
  return group.logs.find((log) => log.source === "skill") || group.logs[0];
}

function formatActivityStatusLabel(
  status: GeneralWorkbenchActivityLogGroup["status"],
): string {
  if (status === "running") return "处理中";
  if (status === "failed") return "失败";
  return "已记录";
}

function getActivityStatusBadgeClassName(
  status: GeneralWorkbenchActivityLogGroup["status"],
) {
  return cn(
    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
    status === "running" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700",
    status === "completed" && "border-emerald-200 bg-emerald-50 text-emerald-700",
  );
}

function formatActivitySourceLabel(source?: string): string | null {
  const normalized = source?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "skill") {
    return "技能";
  }
  if (normalized === "tool") {
    return "工具";
  }
  return normalized;
}

function getRunDetailStatusBadgeClassName(status: AgentRun["status"]) {
  return cn(
    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
    status === "running" && "border-sky-200 bg-sky-50 text-sky-700",
    status === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    status === "error" && "border-rose-200 bg-rose-50 text-rose-700",
    status === "queued" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "canceled" && "border-slate-200 bg-slate-100 text-slate-500",
    status === "timeout" && "border-rose-200 bg-rose-50 text-rose-700",
  );
}

function buildRunDetailSummaryText(params: {
  runMetadataSummary: GeneralWorkbenchRunMetadataSummary;
  activeRunStagesLabel?: string | null;
}): string {
  const { runMetadataSummary, activeRunStagesLabel } = params;
  const parts: string[] = [];
  if (activeRunStagesLabel) {
    parts.push(activeRunStagesLabel);
  }
  if (runMetadataSummary.workflow) {
    parts.push(`工作流 ${runMetadataSummary.workflow}`);
  }
  if (runMetadataSummary.artifactPaths.length > 0) {
    parts.push(
      runMetadataSummary.artifactPaths.length === 1
        ? `产物 ${runMetadataSummary.artifactPaths[0]}`
        : `产物 ${runMetadataSummary.artifactPaths.length} 项`,
    );
  }
  return parts.join(" · ") || "查看本次运行的状态与产物记录";
}

function buildActivitySummary(
  group: GeneralWorkbenchActivityLogGroup,
  gateLabel: string | null,
): string {
  const parts: string[] = [];
  if (gateLabel) {
    parts.push(gateLabel);
  }
  if (group.artifactPaths.length > 0) {
    parts.push(
      group.artifactPaths.length === 1
        ? `产物 ${group.artifactPaths[0]}`
        : `产物 ${group.artifactPaths.length} 项`,
    );
  }
  if (group.logs.length > 1) {
    parts.push(`共 ${group.logs.length} 步`);
  }
  return parts.join(" · ");
}

function buildActivitySectionSummary(params: {
  groups: GeneralWorkbenchActivityLogGroup[];
  activeRunDetail?: AgentRun | null;
}): {
  title: string;
  meta: string;
} {
  const { groups, activeRunDetail } = params;
  if (groups.length === 0) {
    return {
      title: "最近还没有执行经过",
      meta: "技能调用、工具步骤与运行详情会按组收纳在这里。",
    };
  }

  const latestGroup = groups[0];
  const primaryLog = getPrimaryActivityLog(latestGroup);
  const gateLabel = formatGateLabel(latestGroup.gateKey);
  const sourceLabel = formatActivitySourceLabel(latestGroup.source);
  const activeRunLabel = activeRunDetail?.id
    ? formatRunIdShort(activeRunDetail.id) || activeRunDetail.id
    : null;
  const metaParts = [
    latestGroup.timeLabel || "最近",
    formatActivityStatusLabel(latestGroup.status),
    sourceLabel,
    gateLabel,
    latestGroup.logs.length > 1 ? `${latestGroup.logs.length} 步` : null,
    latestGroup.artifactPaths.length > 0
      ? latestGroup.artifactPaths.length === 1
        ? "1 个产物"
        : `${latestGroup.artifactPaths.length} 个产物`
      : null,
    activeRunLabel ? `当前查看 ${activeRunLabel}` : null,
  ].filter(Boolean);

  return {
    title: `最近一组：${primaryLog?.name || "执行经过"}`,
    meta: metaParts.join(" · "),
  };
}

function buildActivityStepSummary(
  log: GeneralWorkbenchActivityLogGroup["logs"][number],
): string | null {
  const parts = [log.inputSummary, log.outputSummary]
    .map((item) => item?.trim() || "")
    .filter((item) => item.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" → ");
}

function renderActivityLogItem(
  group: GeneralWorkbenchActivityLogGroup,
  onViewRunDetail: GeneralWorkbenchWorkflowPanelProps["onViewRunDetail"],
  onRevealArtifactInFinder: GeneralWorkbenchWorkflowPanelProps["onRevealArtifactInFinder"],
  onOpenArtifactWithDefaultApp: GeneralWorkbenchWorkflowPanelProps["onOpenArtifactWithDefaultApp"],
) {
  const gateLabel = formatGateLabel(group.gateKey);
  const runLabel = formatRunIdShort(group.runId);
  const sourceLabel = formatActivitySourceLabel(group.source);
  const primaryLog = getPrimaryActivityLog(group);
  const activitySummary = buildActivitySummary(group, gateLabel);

  return (
    <ActivityLogCard key={`activity-${group.key}`}>
      <ActivityLogHeader>
        <div className={getActivityStatusBadgeClassName(group.status)}>
          {formatActivityStatusLabel(group.status)}
        </div>
        <ActivityLogTitleBlock>
          <ActivityLogTitle>{primaryLog?.name || "执行经过"}</ActivityLogTitle>
          <ActivityLogMetaRow>
            {sourceLabel ? <ActivityLogBadge>{sourceLabel}</ActivityLogBadge> : null}
            {gateLabel ? <ActivityLogBadge>{gateLabel}</ActivityLogBadge> : null}
            {group.logs.length > 1 ? (
              <ActivityLogBadge>{`${group.logs.length} 步`}</ActivityLogBadge>
            ) : null}
            {group.artifactPaths.length > 0 ? (
              <ActivityLogBadge>
                {group.artifactPaths.length === 1
                  ? "1 个产物"
                  : `${group.artifactPaths.length} 个产物`}
              </ActivityLogBadge>
            ) : null}
          </ActivityLogMetaRow>
        </ActivityLogTitleBlock>
        <div className="shrink-0 text-[10px] leading-5 text-slate-400">
          {group.timeLabel}
        </div>
      </ActivityLogHeader>
      {activitySummary ? (
        <ActivityLogSummary>{activitySummary}</ActivityLogSummary>
      ) : null}
      <ActivityLogSteps>
        {group.logs.map((log) => (
          <ActivityLogStepRow key={log.id}>
            <ActivityLogStepHead>
              <span className="text-slate-400">•</span>
              <span className="min-w-0 flex-1 break-words">{log.name}</span>
              <span className="shrink-0 text-[10px] text-slate-400">
                {log.timeLabel}
              </span>
            </ActivityLogStepHead>
            {buildActivityStepSummary(log) ? (
              <ActivityLogStepSummary>
                {buildActivityStepSummary(log)}
              </ActivityLogStepSummary>
            ) : null}
          </ActivityLogStepRow>
        ))}
      </ActivityLogSteps>
      <ActionRow>
        {group.runId && onViewRunDetail ? (
          <RunLinkButton
            type="button"
            onClick={() => onViewRunDetail(group.runId!)}
          >
            查看运行 {runLabel || group.runId}
          </RunLinkButton>
        ) : null}
        {!group.runId
          ? group.artifactPaths.map((artifactPath) => (
              <ActivityMetaFragment
                key={`${group.key}-${artifactPath}`}
                artifactPath={artifactPath}
                sessionId={group.sessionId || null}
                onRevealArtifactInFinder={onRevealArtifactInFinder}
                onOpenArtifactWithDefaultApp={onOpenArtifactWithDefaultApp}
              />
            ))
          : null}
      </ActionRow>
    </ActivityLogCard>
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
  showBranchRecords,
  onToggleBranchRecords,
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
  const visibleQueueSteps = workflowSnapshot.visibleQueueItems.filter(
    (step) => step.id !== currentWorkflowStep?.id,
  );
  const hiddenQueueCount = Math.max(
    workflowSnapshot.openSteps.length - 1 - visibleQueueSteps.length,
    0,
  );
  const completedWorkflowSteps = workflowSnapshot.completedCount;
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
  const currentBranchItem =
    sortedBranchItems.find((item) => item.isCurrent) ?? sortedBranchItems[0] ?? null;
  const secondaryBranchCount = Math.max(
    sortedBranchItems.length - (currentBranchItem ? 1 : 0),
    0,
  );
  const branchSectionSummaryText = buildBranchSectionSummaryText({
    currentBranch: currentBranchItem,
    relatedCount: secondaryBranchCount,
    isVersionMode,
  });
  const creationTaskSectionSummary = buildCreationTaskSectionSummary({
    groups: groupedCreationTaskEvents,
    totalCount: creationTaskEventsCount,
  });
  const workflowResultHandoffText = buildWorkflowResultHandoffText({
    branchSectionTitle,
    hasRecordedOutputs:
      creationTaskEventsCount > 0 ||
      groupedActivityLogs.length > 0 ||
      runMetadataSummary.artifactPaths.length > 0,
  });
  const activitySectionSummary = buildActivitySectionSummary({
    groups: groupedActivityLogs,
    activeRunDetail,
  });

  return (
    <>
      <section
        className={WORKFLOW_SECTION_CLASSNAME}
        data-testid="workflow-sidebar-task-section"
      >
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>当前进展</span>
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
                  当前焦点
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
              <div
                className={WORKFLOW_RESULT_HANDOFF_HINT_CLASSNAME}
                data-testid="workflow-sidebar-result-destination-hint"
              >
                <div className="text-[10px] font-semibold text-slate-500">
                  结果去向
                </div>
                <div className="mt-1 text-[11px] leading-5 text-slate-500">
                  {workflowResultHandoffText}
                </div>
              </div>
            </div>
          </div>
        </div>
        {visibleQueueSteps.length > 0 ? (
          <div className={WORKFLOW_STEP_LIST_CLASSNAME}>
            <div className={WORKFLOW_QUEUE_HEADER_CLASSNAME}>
              <span>后续任务</span>
              <span>
                {hiddenQueueCount > 0
                  ? `已展示 ${visibleQueueSteps.length} 项，另有 ${hiddenQueueCount} 项`
                  : `${visibleQueueSteps.length} 项待处理`}
              </span>
            </div>
            <div className={WORKFLOW_QUEUE_LIST_CLASSNAME}>
              {visibleQueueSteps.map((step, index) => (
                <WorkflowQueueRow
                  key={step.id}
                  $status={step.status}
                  data-testid="workflow-sidebar-step"
                  data-status={step.status}
                >
                  <span
                    className={cn(
                      "mt-0.5",
                      getWorkflowStepIconClassName(step.status),
                    )}
                  >
                    {getStepIcon(step.status)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{`后续 ${index + 1}`}</span>
                    </div>
                    <div className="mt-0.5 break-words text-[12px] leading-5 text-slate-900">
                      {step.title}
                    </div>
                  </div>
                  <span className={getStatusBadgeClassName(step.status)}>
                    {getWorkflowStatusLabel(step.status)}
                  </span>
                </WorkflowQueueRow>
              ))}
            </div>
          </div>
        ) : null}
        {completedWorkflowSteps > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span className={WORKFLOW_TASK_SUMMARY_PILL_CLASSNAME}>
              {`已完成 ${completedWorkflowSteps} 项`}
            </span>
            {remainingSteps > 0 ? (
              <span>已完成项已收起，优先聚焦当前与后续任务</span>
            ) : (
              <span>当前流程已完成，可回看下方记录</span>
            )}
          </div>
        ) : null}
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
            <button
              type="button"
              aria-label="切换可继续记录"
              className={TOGGLE_BUTTON_CLASSNAME}
              onClick={onToggleBranchRecords}
            >
              {showBranchRecords ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
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
        {branchItems.length === 0 ? (
          <ActivityMeta>{getEmptyBranchText(isVersionMode)}</ActivityMeta>
        ) : (
          <>
            <BranchSectionSummary
              data-testid="workflow-sidebar-branch-summary"
            >
              {branchSectionSummaryText}
            </BranchSectionSummary>
            {showBranchRecords ? (
              <BranchList className="mt-2 custom-scrollbar">
                {sortedBranchItems.map((item) => (
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
                        {item.isCurrent ? (
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
                        ) : (
                          <BranchHint>切到当前焦点后再继续处理这一条记录</BranchHint>
                        )}
                      </div>
                    </BranchHead>
                  </BranchItem>
                ))}
              </BranchList>
            ) : null}
          </>
        )}
      </section>

      <section className={WORKFLOW_SECTION_CLASSNAME}>
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>产出记录</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={WORKFLOW_SECTION_BADGE_CLASSNAME}>
              {creationTaskEventsCount}
            </span>
            <button
              type="button"
              aria-label="切换产出记录"
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
        <SecondarySectionSummaryCard data-testid="workflow-sidebar-creation-summary">
          <SecondarySectionSummaryTitle>
            {creationTaskSectionSummary.title}
          </SecondarySectionSummaryTitle>
          <SecondarySectionSummaryMeta>
            {creationTaskSectionSummary.meta}
          </SecondarySectionSummaryMeta>
        </SecondarySectionSummaryCard>
        {showCreationTasks ? (
          <ActivityList className="custom-scrollbar">
            {groupedCreationTaskEvents.length === 0 ? (
              <ActivityMeta>最近还没有新的产出记录</ActivityMeta>
            ) : (
              groupedCreationTaskEvents.map((group) => (
                <CreationTaskGroupCard key={`creation-task-${group.key}`}>
                  <CreationTaskGroupHeader>
                    <span>{group.label}</span>
                    <CreationTaskGroupCount>
                      {formatCreationTaskCountLabel(group.tasks.length)}
                    </CreationTaskGroupCount>
                    <span className="ml-auto text-[10px] text-slate-400">
                      {group.latestTimeLabel}
                    </span>
                  </CreationTaskGroupHeader>
                  <CreationTaskList>
                    {group.tasks.map((task) => (
                      <CreationTaskRow key={`${task.taskId}-${task.path}`}>
                        <CreationTaskContent>
                          <CreationTaskTitleRow>
                            <CreationTaskTitle>
                              {getCreationTaskTitle(task.path)}
                            </CreationTaskTitle>
                            <CreationTaskTime>{task.timeLabel}</CreationTaskTime>
                          </CreationTaskTitleRow>
                          <CreationTaskPath>{task.path}</CreationTaskPath>
                        </CreationTaskContent>
                        <RunDetailActionButton
                          type="button"
                          aria-label={
                            task.absolutePath
                              ? `复制任务文件绝对路径-${task.taskId}`
                              : `复制任务文件路径-${task.taskId}`
                          }
                          onClick={() => {
                            void onCopyText(task.absolutePath || task.path);
                          }}
                        >
                          复制路径
                        </RunDetailActionButton>
                      </CreationTaskRow>
                    ))}
                  </CreationTaskList>
                </CreationTaskGroupCard>
              ))
            )}
          </ActivityList>
        ) : null}
      </section>

      <section className={WORKFLOW_SECTION_CLASSNAME}>
        <div className={WORKFLOW_SECTION_TITLE_CLASSNAME}>
          <span>执行经过</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={WORKFLOW_SECTION_BADGE_CLASSNAME}>
              {groupedActivityLogs.length}
            </span>
            <button
              type="button"
              aria-label="切换执行经过"
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
        <SecondarySectionSummaryCard data-testid="workflow-sidebar-activity-summary">
          <SecondarySectionSummaryTitle>
            {activitySectionSummary.title}
          </SecondarySectionSummaryTitle>
          <SecondarySectionSummaryMeta>
            {activitySectionSummary.meta}
          </SecondarySectionSummaryMeta>
        </SecondarySectionSummaryCard>
        {showActivityLogs ? (
          <>
            <ActivityList className="custom-scrollbar">
              {groupedActivityLogs.length === 0 ? (
                <ActivityMeta>最近还没有执行经过</ActivityMeta>
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
                <RunDetailHeader>
                  <div
                    className={getRunDetailStatusBadgeClassName(
                      activeRunDetail.status,
                    )}
                  >
                    {formatRunStatusLabel(activeRunDetail.status)}
                  </div>
                  <RunDetailTitleBlock>
                    <RunDetailTitle>当前查看运行</RunDetailTitle>
                    <RunDetailMetaRow>
                      <RunDetailBadge>
                        {formatActivitySourceLabel(activeRunDetail.source) ||
                          "运行"}
                      </RunDetailBadge>
                      {runMetadataSummary.workflow ? (
                        <RunDetailBadge>
                          {runMetadataSummary.workflow}
                        </RunDetailBadge>
                      ) : null}
                      {runMetadataSummary.artifactPaths.length > 0 ? (
                        <RunDetailBadge>
                          {runMetadataSummary.artifactPaths.length === 1
                            ? "1 个产物"
                            : `${runMetadataSummary.artifactPaths.length} 个产物`}
                        </RunDetailBadge>
                      ) : null}
                    </RunDetailMetaRow>
                  </RunDetailTitleBlock>
                </RunDetailHeader>
                <RunDetailSummary>
                  {buildRunDetailSummaryText({
                    runMetadataSummary,
                    activeRunStagesLabel,
                  })}
                </RunDetailSummary>
                <RunDetailRow>运行ID：{activeRunDetail.id}</RunDetailRow>
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
                    aria-label="复制原始记录"
                    onClick={() => {
                      void onCopyText(runMetadataText);
                    }}
                  >
                    复制原始记录
                  </RunDetailActionButton>
                </RunDetailActions>
                {runMetadataSummary.artifactPaths.length > 0 ? (
                  <RunDetailArtifacts>
                    <RunDetailArtifactsTitle>关联产物</RunDetailArtifactsTitle>
                    {runMetadataSummary.artifactPaths.map((artifactPath) => (
                      <RunDetailArtifactRow key={`run-detail-${artifactPath}`}>
                        <RunDetailArtifactPath>
                          {artifactPath}
                        </RunDetailArtifactPath>
                        <RunDetailArtifactActions>
                          <RunDetailArtifactActionButton
                            type="button"
                            aria-label={`复制产物路径-${artifactPath}`}
                            onClick={() => {
                              void onCopyText(artifactPath);
                            }}
                          >
                            复制
                          </RunDetailArtifactActionButton>
                          <RunDetailArtifactActionButton
                            type="button"
                            aria-label={`定位产物路径-${artifactPath}`}
                            onClick={() => {
                              void onRevealArtifactInFinder(artifactPath);
                            }}
                          >
                            定位
                          </RunDetailArtifactActionButton>
                          <RunDetailArtifactActionButton
                            type="button"
                            aria-label={`打开产物路径-${artifactPath}`}
                            onClick={() => {
                              void onOpenArtifactWithDefaultApp(artifactPath);
                            }}
                          >
                            打开
                          </RunDetailArtifactActionButton>
                        </RunDetailArtifactActions>
                      </RunDetailArtifactRow>
                    ))}
                  </RunDetailArtifacts>
                ) : null}
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
