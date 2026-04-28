import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  FolderOpen,
  HardDriveDownload,
  ListChecks,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type {
  AgentRuntimeAnalysisHandoff,
  AgentRuntimeEvidencePack,
  AgentRuntimeHandoffBundle,
  AgentRuntimeSaveReviewDecisionRequest,
  AgentRuntimeReplayCase,
  AgentRuntimeReviewDecisionTemplate,
  AgentRuntimeToolInventory,
  AgentRuntimeToolInventoryCatalogEntry,
  AgentRuntimeToolInventoryRegistryEntry,
  AgentRuntimeToolInventoryRuntimeEntry,
  AgentRuntimeThreadReadModel,
  AgentToolExecutionPolicySource,
  AsterSubagentSessionInfo,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import {
  exportAgentRuntimeAnalysisHandoff,
  exportAgentRuntimeEvidencePack,
  exportAgentRuntimeHandoffBundle,
  exportAgentRuntimeReplayCase,
  exportAgentRuntimeReviewDecisionTemplate,
  saveAgentRuntimeReviewDecision,
} from "@/lib/api/agentRuntime";
import { getMcpInnerToolName } from "@/lib/api/mcp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import { SearchResultPreviewList } from "./SearchResultPreviewList";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  Message,
} from "../types";
import type {
  HarnessFileAction,
  HarnessActiveFileWrite,
  HarnessFileKind,
  HarnessOutputSignal,
  HarnessSessionState,
} from "../utils/harnessState";
import { formatArtifactWritePhaseLabel } from "../utils/messageArtifacts";
import {
  isUnifiedWebSearchToolName,
  resolveSearchResultPreviewItemsFromText,
} from "../utils/searchResultPreview";
import {
  classifySearchQuerySemantic,
  summarizeSearchQuerySemantics,
} from "../utils/searchQueryGrouping";
import {
  normalizeToolNameKey,
  resolveToolDisplayLabel,
} from "../utils/toolDisplayInfo";
import { deriveRuntimeToolAvailability } from "../utils/runtimeToolAvailability";
import {
  buildWorkflowSummaryText,
  getWorkflowStatusLabel,
} from "../utils/workflowStepPresentation";
import { buildThreadReliabilityView } from "../utils/threadReliabilityView";
import { resolveTeamWorkspaceStableProcessingLabel } from "../utils/teamWorkspaceCopy";
import { isInternalRoutingRuntimeStatus } from "../utils/turnSummaryPresentation";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import { AgentThreadReliabilityPanel } from "./AgentThreadReliabilityPanel";
import { HarnessVerificationSummarySection } from "./HarnessVerificationSummarySection";
import { RuntimeReviewDecisionDialog } from "./RuntimeReviewDecisionDialog";

interface HarnessEnvironmentSummary {
  skillsCount: number;
  skillNames: string[];
  memorySignals: string[];
  contextItemsCount: number;
  activeContextCount: number;
  contextItemNames: string[];
  contextEnabled: boolean;
}

export interface HarnessFilePreviewResult {
  path?: string;
  content?: string | null;
  error?: string | null;
  isBinary?: boolean;
  size?: number;
}

interface HarnessStatusPanelProps {
  harnessState: HarnessSessionState;
  environment: HarnessEnvironmentSummary;
  layout?: "default" | "sidebar" | "dialog";
  onLoadFilePreview?: (path: string) => Promise<HarnessFilePreviewResult>;
  onOpenFile?: (fileName: string, content: string) => void;
  onRevealPath?: (path: string) => Promise<void>;
  onOpenPath?: (path: string) => Promise<void>;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  onOpenSubagentSession?: (sessionId: string) => void;
  toolInventory?: AgentRuntimeToolInventory | null;
  toolInventoryLoading?: boolean;
  toolInventoryError?: string | null;
  onRefreshToolInventory?: () => void;
  title?: string;
  description?: string;
  toggleLabel?: string;
  leadContent?: ReactNode;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  threadRead?: AgentRuntimeThreadReadModel | null;
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
  canInterrupt?: boolean;
  onInterruptCurrentTurn?: () => void | Promise<void>;
  onResumeThread?: () => boolean | Promise<boolean>;
  onReplayPendingRequest?: (requestId: string) => boolean | Promise<boolean>;
  onPromoteQueuedTurn?: (queuedTurnId: string) => boolean | Promise<boolean>;
  onOpenMemoryWorkbench?: () => void;
  messages?: Message[];
  teamMemorySnapshot?: TeamMemorySnapshot | null;
  diagnosticRuntimeContext?: {
    sessionId?: string | null;
    workspaceId?: string | null;
    workingDir?: string | null;
    providerType?: string | null;
    model?: string | null;
    executionStrategy?: string | null;
    activeTheme?: string | null;
    selectedTeamLabel?: string | null;
  } | null;
}

interface PreviewDialogState {
  open: boolean;
  title: string;
  description?: string;
  path?: string;
  displayName: string;
  content?: string;
  preview?: string;
  error?: string;
  isBinary: boolean;
  size?: number;
  loading: boolean;
}

type FileFilterValue = "all" | HarnessFileKind;
type OutputFilterValue = "all" | "path" | "offload" | "truncated" | "summary";
type FileDisplayMode = "timeline" | "grouped";
type ToolInventoryFilterValue = "all" | "runtime" | "persisted" | "default";

type HarnessSectionKey =
  | "team_config"
  | "runtime"
  | "handoff"
  | "reliability"
  | "runtime-facts"
  | "inventory"
  | "approvals"
  | "writes"
  | "files"
  | "outputs"
  | "plan"
  | "delegation"
  | "context"
  | "capabilities";

interface HarnessSectionNavItem {
  key: HarnessSectionKey;
  label: string;
}

interface HarnessSummaryCard {
  sectionKey: HarnessSectionKey;
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}

interface RuntimeTaskPresentation {
  title: string;
  summaryText: string;
  phaseLabel: string;
  statusLabel: string;
  progressLabel: string;
  stepStatus: StepStatus;
  checkpoints: string[];
}

interface TextSegment {
  type: "text" | "url";
  value: string;
}

const URL_PATTERN_SOURCE = String.raw`\bhttps?:\/\/[^\s<>"'\`]+`;
const URL_TRAILING_PUNCTUATION = /[),.;!?]+$/;

function createUrlPattern(): RegExp {
  return new RegExp(URL_PATTERN_SOURCE, "gi");
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function formatTime(value?: Date): string {
  if (!value) {
    return "刚刚";
  }

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUnixTimestamp(value?: number): string {
  if (!value) {
    return "未知";
  }

  return new Date(value * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatIsoDateTime(value?: string): string {
  if (!value) {
    return "未知";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveSubagentRuntimeStatusLabel(
  status?: AsterSubagentSessionInfo["runtime_status"],
): string {
  switch (status) {
    case "queued":
      return "稍后开始";
    case "running":
      return "处理中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "aborted":
      return "已暂停";
    case "idle":
    default:
      return "待开始";
  }
}

function resolveSubagentRuntimeStatusVariant(
  status?: AsterSubagentSessionInfo["runtime_status"],
): ComponentProps<typeof Badge>["variant"] {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
    case "aborted":
      return "destructive";
    case "queued":
    case "idle":
    default:
      return "outline";
  }
}

function resolveSubagentSessionTypeLabel(value?: string): string {
  switch (value) {
    case "sub_agent":
      return "子任务";
    case "fork":
      return "分支任务";
    case "user":
    default:
      return value?.trim() || "任务会话";
  }
}

function resolveFriendlyToolLabel(value?: string): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalizeToolNameKey(normalized) === "turnsummary") {
    return "当前任务摘要";
  }

  return resolveToolDisplayLabel(normalized);
}

function joinDisplayParts(
  parts: Array<string | null | undefined>,
): string | undefined {
  const normalized = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return normalized.length > 0 ? normalized.join(" · ") : undefined;
}

function summarizeChildSubagentSessions(sessions: AsterSubagentSessionInfo[]): {
  total: number;
  running: number;
  queued: number;
  active: number;
  settled: number;
  failed: number;
} {
  const running = sessions.filter(
    (session) => session.runtime_status === "running",
  ).length;
  const queued = sessions.filter(
    (session) => session.runtime_status === "queued",
  ).length;
  const failed = sessions.filter(
    (session) =>
      session.runtime_status === "failed" ||
      session.runtime_status === "aborted",
  ).length;
  const settled = sessions.filter(
    (session) =>
      session.runtime_status === "completed" ||
      session.runtime_status === "failed" ||
      session.runtime_status === "aborted" ||
      session.runtime_status === "closed",
  ).length;

  return {
    total: sessions.length,
    running,
    queued,
    active: running + queued,
    settled,
    failed,
  };
}

function formatSize(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function formatHandoffStatusLabel(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "未知";
  }

  switch (normalized) {
    case "idle":
      return "空闲";
    case "pending":
      return "待处理";
    case "queued":
      return "排队中";
    case "running":
      return "处理中";
    case "waiting_request":
      return "等待请求";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "interrupting":
      return "中断中";
    case "interrupted":
      return "已中断";
    default:
      return normalized;
  }
}

function formatHandoffArtifactKindLabel(
  kind: AgentRuntimeHandoffBundle["artifacts"][number]["kind"],
): string {
  switch (kind) {
    case "plan":
      return "计划";
    case "progress":
      return "进度";
    case "handoff":
      return "交接";
    case "review_summary":
      return "审查";
    default:
      return kind;
  }
}

function formatEvidenceArtifactKindLabel(
  kind: AgentRuntimeEvidencePack["artifacts"][number]["kind"],
): string {
  switch (kind) {
    case "summary":
      return "摘要";
    case "runtime":
      return "运行时";
    case "timeline":
      return "时间线";
    case "artifacts":
      return "产物";
    default:
      return kind;
  }
}

function formatReplayArtifactKindLabel(
  kind: AgentRuntimeReplayCase["artifacts"][number]["kind"],
): string {
  switch (kind) {
    case "input":
      return "输入";
    case "expected":
      return "期望";
    case "grader":
      return "评分";
    case "evidence_links":
      return "证据链接";
    default:
      return kind;
  }
}

function formatAnalysisArtifactKindLabel(
  kind: AgentRuntimeAnalysisHandoff["artifacts"][number]["kind"],
): string {
  switch (kind) {
    case "analysis_brief":
      return "简报";
    case "analysis_context":
      return "上下文";
    default:
      return kind;
  }
}

function formatReviewDecisionArtifactKindLabel(
  kind: AgentRuntimeReviewDecisionTemplate["artifacts"][number]["kind"],
): string {
  switch (kind) {
    case "review_decision_markdown":
      return "Markdown";
    case "review_decision_json":
      return "JSON";
    default:
      return kind;
  }
}

function formatReviewDecisionStatusLabel(status?: string): string {
  switch (status?.trim()) {
    case "accepted":
      return "接受";
    case "deferred":
      return "延后";
    case "rejected":
      return "拒绝";
    case "needs_more_evidence":
      return "需要更多证据";
    case "pending_review":
      return "待人工审核";
    default:
      return status?.trim() || "未知";
  }
}

function formatReviewDecisionRiskLevelLabel(riskLevel?: string): string {
  switch (riskLevel?.trim()) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "unknown":
      return "未定";
    default:
      return riskLevel?.trim() || "未知";
  }
}

function slugifyHarnessCase(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "replay-case";
}

function quoteShellArg(value: string): string {
  return JSON.stringify(value);
}

function buildReplayPromotionContext(params: {
  replayCase: AgentRuntimeReplayCase;
  analysisTitle?: string | null;
  reviewTitle?: string | null;
}) {
  const titleSource =
    params.reviewTitle?.trim() ||
    params.analysisTitle?.trim() ||
    `Replay case ${params.replayCase.session_id}`;
  const slugSource =
    params.reviewTitle?.trim() ||
    params.analysisTitle?.trim() ||
    params.replayCase.session_id;

  return {
    suiteId: "repo-promoted-replays",
    title: titleSource,
    slug: slugifyHarnessCase(slugSource),
  };
}

function buildReplayPromotionCommand(params: {
  replayCase: AgentRuntimeReplayCase;
  analysisTitle?: string | null;
  reviewTitle?: string | null;
}): string {
  const context = buildReplayPromotionContext(params);
  return [
    "npm run harness:eval:promote --",
    `--session-id ${quoteShellArg(params.replayCase.session_id)}`,
    `--slug ${quoteShellArg(context.slug)}`,
    `--title ${quoteShellArg(context.title)}`,
  ].join(" ");
}

function buildReplayEvalCommand(): string {
  return "npm run harness:eval";
}

function buildReplayTrendCommand(): string {
  return "npm run harness:eval:trend";
}

function describeAction(action: HarnessFileAction): string {
  switch (action) {
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "edit":
      return "编辑";
    case "offload":
      return "转存";
    case "persist":
      return "落盘";
    default:
      return action;
  }
}

function describeKind(kind: HarnessFileKind): string {
  switch (kind) {
    case "document":
      return "文档";
    case "code":
      return "代码";
    case "log":
      return "日志";
    case "artifact":
      return "产物";
    case "offload":
      return "转存";
    default:
      return "文件";
  }
}

function resolveKindIcon(kind: HarnessFileKind): LucideIcon {
  switch (kind) {
    case "code":
      return FileCode2;
    case "artifact":
    case "offload":
      return FileArchive;
    default:
      return FileText;
  }
}

function getSignalPath(signal: HarnessOutputSignal): string | undefined {
  return signal.offloadFile || signal.outputFile || signal.artifactPath;
}

function normalizeUrlCandidate(rawUrl: string): {
  url: string;
  trailing: string;
} {
  const normalized = rawUrl.replace(URL_TRAILING_PUNCTUATION, "");
  return {
    url: normalized || rawUrl,
    trailing: rawUrl.slice((normalized || rawUrl).length),
  };
}

function splitTextIntoSegments(text: string): TextSegment[] {
  if (!text.trim()) {
    return [{ type: "text", value: text }];
  }

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  const urlPattern = createUrlPattern();

  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        value: text.slice(lastIndex, matchIndex),
      });
    }

    const { url, trailing } = normalizeUrlCandidate(rawUrl);
    segments.push({ type: "url", value: url });
    if (trailing) {
      segments.push({ type: "text", value: trailing });
    }
    lastIndex = matchIndex + rawUrl.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      value: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

function findFirstUrl(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(createUrlPattern());
    if (!match || match.length === 0) {
      continue;
    }
    return normalizeUrlCandidate(match[0]).url;
  }
  return undefined;
}

function isSearchOutputSignal(signal: HarnessOutputSignal): boolean {
  if (isUnifiedWebSearchToolName(signal.toolName)) {
    return true;
  }

  return signal.title === "联网检索摘要";
}

function isLikelyFilePath(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return false;
  }

  if (/^(~\/|\/|[A-Za-z]:[\\/]|\.{1,2}[\\/])/.test(normalized)) {
    return true;
  }

  return (
    /[\\/]/.test(normalized) &&
    /\.[A-Za-z0-9_-]{1,12}(?:[#?].*)?$/.test(normalized)
  );
}

function summarizeFileActions(
  events: HarnessSessionState["recentFileEvents"],
): string {
  const counts = new Map<HarnessFileAction, number>();

  for (const event of events) {
    counts.set(event.action, (counts.get(event.action) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([action, count]) => `${describeAction(action)} ${count}`)
    .join(" · ");
}

function matchesOutputFilter(
  signal: HarnessOutputSignal,
  filter: OutputFilterValue,
): boolean {
  const signalPath = getSignalPath(signal);

  switch (filter) {
    case "path":
      return Boolean(signalPath);
    case "offload":
      return Boolean(signal.offloaded || signal.offloadFile);
    case "truncated":
      return signal.truncated === true;
    case "summary":
      return !signalPath && Boolean(signal.preview?.trim());
    default:
      return true;
  }
}

function pickPathFromArguments(
  argumentsValue?: Record<string, unknown>,
): string | undefined {
  return extractArtifactProtocolPathsFromValue(argumentsValue)[0];
}

function describeApproval(item: ActionRequired): string | undefined {
  const hints: string[] = [];

  if (item.toolName?.trim()) {
    hints.push(resolveFriendlyToolLabel(item.toolName) || item.toolName.trim());
  }

  const path = pickPathFromArguments(item.arguments);
  if (path) {
    hints.push(path);
  }

  const command = item.arguments?.cmd ?? item.arguments?.command;
  if (typeof command === "string" && command.trim()) {
    hints.push(command.trim());
  }

  return hints.length > 0 ? hints.join(" · ") : undefined;
}

function formatRuntimePhaseLabel(
  runtimeStatus: HarnessSessionState["runtimeStatus"],
): string {
  if (!runtimeStatus) {
    return "空闲";
  }

  switch (runtimeStatus.phase) {
    case "preparing":
      return "准备中";
    case "routing":
      return "处理中";
    case "context":
      return "整理信息";
    case "cancelled":
      return "已取消";
    case "failed":
      return "需要处理";
    default:
      return runtimeStatus.phase;
  }
}

function resolveRuntimeStepStatus(
  runtimeStatus: NonNullable<HarnessSessionState["runtimeStatus"]>,
): StepStatus {
  if (runtimeStatus.phase === "failed") {
    return "error";
  }
  if (runtimeStatus.phase === "cancelled") {
    return "skipped";
  }
  return "active";
}

function resolveRuntimeStatusLabel(
  runtimeStatus: NonNullable<HarnessSessionState["runtimeStatus"]>,
): string {
  if (runtimeStatus.phase === "cancelled") {
    return "已取消";
  }
  return getWorkflowStatusLabel(resolveRuntimeStepStatus(runtimeStatus));
}

function buildRuntimeSummaryText(
  runtimeStatus: NonNullable<HarnessSessionState["runtimeStatus"]>,
): string {
  const detail = runtimeStatus.detail?.trim();
  if (detail) {
    return detail;
  }
  if (runtimeStatus.phase === "cancelled") {
    return "当前流程已取消，可重新发起新的任务继续。";
  }
  return buildWorkflowSummaryText({
    leadingStep: {
      status: resolveRuntimeStepStatus(runtimeStatus),
    },
    remainingCount: 1,
    emptyLabel: "当前流程已完成",
  });
}

function formatRuntimeProgressLabel(
  runtimeStatus: NonNullable<HarnessSessionState["runtimeStatus"]>,
  checkpoints: string[],
): string {
  if (checkpoints.length > 0) {
    return `已记录 ${checkpoints.length} 个任务节点`;
  }
  if (runtimeStatus.phase === "failed") {
    return "等待处理异常后重试";
  }
  if (runtimeStatus.phase === "cancelled") {
    return "当前流程已取消";
  }
  return "等待更多执行进展";
}

function buildRuntimeTaskPresentation(
  runtimeStatus: HarnessSessionState["runtimeStatus"],
): RuntimeTaskPresentation | null {
  if (!runtimeStatus || isInternalRoutingRuntimeStatus(runtimeStatus)) {
    return null;
  }

  const checkpoints = (runtimeStatus.checkpoints ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    title: runtimeStatus.title?.trim() || "正在整理当前任务",
    summaryText: buildRuntimeSummaryText(runtimeStatus),
    phaseLabel: formatRuntimePhaseLabel(runtimeStatus),
    statusLabel: resolveRuntimeStatusLabel(runtimeStatus),
    progressLabel: formatRuntimeProgressLabel(runtimeStatus, checkpoints),
    stepStatus: resolveRuntimeStepStatus(runtimeStatus),
    checkpoints,
  };
}

function formatWriteSourceLabel(source?: string): string {
  switch (source) {
    case "tool_start":
      return "工具启动";
    case "artifact_snapshot":
      return "快照同步";
    case "tool_result":
      return "工具结果";
    case "message_content":
      return "消息流";
    default:
      return source || "处理中";
  }
}

function formatExecutionSourceLabel(
  source: AgentToolExecutionPolicySource,
): string {
  switch (source) {
    case "runtime":
      return "运行时覆盖";
    case "persisted":
      return "持久化覆盖";
    case "default":
    default:
      return "默认策略";
  }
}

function resolveExecutionSourceVariant(
  source: AgentToolExecutionPolicySource,
): ComponentProps<typeof Badge>["variant"] {
  switch (source) {
    case "runtime":
      return "default";
    case "persisted":
      return "secondary";
    case "default":
    default:
      return "outline";
  }
}

function formatExecutionWarningPolicyLabel(value: string): string {
  switch (value) {
    case "shell_command_risk":
      return "命令风险告警";
    case "none":
    default:
      return "无告警";
  }
}

function formatExecutionRestrictionProfileLabel(value: string): string {
  switch (value) {
    case "workspace_path_required":
      return "必须提供工作区路径";
    case "workspace_path_optional":
      return "可选工作区路径";
    case "workspace_absolute_path_required":
      return "必须提供绝对工作区路径";
    case "workspace_shell_command":
      return "工作区命令限制";
    case "analyze_image_input":
      return "仅图像输入";
    case "safe_https_url_required":
      return "仅安全 HTTPS URL";
    case "none":
    default:
      return "无额外限制";
  }
}

function formatExecutionSandboxProfileLabel(value: string): string {
  switch (value) {
    case "workspace_command":
      return "工作区命令沙箱";
    case "none":
    default:
      return "无沙箱";
  }
}

function formatToolLifecycleLabel(value: string): string {
  switch (value) {
    case "current":
      return "现役";
    case "compat":
      return "兼容";
    case "deprecated":
      return "待清理";
    default:
      return value;
  }
}

function formatToolPermissionPlaneLabel(value: string): string {
  switch (value) {
    case "session_allowlist":
      return "会话白名单";
    case "parameter_restricted":
      return "参数受限";
    case "caller_filtered":
      return "调用方过滤";
    default:
      return value;
  }
}

function formatToolSourceKindLabel(value: string): string {
  switch (value) {
    case "aster_builtin":
      return "Aster 内置";
    case "lime_injected":
      return "Lime 注入";
    case "browser_compatibility":
      return "Browser Assist";
    default:
      return value;
  }
}

function formatExtensionSourceKindLabel(value: string): string {
  switch (value) {
    case "mcp_bridge":
      return "MCP Bridge";
    case "runtime_extension":
      return "Runtime Extension";
    default:
      return value;
  }
}

function formatRuntimeToolSourceKindLabel(value: string): string {
  switch (value) {
    case "registry_native":
      return "Registry";
    case "current_surface":
      return "当前工具面";
    case "runtime_extension":
      return "Extension";
    case "mcp":
      return "MCP";
    default:
      return value;
  }
}

function formatRuntimeToolAvailabilitySourceLabel(value: string): string {
  switch (value) {
    case "runtime_tools":
      return "runtime_tools";
    case "registry_tools":
      return "registry_tools";
    case "none":
    default:
      return "未就绪";
  }
}

function collectCatalogExecutionSources(
  entry: AgentRuntimeToolInventoryCatalogEntry,
): AgentToolExecutionPolicySource[] {
  return [
    entry.execution_warning_policy_source,
    entry.execution_restriction_profile_source,
    entry.execution_sandbox_profile_source,
  ];
}

function collectRegistryExecutionSources(
  entry: AgentRuntimeToolInventoryRegistryEntry,
): AgentToolExecutionPolicySource[] {
  return [
    entry.catalog_execution_warning_policy_source,
    entry.catalog_execution_restriction_profile_source,
    entry.catalog_execution_sandbox_profile_source,
  ].filter((value): value is AgentToolExecutionPolicySource => Boolean(value));
}

function sortRuntimeToolsByVisibility(
  tools: AgentRuntimeToolInventoryRuntimeEntry[],
): AgentRuntimeToolInventoryRuntimeEntry[] {
  return [...tools].sort((left, right) => {
    if (left.visible_in_context !== right.visible_in_context) {
      return left.visible_in_context ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function matchesCatalogToolInventoryFilter(
  entry: AgentRuntimeToolInventoryCatalogEntry,
  filter: ToolInventoryFilterValue,
): boolean {
  const sources = collectCatalogExecutionSources(entry);

  switch (filter) {
    case "runtime":
      return sources.includes("runtime");
    case "persisted":
      return sources.includes("persisted");
    case "default":
      return sources.every((source) => source === "default");
    case "all":
    default:
      return true;
  }
}

function countCatalogToolsByInventoryFilter(
  catalogTools: AgentRuntimeToolInventoryCatalogEntry[],
  filter: ToolInventoryFilterValue,
): number {
  return catalogTools.filter((entry) =>
    matchesCatalogToolInventoryFilter(entry, filter),
  ).length;
}

function buildToolInventorySourceStats(
  catalogTools: AgentRuntimeToolInventoryCatalogEntry[],
): Record<AgentToolExecutionPolicySource, number> {
  const stats: Record<AgentToolExecutionPolicySource, number> = {
    default: 0,
    persisted: 0,
    runtime: 0,
  };

  for (const entry of catalogTools) {
    for (const source of collectCatalogExecutionSources(entry)) {
      stats[source] += 1;
    }
  }

  return stats;
}

function getActiveWriteDescription(write: HarnessActiveFileWrite): string {
  const parts = [
    formatArtifactWritePhaseLabel(write.phase),
    write.source ? formatWriteSourceLabel(write.source) : undefined,
    write.updatedAt ? formatTime(write.updatedAt) : undefined,
  ].filter(Boolean);

  return parts.join(" · ");
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    await openExternal(url);
  } catch {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank");
      return;
    }
    throw new Error("当前环境不支持打开外部链接");
  }
}

function InteractiveText({
  text,
  className,
  mono = false,
  stopPropagation = false,
  onOpenUrl,
}: {
  text?: string;
  className?: string;
  mono?: boolean;
  stopPropagation?: boolean;
  onOpenUrl: (url: string) => void | Promise<void>;
}) {
  if (!text?.trim()) {
    return null;
  }

  const segments = splitTextIntoSegments(text);

  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-all",
        mono && "font-mono",
        className,
      )}
    >
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <span key={`text-${index}`} className="whitespace-pre-wrap">
              {segment.value}
            </span>
          );
        }

        const handleOpen = (
          event:
            | ReactMouseEvent<HTMLSpanElement>
            | ReactKeyboardEvent<HTMLSpanElement>,
        ) => {
          if ("key" in event && event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          if (stopPropagation) {
            event.stopPropagation();
          }
          void onOpenUrl(segment.value);
        };

        return (
          <span
            key={`url-${segment.value}-${index}`}
            role="link"
            tabIndex={0}
            aria-label={`打开链接：${segment.value}`}
            className="cursor-pointer underline decoration-dotted underline-offset-2 text-primary transition-colors hover:text-primary/80"
            onClick={handleOpen}
            onKeyDown={handleOpen}
          >
            {segment.value}
          </span>
        );
      })}
    </span>
  );
}

function PathTextLink({
  path,
  className,
  stopPropagation = false,
  onOpenPath,
}: {
  path?: string;
  className?: string;
  stopPropagation?: boolean;
  onOpenPath: (path: string) => void | Promise<void>;
}) {
  if (!path?.trim()) {
    return null;
  }

  const normalizedPath = path.trim();

  const handleOpen = (
    event:
      | ReactMouseEvent<HTMLSpanElement>
      | ReactKeyboardEvent<HTMLSpanElement>,
  ) => {
    if ("key" in event && event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (stopPropagation) {
      event.stopPropagation();
    }
    void onOpenPath(normalizedPath);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`系统打开路径：${normalizedPath}`}
      className={cn(
        "cursor-pointer break-all underline decoration-dotted underline-offset-2 text-primary transition-colors hover:text-primary/80",
        className,
      )}
      onClick={handleOpen}
      onKeyDown={handleOpen}
    >
      {normalizedPath}
    </span>
  );
}

function ActionableBadge({
  value,
  variant,
  onOpenUrl,
  onOpenPath,
}: {
  value: string;
  variant: ComponentProps<typeof Badge>["variant"];
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPath: (path: string) => void | Promise<void>;
}) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const matchedUrl = findFirstUrl(normalized);
  if (matchedUrl && matchedUrl === normalized) {
    return (
      <Badge variant={variant} className="max-w-full whitespace-normal">
        <InteractiveText text={normalized} onOpenUrl={onOpenUrl} />
      </Badge>
    );
  }

  if (isLikelyFilePath(normalized)) {
    return (
      <Badge variant={variant} className="max-w-full whitespace-normal">
        <PathTextLink path={normalized} onOpenPath={onOpenPath} />
      </Badge>
    );
  }

  return <Badge variant={variant}>{normalized}</Badge>;
}

function SearchOutputCard({
  signal,
  onOpenUrl,
  onOpenDetail,
}: {
  signal: HarnessOutputSignal;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenDetail: () => void;
}) {
  const [resultsExpanded, setResultsExpanded] = useState(true);
  const results = useMemo(
    () =>
      resolveSearchResultPreviewItemsFromText(
        signal.content?.trim() ||
          signal.preview?.trim() ||
          signal.summary.trim(),
      ),
    [signal.content, signal.preview, signal.summary],
  );

  useEffect(() => {
    setResultsExpanded(true);
  }, [signal.id]);
  const semantic = useMemo(
    () => classifySearchQuerySemantic(signal.summary),
    [signal.summary],
  );

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-orange-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <Search className="h-3.5 w-3.5" />
            <span>已搜索</span>
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-foreground">
            {signal.summary}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {signal.title}
            {results.length > 0 ? ` · ${results.length} 条结果` : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{semantic.label}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {results.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              aria-label={
                resultsExpanded
                  ? `收起搜索结果：${signal.summary}`
                  : `展开搜索结果：${signal.summary}`
              }
              onClick={() => setResultsExpanded((prev) => !prev)}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  resultsExpanded && "rotate-180",
                )}
              />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            aria-label={`查看工具输出：${signal.title}`}
            onClick={onOpenDetail}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {results.length > 0 && resultsExpanded ? (
        <SearchResultPreviewList
          items={results}
          onOpenUrl={onOpenUrl}
          popoverSide="left"
          popoverAlign="start"
          className="mt-3"
        />
      ) : !results.length && signal.preview ? (
        <div className="mt-3 rounded-xl bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
          <InteractiveText text={signal.preview} onOpenUrl={onOpenUrl} />
        </div>
      ) : null}
    </div>
  );
}

function SearchOutputBatchCard({
  signals,
  onOpenUrl,
  onOpenDetail,
}: {
  signals: HarnessOutputSignal[];
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenDetail: (signal: HarnessOutputSignal) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const semanticSummaries = useMemo(
    () =>
      summarizeSearchQuerySemantics(signals.map((signal) => signal.summary)),
    [signals],
  );
  const preview = signals
    .slice(0, 2)
    .map((signal) => signal.summary)
    .join(" · ");
  const hiddenCount = Math.max(signals.length - 2, 0);

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label={expanded ? "收起搜索批次" : "展开搜索批次"}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-orange-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <Search className="h-3.5 w-3.5" />
            <span>已搜索 {signals.length} 组查询</span>
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-foreground">
            {preview}
            {hiddenCount > 0 ? ` 等 ${hiddenCount} 组` : ""}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">联网检索批次</div>
        </div>
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          aria-hidden="true"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {semanticSummaries.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {semanticSummaries.map((item) => (
            <Badge key={item.key} variant="secondary">
              {item.label} {item.count}
            </Badge>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3">
          {signals.map((signal) => (
            <SearchOutputCard
              key={signal.id}
              signal={signal}
              onOpenUrl={onOpenUrl}
              onOpenDetail={() => onOpenDetail(signal)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  hint,
  icon: Icon,
  onClick,
  compact = false,
}: {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  onClick?: () => void;
  compact?: boolean;
}) {
  const cardContent = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div
          className={cn(
            "mt-1 font-semibold text-foreground",
            compact ? "text-sm" : "text-base",
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="rounded-lg bg-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "rounded-xl border border-border bg-background/80 text-left transition-colors hover:bg-muted/60",
          compact ? "p-2.5" : "p-3",
        )}
        onClick={onClick}
        aria-label={`跳转到${title}`}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background/80",
        compact ? "p-2.5" : "p-3",
      )}
    >
      {cardContent}
    </div>
  );
}

function InventoryStatCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-base font-semibold text-foreground">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function Section({
  sectionKey,
  title,
  badge,
  children,
  registerRef,
}: {
  sectionKey?: HarnessSectionKey;
  title: string;
  badge?: string;
  children: ReactNode;
  registerRef?: (key: HarnessSectionKey, node: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={(node) =>
        sectionKey && registerRef ? registerRef(sectionKey, node) : undefined
      }
      data-harness-section={sectionKey}
      className="rounded-xl border border-border bg-background/80 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      {children}
    </section>
  );
}

export function HarnessStatusPanel({
  harnessState,
  environment,
  layout = "default",
  onLoadFilePreview,
  onOpenFile,
  onRevealPath,
  onOpenPath,
  childSubagentSessions = [],
  onOpenSubagentSession,
  toolInventory,
  toolInventoryLoading = false,
  toolInventoryError = null,
  onRefreshToolInventory,
  title = "处理工作台",
  description = "集中查看最新进展、文件变更、处理结果和待确认事项。",
  toggleLabel = "详情",
  leadContent,
  selectedTeamLabel = null,
  selectedTeamSummary = null,
  selectedTeamRoles = [],
  threadRead = null,
  turns = [],
  threadItems = [],
  currentTurnId = null,
  pendingActions = [],
  submittedActionsInFlight = [],
  queuedTurns = [],
  canInterrupt = false,
  onInterruptCurrentTurn,
  onResumeThread,
  onReplayPendingRequest,
  onPromoteQueuedTurn,
  onOpenMemoryWorkbench,
  messages = [],
  teamMemorySnapshot = null,
  diagnosticRuntimeContext = null,
}: HarnessStatusPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const isDialogLayout = layout === "dialog";
  const isDetailsExpanded = isDialogLayout ? true : expanded;
  const [fileFilter, setFileFilter] = useState<FileFilterValue>("all");
  const [outputFilter, setOutputFilter] = useState<OutputFilterValue>("all");
  const [fileDisplayMode, setFileDisplayMode] =
    useState<FileDisplayMode>("timeline");
  const [toolInventoryFilter, setToolInventoryFilter] =
    useState<ToolInventoryFilterValue>("all");
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState>({
    open: false,
    title: "",
    displayName: "",
    isBinary: false,
    loading: false,
  });
  const [handoffBundle, setHandoffBundle] =
    useState<AgentRuntimeHandoffBundle | null>(null);
  const [handoffExporting, setHandoffExporting] = useState(false);
  const [handoffExportError, setHandoffExportError] = useState<string | null>(
    null,
  );
  const [evidencePack, setEvidencePack] =
    useState<AgentRuntimeEvidencePack | null>(null);
  const [evidenceExporting, setEvidenceExporting] = useState(false);
  const [evidenceExportError, setEvidenceExportError] = useState<string | null>(
    null,
  );
  const [replayCase, setReplayCase] = useState<AgentRuntimeReplayCase | null>(
    null,
  );
  const [replayExporting, setReplayExporting] = useState(false);
  const [replayExportError, setReplayExportError] = useState<string | null>(
    null,
  );
  const [analysisHandoff, setAnalysisHandoff] =
    useState<AgentRuntimeAnalysisHandoff | null>(null);
  const [analysisExporting, setAnalysisExporting] = useState(false);
  const [analysisExportError, setAnalysisExportError] = useState<string | null>(
    null,
  );
  const [reviewDecisionTemplate, setReviewDecisionTemplate] =
    useState<AgentRuntimeReviewDecisionTemplate | null>(null);
  const [reviewDecisionEditorOpen, setReviewDecisionEditorOpen] =
    useState(false);
  const [reviewDecisionExporting, setReviewDecisionExporting] = useState(false);
  const [reviewDecisionSaving, setReviewDecisionSaving] = useState(false);
  const [reviewDecisionExportError, setReviewDecisionExportError] = useState<
    string | null
  >(null);
  const previewRequestIdRef = useRef(0);
  const sectionRefs = useRef<
    Partial<Record<HarnessSectionKey, HTMLElement | null>>
  >({});
  const currentSessionId = diagnosticRuntimeContext?.sessionId?.trim() || null;

  useEffect(() => {
    setHandoffBundle(null);
    setHandoffExportError(null);
    setHandoffExporting(false);
    setEvidencePack(null);
    setEvidenceExportError(null);
    setEvidenceExporting(false);
    setReplayCase(null);
    setReplayExportError(null);
    setReplayExporting(false);
    setAnalysisHandoff(null);
    setAnalysisExportError(null);
    setAnalysisExporting(false);
    setReviewDecisionTemplate(null);
    setReviewDecisionEditorOpen(false);
    setReviewDecisionExportError(null);
    setReviewDecisionExporting(false);
    setReviewDecisionSaving(false);
  }, [currentSessionId]);

  const registerSectionRef = useCallback(
    (key: HarnessSectionKey, node: HTMLElement | null) => {
      sectionRefs.current[key] = node;
    },
    [],
  );

  const scrollToSection = useCallback((key: HarnessSectionKey) => {
    const target = sectionRefs.current[key];
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleExportHandoffBundle = useCallback(async () => {
    if (!currentSessionId) {
      toast.error("当前没有可导出的会话上下文");
      return;
    }

    setHandoffExporting(true);
    setHandoffExportError(null);
    try {
      const bundle = await exportAgentRuntimeHandoffBundle(currentSessionId);
      setHandoffBundle(bundle);
      toast.success(`已导出 ${bundle.artifacts.length} 个交接制品`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "导出交接制品失败";
      setHandoffExportError(message);
      toast.error(message);
    } finally {
      setHandoffExporting(false);
    }
  }, [currentSessionId]);

  const handleExportEvidencePack = useCallback(async () => {
    if (!currentSessionId) {
      toast.error("当前没有可导出的会话上下文");
      return;
    }

    setEvidenceExporting(true);
    setEvidenceExportError(null);
    try {
      const pack = await exportAgentRuntimeEvidencePack(currentSessionId);
      setEvidencePack(pack);
      toast.success(`已导出 ${pack.artifacts.length} 个问题证据文件`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "导出问题证据包失败";
      setEvidenceExportError(message);
      toast.error(message);
    } finally {
      setEvidenceExporting(false);
    }
  }, [currentSessionId]);

  const handleExportReplayCase = useCallback(async () => {
    if (!currentSessionId) {
      toast.error("当前没有可导出的会话上下文");
      return null;
    }

    setReplayExporting(true);
    setReplayExportError(null);
    try {
      const replay = await exportAgentRuntimeReplayCase(currentSessionId);
      setReplayCase(replay);
      toast.success(`已导出 ${replay.artifacts.length} 个 Replay 样本文件`);
      return replay;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "导出 Replay 样本失败";
      setReplayExportError(message);
      toast.error(message);
      return null;
    } finally {
      setReplayExporting(false);
    }
  }, [currentSessionId]);

  const handleExportAnalysisHandoff = useCallback(async () => {
    if (!currentSessionId) {
      toast.error("当前没有可导出的会话上下文");
      return null;
    }

    setAnalysisExporting(true);
    setAnalysisExportError(null);
    try {
      const analysis =
        await exportAgentRuntimeAnalysisHandoff(currentSessionId);
      setAnalysisHandoff(analysis);
      toast.success(`已导出 ${analysis.artifacts.length} 个外部分析文件`);
      return analysis;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "导出外部分析交接失败";
      setAnalysisExportError(message);
      toast.error(message);
      return null;
    } finally {
      setAnalysisExporting(false);
    }
  }, [currentSessionId]);

  const handleCopyAnalysisPrompt = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    const analysis = analysisHandoff || (await handleExportAnalysisHandoff());
    if (!analysis?.copy_prompt) {
      return;
    }

    try {
      await navigator.clipboard.writeText(analysis.copy_prompt);
      toast.success("已复制 AI 诊断与修复指令");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制 AI 诊断与修复指令失败",
      );
    }
  }, [analysisHandoff, handleExportAnalysisHandoff]);

  const handleCopyReplayPromotionCommand = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    const replay = replayCase || (await handleExportReplayCase());
    if (!replay) {
      return;
    }

    const promoteCommand = buildReplayPromotionCommand({
      replayCase: replay,
      analysisTitle: analysisHandoff?.title,
      reviewTitle: reviewDecisionTemplate?.title,
    });
    const evalCommand = buildReplayEvalCommand();
    const trendCommand = buildReplayTrendCommand();

    try {
      await navigator.clipboard.writeText(
        `${promoteCommand}\n${evalCommand}\n${trendCommand}\n`,
      );
      toast.success("已复制回归沉淀、验证与趋势命令");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "复制回归沉淀、验证与趋势命令失败",
      );
    }
  }, [
    analysisHandoff?.title,
    handleExportReplayCase,
    replayCase,
    reviewDecisionTemplate?.title,
  ]);

  const handleExportReviewDecisionTemplate = useCallback(async () => {
    if (!currentSessionId) {
      toast.error("当前没有可导出的会话上下文");
      return null;
    }

    setReviewDecisionExporting(true);
    setReviewDecisionExportError(null);
    try {
      const template =
        await exportAgentRuntimeReviewDecisionTemplate(currentSessionId);
      setReviewDecisionTemplate(template);
      toast.success(`已导出 ${template.artifacts.length} 个人工审核文件`);
      return template;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "导出人工审核记录失败";
      setReviewDecisionExportError(message);
      toast.error(message);
      return null;
    } finally {
      setReviewDecisionExporting(false);
    }
  }, [currentSessionId]);

  const handleOpenReviewDecisionEditor = useCallback(async () => {
    const template =
      reviewDecisionTemplate || (await handleExportReviewDecisionTemplate());
    if (!template) {
      return;
    }

    setReviewDecisionTemplate(template);
    setReviewDecisionEditorOpen(true);
  }, [handleExportReviewDecisionTemplate, reviewDecisionTemplate]);

  const handleSaveReviewDecision = useCallback(
    async (request: AgentRuntimeSaveReviewDecisionRequest) => {
      setReviewDecisionSaving(true);
      setReviewDecisionExportError(null);
      try {
        const template = await saveAgentRuntimeReviewDecision(request);
        setReviewDecisionTemplate(template);
        setReviewDecisionEditorOpen(false);
        toast.success("已保存人工审核结果");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "保存人工审核结果失败";
        setReviewDecisionExportError(message);
        toast.error(message);
      } finally {
        setReviewDecisionSaving(false);
      }
    },
    [],
  );

  const hasToolInventorySection =
    toolInventoryLoading ||
    Boolean(toolInventoryError) ||
    Boolean(toolInventory);
  const hasHandoffSection = Boolean(currentSessionId);
  const runtimeTaskPresentation = useMemo(
    () => buildRuntimeTaskPresentation(harnessState.runtimeStatus),
    [harnessState.runtimeStatus],
  );
  const toolInventorySourceStats = useMemo(
    () => buildToolInventorySourceStats(toolInventory?.catalog_tools || []),
    [toolInventory],
  );
  const filteredCatalogTools = useMemo(
    () =>
      (toolInventory?.catalog_tools || []).filter((entry) =>
        matchesCatalogToolInventoryFilter(entry, toolInventoryFilter),
      ),
    [toolInventory, toolInventoryFilter],
  );
  const toolInventoryWarnings = toolInventory?.warnings || [];
  const toolInventoryCatalogTools = toolInventory?.catalog_tools || [];
  const toolInventoryRegistryTools = toolInventory?.registry_tools || [];
  const toolInventoryRuntimeTools = useMemo(
    () => sortRuntimeToolsByVisibility(toolInventory?.runtime_tools || []),
    [toolInventory?.runtime_tools],
  );
  const runtimeToolAvailability = useMemo(
    () => deriveRuntimeToolAvailability(toolInventory),
    [toolInventory],
  );
  const toolInventoryExtensionSurfaces =
    toolInventory?.extension_surfaces || [];
  const toolInventoryExtensionTools = toolInventory?.extension_tools || [];
  const toolInventoryMcpTools = toolInventory?.mcp_tools || [];
  const runtimeToolTotal =
    toolInventory?.counts.runtime_total ?? toolInventoryRuntimeTools.length;
  const runtimeToolVisibleTotal =
    toolInventory?.counts.runtime_visible_total ??
    toolInventoryRuntimeTools.filter((entry) => entry.visible_in_context)
      .length;
  const runtimeToolCapabilityGaps = useMemo(() => {
    if (!toolInventory || !runtimeToolAvailability.known) {
      return [];
    }

    const gaps: Array<{ key: string; title: string; missing: string[] }> = [];

    if (!runtimeToolAvailability.webSearch) {
      gaps.push({
        key: "web_search",
        title: "WebSearch",
        missing: ["WebSearch"],
      });
    }

    if (!runtimeToolAvailability.subagentCore) {
      gaps.push({
        key: "subagent_core",
        title: "子任务核心 tools",
        missing: runtimeToolAvailability.missingSubagentCoreTools,
      });
    }

    if (!runtimeToolAvailability.subagentTeamTools) {
      gaps.push({
        key: "subagent_team",
        title: "Team current tools",
        missing: runtimeToolAvailability.missingSubagentTeamTools,
      });
    }

    if (!runtimeToolAvailability.taskRuntime) {
      gaps.push({
        key: "task_runtime",
        title: "Task current tools",
        missing: runtimeToolAvailability.missingTaskTools,
      });
    }

    return gaps;
  }, [runtimeToolAvailability, toolInventory]);
  const realTeamSummary = useMemo(
    () => summarizeChildSubagentSessions(childSubagentSessions),
    [childSubagentSessions],
  );
  const hasSelectedTeamConfig =
    Boolean(selectedTeamLabel?.trim()) ||
    Boolean(selectedTeamSummary?.trim()) ||
    (selectedTeamRoles?.length ?? 0) > 0;
  const threadReliabilityView = useMemo(
    () =>
      buildThreadReliabilityView({
        threadRead,
        turns,
        threadItems,
        currentTurnId,
        pendingActions,
        submittedActionsInFlight,
        queuedTurns,
      }),
    [
      currentTurnId,
      pendingActions,
      queuedTurns,
      submittedActionsInFlight,
      threadItems,
      threadRead,
      turns,
    ],
  );
  const runtimeFactSummary = useMemo(() => {
    const decisionReason =
      threadRead?.decision_reason ||
      ((
        threadRead?.runtime_summary as { decisionReason?: string | null } | null
      )?.decisionReason ??
        null);
    const fallbackChain = Array.isArray(threadRead?.fallback_chain)
      ? threadRead?.fallback_chain || []
      : Array.isArray(
            (
              threadRead?.runtime_summary as {
                fallbackChain?: string[] | null;
              } | null
            )?.fallbackChain,
          )
        ? (threadRead?.runtime_summary as { fallbackChain?: string[] | null })
            .fallbackChain || []
        : [];
    const oemPolicy = threadRead?.oem_policy as {
      locked?: boolean | null;
      quotaLow?: boolean | null;
      defaultModel?: string | null;
      selectedModel?: string | null;
      quotaStatus?: string | null;
      offerState?: string | null;
      providerSource?: string | null;
      providerKey?: string | null;
      fallbackToLocalAllowed?: boolean | null;
      canInvoke?: boolean | null;
      tenantId?: string | null;
    } | null;

    if (!decisionReason && fallbackChain.length === 0 && !oemPolicy) {
      return null;
    }

    return {
      decisionReason,
      fallbackChain,
      oemPolicy,
    };
  }, [threadRead]);

  const fileFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: "全部" },
        { value: "document" as const, label: "文档" },
        { value: "code" as const, label: "代码" },
        { value: "log" as const, label: "日志" },
        { value: "artifact" as const, label: "产物" },
        { value: "offload" as const, label: "转存" },
        { value: "other" as const, label: "其他" },
      ].filter(
        (option) =>
          option.value === "all" ||
          harnessState.recentFileEvents.some(
            (event) => event.kind === option.value,
          ),
      ),
    [harnessState.recentFileEvents],
  );

  const outputFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: "全部" },
        { value: "path" as const, label: "有路径" },
        { value: "offload" as const, label: "转存" },
        { value: "truncated" as const, label: "截断" },
        { value: "summary" as const, label: "仅摘要" },
      ].filter(
        (option) =>
          option.value === "all" ||
          harnessState.outputSignals.some((signal) =>
            matchesOutputFilter(signal, option.value),
          ),
      ),
    [harnessState.outputSignals],
  );

  const filteredFileEvents = useMemo(
    () =>
      harnessState.recentFileEvents.filter(
        (event) => fileFilter === "all" || event.kind === fileFilter,
      ),
    [fileFilter, harnessState.recentFileEvents],
  );

  const filteredOutputSignals = useMemo(
    () =>
      harnessState.outputSignals.filter((signal) =>
        matchesOutputFilter(signal, outputFilter),
      ),
    [harnessState.outputSignals, outputFilter],
  );

  const groupedOutputEntries = useMemo(() => {
    const entries: Array<
      | { type: "single"; signal: HarnessOutputSignal }
      | { type: "search_batch"; signals: HarnessOutputSignal[] }
    > = [];

    for (const signal of filteredOutputSignals) {
      const isSearch = isSearchOutputSignal(signal);
      const lastEntry = entries[entries.length - 1];

      if (isSearch && lastEntry && lastEntry.type === "search_batch") {
        lastEntry.signals.push(signal);
        continue;
      }

      if (isSearch) {
        entries.push({ type: "search_batch", signals: [signal] });
        continue;
      }

      entries.push({ type: "single", signal });
    }

    return entries;
  }, [filteredOutputSignals]);

  const groupedFileEvents = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        path: string;
        displayName: string;
        kind: HarnessFileKind;
        latestEvent: HarnessSessionState["recentFileEvents"][number];
        count: number;
        events: HarnessSessionState["recentFileEvents"];
      }
    >();

    for (const event of filteredFileEvents) {
      const key = event.path.trim() || event.id;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          key,
          path: event.path,
          displayName: event.displayName,
          kind: event.kind,
          latestEvent: event,
          count: 1,
          events: [event],
        });
        continue;
      }

      existing.events.push(event);
      existing.count += 1;

      const currentTime = existing.latestEvent.timestamp?.getTime() ?? 0;
      const nextTime = event.timestamp?.getTime() ?? 0;
      if (nextTime >= currentTime) {
        existing.latestEvent = event;
        existing.displayName = event.displayName;
        existing.kind = event.kind;
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        actionSummary: summarizeFileActions(group.events),
      }))
      .sort((left, right) => {
        const leftTime = left.latestEvent.timestamp?.getTime() ?? 0;
        const rightTime = right.latestEvent.timestamp?.getTime() ?? 0;
        return rightTime - leftTime;
      });
  }, [filteredFileEvents]);

  const availableSections = useMemo(() => {
    const sections: HarnessSectionNavItem[] = [];

    if (hasSelectedTeamConfig) {
      sections.push({ key: "team_config", label: "任务分工" });
    }

    if (runtimeTaskPresentation) {
      sections.push({ key: "runtime", label: "任务进行时" });
    }
    if (hasHandoffSection) {
      sections.push({ key: "handoff", label: "交接制品" });
    }
    if (threadReliabilityView.shouldRender) {
      sections.push({ key: "reliability", label: "可靠性" });
    }
    if (harnessState.activeFileWrites.length > 0) {
      sections.push({ key: "writes", label: "文件写入" });
    }
    if (harnessState.outputSignals.length > 0) {
      sections.push({ key: "outputs", label: "工具输出" });
    }
    if (hasToolInventorySection) {
      sections.push({ key: "inventory", label: "工具与权限" });
    }
    if (harnessState.pendingApprovals.length > 0) {
      sections.push({ key: "approvals", label: "待审批" });
    }
    if (harnessState.recentFileEvents.length > 0) {
      sections.push({ key: "files", label: "文件活动" });
    }
    if (
      harnessState.plan.phase !== "idle" ||
      harnessState.plan.items.length > 0
    ) {
      sections.push({ key: "plan", label: "规划状态" });
    }
    if (realTeamSummary.total > 0 || harnessState.delegatedTasks.length > 0) {
      sections.push({ key: "delegation", label: "子任务" });
    }
    if (harnessState.latestContextTrace.length > 0) {
      sections.push({ key: "context", label: "上下文轨迹" });
    }

    if (environment.skillsCount > 0) {
      sections.push({ key: "capabilities", label: "已激活技能" });
    }

    return sections;
  }, [
    environment.skillsCount,
    hasToolInventorySection,
    harnessState.delegatedTasks.length,
    harnessState.activeFileWrites.length,
    harnessState.latestContextTrace.length,
    harnessState.outputSignals.length,
    harnessState.pendingApprovals.length,
    harnessState.plan.items.length,
    harnessState.plan.phase,
    harnessState.recentFileEvents.length,
    hasHandoffSection,
    hasSelectedTeamConfig,
    realTeamSummary.total,
    runtimeTaskPresentation,
    threadReliabilityView.shouldRender,
  ]);

  const summaryCards = useMemo(() => {
    const cards: HarnessSummaryCard[] = [];

    if (runtimeTaskPresentation) {
      cards.push({
        sectionKey: "runtime",
        title: "当前任务",
        value: runtimeTaskPresentation.title,
        hint: `${runtimeTaskPresentation.statusLabel} · ${runtimeTaskPresentation.progressLabel}`,
        icon: Loader2,
      });
    }

    if (hasHandoffSection) {
      cards.push({
        sectionKey: "handoff",
        title: "交接制品",
        value: handoffBundle
          ? `${handoffBundle.artifacts.length} 个文件`
          : "待导出",
        hint: handoffBundle
          ? `最近导出 ${formatIsoDateTime(handoffBundle.exported_at)}`
          : "导出当前会话的 plan / progress / handoff / review 四件套",
        icon: HardDriveDownload,
      });
    }

    if (threadReliabilityView.shouldRender) {
      cards.push({
        sectionKey: "reliability",
        title: "可靠性",
        value: threadReliabilityView.statusLabel,
        hint: threadReliabilityView.summary,
        icon: AlertCircle,
      });
    }

    if (hasSelectedTeamConfig) {
      cards.push({
        sectionKey: "team_config",
        title: "任务分工",
        value:
          selectedTeamLabel?.trim() ||
          `${selectedTeamRoles?.length || 0} 个角色`,
        hint:
          selectedTeamSummary?.trim() ||
          ((selectedTeamRoles?.length || 0) > 0
            ? `已配置 ${selectedTeamRoles?.length || 0} 个角色`
            : "本次已启用任务分工"),
        icon: Workflow,
      });
    }

    if (harnessState.activeFileWrites.length > 0) {
      cards.push({
        sectionKey: "writes",
        title: "文件写入",
        value: `${harnessState.activeFileWrites.length}`,
        hint:
          harnessState.activeFileWrites[0]?.displayName || "暂无正在处理的文件",
        icon: FileText,
      });
    }

    if (realTeamSummary.total > 0) {
      cards.push({
        sectionKey: "delegation",
        title: "子任务",
        value:
          realTeamSummary.active > 0
            ? `${realTeamSummary.active}/${realTeamSummary.total}`
            : `${realTeamSummary.total}`,
        hint:
          realTeamSummary.active > 0
            ? `处理中 ${realTeamSummary.running} · 等待中 ${realTeamSummary.queued} · 已完成 ${realTeamSummary.settled}`
            : `已完成 ${realTeamSummary.settled} · 需处理 ${realTeamSummary.failed}`,
        icon: Workflow,
      });
    }

    if (hasToolInventorySection) {
      cards.push({
        sectionKey: "inventory",
        title: "工具库存",
        value: toolInventoryLoading
          ? "读取中"
          : toolInventory
            ? `${runtimeToolVisibleTotal}`
            : "异常",
        hint: toolInventoryError
          ? toolInventoryError
          : toolInventory
            ? `runtime ${runtimeToolVisibleTotal}/${runtimeToolTotal} · registry ${toolInventory.counts.registry_visible_total}`
            : "等待拉取运行时库存",
        icon: Wrench,
      });
    }

    cards.push(
      {
        sectionKey: "approvals",
        title: "待审批",
        value: `${harnessState.pendingApprovals.length}`,
        hint:
          harnessState.pendingApprovals.length > 0
            ? "需要你确认的操作"
            : "当前无阻塞审批",
        icon: ShieldAlert,
      },
      {
        sectionKey: "files",
        title: "文件活动",
        value: `${harnessState.recentFileEvents.length}`,
        hint:
          harnessState.recentFileEvents[0]?.displayName || "暂无可展示文件活动",
        icon: FolderOpen,
      },
      {
        sectionKey: "plan",
        title: "计划状态",
        value:
          harnessState.plan.phase === "planning"
            ? "进行中"
            : harnessState.plan.phase === "ready"
              ? "已就绪"
              : "空闲",
        hint:
          harnessState.plan.items[0]?.content ||
          harnessState.plan.summaryText ||
          "未检测到显式计划快照",
        icon: ListChecks,
      },
      {
        sectionKey: "context",
        title: "上下文",
        value: `${environment.activeContextCount}/${environment.contextItemsCount}`,
        hint: environment.contextEnabled
          ? "上下文工作台已启用"
          : "普通聊天模式",
        icon: Sparkles,
      },
    );

    return cards;
  }, [
    environment.activeContextCount,
    environment.contextEnabled,
    environment.contextItemsCount,
    handoffBundle,
    hasHandoffSection,
    hasToolInventorySection,
    hasSelectedTeamConfig,
    harnessState.activeFileWrites,
    harnessState.pendingApprovals.length,
    harnessState.plan.items,
    harnessState.plan.phase,
    harnessState.plan.summaryText,
    harnessState.recentFileEvents,
    realTeamSummary.active,
    realTeamSummary.failed,
    realTeamSummary.queued,
    realTeamSummary.running,
    realTeamSummary.settled,
    realTeamSummary.total,
    runtimeTaskPresentation,
    selectedTeamLabel,
    selectedTeamRoles?.length,
    selectedTeamSummary,
    toolInventory,
    toolInventoryError,
    toolInventoryLoading,
    runtimeToolTotal,
    runtimeToolVisibleTotal,
    threadReliabilityView.shouldRender,
    threadReliabilityView.statusLabel,
    threadReliabilityView.summary,
  ]);

  const openPreview = useCallback(
    async ({
      title,
      description,
      path,
      content,
      preview,
    }: {
      title: string;
      description?: string;
      path?: string;
      content?: string;
      preview?: string;
    }) => {
      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;

      const shouldLoad =
        !content?.trim() && !!path && typeof onLoadFilePreview === "function";

      setPreviewDialog({
        open: true,
        title,
        description,
        path,
        displayName: path ? getFileName(path) : title,
        content: content?.trim() || preview?.trim(),
        preview,
        error:
          content?.trim() || preview?.trim()
            ? undefined
            : shouldLoad
              ? undefined
              : "暂无可预览内容",
        isBinary: false,
        loading: shouldLoad,
      });

      if (!shouldLoad || !path) {
        return;
      }

      try {
        const result = await onLoadFilePreview(path);
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        const nextPath = result.path || path;
        const normalizedContent = result.content ?? undefined;

        setPreviewDialog((current) => ({
          ...current,
          path: nextPath,
          displayName: getFileName(nextPath),
          content: normalizedContent?.trim()
            ? normalizedContent
            : current.content,
          isBinary: result.isBinary === true,
          size: result.size,
          error:
            result.isBinary === true
              ? undefined
              : result.error || (normalizedContent ? undefined : current.error),
          loading: false,
        }));
      } catch (error) {
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setPreviewDialog((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [onLoadFilePreview],
  );

  const handleOpenFile = useCallback(() => {
    if (!onOpenFile || !previewDialog.content?.trim()) {
      return;
    }

    onOpenFile(
      previewDialog.path || previewDialog.displayName,
      previewDialog.content,
    );
  }, [
    onOpenFile,
    previewDialog.content,
    previewDialog.displayName,
    previewDialog.path,
  ]);

  const handleCopyPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可复制的文件路径");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      toast.success("文件路径已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制路径失败");
    }
  }, [previewDialog.path]);

  const handleCopyContent = useCallback(async () => {
    const content = previewDialog.content?.trim();
    if (!content) {
      toast.error("当前没有可复制的内容");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(previewDialog.content || "");
      toast.success("内容已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制内容失败");
    }
  }, [previewDialog.content]);

  const handleOpenPathValue = useCallback(
    async (path: string) => {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        toast.error("当前没有可打开的文件路径");
        return;
      }

      try {
        await (onOpenPath ?? openPathWithDefaultApp)(normalizedPath);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "打开文件失败");
      }
    },
    [onOpenPath],
  );

  const handleOpenExternalLink = useCallback(async (url: string) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      toast.error("当前没有可打开的链接");
      return;
    }

    try {
      await openExternalUrl(normalizedUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开链接失败");
    }
  }, []);

  const handleRevealPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可定位的文件路径");
      return;
    }

    try {
      await (onRevealPath ?? revealPathInFinder)(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "定位文件失败");
    }
  }, [onRevealPath, previewDialog.path]);

  const handleOpenPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可打开的文件路径");
      return;
    }

    await handleOpenPathValue(path);
  }, [handleOpenPathValue, previewDialog.path]);

  return (
    <>
      <div
        data-testid="harness-status-panel"
        data-layout={layout}
        className={cn(
          "lime-workbench-theme-scope lime-workbench-surface-scope text-[color:var(--lime-text)]",
          layout === "sidebar"
            ? "rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]"
            : layout === "dialog"
              ? "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]"
              : "mx-3 mt-2 rounded-2xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)]",
        )}
      >
        <div
          data-harness-drag-handle={isDialogLayout ? "true" : undefined}
          className={cn(
            "flex items-center justify-between gap-3 border-b border-border px-4 py-3",
            isDialogLayout &&
              "shrink-0 cursor-grab select-none px-5 py-4 active:cursor-grabbing",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              {realTeamSummary.active > 0 ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  任务进行中
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          {!isDialogLayout ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={isDetailsExpanded}
              aria-label={
                isDetailsExpanded ? `折叠${toggleLabel}` : `展开${toggleLabel}`
              }
            >
              {isDetailsExpanded ? (
                <ChevronDown className="mr-1 h-4 w-4" />
              ) : (
                <ChevronRight className="mr-1 h-4 w-4" />
              )}
              {isDetailsExpanded ? `收起${toggleLabel}` : `展开${toggleLabel}`}
            </Button>
          ) : null}
        </div>

        {!isDialogLayout && leadContent ? (
          <div
            className={cn(
              "border-b border-border px-4 py-4",
              isDialogLayout && "shrink-0 px-5 py-4",
            )}
          >
            {leadContent}
          </div>
        ) : null}

        {!isDialogLayout ? (
          <div
            className={cn(
              "grid gap-2 px-4 py-4",
              layout === "sidebar"
                ? "grid-cols-1"
                : "md:grid-cols-2 xl:grid-cols-4",
            )}
          >
            {summaryCards.map((card) => (
              <SummaryCard
                key={card.title}
                title={card.title}
                value={card.value}
                hint={card.hint}
                icon={card.icon}
                onClick={() => scrollToSection(card.sectionKey)}
                compact={false}
              />
            ))}
          </div>
        ) : null}

        {isDetailsExpanded ? (
          <ScrollArea
            className={cn(
              "border-t border-border px-4 py-4",
              layout === "sidebar"
                ? "max-h-[24rem]"
                : layout === "dialog"
                  ? "flex-1 min-h-0 overscroll-contain px-5"
                  : "max-h-[28rem]",
            )}
          >
            <div className="space-y-4 pb-1">
              {isDialogLayout && leadContent ? (
                <div className="pt-4">{leadContent}</div>
              ) : null}

              {isDialogLayout ? (
                <div className="grid gap-2 pt-1 sm:grid-cols-2 xl:grid-cols-5">
                  {summaryCards.map((card) => (
                    <SummaryCard
                      key={card.title}
                      title={card.title}
                      value={card.value}
                      hint={card.hint}
                      icon={card.icon}
                      onClick={() => scrollToSection(card.sectionKey)}
                      compact={true}
                    />
                  ))}
                </div>
              ) : null}

              {availableSections.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableSections.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      onClick={() => scrollToSection(item.key)}
                      aria-label={`跳转到${item.label}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {hasSelectedTeamConfig ? (
                <Section
                  sectionKey="team_config"
                  title="当前任务分工"
                  badge={
                    selectedTeamRoles && selectedTeamRoles.length > 0
                      ? `${selectedTeamRoles.length} 个角色`
                      : undefined
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="rounded-xl border border-sky-200/80 bg-sky-50/50 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Workflow className="h-4 w-4 text-sky-600" />
                        <span>{selectedTeamLabel || "当前已启用分工方案"}</span>
                      </div>
                      {selectedTeamSummary ? (
                        <div className="mt-2 text-sm text-muted-foreground">
                          {selectedTeamSummary}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-muted-foreground">
                          本次会优先参考所选分工方案，按需拆出子任务继续处理。
                        </div>
                      )}
                    </div>

                    {selectedTeamRoles && selectedTeamRoles.length > 0 ? (
                      <div className="grid gap-2 lg:grid-cols-2">
                        {selectedTeamRoles.map((role, index) => (
                          <div
                            key={`${role.id || role.label}-${index}`}
                            className="rounded-xl border border-border bg-background p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium text-foreground">
                                {role.label}
                              </div>
                              {role.profileId ? (
                                <Badge variant="outline">
                                  模板 {role.profileId}
                                </Badge>
                              ) : null}
                              {role.roleKey ? (
                                <Badge variant="outline">
                                  职责 {role.roleKey}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">
                              {role.summary}
                            </div>
                            {role.skillIds && role.skillIds.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {role.skillIds.map((skillId) => (
                                  <Badge
                                    key={`${role.id || role.label}-${skillId}`}
                                    variant="secondary"
                                  >
                                    {skillId}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}
              {runtimeTaskPresentation ? (
                <Section
                  sectionKey="runtime"
                  title="任务进行时"
                  badge={
                    runtimeTaskPresentation.checkpoints.length > 0
                      ? `${runtimeTaskPresentation.checkpoints.length} 个节点`
                      : runtimeTaskPresentation.phaseLabel
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-background p-4 shadow-sm shadow-slate-950/5">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
                            runtimeTaskPresentation.stepStatus === "error" &&
                              "bg-destructive/10 text-destructive",
                            runtimeTaskPresentation.stepStatus === "skipped" &&
                              "bg-muted text-muted-foreground",
                            runtimeTaskPresentation.stepStatus === "active" &&
                              "bg-primary/10 text-primary",
                          )}
                        >
                          {runtimeTaskPresentation.stepStatus === "error" ? (
                            <AlertCircle className="h-4 w-4" />
                          ) : runtimeTaskPresentation.stepStatus ===
                            "skipped" ? (
                            <Clock3 className="h-4 w-4" />
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-muted-foreground">
                            当前任务
                          </div>
                          <div className="mt-1 text-sm font-semibold leading-6 text-foreground">
                            {runtimeTaskPresentation.title}
                          </div>
                          <InteractiveText
                            text={runtimeTaskPresentation.summaryText}
                            className="mt-2 text-sm leading-6 text-muted-foreground"
                            onOpenUrl={handleOpenExternalLink}
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge
                              variant={
                                runtimeTaskPresentation.stepStatus === "error"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {runtimeTaskPresentation.statusLabel}
                            </Badge>
                            <Badge variant="outline">
                              {runtimeTaskPresentation.phaseLabel}
                            </Badge>
                            <Badge variant="outline">
                              {runtimeTaskPresentation.progressLabel}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    {runtimeTaskPresentation.checkpoints.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-muted-foreground">
                            任务节点
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {runtimeTaskPresentation.progressLabel}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {runtimeTaskPresentation.checkpoints.map(
                            (checkpoint, index) => {
                              const isCurrentCheckpoint =
                                index ===
                                runtimeTaskPresentation.checkpoints.length - 1;
                              return (
                                <div
                                  key={`${checkpoint}-${index}`}
                                  className={cn(
                                    "flex items-start gap-3 rounded-xl border px-3 py-2.5",
                                    isCurrentCheckpoint &&
                                      runtimeTaskPresentation.stepStatus ===
                                        "error" &&
                                      "border-destructive/30 bg-destructive/5",
                                    isCurrentCheckpoint &&
                                      runtimeTaskPresentation.stepStatus ===
                                        "active" &&
                                      "border-primary/20 bg-primary/5",
                                    isCurrentCheckpoint &&
                                      runtimeTaskPresentation.stepStatus ===
                                        "skipped" &&
                                      "border-border bg-muted/30",
                                    !isCurrentCheckpoint &&
                                      "border-border bg-muted/20",
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                                      isCurrentCheckpoint &&
                                        runtimeTaskPresentation.stepStatus ===
                                          "error" &&
                                        "bg-destructive/10 text-destructive",
                                      isCurrentCheckpoint &&
                                        runtimeTaskPresentation.stepStatus ===
                                          "active" &&
                                        "bg-primary/10 text-primary",
                                      isCurrentCheckpoint &&
                                        runtimeTaskPresentation.stepStatus ===
                                          "skipped" &&
                                        "bg-background text-muted-foreground",
                                      !isCurrentCheckpoint &&
                                        "bg-background text-muted-foreground",
                                    )}
                                  >
                                    {isCurrentCheckpoint ? (
                                      runtimeTaskPresentation.stepStatus ===
                                      "error" ? (
                                        <AlertCircle className="h-3.5 w-3.5" />
                                      ) : runtimeTaskPresentation.stepStatus ===
                                        "skipped" ? (
                                        <Clock3 className="h-3.5 w-3.5" />
                                      ) : (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      )
                                    ) : (
                                      index + 1
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <InteractiveText
                                      text={checkpoint}
                                      className="text-sm leading-6 text-foreground"
                                      onOpenUrl={handleOpenExternalLink}
                                    />
                                  </div>
                                  <Badge
                                    variant={
                                      isCurrentCheckpoint
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {isCurrentCheckpoint ? "当前" : "已记录"}
                                  </Badge>
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                        {runtimeTaskPresentation.progressLabel}
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {hasHandoffSection ? (
                <Section
                  sectionKey="handoff"
                  title="交接制品"
                  badge={
                    handoffBundle
                      ? `已导出 ${handoffBundle.artifacts.length} 个文件`
                      : "待导出"
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="rounded-xl border border-sky-200/80 bg-sky-50/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <HardDriveDownload className="h-4 w-4 text-sky-600" />
                            <span>会话交接四件套</span>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            把当前 session 的 plan / progress / handoff / review
                            摘要落到工作区 `.lime/harness/sessions`
                            下，便于下一次恢复和审查。
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            当前会话：{currentSessionId}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={handoffBundle ? "outline" : "default"}
                            className="gap-2"
                            aria-label="导出交接制品"
                            disabled={handoffExporting}
                            onClick={() => void handleExportHandoffBundle()}
                          >
                            {handoffExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <HardDriveDownload className="h-4 w-4" />
                            )}
                            {handoffBundle ? "刷新导出" : "导出交接制品"}
                          </Button>
                          {handoffBundle ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              aria-label="打开交接目录"
                              onClick={() =>
                                void handleOpenPathValue(
                                  handoffBundle.bundle_absolute_root,
                                )
                              }
                            >
                              <FolderOpen className="h-4 w-4" />
                              打开目录
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {handoffExportError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                        {handoffExportError}
                      </div>
                    ) : null}

                    {handoffBundle ? (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <InventoryStatCard
                            title="线程状态"
                            value={formatHandoffStatusLabel(
                              handoffBundle.thread_status,
                            )}
                            hint={`最近导出 ${formatIsoDateTime(handoffBundle.exported_at)}`}
                          />
                          <InventoryStatCard
                            title="最新 Turn"
                            value={formatHandoffStatusLabel(
                              handoffBundle.latest_turn_status,
                            )}
                            hint={`待处理请求 ${handoffBundle.pending_request_count} · 排队 ${handoffBundle.queued_turn_count}`}
                          />
                          <InventoryStatCard
                            title="Todo"
                            value={`${handoffBundle.todo_completed}/${handoffBundle.todo_total}`}
                            hint={`待开始 ${handoffBundle.todo_pending} · 进行中 ${handoffBundle.todo_in_progress}`}
                          />
                          <InventoryStatCard
                            title="子任务"
                            value={`${handoffBundle.active_subagent_count}`}
                            hint={`workspace ${handoffBundle.workspace_id || "未绑定"}`}
                          />
                        </div>

                        <div className="rounded-xl border border-border bg-background p-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            <span>导出目录</span>
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <div>
                              相对路径：
                              <span className="ml-1 break-all font-mono text-foreground">
                                {handoffBundle.bundle_relative_root}
                              </span>
                            </div>
                            <div>
                              绝对路径：
                              <PathTextLink
                                path={handoffBundle.bundle_absolute_root}
                                className="ml-1"
                                onOpenPath={handleOpenPathValue}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {handoffBundle.artifacts.map((artifact) => {
                            const sizeLabel = formatSize(artifact.bytes);
                            return (
                              <div
                                key={artifact.absolute_path}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <FileText className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-sm font-medium text-foreground">
                                        {artifact.title}
                                      </span>
                                      <Badge variant="outline">
                                        {formatHandoffArtifactKindLabel(
                                          artifact.kind,
                                        )}
                                      </Badge>
                                      {sizeLabel ? (
                                        <Badge variant="secondary">
                                          {sizeLabel}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 text-xs text-muted-foreground">
                                      <div>
                                        相对路径：
                                        <span className="ml-1 break-all font-mono text-foreground">
                                          {artifact.relative_path}
                                        </span>
                                      </div>
                                      <div className="mt-1">
                                        绝对路径：
                                        <PathTextLink
                                          path={artifact.absolute_path}
                                          className="ml-1"
                                          onOpenPath={handleOpenPathValue}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="gap-2"
                                      aria-label={`预览交接制品：${artifact.title}`}
                                      onClick={() =>
                                        void openPreview({
                                          title: artifact.title,
                                          description: `交接制品 · ${formatHandoffArtifactKindLabel(
                                            artifact.kind,
                                          )}`,
                                          path: artifact.absolute_path,
                                        })
                                      }
                                    >
                                      <Eye className="h-4 w-4" />
                                      预览
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="gap-2"
                                      aria-label={`系统打开交接制品：${artifact.absolute_path}`}
                                      onClick={() =>
                                        void handleOpenPathValue(
                                          artifact.absolute_path,
                                        )
                                      }
                                    >
                                      <FolderOpen className="h-4 w-4" />
                                      打开
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        尚未导出交接制品。建议在需要跨会话接手、准备审查或切换执行人前先导出一次。
                      </div>
                    )}

                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <ShieldAlert className="h-4 w-4 text-amber-600" />
                            <span>问题证据包</span>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            把当前
                            runtime、timeline、最近产物和已知缺口导出为最小证据包，为后续
                            replay、eval 和故障复盘提供输入。
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={evidencePack ? "outline" : "default"}
                            className="gap-2"
                            aria-label="导出问题证据包"
                            disabled={evidenceExporting}
                            onClick={() => void handleExportEvidencePack()}
                          >
                            {evidenceExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ShieldAlert className="h-4 w-4" />
                            )}
                            {evidencePack ? "刷新证据包" : "导出问题证据包"}
                          </Button>
                          {evidencePack ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              aria-label="打开问题证据目录"
                              onClick={() =>
                                void handleOpenPathValue(
                                  evidencePack.pack_absolute_root,
                                )
                              }
                            >
                              <FolderOpen className="h-4 w-4" />
                              打开目录
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {evidenceExportError ? (
                        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                          {evidenceExportError}
                        </div>
                      ) : null}

                      {evidencePack ? (
                        <div className="mt-3 space-y-3">
                          {(() => {
                            const verificationSummary =
                              evidencePack.observability_summary
                                ?.verification_summary;
                            const failureFocus =
                              verificationSummary?.focus_verification_failure_outcomes ??
                              [];
                            const exportedSignals =
                              evidencePack.observability_summary?.signal_coverage.filter(
                                (entry) => entry.status === "exported",
                              ).length ?? 0;

                            return (
                              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <InventoryStatCard
                                  title="线程状态"
                                  value={formatHandoffStatusLabel(
                                    evidencePack.thread_status,
                                  )}
                                  hint={`最近导出 ${formatIsoDateTime(evidencePack.exported_at)}`}
                                />
                                <InventoryStatCard
                                  title="时间线"
                                  value={`${evidencePack.turn_count} / ${evidencePack.item_count}`}
                                  hint="turns / items"
                                />
                                <InventoryStatCard
                                  title="阻塞线索"
                                  value={`${evidencePack.pending_request_count} / ${evidencePack.queued_turn_count}`}
                                  hint="pending request / queued turn"
                                />
                                <InventoryStatCard
                                  title="已知缺口"
                                  value={`${evidencePack.known_gaps.length}`}
                                  hint={
                                    verificationSummary
                                      ? `验证焦点 ${failureFocus.length} · 已导出信号 ${exportedSignals}`
                                      : `最近产物 ${evidencePack.recent_artifact_count} 个`
                                  }
                                />
                              </div>
                            );
                          })()}

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <FolderOpen className="h-4 w-4 text-muted-foreground" />
                              <span>证据目录</span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>
                                相对路径：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {evidencePack.pack_relative_root}
                                </span>
                              </div>
                              <div>
                                绝对路径：
                                <PathTextLink
                                  path={evidencePack.pack_absolute_root}
                                  className="ml-1"
                                  onOpenPath={handleOpenPathValue}
                                />
                              </div>
                            </div>
                          </div>

                          {evidencePack.observability_summary
                            ?.verification_summary ? (
                            <HarnessVerificationSummarySection
                              summary={
                                evidencePack.observability_summary
                                  .verification_summary
                              }
                            />
                          ) : null}

                          {evidencePack.known_gaps.length > 0 ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                              <div className="text-sm font-medium text-amber-900">
                                当前已知缺口
                              </div>
                              <div className="mt-2 space-y-1 text-xs text-amber-800">
                                {evidencePack.known_gaps.map((gap, index) => (
                                  <div key={`${gap}-${index}`}>{gap}</div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-3">
                            {evidencePack.artifacts.map((artifact) => {
                              const sizeLabel = formatSize(artifact.bytes);
                              return (
                                <div
                                  key={artifact.absolute_path}
                                  className="rounded-xl border border-border bg-background p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm font-medium text-foreground">
                                          {artifact.title}
                                        </span>
                                        <Badge variant="outline">
                                          {formatEvidenceArtifactKindLabel(
                                            artifact.kind,
                                          )}
                                        </Badge>
                                        {sizeLabel ? (
                                          <Badge variant="secondary">
                                            {sizeLabel}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        <div>
                                          相对路径：
                                          <span className="ml-1 break-all font-mono text-foreground">
                                            {artifact.relative_path}
                                          </span>
                                        </div>
                                        <div className="mt-1">
                                          绝对路径：
                                          <PathTextLink
                                            path={artifact.absolute_path}
                                            className="ml-1"
                                            onOpenPath={handleOpenPathValue}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        aria-label={`预览问题证据：${artifact.title}`}
                                        onClick={() =>
                                          void openPreview({
                                            title: artifact.title,
                                            description: `问题证据 · ${formatEvidenceArtifactKindLabel(
                                              artifact.kind,
                                            )}`,
                                            path: artifact.absolute_path,
                                          })
                                        }
                                      >
                                        <Eye className="h-4 w-4" />
                                        预览
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="gap-2"
                                        aria-label={`系统打开问题证据：${artifact.absolute_path}`}
                                        onClick={() =>
                                          void handleOpenPathValue(
                                            artifact.absolute_path,
                                          )
                                        }
                                      >
                                        <FolderOpen className="h-4 w-4" />
                                        打开
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                          尚未导出问题证据包。建议在出现阻塞、需要复盘失败链路，或准备把真实案例沉淀成
                          replay / eval 样本前导出一次。
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <FileCode2 className="h-4 w-4 text-emerald-600" />
                            <span>Replay 样本</span>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            基于当前 session 复用 handoff bundle 与 evidence
                            pack，导出 `input / expected / grader /
                            evidence-links`
                            四件套，把真实失败转成可回放、可评分、可回归的最小样本。
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={replayCase ? "outline" : "default"}
                            className="gap-2"
                            aria-label="导出 Replay 样本"
                            disabled={replayExporting}
                            onClick={() => void handleExportReplayCase()}
                          >
                            {replayExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileCode2 className="h-4 w-4" />
                            )}
                            {replayCase
                              ? "刷新 Replay 样本"
                              : "导出 Replay 样本"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            aria-label="复制回归沉淀与验证命令"
                            disabled={replayExporting}
                            onClick={() =>
                              void handleCopyReplayPromotionCommand()
                            }
                          >
                            {replayExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                            复制回归命令
                          </Button>
                          {replayCase ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              aria-label="打开 Replay 样本目录"
                              onClick={() =>
                                void handleOpenPathValue(
                                  replayCase.replay_absolute_root,
                                )
                              }
                            >
                              <FolderOpen className="h-4 w-4" />
                              打开目录
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {replayExportError ? (
                        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                          {replayExportError}
                        </div>
                      ) : null}

                      {replayCase ? (
                        <div className="mt-3 space-y-3">
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <InventoryStatCard
                              title="线程状态"
                              value={formatHandoffStatusLabel(
                                replayCase.thread_status,
                              )}
                              hint={`最近导出 ${formatIsoDateTime(replayCase.exported_at)}`}
                            />
                            <InventoryStatCard
                              title="阻塞线索"
                              value={`${replayCase.pending_request_count} / ${replayCase.queued_turn_count}`}
                              hint="pending request / queued turn"
                            />
                            <InventoryStatCard
                              title="关联证据"
                              value={`${replayCase.linked_handoff_artifact_count} / ${replayCase.linked_evidence_artifact_count}`}
                              hint="handoff / evidence"
                            />
                            <InventoryStatCard
                              title="最近产物"
                              value={`${replayCase.recent_artifact_count}`}
                              hint={`workspace ${replayCase.workspace_id || "未绑定"}`}
                            />
                          </div>

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <FolderOpen className="h-4 w-4 text-muted-foreground" />
                              <span>Replay 目录</span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>
                                相对路径：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {replayCase.replay_relative_root}
                                </span>
                              </div>
                              <div>
                                绝对路径：
                                <PathTextLink
                                  path={replayCase.replay_absolute_root}
                                  className="ml-1"
                                  onOpenPath={handleOpenPathValue}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                            <div className="text-sm font-medium text-emerald-900">
                              关联证据主链
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-emerald-800">
                              <div>
                                handoff：
                                <span className="ml-1 break-all font-mono text-emerald-950">
                                  {replayCase.handoff_bundle_relative_root}
                                </span>
                              </div>
                              <div>
                                evidence：
                                <span className="ml-1 break-all font-mono text-emerald-950">
                                  {replayCase.evidence_pack_relative_root}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-sky-950">
                              <Workflow className="h-4 w-4 text-sky-700" />
                              <span>回归资产沉淀</span>
                            </div>
                            <div className="mt-2 text-xs leading-5 text-sky-900">
                              这一步直接复用仓库已有的 `harness:eval:promote` 与
                              `harness:eval` 主命令，把当前 replay case
                              提升为仓库 current
                              样本，并立即跑一次统一摘要验证；
                              点击“复制回归命令”后不需要你再手写参数。
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              <InventoryStatCard
                                title="目标 Suite"
                                value={
                                  buildReplayPromotionContext({
                                    replayCase,
                                    analysisTitle: analysisHandoff?.title,
                                    reviewTitle: reviewDecisionTemplate?.title,
                                  }).suiteId
                                }
                                hint="仓库 current 样本集"
                              />
                              <InventoryStatCard
                                title="建议 Slug"
                                value={
                                  buildReplayPromotionContext({
                                    replayCase,
                                    analysisTitle: analysisHandoff?.title,
                                    reviewTitle: reviewDecisionTemplate?.title,
                                  }).slug
                                }
                                hint="promotion 目录名"
                              />
                              <InventoryStatCard
                                title="后续验证"
                                value="eval + trend"
                                hint="统一摘要与趋势入口"
                              />
                            </div>
                          </div>

                          <div className="space-y-3">
                            {replayCase.artifacts.map((artifact) => {
                              const sizeLabel = formatSize(artifact.bytes);
                              return (
                                <div
                                  key={artifact.absolute_path}
                                  className="rounded-xl border border-border bg-background p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm font-medium text-foreground">
                                          {artifact.title}
                                        </span>
                                        <Badge variant="outline">
                                          {formatReplayArtifactKindLabel(
                                            artifact.kind,
                                          )}
                                        </Badge>
                                        {sizeLabel ? (
                                          <Badge variant="secondary">
                                            {sizeLabel}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        <div>
                                          相对路径：
                                          <span className="ml-1 break-all font-mono text-foreground">
                                            {artifact.relative_path}
                                          </span>
                                        </div>
                                        <div className="mt-1">
                                          绝对路径：
                                          <PathTextLink
                                            path={artifact.absolute_path}
                                            className="ml-1"
                                            onOpenPath={handleOpenPathValue}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        aria-label={`预览 Replay 样本：${artifact.title}`}
                                        onClick={() =>
                                          void openPreview({
                                            title: artifact.title,
                                            description: `Replay 样本 · ${formatReplayArtifactKindLabel(
                                              artifact.kind,
                                            )}`,
                                            path: artifact.absolute_path,
                                          })
                                        }
                                      >
                                        <Eye className="h-4 w-4" />
                                        预览
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="gap-2"
                                        aria-label={`系统打开 Replay 样本：${artifact.absolute_path}`}
                                        onClick={() =>
                                          void handleOpenPathValue(
                                            artifact.absolute_path,
                                          )
                                        }
                                      >
                                        <FolderOpen className="h-4 w-4" />
                                        打开
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                          尚未导出 Replay 样本。建议在 handoff 和 evidence
                          都稳定后，再把真实失败沉淀成 `input / expected /
                          grader / evidence-links` 四件套。
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Sparkles className="h-4 w-4 text-violet-600" />
                            <span>外部分析交接</span>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            把 handoff / evidence / replay 主链重新包装成外部 AI
                            可直接消费的分析交接；复制后可直接粘贴给 AI，
                            不需要你再手写补充 prompt。
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={analysisHandoff ? "outline" : "default"}
                            className="gap-2"
                            aria-label="导出外部分析交接"
                            disabled={analysisExporting}
                            onClick={() => void handleExportAnalysisHandoff()}
                          >
                            {analysisExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            {analysisHandoff ? "刷新分析交接" : "导出分析交接"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            aria-label="一键复制给 AI"
                            disabled={analysisExporting}
                            onClick={() => void handleCopyAnalysisPrompt()}
                          >
                            {analysisExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                            一键复制给 AI
                          </Button>
                          {analysisHandoff ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              aria-label="打开外部分析目录"
                              onClick={() =>
                                void handleOpenPathValue(
                                  analysisHandoff.analysis_absolute_root,
                                )
                              }
                            >
                              <FolderOpen className="h-4 w-4" />
                              打开目录
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {analysisExportError ? (
                        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                          {analysisExportError}
                        </div>
                      ) : null}

                      {analysisHandoff ? (
                        <div className="mt-3 space-y-3">
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <InventoryStatCard
                              title="线程状态"
                              value={formatHandoffStatusLabel(
                                analysisHandoff.thread_status,
                              )}
                              hint={`最近导出 ${formatIsoDateTime(analysisHandoff.exported_at)}`}
                            />
                            <InventoryStatCard
                              title="最新 Turn"
                              value={formatHandoffStatusLabel(
                                analysisHandoff.latest_turn_status,
                              )}
                              hint={`待处理请求 ${analysisHandoff.pending_request_count} · 排队 ${analysisHandoff.queued_turn_count}`}
                            />
                            <InventoryStatCard
                              title="分析标题"
                              value={analysisHandoff.title || "未命名"}
                              hint={`工作区 ${analysisHandoff.workspace_id || "未绑定"}`}
                            />
                            <InventoryStatCard
                              title="分析文件"
                              value={`${analysisHandoff.artifacts.length}`}
                              hint="analysis brief / context"
                            />
                          </div>

                          <div className="rounded-xl border border-violet-200 bg-violet-50/80 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-violet-950">
                              <Copy className="h-4 w-4 text-violet-700" />
                              <span>复制说明</span>
                            </div>
                            <div className="mt-2 text-xs leading-5 text-violet-900">
                              复制内容来自后端导出的
                              `copy_prompt`，已经包含分析入口文件、关联目录和输出要求；
                              外部 AI
                              可直接开始诊断，证据足够明确时也可直接实施最小修复。
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <FolderOpen className="h-4 w-4 text-muted-foreground" />
                              <span>分析目录</span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>
                                相对路径：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {analysisHandoff.analysis_relative_root}
                                </span>
                              </div>
                              <div>
                                绝对路径：
                                <PathTextLink
                                  path={analysisHandoff.analysis_absolute_root}
                                  className="ml-1"
                                  onOpenPath={handleOpenPathValue}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="text-sm font-medium text-foreground">
                              关联主链目录
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>
                                handoff：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {analysisHandoff.handoff_bundle_relative_root}
                                </span>
                              </div>
                              <div>
                                evidence：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {analysisHandoff.evidence_pack_relative_root}
                                </span>
                              </div>
                              <div>
                                replay：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {analysisHandoff.replay_case_relative_root}
                                </span>
                              </div>
                              <div>
                                路径占位根：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {analysisHandoff.sanitized_workspace_root}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {analysisHandoff.artifacts.map((artifact) => {
                              const sizeLabel = formatSize(artifact.bytes);
                              return (
                                <div
                                  key={artifact.absolute_path}
                                  className="rounded-xl border border-border bg-background p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm font-medium text-foreground">
                                          {artifact.title}
                                        </span>
                                        <Badge variant="outline">
                                          {formatAnalysisArtifactKindLabel(
                                            artifact.kind,
                                          )}
                                        </Badge>
                                        {sizeLabel ? (
                                          <Badge variant="secondary">
                                            {sizeLabel}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        <div>
                                          相对路径：
                                          <span className="ml-1 break-all font-mono text-foreground">
                                            {artifact.relative_path}
                                          </span>
                                        </div>
                                        <div className="mt-1">
                                          绝对路径：
                                          <PathTextLink
                                            path={artifact.absolute_path}
                                            className="ml-1"
                                            onOpenPath={handleOpenPathValue}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        aria-label={`预览外部分析文件：${artifact.title}`}
                                        onClick={() =>
                                          void openPreview({
                                            title: artifact.title,
                                            description: `外部分析交接 · ${formatAnalysisArtifactKindLabel(
                                              artifact.kind,
                                            )}`,
                                            path: artifact.absolute_path,
                                          })
                                        }
                                      >
                                        <Eye className="h-4 w-4" />
                                        预览
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="gap-2"
                                        aria-label={`系统打开外部分析文件：${artifact.absolute_path}`}
                                        onClick={() =>
                                          void handleOpenPathValue(
                                            artifact.absolute_path,
                                          )
                                        }
                                      >
                                        <FolderOpen className="h-4 w-4" />
                                        打开
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                          尚未导出外部分析交接。点击“一键复制给
                          AI”时会自动先导出再复制， 用于把当前 Lime
                          证据链直接交给外部 AI 做诊断与最小修复。
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <ListChecks className="h-4 w-4 text-emerald-600" />
                            <span>人工审核记录</span>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            把外部 AI 的分析结论回挂为 `review-decision.md/json`
                            模板，固定接受、延后、拒绝与回归要求；最终决策仍由开发者审核，不是
                            Lime 自动闭环。
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              reviewDecisionTemplate ? "outline" : "default"
                            }
                            className="gap-2"
                            aria-label="导出人工审核记录"
                            disabled={reviewDecisionExporting}
                            onClick={() =>
                              void handleExportReviewDecisionTemplate()
                            }
                          >
                            {reviewDecisionExporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ListChecks className="h-4 w-4" />
                            )}
                            {reviewDecisionTemplate
                              ? "刷新人工审核记录"
                              : "导出人工审核记录"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            aria-label="填写人工审核结果"
                            disabled={
                              reviewDecisionExporting || reviewDecisionSaving
                            }
                            onClick={() =>
                              void handleOpenReviewDecisionEditor()
                            }
                          >
                            <ShieldAlert className="h-4 w-4" />
                            填写人工审核结果
                          </Button>
                          {reviewDecisionTemplate ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              aria-label="打开人工审核目录"
                              onClick={() =>
                                void handleOpenPathValue(
                                  reviewDecisionTemplate.review_absolute_root,
                                )
                              }
                            >
                              <FolderOpen className="h-4 w-4" />
                              打开目录
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {reviewDecisionExportError ? (
                        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                          {reviewDecisionExportError}
                        </div>
                      ) : null}

                      {reviewDecisionTemplate ? (
                        <div className="mt-3 space-y-3">
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                            <InventoryStatCard
                              title="当前状态"
                              value={formatReviewDecisionStatusLabel(
                                reviewDecisionTemplate.decision
                                  .decision_status ||
                                  reviewDecisionTemplate.default_decision_status,
                              )}
                              hint={`最近写入 ${formatIsoDateTime(reviewDecisionTemplate.exported_at)}`}
                            />
                            <InventoryStatCard
                              title="线程状态"
                              value={formatHandoffStatusLabel(
                                reviewDecisionTemplate.thread_status,
                              )}
                              hint={`待处理请求 ${reviewDecisionTemplate.pending_request_count} · 排队 ${reviewDecisionTemplate.queued_turn_count}`}
                            />
                            <InventoryStatCard
                              title="风险等级"
                              value={formatReviewDecisionRiskLevelLabel(
                                reviewDecisionTemplate.decision.risk_level,
                              )}
                              hint={
                                reviewDecisionTemplate.decision.risk_tags
                                  .length > 0
                                  ? reviewDecisionTemplate.decision.risk_tags.join(
                                      " / ",
                                    )
                                  : "尚未填写风险标签"
                              }
                            />
                            <InventoryStatCard
                              title="分析文件"
                              value={`${reviewDecisionTemplate.analysis_artifacts.length}`}
                              hint="沿用 analysis handoff 主链"
                            />
                            <InventoryStatCard
                              title="审核文件"
                              value={`${reviewDecisionTemplate.artifacts.length}`}
                              hint="review-decision.md / json"
                            />
                          </div>

                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-emerald-950">
                              <ShieldAlert className="h-4 w-4 text-emerald-700" />
                              <span>职责边界</span>
                            </div>
                            <div className="mt-2 text-xs leading-5 text-emerald-900">
                              运行时事实继续以 aster-rust 的 session / thread /
                              turn 为准，外部分析形状对齐 Codex
                              的交接习惯，但最终是否接受修复、补哪些回归，必须由开发者写入
                              review decision。
                            </div>
                          </div>

                          {reviewDecisionTemplate.verification_summary ? (
                            <HarnessVerificationSummarySection
                              summary={
                                reviewDecisionTemplate.verification_summary
                              }
                            />
                          ) : null}

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-foreground">
                                当前人工审核结论
                              </div>
                              <Badge variant="outline">
                                {formatReviewDecisionStatusLabel(
                                  reviewDecisionTemplate.decision
                                    .decision_status ||
                                    reviewDecisionTemplate.default_decision_status,
                                )}
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                              <div>
                                审核人：
                                <span className="ml-1 text-foreground">
                                  {reviewDecisionTemplate.decision
                                    .human_reviewer || "待填写"}
                                </span>
                              </div>
                              <div>
                                审核时间：
                                <span className="ml-1 text-foreground">
                                  {reviewDecisionTemplate.decision.reviewed_at
                                    ? formatIsoDateTime(
                                        reviewDecisionTemplate.decision
                                          .reviewed_at,
                                      )
                                    : "待填写"}
                                </span>
                              </div>
                              <div>
                                风险等级：
                                <span className="ml-1 text-foreground">
                                  {formatReviewDecisionRiskLevelLabel(
                                    reviewDecisionTemplate.decision.risk_level,
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                              <div>
                                <div className="font-medium text-foreground">
                                  决策摘要
                                </div>
                                <div className="mt-1 whitespace-pre-wrap">
                                  {reviewDecisionTemplate.decision
                                    .decision_summary || "尚未填写决策摘要。"}
                                </div>
                              </div>
                              <div>
                                <div className="font-medium text-foreground">
                                  采用的修复策略
                                </div>
                                <div className="mt-1 whitespace-pre-wrap">
                                  {reviewDecisionTemplate.decision
                                    .chosen_fix_strategy ||
                                    "尚未填写修复策略。"}
                                </div>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <div className="font-medium text-foreground">
                                    回归要求
                                  </div>
                                  <div className="mt-1 space-y-1">
                                    {reviewDecisionTemplate.decision
                                      .regression_requirements.length > 0 ? (
                                      reviewDecisionTemplate.decision.regression_requirements.map(
                                        (item) => (
                                          <div key={item}>- {item}</div>
                                        ),
                                      )
                                    ) : (
                                      <div>尚未填写回归要求。</div>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <div className="font-medium text-foreground">
                                    后续动作
                                  </div>
                                  <div className="mt-1 space-y-1">
                                    {reviewDecisionTemplate.decision
                                      .followup_actions.length > 0 ? (
                                      reviewDecisionTemplate.decision.followup_actions.map(
                                        (item) => (
                                          <div key={item}>- {item}</div>
                                        ),
                                      )
                                    ) : (
                                      <div>尚未填写后续动作。</div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {reviewDecisionTemplate.decision.notes ? (
                                <div>
                                  <div className="font-medium text-foreground">
                                    审核备注
                                  </div>
                                  <div className="mt-1 whitespace-pre-wrap">
                                    {reviewDecisionTemplate.decision.notes}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <FolderOpen className="h-4 w-4 text-muted-foreground" />
                              <span>审核目录</span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>
                                相对路径：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {reviewDecisionTemplate.review_relative_root}
                                </span>
                              </div>
                              <div>
                                绝对路径：
                                <PathTextLink
                                  path={
                                    reviewDecisionTemplate.review_absolute_root
                                  }
                                  className="ml-1"
                                  onOpenPath={handleOpenPathValue}
                                />
                              </div>
                              <div>
                                关联 analysis：
                                <span className="ml-1 break-all font-mono text-foreground">
                                  {
                                    reviewDecisionTemplate.analysis_relative_root
                                  }
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-background p-3">
                            <div className="text-sm font-medium text-foreground">
                              人工审核清单
                            </div>
                            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                              {reviewDecisionTemplate.review_checklist.map(
                                (item) => (
                                  <div
                                    key={item}
                                    className="rounded-lg border border-dashed border-border px-3 py-2"
                                  >
                                    {item}
                                  </div>
                                ),
                              )}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="text-sm font-medium text-foreground">
                              关联分析文件
                            </div>
                            {reviewDecisionTemplate.analysis_artifacts.map(
                              (artifact) => {
                                const sizeLabel = formatSize(artifact.bytes);
                                return (
                                  <div
                                    key={artifact.absolute_path}
                                    className="rounded-xl border border-border bg-background p-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <FileText className="h-4 w-4 text-muted-foreground" />
                                          <span className="text-sm font-medium text-foreground">
                                            {artifact.title}
                                          </span>
                                          <Badge variant="outline">
                                            {formatAnalysisArtifactKindLabel(
                                              artifact.kind,
                                            )}
                                          </Badge>
                                          {sizeLabel ? (
                                            <Badge variant="secondary">
                                              {sizeLabel}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <div className="mt-2 text-xs text-muted-foreground">
                                          <div>
                                            相对路径：
                                            <span className="ml-1 break-all font-mono text-foreground">
                                              {artifact.relative_path}
                                            </span>
                                          </div>
                                          <div className="mt-1">
                                            绝对路径：
                                            <PathTextLink
                                              path={artifact.absolute_path}
                                              className="ml-1"
                                              onOpenPath={handleOpenPathValue}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="gap-2"
                                          aria-label={`预览关联分析文件：${artifact.title}`}
                                          onClick={() =>
                                            void openPreview({
                                              title: artifact.title,
                                              description: `关联分析文件 · ${formatAnalysisArtifactKindLabel(
                                                artifact.kind,
                                              )}`,
                                              path: artifact.absolute_path,
                                            })
                                          }
                                        >
                                          <Eye className="h-4 w-4" />
                                          预览
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          className="gap-2"
                                          aria-label={`系统打开关联分析文件：${artifact.absolute_path}`}
                                          onClick={() =>
                                            void handleOpenPathValue(
                                              artifact.absolute_path,
                                            )
                                          }
                                        >
                                          <FolderOpen className="h-4 w-4" />
                                          打开
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>

                          <div className="space-y-3">
                            <div className="text-sm font-medium text-foreground">
                              审核记录模板文件
                            </div>
                            {reviewDecisionTemplate.artifacts.map(
                              (artifact) => {
                                const sizeLabel = formatSize(artifact.bytes);
                                return (
                                  <div
                                    key={artifact.absolute_path}
                                    className="rounded-xl border border-border bg-background p-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <FileText className="h-4 w-4 text-muted-foreground" />
                                          <span className="text-sm font-medium text-foreground">
                                            {artifact.title}
                                          </span>
                                          <Badge variant="outline">
                                            {formatReviewDecisionArtifactKindLabel(
                                              artifact.kind,
                                            )}
                                          </Badge>
                                          {sizeLabel ? (
                                            <Badge variant="secondary">
                                              {sizeLabel}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <div className="mt-2 text-xs text-muted-foreground">
                                          <div>
                                            相对路径：
                                            <span className="ml-1 break-all font-mono text-foreground">
                                              {artifact.relative_path}
                                            </span>
                                          </div>
                                          <div className="mt-1">
                                            绝对路径：
                                            <PathTextLink
                                              path={artifact.absolute_path}
                                              className="ml-1"
                                              onOpenPath={handleOpenPathValue}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="gap-2"
                                          aria-label={`预览人工审核文件：${artifact.title}`}
                                          onClick={() =>
                                            void openPreview({
                                              title: artifact.title,
                                              description: `人工审核记录 · ${formatReviewDecisionArtifactKindLabel(
                                                artifact.kind,
                                              )}`,
                                              path: artifact.absolute_path,
                                            })
                                          }
                                        >
                                          <Eye className="h-4 w-4" />
                                          预览
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          className="gap-2"
                                          aria-label={`系统打开人工审核文件：${artifact.absolute_path}`}
                                          onClick={() =>
                                            void handleOpenPathValue(
                                              artifact.absolute_path,
                                            )
                                          }
                                        >
                                          <FolderOpen className="h-4 w-4" />
                                          打开
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                          尚未导出人工审核记录。建议在外部 AI 完成诊断后立刻导出
                          `review-decision.md/json`，把接受、延后、拒绝和回归要求回挂到工作区，
                          而不是散落在聊天窗口或临时笔记里。
                        </div>
                      )}
                    </div>
                  </div>
                </Section>
              ) : null}

              {threadReliabilityView.shouldRender ? (
                <Section
                  sectionKey="reliability"
                  title="线程可靠性"
                  badge={threadReliabilityView.statusLabel}
                  registerRef={registerSectionRef}
                >
                  <AgentThreadReliabilityPanel
                    className="mb-0 border-border bg-background shadow-none"
                    threadRead={threadRead}
                    turns={turns}
                    threadItems={threadItems}
                    currentTurnId={currentTurnId}
                    pendingActions={pendingActions}
                    submittedActionsInFlight={submittedActionsInFlight}
                    queuedTurns={queuedTurns}
                    canInterrupt={canInterrupt}
                    onInterruptCurrentTurn={onInterruptCurrentTurn}
                    onResumeThread={onResumeThread}
                    onReplayPendingRequest={onReplayPendingRequest}
                    onPromoteQueuedTurn={onPromoteQueuedTurn}
                    onOpenMemoryWorkbench={onOpenMemoryWorkbench}
                    harnessState={harnessState}
                    messages={messages}
                    teamMemorySnapshot={teamMemorySnapshot}
                    diagnosticRuntimeContext={diagnosticRuntimeContext}
                  />
                </Section>
              ) : null}

              {runtimeFactSummary ? (
                <Section
                  sectionKey="runtime-facts"
                  title="运行时事实"
                  badge="current"
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-4">
                    {runtimeFactSummary.decisionReason ? (
                      <div className="text-sm text-slate-700">
                        <span className="font-medium text-foreground">
                          决策原因：
                        </span>
                        {runtimeFactSummary.decisionReason}
                      </div>
                    ) : null}

                    {runtimeFactSummary.fallbackChain.length > 0 ? (
                      <div className="text-sm text-slate-700">
                        <span className="font-medium text-foreground">
                          回退链：
                        </span>
                        {runtimeFactSummary.fallbackChain.join(" → ")}
                      </div>
                    ) : null}

                    {runtimeFactSummary.oemPolicy ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {runtimeFactSummary.oemPolicy.locked ? (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-white text-amber-700"
                            >
                              品牌云端托管锁定
                            </Badge>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.quotaLow ? (
                            <Badge
                              variant="outline"
                              className="border-orange-300 bg-white text-orange-700"
                            >
                              品牌云端额度偏低
                            </Badge>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.canInvoke === false ? (
                            <Badge
                              variant="outline"
                              className="border-rose-300 bg-white text-rose-700"
                            >
                              品牌云端当前不可调用
                            </Badge>
                          ) : null}
                          {runtimeFactSummary.oemPolicy
                            .fallbackToLocalAllowed === true ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-300 bg-white text-emerald-700"
                            >
                              允许回退本地
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {runtimeFactSummary.oemPolicy.defaultModel ||
                          runtimeFactSummary.oemPolicy.selectedModel ? (
                            <span>
                              品牌云端模型{" "}
                              {runtimeFactSummary.oemPolicy.defaultModel ||
                                runtimeFactSummary.oemPolicy.selectedModel}
                            </span>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.quotaStatus ? (
                            <span>
                              额度状态{" "}
                              {runtimeFactSummary.oemPolicy.quotaStatus}
                            </span>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.offerState ? (
                            <span>
                              策略状态 {runtimeFactSummary.oemPolicy.offerState}
                            </span>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.providerSource ? (
                            <span>
                              来源 {runtimeFactSummary.oemPolicy.providerSource}
                            </span>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.providerKey ? (
                            <span>
                              Provider Key{" "}
                              {runtimeFactSummary.oemPolicy.providerKey}
                            </span>
                          ) : null}
                          {runtimeFactSummary.oemPolicy.tenantId ? (
                            <span>
                              租户 {runtimeFactSummary.oemPolicy.tenantId}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {harnessState.activeFileWrites.length > 0 ? (
                <Section
                  sectionKey="writes"
                  title="当前文件写入"
                  badge={`${harnessState.activeFileWrites.length} 条`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {harnessState.activeFileWrites.map((write) => (
                      <button
                        key={write.id}
                        type="button"
                        className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                        onClick={() =>
                          void openPreview({
                            title: write.displayName,
                            description: getActiveWriteDescription(write),
                            path: write.path,
                            content: write.content,
                            preview: write.preview || write.latestChunk,
                          })
                        }
                        aria-label={`查看文件写入：${write.displayName}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate text-sm font-medium text-foreground">
                                {write.displayName}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {getActiveWriteDescription(write)}
                            </div>
                            <PathTextLink
                              path={write.path}
                              className="mt-1 text-xs"
                              stopPropagation={true}
                              onOpenPath={handleOpenPathValue}
                            />
                          </div>
                          <Badge variant="outline">
                            {formatArtifactWritePhaseLabel(write.phase)}
                          </Badge>
                        </div>
                        {write.preview || write.latestChunk ? (
                          <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                            <InteractiveText
                              text={write.preview || write.latestChunk}
                              mono={true}
                              stopPropagation={true}
                              onOpenUrl={handleOpenExternalLink}
                            />
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            正在准备文件内容...
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </Section>
              ) : null}

              {harnessState.outputSignals.length > 0 ? (
                <Section
                  sectionKey="outputs"
                  title="工具输出"
                  badge={
                    filteredOutputSignals.length ===
                    harnessState.outputSignals.length
                      ? `${harnessState.outputSignals.length} 条`
                      : `${filteredOutputSignals.length} / ${harnessState.outputSignals.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {outputFilterOptions.map((option) => {
                        const count =
                          option.value === "all"
                            ? harnessState.outputSignals.length
                            : harnessState.outputSignals.filter((signal) =>
                                matchesOutputFilter(signal, option.value),
                              ).length;
                        const active = option.value === outputFilter;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              active
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                            onClick={() => setOutputFilter(option.value)}
                            aria-pressed={active}
                            aria-label={`工具输出筛选：${option.label}`}
                          >
                            {option.label} {count}
                          </button>
                        );
                      })}
                    </div>
                    {filteredOutputSignals.length > 0 ? (
                      groupedOutputEntries.map((entry) => {
                        if (entry.type === "search_batch") {
                          if (entry.signals.length === 1) {
                            const signal = entry.signals[0];
                            return (
                              <SearchOutputCard
                                key={signal.id}
                                signal={signal}
                                onOpenUrl={handleOpenExternalLink}
                                onOpenDetail={() =>
                                  void openPreview({
                                    title: signal.title,
                                    description: signal.summary,
                                    path: getSignalPath(signal),
                                    content: signal.content,
                                    preview: signal.preview,
                                  })
                                }
                              />
                            );
                          }

                          return (
                            <SearchOutputBatchCard
                              key={entry.signals
                                .map((signal) => signal.id)
                                .join("|")}
                              signals={entry.signals}
                              onOpenUrl={handleOpenExternalLink}
                              onOpenDetail={(signal) =>
                                void openPreview({
                                  title: signal.title,
                                  description: signal.summary,
                                  path: getSignalPath(signal),
                                  content: signal.content,
                                  preview: signal.preview,
                                })
                              }
                            />
                          );
                        }

                        const signal = entry.signal;
                        const signalPath = getSignalPath(signal);
                        const signalUrl = findFirstUrl(
                          signal.summary,
                          signal.content,
                          signal.preview,
                          signal.title,
                        );
                        const canOpenPreview = Boolean(
                          signalPath || signal.content || signal.preview,
                        );
                        const canOpenUrl =
                          !canOpenPreview && Boolean(signalUrl);

                        return (
                          <button
                            key={signal.id}
                            type="button"
                            className={cn(
                              "w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60",
                              !canOpenPreview &&
                                !canOpenUrl &&
                                "cursor-default",
                            )}
                            onClick={() =>
                              canOpenPreview
                                ? void openPreview({
                                    title: signal.title,
                                    description: signal.summary,
                                    path: signalPath,
                                    content: signal.content,
                                    preview: signal.preview,
                                  })
                                : signalUrl
                                  ? void handleOpenExternalLink(signalUrl)
                                  : undefined
                            }
                            aria-label={`查看工具输出：${signal.title}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {signal.title}
                                  </span>
                                </div>
                                <InteractiveText
                                  text={signal.summary}
                                  className="mt-1 text-xs text-muted-foreground"
                                  stopPropagation={true}
                                  onOpenUrl={handleOpenExternalLink}
                                />
                                <PathTextLink
                                  path={signalPath}
                                  className="mt-1 text-xs"
                                  stopPropagation={true}
                                  onOpenPath={handleOpenPathValue}
                                />
                              </div>
                              <Badge variant="outline">
                                {resolveFriendlyToolLabel(signal.toolName) ||
                                  signal.toolName}
                              </Badge>
                            </div>
                            {signal.preview ? (
                              <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                <InteractiveText
                                  text={signal.preview}
                                  mono={true}
                                  stopPropagation={true}
                                  onOpenUrl={handleOpenExternalLink}
                                />
                              </div>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前筛选条件下暂无记录。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {hasToolInventorySection ? (
                <Section
                  sectionKey="inventory"
                  title="工具与权限"
                  badge={
                    toolInventoryLoading
                      ? "读取中"
                      : toolInventory
                        ? `runtime ${runtimeToolVisibleTotal}/${runtimeToolTotal}`
                        : toolInventoryError
                          ? "读取失败"
                          : "待同步"
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        {toolInventory ? (
                          <>
                            <Badge variant="secondary">
                              caller：{toolInventory.request?.caller || "未知"}
                            </Badge>
                            <Badge variant="outline">
                              工作台：
                              {toolInventory.request?.surface?.workbench
                                ? "开启"
                                : "关闭"}
                            </Badge>
                            <Badge variant="outline">
                              Browser Assist：
                              {toolInventory.request?.surface?.browser_assist
                                ? "开启"
                                : "关闭"}
                            </Badge>
                            <Badge variant="outline">
                              默认允许：
                              {toolInventory.counts.default_allowed_total}
                            </Badge>
                          </>
                        ) : (
                          <Badge variant="outline">等待工具库存</Badge>
                        )}
                      </div>
                      {onRefreshToolInventory ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          aria-label="刷新工具库存"
                          onClick={onRefreshToolInventory}
                        >
                          {toolInventoryLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Wrench className="h-4 w-4" />
                          )}
                          刷新库存
                        </Button>
                      ) : null}
                    </div>

                    {toolInventoryLoading ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在读取当前工具库存与权限策略...
                      </div>
                    ) : null}

                    {toolInventoryError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                        {toolInventoryError}
                      </div>
                    ) : null}

                    {toolInventory ? (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                          <InventoryStatCard
                            title="Runtime"
                            value={`${runtimeToolVisibleTotal}`}
                            hint={`可见 / 总数 ${runtimeToolVisibleTotal} / ${runtimeToolTotal}`}
                          />
                          <InventoryStatCard
                            title="Catalog"
                            value={`${toolInventory.counts.catalog_total}`}
                            hint={`现役 ${toolInventory.counts.catalog_current_total} · 兼容 ${toolInventory.counts.catalog_compat_total}`}
                          />
                          <InventoryStatCard
                            title="Registry"
                            value={`${toolInventory.counts.registry_visible_total}`}
                            hint={`可见 / 总数 ${toolInventory.counts.registry_visible_total} / ${toolInventory.counts.registry_total}`}
                          />
                          <InventoryStatCard
                            title="Extension"
                            value={`${toolInventory.counts.extension_tool_visible_total}`}
                            hint={`可见 / 总数 ${toolInventory.counts.extension_tool_visible_total} / ${toolInventory.counts.extension_tool_total}`}
                          />
                          <InventoryStatCard
                            title="MCP"
                            value={`${toolInventory.counts.mcp_tool_visible_total}`}
                            hint={`服务 ${toolInventory.counts.mcp_server_total} · 工具 ${toolInventory.counts.mcp_tool_total}`}
                          />
                        </div>

                        <div className="grid gap-2 sm:grid-cols-3">
                          {(
                            [
                              ["default", "默认策略"],
                              ["persisted", "持久化覆盖"],
                              ["runtime", "运行时覆盖"],
                            ] as Array<[AgentToolExecutionPolicySource, string]>
                          ).map(([source, label]) => (
                            <InventoryStatCard
                              key={source}
                              title={label}
                              value={`${toolInventorySourceStats[source]}`}
                              hint="按 warning / restriction / sandbox 三字段累计"
                            />
                          ))}
                        </div>

                        {toolInventoryWarnings.length > 0 ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                            <div className="text-sm font-medium text-amber-900">
                              库存告警
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-amber-800">
                              {toolInventoryWarnings.map((warning, index) => (
                                <div key={`${warning}-${index}`}>{warning}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {toolInventory ? (
                          <div
                            className="space-y-3"
                            data-testid="harness-runtime-tool-capability-summary"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-foreground">
                                Runtime 能力摘要
                              </div>
                              <Badge
                                variant={
                                  runtimeToolAvailability.known
                                    ? "secondary"
                                    : "outline"
                                }
                                data-testid="harness-runtime-tool-capability-source"
                              >
                                {runtimeToolAvailability.known
                                  ? `来源 ${formatRuntimeToolAvailabilitySourceLabel(
                                      runtimeToolAvailability.source,
                                    )}`
                                  : "Runtime 工具面未就绪"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge
                                variant={
                                  runtimeToolAvailability.webSearch
                                    ? "secondary"
                                    : "outline"
                                }
                                data-testid="harness-runtime-tool-capability-web-search"
                              >
                                {runtimeToolAvailability.webSearch
                                  ? "WebSearch 已接通"
                                  : "WebSearch 未接通"}
                              </Badge>
                              <Badge
                                variant={
                                  runtimeToolAvailability.subagentCore
                                    ? "secondary"
                                    : "outline"
                                }
                                data-testid="harness-runtime-tool-capability-subagent-core"
                              >
                                {runtimeToolAvailability.subagentCore
                                  ? "子任务核心 tools 已接通"
                                  : `子任务核心 tools 缺 ${runtimeToolAvailability.missingSubagentCoreTools.length} 项`}
                              </Badge>
                              <Badge
                                variant={
                                  runtimeToolAvailability.subagentTeamTools
                                    ? "secondary"
                                    : "outline"
                                }
                                data-testid="harness-runtime-tool-capability-team"
                              >
                                {runtimeToolAvailability.subagentTeamTools
                                  ? "Team current tools 已接通"
                                  : `Team current tools 缺 ${runtimeToolAvailability.missingSubagentTeamTools.length} 项`}
                              </Badge>
                              <Badge
                                variant={
                                  runtimeToolAvailability.taskRuntime
                                    ? "secondary"
                                    : "outline"
                                }
                                data-testid="harness-runtime-tool-capability-task"
                              >
                                {runtimeToolAvailability.taskRuntime
                                  ? "Task current tools 已接通"
                                  : `Task current tools 缺 ${runtimeToolAvailability.missingTaskTools.length} 项`}
                              </Badge>
                            </div>
                            {runtimeToolAvailability.known ? (
                              runtimeToolCapabilityGaps.length > 0 ? (
                                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                                  <div className="font-medium text-foreground">
                                    当前 runtime current surface 仍有缺口
                                  </div>
                                  <div className="mt-2 space-y-2">
                                    {runtimeToolCapabilityGaps.map((gap) => (
                                      <div key={gap.key}>
                                        <span className="font-medium text-foreground">
                                          {gap.title}
                                        </span>
                                        <span>：</span>
                                        <span>{gap.missing.join(" / ")}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3 text-sm text-emerald-900">
                                  当前 runtime current surface 已覆盖
                                  WebSearch、子任务、Team 与 Task 主链。
                                </div>
                              )
                            ) : (
                              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                                当前 inventory 尚未提供可用 runtime tool
                                surface，暂时只能回看 registry/raw inventory。
                              </div>
                            )}
                          </div>
                        ) : null}

                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium text-foreground">
                              实际 Runtime 工具面
                            </div>
                            <Badge variant="secondary">
                              {runtimeToolVisibleTotal} / {runtimeToolTotal}
                            </Badge>
                          </div>
                          {toolInventoryRuntimeTools.length > 0 ? (
                            toolInventoryRuntimeTools.map((entry) => (
                              <div
                                key={`${entry.source_kind}:${entry.name}`}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">
                                    {entry.name}
                                  </span>
                                  <Badge variant="outline">
                                    {formatRuntimeToolSourceKindLabel(
                                      entry.source_kind,
                                    )}
                                  </Badge>
                                  {entry.source_label ? (
                                    <Badge variant="outline">
                                      {entry.source_label}
                                    </Badge>
                                  ) : null}
                                  {entry.status ? (
                                    <Badge variant="outline">
                                      {entry.status}
                                    </Badge>
                                  ) : null}
                                  {entry.visible_in_context ? (
                                    <Badge variant="secondary">
                                      上下文可见
                                    </Badge>
                                  ) : null}
                                  {entry.deferred_loading ? (
                                    <Badge variant="outline">Deferred</Badge>
                                  ) : null}
                                  {!entry.caller_allowed ? (
                                    <Badge variant="destructive">
                                      Caller 拒绝
                                    </Badge>
                                  ) : null}
                                  {entry.catalog_entry_name ? (
                                    <Badge variant="outline">
                                      映射 {entry.catalog_entry_name}
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {entry.description}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {entry.allowed_callers.length > 0 ? (
                                    <Badge variant="outline">
                                      callers：
                                      {entry.allowed_callers.join(", ")}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">
                                      callers：全部
                                    </Badge>
                                  )}
                                  {entry.always_visible ? (
                                    <Badge variant="outline">
                                      Always Visible
                                    </Badge>
                                  ) : null}
                                  <Badge variant="outline">
                                    input_examples：
                                    {entry.input_examples_count}
                                  </Badge>
                                  {entry.tags.map((tag) => (
                                    <Badge
                                      key={`${entry.name}-${entry.source_kind}-${tag}`}
                                      variant="outline"
                                    >
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                              当前尚未构建统一 runtime 工具面。
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium text-foreground">
                              Catalog 工具
                            </div>
                            <Badge variant="secondary">
                              {filteredCatalogTools.length} /{" "}
                              {toolInventoryCatalogTools.length}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { value: "all" as const, label: "全部" },
                              {
                                value: "runtime" as const,
                                label: "运行时覆盖",
                              },
                              {
                                value: "persisted" as const,
                                label: "持久化覆盖",
                              },
                              { value: "default" as const, label: "纯默认" },
                            ].map((option) => {
                              const active =
                                option.value === toolInventoryFilter;
                              const count = countCatalogToolsByInventoryFilter(
                                toolInventoryCatalogTools,
                                option.value,
                              );

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  className={cn(
                                    "rounded-full border px-3 py-1 text-xs transition-colors",
                                    active
                                      ? "border-primary bg-primary/10 text-foreground"
                                      : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                  )}
                                  onClick={() =>
                                    setToolInventoryFilter(option.value)
                                  }
                                  aria-pressed={active}
                                  aria-label={`工具库存筛选：${option.label}`}
                                >
                                  {option.label} {count}
                                </button>
                              );
                            })}
                          </div>

                          {filteredCatalogTools.length > 0 ? (
                            filteredCatalogTools.map((entry) => (
                              <div
                                key={entry.name}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-medium text-foreground">
                                        {entry.name}
                                      </span>
                                      <Badge variant="outline">
                                        {formatToolLifecycleLabel(
                                          entry.lifecycle,
                                        )}
                                      </Badge>
                                      <Badge variant="outline">
                                        {formatToolSourceKindLabel(
                                          entry.source,
                                        )}
                                      </Badge>
                                      <Badge variant="outline">
                                        {formatToolPermissionPlaneLabel(
                                          entry.permission_plane,
                                        )}
                                      </Badge>
                                      {entry.workspace_default_allow ? (
                                        <Badge variant="secondary">
                                          默认允许
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                      {entry.profiles.map((profile) => (
                                        <Badge
                                          key={`${entry.name}-${profile}`}
                                          variant="outline"
                                        >
                                          {profile}
                                        </Badge>
                                      ))}
                                      {entry.capabilities.map((capability) => (
                                        <Badge
                                          key={`${entry.name}-${capability}`}
                                          variant="outline"
                                        >
                                          {capability}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-3 grid gap-2 xl:grid-cols-3">
                                  <div className="rounded-lg bg-muted/50 p-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Warning
                                    </div>
                                    <div className="mt-1 text-sm text-foreground">
                                      {formatExecutionWarningPolicyLabel(
                                        entry.execution_warning_policy,
                                      )}
                                    </div>
                                    <div className="mt-2">
                                      <Badge
                                        variant={resolveExecutionSourceVariant(
                                          entry.execution_warning_policy_source,
                                        )}
                                      >
                                        {formatExecutionSourceLabel(
                                          entry.execution_warning_policy_source,
                                        )}
                                      </Badge>
                                    </div>
                                  </div>
                                  <div className="rounded-lg bg-muted/50 p-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Restriction
                                    </div>
                                    <div className="mt-1 text-sm text-foreground">
                                      {formatExecutionRestrictionProfileLabel(
                                        entry.execution_restriction_profile,
                                      )}
                                    </div>
                                    <div className="mt-2">
                                      <Badge
                                        variant={resolveExecutionSourceVariant(
                                          entry.execution_restriction_profile_source,
                                        )}
                                      >
                                        {formatExecutionSourceLabel(
                                          entry.execution_restriction_profile_source,
                                        )}
                                      </Badge>
                                    </div>
                                  </div>
                                  <div className="rounded-lg bg-muted/50 p-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Sandbox
                                    </div>
                                    <div className="mt-1 text-sm text-foreground">
                                      {formatExecutionSandboxProfileLabel(
                                        entry.execution_sandbox_profile,
                                      )}
                                    </div>
                                    <div className="mt-2">
                                      <Badge
                                        variant={resolveExecutionSourceVariant(
                                          entry.execution_sandbox_profile_source,
                                        )}
                                      >
                                        {formatExecutionSourceLabel(
                                          entry.execution_sandbox_profile_source,
                                        )}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                              当前筛选条件下暂无 catalog 工具。
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="text-sm font-medium text-foreground">
                            Runtime Registry
                          </div>
                          {toolInventoryRegistryTools.length > 0 ? (
                            toolInventoryRegistryTools.map((entry) => (
                              <div
                                key={entry.name}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-medium text-foreground">
                                        {entry.name}
                                      </span>
                                      {entry.catalog_entry_name ? (
                                        <Badge variant="outline">
                                          映射 {entry.catalog_entry_name}
                                        </Badge>
                                      ) : (
                                        <Badge variant="destructive">
                                          未映射 catalog
                                        </Badge>
                                      )}
                                      {entry.visible_in_context ? (
                                        <Badge variant="secondary">
                                          上下文可见
                                        </Badge>
                                      ) : null}
                                      {entry.deferred_loading ? (
                                        <Badge variant="outline">
                                          Deferred
                                        </Badge>
                                      ) : null}
                                      {!entry.caller_allowed ? (
                                        <Badge variant="destructive">
                                          Caller 拒绝
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {entry.description}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                      {entry.allowed_callers.length > 0 ? (
                                        <Badge variant="outline">
                                          callers：
                                          {entry.allowed_callers.join(", ")}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline">
                                          callers：全部
                                        </Badge>
                                      )}
                                      {entry.tags.map((tag) => (
                                        <Badge
                                          key={`${entry.name}-${tag}`}
                                          variant="outline"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                      <Badge variant="outline">
                                        input_examples：
                                        {entry.input_examples_count}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>

                                {collectRegistryExecutionSources(entry).length >
                                0 ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {entry.catalog_execution_warning_policy &&
                                    entry.catalog_execution_warning_policy_source ? (
                                      <Badge
                                        variant={resolveExecutionSourceVariant(
                                          entry.catalog_execution_warning_policy_source,
                                        )}
                                      >
                                        Warning：
                                        {formatExecutionSourceLabel(
                                          entry.catalog_execution_warning_policy_source,
                                        )}
                                      </Badge>
                                    ) : null}
                                    {entry.catalog_execution_restriction_profile &&
                                    entry.catalog_execution_restriction_profile_source ? (
                                      <Badge
                                        variant={resolveExecutionSourceVariant(
                                          entry.catalog_execution_restriction_profile_source,
                                        )}
                                      >
                                        Restriction：
                                        {formatExecutionSourceLabel(
                                          entry.catalog_execution_restriction_profile_source,
                                        )}
                                      </Badge>
                                    ) : null}
                                    {entry.catalog_execution_sandbox_profile &&
                                    entry.catalog_execution_sandbox_profile_source ? (
                                      <Badge
                                        variant={resolveExecutionSourceVariant(
                                          entry.catalog_execution_sandbox_profile_source,
                                        )}
                                      >
                                        Sandbox：
                                        {formatExecutionSourceLabel(
                                          entry.catalog_execution_sandbox_profile_source,
                                        )}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                              当前 runtime registry 为空。
                            </div>
                          )}
                        </div>

                        {toolInventoryExtensionSurfaces.length > 0 ? (
                          <div className="space-y-3">
                            <div className="text-sm font-medium text-foreground">
                              Extension Surfaces
                            </div>
                            {toolInventoryExtensionSurfaces.map((entry) => (
                              <div
                                key={entry.extension_name}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">
                                    {entry.extension_name}
                                  </span>
                                  <Badge variant="outline">
                                    {formatExtensionSourceKindLabel(
                                      entry.source_kind,
                                    )}
                                  </Badge>
                                  {entry.deferred_loading ? (
                                    <Badge variant="outline">Deferred</Badge>
                                  ) : null}
                                  {entry.allowed_caller ? (
                                    <Badge variant="secondary">
                                      caller：{entry.allowed_caller}
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {entry.description}
                                </div>
                                <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                                  <div>
                                    可用工具：{entry.available_tools.length}
                                  </div>
                                  <div>
                                    常驻工具：{entry.always_expose_tools.length}
                                  </div>
                                  <div>已加载：{entry.loaded_tools.length}</div>
                                  <div>
                                    可搜索：{entry.searchable_tools.length}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {toolInventoryExtensionTools.length > 0 ? (
                          <div className="space-y-3">
                            <div className="text-sm font-medium text-foreground">
                              Extension Tools
                            </div>
                            {toolInventoryExtensionTools.map((entry) => (
                              <div
                                key={entry.name}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">
                                    {entry.name}
                                  </span>
                                  <Badge variant="outline">
                                    {entry.status}
                                  </Badge>
                                  <Badge variant="outline">
                                    {formatExtensionSourceKindLabel(
                                      entry.source_kind,
                                    )}
                                  </Badge>
                                  {entry.visible_in_context ? (
                                    <Badge variant="secondary">
                                      上下文可见
                                    </Badge>
                                  ) : null}
                                  {!entry.caller_allowed ? (
                                    <Badge variant="destructive">
                                      Caller 拒绝
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {entry.extension_name ? (
                                    <Badge variant="outline">
                                      extension：{entry.extension_name}
                                    </Badge>
                                  ) : null}
                                  {entry.allowed_caller ? (
                                    <Badge variant="outline">
                                      caller：{entry.allowed_caller}
                                    </Badge>
                                  ) : null}
                                  {entry.deferred_loading ? (
                                    <Badge variant="outline">Deferred</Badge>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {entry.description}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {toolInventoryMcpTools.length > 0 ? (
                          <div className="space-y-3">
                            <div className="text-sm font-medium text-foreground">
                              MCP Tools
                            </div>
                            {toolInventoryMcpTools.map((entry) => (
                              <div
                                key={`${entry.server_name}:${entry.name}`}
                                className="rounded-xl border border-border bg-background p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">
                                    {getMcpInnerToolName(
                                      entry.name,
                                      entry.server_name,
                                    )}
                                  </span>
                                  <Badge variant="outline">
                                    {entry.server_name}
                                  </Badge>
                                  {entry.visible_in_context ? (
                                    <Badge variant="secondary">
                                      上下文可见
                                    </Badge>
                                  ) : null}
                                  {entry.always_visible ? (
                                    <Badge variant="outline">
                                      Always Visible
                                    </Badge>
                                  ) : null}
                                  {entry.deferred_loading ? (
                                    <Badge variant="outline">Deferred</Badge>
                                  ) : null}
                                  {!entry.caller_allowed ? (
                                    <Badge variant="destructive">
                                      Caller 拒绝
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {entry.description}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {entry.allowed_callers.length > 0 ? (
                                    <Badge variant="outline">
                                      callers：
                                      {entry.allowed_callers.join(", ")}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">
                                      callers：全部
                                    </Badge>
                                  )}
                                  {entry.tags.map((tag) => (
                                    <Badge
                                      key={`${entry.server_name}:${entry.name}:${tag}`}
                                      variant="outline"
                                    >
                                      {tag}
                                    </Badge>
                                  ))}
                                  <Badge variant="outline">
                                    input_examples：
                                    {entry.input_examples_count}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : !toolInventoryLoading && !toolInventoryError ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前尚未拿到工具库存快照。
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {harnessState.pendingApprovals.length > 0 ? (
                <Section
                  sectionKey="approvals"
                  title="待处理审批"
                  badge={`${harnessState.pendingApprovals.length} 条`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {harnessState.pendingApprovals.map((item) => (
                      <div
                        key={item.requestId}
                        className="rounded-xl border border-amber-200 bg-amber-50/80 p-3"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                          <ShieldAlert className="h-4 w-4" />
                          <InteractiveText
                            text={item.prompt || "等待用户确认"}
                            className="text-sm"
                            onOpenUrl={handleOpenExternalLink}
                          />
                        </div>
                        {describeApproval(item) ? (
                          <InteractiveText
                            text={describeApproval(item)}
                            className="mt-2 text-xs text-amber-800"
                            onOpenUrl={handleOpenExternalLink}
                          />
                        ) : null}
                        <div className="mt-2 text-xs text-amber-700">
                          请求 ID：{item.requestId}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {harnessState.recentFileEvents.length > 0 ? (
                <Section
                  sectionKey="files"
                  title="最近文件活动"
                  badge={
                    fileDisplayMode === "grouped"
                      ? `${groupedFileEvents.length} 个文件 / ${filteredFileEvents.length} 条`
                      : filteredFileEvents.length ===
                          harnessState.recentFileEvents.length
                        ? `${harnessState.recentFileEvents.length} 条`
                        : `${filteredFileEvents.length} / ${harnessState.recentFileEvents.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        {fileFilterOptions.map((option) => {
                          const count =
                            option.value === "all"
                              ? harnessState.recentFileEvents.length
                              : harnessState.recentFileEvents.filter(
                                  (event) => event.kind === option.value,
                                ).length;
                          const active = option.value === fileFilter;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                              onClick={() => setFileFilter(option.value)}
                              aria-pressed={active}
                              aria-label={`文件活动筛选：${option.label}`}
                            >
                              {option.label} {count}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "timeline" as const, label: "时间流" },
                          { value: "grouped" as const, label: "按文件" },
                        ].map((option) => {
                          const active = option.value === fileDisplayMode;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                              onClick={() => setFileDisplayMode(option.value)}
                              aria-pressed={active}
                              aria-label={`文件视图：${option.label}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {filteredFileEvents.length > 0 ? (
                      fileDisplayMode === "grouped" ? (
                        groupedFileEvents.map((group) => {
                          const latestEvent = group.latestEvent;
                          const Icon = resolveKindIcon(group.kind);
                          return (
                            <button
                              key={group.key}
                              type="button"
                              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                              onClick={() =>
                                void openPreview({
                                  title: latestEvent.displayName,
                                  description: joinDisplayParts([
                                    describeAction(latestEvent.action),
                                    describeKind(group.kind),
                                    resolveFriendlyToolLabel(
                                      latestEvent.sourceToolName,
                                    ) || latestEvent.sourceToolName,
                                  ]),
                                  path: latestEvent.path,
                                  content: latestEvent.content,
                                  preview: latestEvent.preview,
                                })
                              }
                              aria-label={`查看聚合文件活动：${group.displayName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {group.displayName}
                                    </span>
                                  </div>
                                  <PathTextLink
                                    path={group.path}
                                    className="mt-1 text-xs"
                                    stopPropagation={true}
                                    onOpenPath={handleOpenPathValue}
                                  />
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge variant="outline">
                                    {group.count} 次活动
                                  </Badge>
                                  <Badge variant="secondary">
                                    {describeKind(group.kind)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatTime(latestEvent.timestamp)}</span>
                                <span>·</span>
                                <span>
                                  最近 {describeAction(latestEvent.action)}
                                </span>
                                <span>·</span>
                                <span>{group.actionSummary}</span>
                              </div>
                              {latestEvent.preview ? (
                                <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                  <InteractiveText
                                    text={latestEvent.preview}
                                    mono={true}
                                    stopPropagation={true}
                                    onOpenUrl={handleOpenExternalLink}
                                  />
                                </div>
                              ) : null}
                            </button>
                          );
                        })
                      ) : (
                        filteredFileEvents.map((event) => {
                          const Icon = resolveKindIcon(event.kind);
                          return (
                            <button
                              key={event.id}
                              type="button"
                              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                              onClick={() =>
                                void openPreview({
                                  title: event.displayName,
                                  description: joinDisplayParts([
                                    describeAction(event.action),
                                    describeKind(event.kind),
                                    resolveFriendlyToolLabel(
                                      event.sourceToolName,
                                    ) || event.sourceToolName,
                                  ]),
                                  path: event.path,
                                  content: event.content,
                                  preview: event.preview,
                                })
                              }
                              aria-label={`查看文件活动：${event.displayName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {event.displayName}
                                    </span>
                                  </div>
                                  <PathTextLink
                                    path={event.path}
                                    className="mt-1 text-xs"
                                    stopPropagation={true}
                                    onOpenPath={handleOpenPathValue}
                                  />
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge variant="outline">
                                    {describeAction(event.action)}
                                  </Badge>
                                  <Badge variant="secondary">
                                    {describeKind(event.kind)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatTime(event.timestamp)}</span>
                                <span>·</span>
                                <span>
                                  {resolveFriendlyToolLabel(
                                    event.sourceToolName,
                                  ) || event.sourceToolName}
                                </span>
                              </div>
                              {event.preview ? (
                                <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                  <InteractiveText
                                    text={event.preview}
                                    mono={true}
                                    stopPropagation={true}
                                    onOpenUrl={handleOpenExternalLink}
                                  />
                                </div>
                              ) : null}
                            </button>
                          );
                        })
                      )
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前筛选条件下暂无记录。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {harnessState.plan.phase !== "idle" ||
              harnessState.plan.items.length > 0 ? (
                <Section
                  sectionKey="plan"
                  title="规划状态"
                  badge={
                    harnessState.plan.phase === "planning"
                      ? "规划中"
                      : harnessState.plan.phase === "ready"
                        ? "已就绪"
                        : "空闲"
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-2">
                    {harnessState.plan.items.length > 0 ? (
                      harnessState.plan.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                        >
                          <InteractiveText
                            text={item.content}
                            className="min-w-0 text-sm text-foreground"
                            onOpenUrl={handleOpenExternalLink}
                          />
                          <Badge
                            variant={
                              item.status === "completed"
                                ? "secondary"
                                : item.status === "in_progress"
                                  ? "default"
                                  : "outline"
                            }
                          >
                            {item.status === "completed"
                              ? "已完成"
                              : item.status === "in_progress"
                                ? "进行中"
                                : "待开始"}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        {harnessState.plan.summaryText ||
                          "已进入规划流程，但暂无可展示的 Todo 快照。"}
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {realTeamSummary.total > 0 ||
              harnessState.delegatedTasks.length > 0 ? (
                <Section
                  sectionKey="delegation"
                  title="子任务"
                  badge={
                    realTeamSummary.active > 0
                      ? `处理中 ${realTeamSummary.active}`
                      : realTeamSummary.total > 0
                        ? `${realTeamSummary.total} 个子任务`
                        : harnessState.delegatedTasks.length > 0
                          ? `${harnessState.delegatedTasks.length} 条`
                          : undefined
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {realTeamSummary.total > 0 ? (
                      <div className="rounded-xl border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-foreground">
                            当前子任务
                          </div>
                          <Badge variant="outline">
                            {realTeamSummary.total} 个
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>处理中 {realTeamSummary.running}</span>
                          <span>等待中 {realTeamSummary.queued}</span>
                          <span>已完成 {realTeamSummary.settled}</span>
                          <span>需处理 {realTeamSummary.failed}</span>
                        </div>
                      </div>
                    ) : null}

                    {harnessState.delegatedTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-xl border border-border bg-background p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate text-sm font-medium text-foreground">
                                {task.title}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {task.role ? (
                                <span>角色：{task.role}</span>
                              ) : null}
                              {task.taskType ? (
                                <span>类型：{task.taskType}</span>
                              ) : null}
                              {task.model ? (
                                <span>模型：{task.model}</span>
                              ) : null}
                            </div>
                            {task.summary ? (
                              <InteractiveText
                                text={task.summary}
                                className="mt-2 text-xs text-muted-foreground"
                                onOpenUrl={handleOpenExternalLink}
                              />
                            ) : null}
                          </div>
                          <Badge
                            variant={
                              task.status === "completed"
                                ? "secondary"
                                : task.status === "running"
                                  ? "default"
                                  : "destructive"
                            }
                          >
                            {task.status === "completed"
                              ? "已完成"
                              : task.status === "running"
                                ? "处理中"
                                : "失败"}
                          </Badge>
                        </div>
                      </div>
                    ))}

                    {childSubagentSessions.length > 0 ? (
                      <div className="space-y-3">
                        <div className="text-xs font-medium text-muted-foreground">
                          实时子任务
                        </div>
                        {childSubagentSessions.map((session) => (
                          <div
                            key={session.id}
                            className="rounded-xl border border-border bg-background p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <Workflow className="h-4 w-4 text-muted-foreground" />
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {session.name}
                                  </span>
                                  <Badge
                                    variant={resolveSubagentRuntimeStatusVariant(
                                      session.runtime_status,
                                    )}
                                  >
                                    {resolveSubagentRuntimeStatusLabel(
                                      session.runtime_status,
                                    )}
                                  </Badge>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <span>
                                    类型：
                                    {resolveSubagentSessionTypeLabel(
                                      session.session_type,
                                    )}
                                  </span>
                                  {session.role_hint ? (
                                    <span>角色：{session.role_hint}</span>
                                  ) : null}
                                  {session.model ? (
                                    <span>模型：{session.model}</span>
                                  ) : null}
                                  {session.provider_name ? (
                                    <span>提供方：{session.provider_name}</span>
                                  ) : null}
                                  {session.team_parallel_budget !== undefined &&
                                  session.team_active_count !== undefined ? (
                                    <span>
                                      处理窗口：
                                      {session.team_active_count}/
                                      {session.team_parallel_budget}
                                    </span>
                                  ) : null}
                                  {session.provider_parallel_budget === 1 &&
                                  session.provider_concurrency_group ? (
                                    <span>
                                      {resolveTeamWorkspaceStableProcessingLabel()}
                                      ： 当前服务按顺序处理
                                    </span>
                                  ) : null}
                                  {session.origin_tool ? (
                                    <span>
                                      来源：
                                      {resolveFriendlyToolLabel(
                                        session.origin_tool,
                                      ) || session.origin_tool}
                                    </span>
                                  ) : null}
                                  <span>
                                    更新：
                                    {formatUnixTimestamp(session.updated_at)}
                                  </span>
                                </div>
                                {session.task_summary ? (
                                  <InteractiveText
                                    text={session.task_summary}
                                    className="mt-2 text-xs text-muted-foreground"
                                    onOpenUrl={handleOpenExternalLink}
                                  />
                                ) : null}
                                {session.queue_reason ? (
                                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">
                                    {session.queue_reason}
                                  </div>
                                ) : null}
                              </div>
                              {onOpenSubagentSession ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    onOpenSubagentSession(session.id)
                                  }
                                >
                                  查看详情
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {harnessState.latestContextTrace.length > 0 ? (
                <Section
                  sectionKey="context"
                  title="最新上下文轨迹"
                  badge={`${harnessState.latestContextTrace.length} 步`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-2">
                    {harnessState.latestContextTrace.map((step, index) => (
                      <div
                        key={`${step.stage}-${index}`}
                        className="rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Workflow className="h-4 w-4 text-muted-foreground" />
                          <span>{step.stage}</span>
                        </div>
                        <InteractiveText
                          text={step.detail}
                          className="mt-1 text-xs text-muted-foreground"
                          onOpenUrl={handleOpenExternalLink}
                        />
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {environment.skillsCount > 0 ? (
                <Section
                  sectionKey="capabilities"
                  title="已激活技能"
                  badge={`${environment.skillsCount} 个技能`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {environment.skillNames.map((name) => (
                        <ActionableBadge
                          key={name}
                          variant="secondary"
                          value={name}
                          onOpenUrl={handleOpenExternalLink}
                          onOpenPath={handleOpenPathValue}
                        />
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {environment.memorySignals.length > 0 ? (
                        environment.memorySignals.map((signal) => (
                          <ActionableBadge
                            key={signal}
                            variant="outline"
                            value={signal}
                            onOpenUrl={handleOpenExternalLink}
                            onOpenPath={handleOpenPathValue}
                          />
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          当前未识别到持久记忆信号
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>
                        上下文条目：{environment.activeContextCount}/
                        {environment.contextItemsCount}
                      </div>
                      {environment.contextItemNames.length > 0 ? (
                        <div className="space-y-1">
                          <div>活跃上下文：</div>
                          <div className="flex flex-wrap gap-2">
                            {environment.contextItemNames.map((item) => (
                              <ActionableBadge
                                key={item}
                                variant="outline"
                                value={item}
                                onOpenUrl={handleOpenExternalLink}
                                onOpenPath={handleOpenPathValue}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        规划 {harnessState.activity.planning}
                      </Badge>
                      <Badge variant="outline">
                        文件 {harnessState.activity.filesystem}
                      </Badge>
                      <Badge variant="outline">
                        执行 {harnessState.activity.execution}
                      </Badge>
                      <Badge variant="outline">
                        网页 {harnessState.activity.web}
                      </Badge>
                      <Badge variant="outline">
                        技能 {harnessState.activity.skills}
                      </Badge>
                      <Badge variant="outline">
                        委派 {harnessState.activity.delegation}
                      </Badge>
                    </div>
                  </div>
                </Section>
              ) : null}
            </div>
          </ScrollArea>
        ) : null}
      </div>

      <RuntimeReviewDecisionDialog
        open={reviewDecisionEditorOpen}
        template={reviewDecisionTemplate}
        saving={reviewDecisionSaving}
        onOpenChange={setReviewDecisionEditorOpen}
        onSave={handleSaveReviewDecision}
      />

      <Dialog
        open={previewDialog.open}
        onOpenChange={(open) =>
          setPreviewDialog((current) => ({
            ...current,
            open,
            loading: open ? current.loading : false,
          }))
        }
      >
        <DialogContent maxWidth="max-w-4xl" className="p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="pr-8">{previewDialog.title}</DialogTitle>
            <DialogDescription className="space-y-1">
              {previewDialog.description ? (
                <InteractiveText
                  text={previewDialog.description}
                  className="block"
                  onOpenUrl={handleOpenExternalLink}
                />
              ) : null}
              {previewDialog.path ? (
                <PathTextLink
                  path={previewDialog.path}
                  className="block text-xs"
                  onOpenPath={handleOpenPathValue}
                />
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{previewDialog.displayName}</Badge>
              {formatSize(previewDialog.size) ? (
                <Badge variant="outline">
                  {formatSize(previewDialog.size)}
                </Badge>
              ) : null}
              {previewDialog.loading ? (
                <Badge variant="outline" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在加载完整内容
                </Badge>
              ) : null}
              {previewDialog.preview &&
              previewDialog.content === previewDialog.preview &&
              !previewDialog.loading ? (
                <Badge variant="outline">当前展示为摘要预览</Badge>
              ) : null}
            </div>

            <ScrollArea className="max-h-[60vh] rounded-xl border border-border bg-muted/30">
              {previewDialog.isBinary ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <HardDriveDownload className="h-4 w-4" />
                  该文件为二进制内容，暂不支持文本预览。
                </div>
              ) : previewDialog.error ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {previewDialog.error}
                </div>
              ) : previewDialog.content ? (
                <div className="px-4 py-4 text-xs leading-6 text-foreground">
                  <InteractiveText
                    text={previewDialog.content}
                    mono={true}
                    onOpenUrl={handleOpenExternalLink}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  暂无可展示内容
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCopyPath()}
              >
                复制路径
              </Button>
            ) : null}
            {previewDialog.content?.trim() ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCopyContent()}
              >
                复制内容
              </Button>
            ) : null}
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRevealPath()}
              >
                定位文件
              </Button>
            ) : null}
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleOpenPath()}
              >
                系统打开
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPreviewDialog((current) => ({ ...current, open: false }))
              }
            >
              关闭
            </Button>
            {onOpenFile &&
            !previewDialog.isBinary &&
            previewDialog.content?.trim() ? (
              <Button type="button" onClick={handleOpenFile}>
                在会话中打开
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default HarnessStatusPanel;
