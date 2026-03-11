/**
 * AI Agent 聊天页面
 *
 * 包含聊天区域和侧边栏（话题列表）
 * 支持内容创作模式下的布局过渡和步骤引导
 * 当主题为 general 时，使用 GeneralChat 组件实现
 */

import {
  startTransition,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  memo,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import styled from "styled-components";
import { Info, PanelLeftOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { safeListen } from "@/lib/dev-bridge";
import { readFilePreview } from "@/lib/api/fileBrowser";
import { uploadImageToSession, importDocument } from "@/lib/api/session-files";
import {
  useAgentChatUnified,
  useThemeContextWorkspace,
  useTopicBranchBoard,
} from "./hooks";
import type { SidebarActivityLog } from "./hooks/useThemeContextWorkspace";
import type { TopicBranchStatus } from "./hooks/useTopicBranchBoard";
import { useSessionFiles } from "./hooks/useSessionFiles";
import { useContentSync } from "./hooks/useContentSync";
import { getDefaultGuidePromptByTheme } from "./utils/defaultGuidePrompt";
import { ChatNavbar } from "./components/ChatNavbar";
import { ChatSidebar } from "./components/ChatSidebar";
import {
  ThemeWorkbenchSidebar,
  type ThemeWorkbenchCreationTaskEvent,
} from "./components/ThemeWorkbenchSidebar";
import { HarnessStatusPanel } from "./components/HarnessStatusPanel";
import { MessageList } from "./components/MessageList";
import { Inputbar } from "./components/Inputbar";
import { RuntimeStyleControlBar } from "./components/RuntimeStyleControlBar";
import { EmptyState } from "./components/EmptyState";
import type { CreationMode } from "./components/types";
import { type TaskFile } from "./components/TaskFiles";
import { LayoutTransition } from "@/components/content-creator/core/LayoutTransition/LayoutTransition";
import { StepProgress } from "@/components/content-creator/core/StepGuide/StepProgress";
import { useWorkflow } from "@/components/content-creator/hooks/useWorkflow";
import { CanvasFactory } from "@/components/content-creator/canvas/CanvasFactory";
import {
  createInitialCanvasState,
  type CanvasStateUnion,
} from "@/components/content-creator/canvas/canvasUtils";
import { createInitialDocumentState } from "@/components/content-creator/canvas/document";
import {
  COVER_IMAGE_REPLACED_EVENT,
  type CoverImageReplacedDetail,
} from "@/components/content-creator/canvas/document/platforms/CoverImagePlaceholder";
import type {
  AutoContinueRunPayload,
  ContentReviewRunPayload,
  DocumentVersion,
  TextStylizeRunPayload,
} from "@/components/content-creator/canvas/document/types";
import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import { CanvasPanel as GeneralCanvasPanel } from "@/components/general-chat/bridge";
import {
  type CanvasState as GeneralCanvasState,
  DEFAULT_CANVAS_STATE,
} from "@/components/general-chat/bridge";
import {
  artifactsAtom,
  selectedArtifactAtom,
  selectedArtifactIdAtom,
} from "@/lib/artifact/store";
import { ArtifactRenderer, ArtifactToolbar } from "@/components/artifact";
import { useAtomValue, useSetAtom } from "jotai";
import { createInitialMusicState } from "@/components/content-creator/canvas/music/types";
import {
  createInitialNovelState,
  countWords as countNovelWords,
} from "@/components/content-creator/canvas/novel/types";
import { parseLyrics } from "@/components/content-creator/canvas/music/utils/lyricsParser";
import {
  generateContentCreationPrompt,
  isContentCreationTheme,
} from "@/components/content-creator/utils/systemPrompt";
import { generateProjectMemoryPrompt } from "@/components/content-creator/utils/projectPrompt";
import {
  getProject,
  getDefaultProject,
  getOrCreateDefaultProject,
  getContent,
  getThemeWorkbenchDocumentState,
  ensureWorkspaceReady,
  updateProject as updateProjectById,
  updateContent,
  type Project,
  type ProjectType,
  type ThemeWorkbenchDocumentState,
} from "@/lib/api/project";
import {
  getProjectMemory,
  type ProjectMemory,
  type Character,
} from "@/lib/api/memory";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { skillsApi, type Skill } from "@/lib/api/skills";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";
import { useSubAgentScheduler } from "@/hooks/useSubAgentScheduler";
import { LatestRunStatusBadge } from "@/components/execution/LatestRunStatusBadge";
import {
  executionRunGet,
  executionRunGetThemeWorkbenchState,
  type AgentRun,
  type ThemeWorkbenchRunTodoItem,
  type ThemeWorkbenchRunTerminalItem,
  type ThemeWorkbenchRunState as BackendThemeWorkbenchRunState,
} from "@/lib/api/executionRun";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { resolveProviderModelCompatibility } from "./utils/providerModelCompatibility";
import { useProviderModels } from "@/hooks/useProviderModels";
import {
  isReasoningModel,
  resolveBaseModelOnThinkingOff,
  resolveThinkingModel,
} from "@/lib/model/thinkingModelResolver";
import {
  loadRememberedBaseModel,
  saveRememberedBaseModel,
} from "@/lib/model/thinkingBaseModelMemory";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { ToolCallState } from "@/lib/api/agentStream";
import {
  skillExecutionApi,
  type SkillDetailInfo,
} from "@/lib/api/skill-execution";

import type { Message, MessageImage } from "./types";
import type {
  ThemeType,
  LayoutMode,
  StepStatus,
} from "@/components/content-creator/types";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
import { getFileToStepMap } from "./utils/workflowMapping";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import {
  extractStyleActionContent,
  resolveStyleActionFileName,
} from "./utils/styleRuntime";
import { resolveTopicSwitchProject } from "./utils/topicProjectSwitch";
import {
  loadChatToolPreferences,
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "./utils/chatToolPreferences";
import { deriveHarnessSessionState } from "./utils/harnessState";
import {
  resolveCanvasTaskFileTarget,
  shouldDeferCanvasSyncWhileEditing,
} from "./utils/taskFileCanvasSync";
import { parseSkillSlashCommand } from "./hooks/skillCommand";
import { subscribeDocumentEditorFocus } from "@/lib/documentEditorFocusEvents";
import {
  DEFAULT_STYLE_PROFILE,
  buildRuntimeStyleOverridePrompt,
  buildStyleAuditPrompt,
  buildStyleRewritePrompt,
  getStyleProfileFromGuide,
  type RuntimeStyleSelection,
} from "@/lib/style-guide";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";

const SUPPORTED_ENTRY_THEMES: ThemeType[] = [
  "general",
  "social-media",
  "poster",
  "music",
  "knowledge",
  "planning",
  "document",
  "video",
  "novel",
];

interface HarnessFilePreviewResult {
  path: string;
  content: string | null;
  isBinary: boolean;
  size: number;
  error: string | null;
}

function extractFileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function normalizeInitialTheme(value?: string): ThemeType {
  if (!value) return "general";
  if (SUPPORTED_ENTRY_THEMES.includes(value as ThemeType)) {
    return value as ThemeType;
  }
  return "general";
}

const PageContainer = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
`;

const MainArea = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
`;

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
`;

const ChatContainerInner = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const EntryBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid hsl(var(--primary) / 0.18);
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--foreground));
  font-size: 13px;
`;

const EntryBannerClose = styled.button`
  margin-left: auto;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  font-size: 13px;
`;

const ChatContent = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0 6px;
  overflow: hidden;
  height: 100%;
  position: relative;
`;

const MessageViewport = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-bottom: 128px;
`;

const FloatingInputbarContainer = styled.div`
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 20;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
`;

const ThemeWorkbenchInputOverlay = styled.div<{
  $hasPendingA2UIForm?: boolean;
}>`
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 25;
  pointer-events: none;
  display: flex;
  justify-content: center;
  box-sizing: border-box;

  > * {
    pointer-events: auto;
    width: ${({ $hasPendingA2UIForm }) =>
      $hasPendingA2UIForm
        ? "min(calc(100% - 24px), 880px)"
        : "min(calc(100% - 16px), 480px)"};
    max-width: 100%;
  }
`;

const ThemeWorkbenchLayoutShell = styled.div<{ $bottomInset: string }>`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: ${({ $bottomInset }) => $bottomInset};
  transition: padding-bottom 0.2s ease;
`;

const ThemeWorkbenchCanvasHost = styled.div`
  flex: 1;
  min-height: 0;

  > * {
    height: 100%;
  }
`;

interface LayoutTransitionRenderGateProps {
  mode: LayoutMode;
  chatContent: ReactNode;
  canvasContent: ReactNode;
}

const LayoutTransitionRenderGate = memo(
  ({ mode, chatContent, canvasContent }: LayoutTransitionRenderGateProps) => (
    <ThemeWorkbenchCanvasHost>
      <LayoutTransition
        mode={mode}
        chatContent={chatContent}
        canvasContent={canvasContent}
      />
    </ThemeWorkbenchCanvasHost>
  ),
  (previous, next) =>
    previous.mode === next.mode &&
    previous.chatContent === next.chatContent &&
    previous.canvasContent === next.canvasContent,
);
LayoutTransitionRenderGate.displayName = "LayoutTransitionRenderGate";

interface HandleSendObserver {
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

interface HandleSendOptions {
  skipThemeSkillPrefix?: boolean;
  purpose?: "content_review" | "text_stylize" | "style_rewrite" | "style_audit";
  observer?: HandleSendObserver;
}

const ThemeWorkbenchLeftExpandButton = styled.button`
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 72px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  background: hsl(var(--background) / 0.95);
  color: hsl(var(--muted-foreground));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 30;

  &:hover {
    color: hsl(var(--foreground));
    border-color: hsl(var(--primary) / 0.4);
    background: hsl(var(--accent) / 0.55);
  }
`;

/**
 * 将 ProjectType 转换为 ThemeType
 * 由于类型已统一，大部分情况下直接返回即可
 */
function projectTypeToTheme(projectType: ProjectType): ThemeType {
  // ProjectType 和 ThemeType 现在是统一的
  // 系统类型 persistent/temporary 映射到 general
  if (projectType === "persistent" || projectType === "temporary") {
    return "general";
  }
  return projectType as ThemeType;
}

const LAST_PROJECT_ID_KEY = "agent_last_project_id";
const TOPIC_PROJECT_KEY_PREFIX = "agent_session_workspace_";
const THEME_WORKBENCH_DOCUMENT_META_KEY = "theme_workbench_document_v1";
const MAX_PERSISTED_DOCUMENT_VERSIONS = 40;
const SOCIAL_ARTICLE_SKILL_KEY = "social_post_with_cover";
const THEME_WORKBENCH_CREATION_TASK_EVENT_NAME =
  "proxycast://creation_task_submitted";
const MAX_THEME_WORKBENCH_CREATION_TASK_EVENTS = 120;

interface CreationTaskSubmittedPayload {
  task_id?: string;
  task_type?: string;
  path?: string;
  absolute_path?: string;
}

function normalizeThemeWorkbenchCreationTaskEvent(
  payload: CreationTaskSubmittedPayload,
): ThemeWorkbenchCreationTaskEvent | null {
  const taskId = payload.task_id?.trim();
  const taskType = payload.task_type?.trim();
  const path = payload.path?.trim();
  if (!taskId || !taskType || !path) {
    return null;
  }
  const createdAt = Date.now();
  return {
    taskId,
    taskType,
    path,
    absolutePath: payload.absolute_path?.trim() || undefined,
    createdAt,
    timeLabel: new Date(createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function resolveThemeWorkbenchRunStepStatus(
  status: "queued" | "running" | "success" | "error" | "canceled" | "timeout",
): StepStatus {
  if (status === "running") {
    return "active";
  }
  if (status === "queued") {
    return "pending";
  }
  if (status === "success") {
    return "completed";
  }
  return "error";
}

function parseThemeWorkbenchToolArguments(
  argumentsJson?: string,
): Record<string, unknown> {
  if (!argumentsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function truncateThemeWorkbenchLabel(value: string, limit = 28): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function resolveThemeWorkbenchTextArg(
  args: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const firstString = value.find(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      );
      if (firstString) {
        return firstString.trim();
      }
    }
  }
  return "";
}

function getThemeWorkbenchFileLabel(pathValue: string): string {
  const normalized = pathValue.trim();
  if (!normalized) {
    return "主稿文件";
  }
  const segments = normalized.split(/[/\\]/).filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return segments[0] || normalized;
}

function resolveThemeWorkbenchToolTaskTitle(toolCall: ToolCallState): string {
  const normalized = toolCall.name.trim().toLowerCase();
  const args = parseThemeWorkbenchToolArguments(toolCall.arguments);
  const queryValue = resolveThemeWorkbenchTextArg(args, [
    "query",
    "q",
    "keyword",
    "pattern",
    "text",
  ]);
  const urlValue = resolveThemeWorkbenchTextArg(args, ["url", "href"]);
  const elementValue = resolveThemeWorkbenchTextArg(args, [
    "element",
    "name",
    "label",
    "ref",
  ]);

  if (normalized.includes("social_generate_cover_image")) {
    const size = resolveThemeWorkbenchTextArg(args, ["size"]);
    return size ? `生成封面图（${size}）` : "生成封面图";
  }
  if (normalized.includes("write_file") || normalized.includes("create_file")) {
    const pathValue = resolveThemeWorkbenchTextArg(args, [
      "path",
      "file_path",
      "filePath",
    ]);
    return pathValue
      ? `写入 ${getThemeWorkbenchFileLabel(pathValue)}`
      : "写入主稿文件";
  }
  if (
    normalized.includes("websearch") ||
    normalized.includes("search_query") ||
    normalized.includes("web_search") ||
    normalized.includes("search")
  ) {
    return queryValue
      ? `检索 ${truncateThemeWorkbenchLabel(queryValue)}`
      : "检索参考资料";
  }
  if (
    normalized.includes("browser_navigate") ||
    (normalized.includes("navigate") && urlValue)
  ) {
    return urlValue
      ? `打开 ${truncateThemeWorkbenchLabel(urlValue, 36)}`
      : "打开网页";
  }
  if (normalized.includes("browser_click") || normalized === "click") {
    return elementValue
      ? `点击「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
      : "点击页面元素";
  }
  if (normalized.includes("browser_hover") || normalized === "hover") {
    return elementValue
      ? `定位「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
      : "定位页面元素";
  }
  if (normalized.includes("browser_type") || normalized === "type") {
    return elementValue
      ? `填写「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
      : queryValue
        ? `填写 ${truncateThemeWorkbenchLabel(queryValue, 18)}`
        : "填写页面内容";
  }
  if (
    normalized.includes("browser_select_option") ||
    normalized.includes("select_option")
  ) {
    const value = resolveThemeWorkbenchTextArg(args, [
      "value",
      "values",
      "option",
    ]);
    return value
      ? `选择 ${truncateThemeWorkbenchLabel(value, 20)}`
      : elementValue
        ? `选择「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
        : "选择页面选项";
  }
  if (
    normalized.includes("browser_press_key") ||
    normalized.includes("press_key")
  ) {
    const keyValue = resolveThemeWorkbenchTextArg(args, ["key"]);
    return keyValue ? `触发按键 ${keyValue}` : "触发页面快捷键";
  }
  if (normalized.includes("browser_drag") || normalized.includes("drag")) {
    const endValue = resolveThemeWorkbenchTextArg(args, [
      "endElement",
      "endRef",
    ]);
    return endValue
      ? `拖拽到「${truncateThemeWorkbenchLabel(endValue, 18)}」`
      : "拖拽页面元素";
  }
  if (
    normalized.includes("browser_snapshot") ||
    normalized.includes("screenshot")
  ) {
    return elementValue
      ? `分析页面区域：${truncateThemeWorkbenchLabel(elementValue, 20)}`
      : urlValue
        ? `分析页面 ${truncateThemeWorkbenchLabel(urlValue, 30)}`
        : "分析页面内容";
  }
  if (normalized.includes("bash") || normalized.includes("shell")) {
    const commandValue = resolveThemeWorkbenchTextArg(args, ["command", "cmd"]);
    const commandProbe = commandValue.toLowerCase();
    if (commandProbe.includes("ffmpeg")) {
      return "处理音视频素材";
    }
    if (commandProbe.includes("curl") || commandProbe.includes("wget")) {
      return "下载远程资源";
    }
    if (
      commandProbe.includes("python") ||
      commandProbe.includes("node") ||
      commandProbe.includes("tsx") ||
      commandProbe.includes("npm")
    ) {
      return "执行自动化脚本";
    }
    return commandValue
      ? `执行命令：${truncateThemeWorkbenchLabel(commandValue, 22)}`
      : "执行终端命令";
  }
  if (normalized.includes("browser")) {
    return urlValue
      ? `采集 ${truncateThemeWorkbenchLabel(urlValue, 36)}`
      : elementValue
        ? `处理页面元素：${truncateThemeWorkbenchLabel(elementValue, 20)}`
        : "采集网页信息";
  }
  return toolCall.name.replace(/[_-]+/g, " ").trim() || "执行工具";
}

function resolveThemeWorkbenchPrimaryTaskTitle(
  skillName: string,
  detail?: SkillDetailInfo | null,
): string {
  if (skillName === SOCIAL_ARTICLE_SKILL_KEY) {
    return "生成社媒主稿";
  }

  const displayName = detail?.display_name?.trim();
  if (displayName) {
    return displayName;
  }

  return skillName.replace(/[_-]+/g, " ").trim() || "执行任务";
}

function extractThemeWorkbenchWorkflowMarkerIndex(
  content: string,
): number | null {
  const matches = [...content.matchAll(/\*\*步骤\s+(\d+)\/(\d+):/g)];
  if (matches.length === 0) {
    return null;
  }
  const last = matches[matches.length - 1];
  const value = Number(last[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value - 1;
}

function findLatestThemeWorkbenchExecution(messages: Message[]): {
  assistantMessage: Message;
  skillName: string | null;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const hasToolCalls = (message.toolCalls?.length || 0) > 0;
    const hasPendingAction =
      message.actionRequests?.some(
        (request) => request.status !== "submitted",
      ) || false;
    if (!message.isThinking && !hasToolCalls && !hasPendingAction) {
      continue;
    }

    let skillName: string | null = null;
    for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
      const candidate = messages[userIndex];
      if (candidate.role !== "user") {
        continue;
      }
      skillName = parseSkillSlashCommand(candidate.content)?.skillName || null;
      break;
    }

    return {
      assistantMessage: message,
      skillName,
    };
  }

  return null;
}

function buildThemeWorkbenchLiveWorkflowSteps(
  messages: Message[],
  skillDetailMap: Record<string, SkillDetailInfo | null>,
  isSending: boolean,
): Array<{ id: string; title: string; status: StepStatus }> {
  const activeExecution = findLatestThemeWorkbenchExecution(messages);
  if (!activeExecution) {
    return [];
  }

  const { assistantMessage, skillName } = activeExecution;
  if (!skillName) {
    return [];
  }

  const skillDetail = skillDetailMap[skillName] || null;
  const workflowSteps = skillDetail?.workflow_steps || [];
  if (workflowSteps.length > 0) {
    const latestAssistantContent =
      messages
        .slice()
        .reverse()
        .find((m) => m.role === "assistant")?.content || "";
    const activeIndex =
      extractThemeWorkbenchWorkflowMarkerIndex(latestAssistantContent) ?? 0;
    return workflowSteps.map((step, index) => ({
      id: step.id,
      title: step.name,
      status:
        index < activeIndex
          ? ("completed" as StepStatus)
          : index == activeIndex
            ? ("active" as StepStatus)
            : ("pending" as StepStatus),
    }));
  }

  const toolCalls = assistantMessage.toolCalls || [];
  const steps: Array<{ id: string; title: string; status: StepStatus }> = [];
  const primaryTaskTitle = resolveThemeWorkbenchPrimaryTaskTitle(
    skillName,
    skillDetail,
  );
  const hasRunningTool = toolCalls.some(
    (toolCall) => toolCall.status === "running",
  );
  const hasFailedTool = toolCalls.some(
    (toolCall) => toolCall.status === "failed",
  );
  const hasCompletedPrimaryWrite = toolCalls.some((toolCall) => {
    if (toolCall.status !== "completed") {
      return false;
    }
    const normalizedName = toolCall.name.trim().toLowerCase();
    return (
      normalizedName.includes("write_file") ||
      normalizedName.includes("create_file")
    );
  });

  steps.push({
    id: `${skillName}:primary`,
    title: primaryTaskTitle,
    status: hasCompletedPrimaryWrite
      ? ("completed" as StepStatus)
      : hasFailedTool
        ? ("error" as StepStatus)
        : toolCalls.length > 0
          ? ("completed" as StepStatus)
          : assistantMessage.isThinking || isSending
            ? ("active" as StepStatus)
            : ("pending" as StepStatus),
  });

  toolCalls.forEach((toolCall, index) => {
    steps.push({
      id: toolCall.id || `${skillName}:tool:${index}`,
      title: resolveThemeWorkbenchToolTaskTitle(toolCall),
      status:
        toolCall.status === "running"
          ? ("active" as StepStatus)
          : toolCall.status === "completed"
            ? ("completed" as StepStatus)
            : ("error" as StepStatus),
    });
  });

  if (isSending && toolCalls.length > 0 && !hasRunningTool) {
    steps.push({
      id: `${skillName}:finalize`,
      title: "整理最终结果",
      status: "active",
    });
  }

  return steps;
}

function resolveThemeWorkbenchQueueItemTitle(
  item: ThemeWorkbenchRunTodoItem,
  skillDetailMap: Record<string, SkillDetailInfo | null>,
): string {
  const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
  if (sourceRef) {
    return resolveThemeWorkbenchPrimaryTaskTitle(
      sourceRef,
      skillDetailMap[sourceRef],
    );
  }
  return item.title?.trim() || "执行任务";
}
const THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS = 45 * 1000;

function resolveThemeWorkbenchSkillSourceRef(
  item:
    | ThemeWorkbenchRunTodoItem
    | ThemeWorkbenchRunTerminalItem
    | { source?: string | null; source_ref?: string | null },
): string | null {
  if ((item.source || "").trim() !== "skill") {
    return null;
  }
  const sourceRef = item.source_ref?.trim();
  return sourceRef || null;
}

interface PersistedThemeWorkbenchDocument {
  versions: DocumentVersion[];
  currentVersionId: string;
  versionStatusMap: Record<string, TopicBranchStatus>;
}

function isTopicBranchStatus(value: unknown): value is TopicBranchStatus {
  return (
    value === "in_progress" ||
    value === "pending" ||
    value === "merged" ||
    value === "candidate"
  );
}

function normalizeDocumentVersion(value: unknown): DocumentVersion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const content =
    typeof candidate.content === "string" ? candidate.content : "";
  const createdAt =
    typeof candidate.createdAt === "number"
      ? candidate.createdAt
      : typeof candidate.created_at === "number"
        ? candidate.created_at
        : NaN;
  const description =
    typeof candidate.description === "string"
      ? candidate.description
      : undefined;

  if (!id || Number.isNaN(createdAt)) {
    return null;
  }

  return {
    id,
    content,
    createdAt,
    description,
  };
}

function buildPersistedThemeWorkbenchDocument(
  state: CanvasStateUnion,
  statusMap: Record<string, TopicBranchStatus>,
): PersistedThemeWorkbenchDocument | null {
  if (state.type !== "document" || state.versions.length === 0) {
    return null;
  }

  const normalizedVersions = state.versions
    .map((version) => normalizeDocumentVersion(version))
    .filter((version): version is DocumentVersion => !!version);

  if (normalizedVersions.length === 0) {
    return null;
  }

  const latestVersions = normalizedVersions.slice(
    -MAX_PERSISTED_DOCUMENT_VERSIONS,
  );
  const versionIdSet = new Set(latestVersions.map((version) => version.id));
  let currentVersionId = state.currentVersionId;

  if (!versionIdSet.has(currentVersionId)) {
    currentVersionId =
      latestVersions[latestVersions.length - 1]?.id || latestVersions[0].id;
  }

  const persistedVersions = latestVersions.map((version) =>
    version.id === currentVersionId ? { ...version, content: "" } : version,
  );

  const versionStatusMap = Object.fromEntries(
    Object.entries(statusMap).filter(
      ([versionId, status]) =>
        versionIdSet.has(versionId) && isTopicBranchStatus(status),
    ),
  ) as Record<string, TopicBranchStatus>;

  return {
    versions: persistedVersions,
    currentVersionId,
    versionStatusMap,
  };
}

function readPersistedThemeWorkbenchDocument(
  metadata?: Record<string, unknown>,
): PersistedThemeWorkbenchDocument | null {
  const raw = metadata?.[THEME_WORKBENCH_DOCUMENT_META_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const versionsRaw = Array.isArray(candidate.versions)
    ? candidate.versions
    : [];
  const versions = versionsRaw
    .map((version) => normalizeDocumentVersion(version))
    .filter((version): version is DocumentVersion => !!version)
    .slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);
  if (versions.length === 0) {
    return null;
  }

  const versionIdSet = new Set(versions.map((version) => version.id));
  const currentVersionIdRaw = candidate.currentVersionId;
  const currentVersionId =
    typeof currentVersionIdRaw === "string" &&
    versionIdSet.has(currentVersionIdRaw)
      ? currentVersionIdRaw
      : versions[versions.length - 1]?.id || versions[0].id;

  const statusRaw = candidate.versionStatusMap;
  const statusEntries =
    statusRaw && typeof statusRaw === "object" ? statusRaw : {};
  const versionStatusMap = Object.fromEntries(
    Object.entries(statusEntries).filter(
      ([versionId, status]) =>
        versionIdSet.has(versionId) && isTopicBranchStatus(status),
    ),
  ) as Record<string, TopicBranchStatus>;

  return {
    versions,
    currentVersionId,
    versionStatusMap,
  };
}

function applyBackendThemeWorkbenchDocumentState(
  state: CanvasStateUnion,
  backendState: ThemeWorkbenchDocumentState,
  currentBody: string,
): {
  state: CanvasStateUnion;
  statusMap: Record<string, TopicBranchStatus>;
} | null {
  if (state.type !== "document" || backendState.versions.length === 0) {
    return null;
  }

  const versions = backendState.versions
    .map((version, index) => ({
      id: version.id,
      content: version.is_current ? currentBody : "",
      createdAt: version.created_at,
      description: version.description?.trim() || `版本 ${index + 1}`,
    }))
    .slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);

  if (versions.length === 0) {
    return null;
  }

  const currentVersion =
    versions.find(
      (version) => version.id === backendState.current_version_id,
    ) || versions[versions.length - 1];

  const statusMap = Object.fromEntries(
    backendState.versions
      .filter(
        (
          version,
        ): version is ThemeWorkbenchDocumentState["versions"][number] & {
          status: TopicBranchStatus;
        } => isTopicBranchStatus(version.status),
      )
      .map((version) => [version.id, version.status]),
  ) as Record<string, TopicBranchStatus>;

  return {
    state: {
      ...state,
      versions,
      currentVersionId: currentVersion.id,
      content: currentVersion.content,
    },
    statusMap,
  };
}

function inferThemeWorkbenchGateFromQueueItem(
  queueItem: ThemeWorkbenchRunTodoItem | null,
): {
  key: "topic_select" | "write_mode" | "publish_confirm";
  title: string;
  description: string;
} {
  const gateKey = queueItem?.gate_key;
  if (gateKey === "publish_confirm") {
    return {
      key: "publish_confirm",
      title: "发布闸门",
      description: queueItem?.title || "正在准备发布前检查与平台适配结果。",
    };
  }
  if (gateKey === "topic_select") {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: queueItem?.title || "正在整理选题方向并生成可确认方案。",
    };
  }
  if (gateKey === "write_mode") {
    return {
      key: "write_mode",
      title: "写作闸门",
      description: queueItem?.title || "正在执行主稿写作与插图生成流程。",
    };
  }

  if (!queueItem) {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: "正在整理选题方向并生成可确认方案。",
    };
  }

  const probe =
    `${queueItem.title} ${queueItem.source_ref || ""} ${queueItem.source}`.toLowerCase();
  const looksLikePublish =
    /publish|adapt|distribution|release|发布|分发|平台适配/.test(probe);
  if (looksLikePublish) {
    return {
      key: "publish_confirm",
      title: "发布闸门",
      description: queueItem.title || "正在准备发布前检查与平台适配结果。",
    };
  }

  const looksLikeTopic = /topic|research|trend|idea|选题|方向|调研|洞察/.test(
    probe,
  );
  if (looksLikeTopic) {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: queueItem.title || "正在整理选题方向并生成可确认方案。",
    };
  }

  return {
    key: "write_mode",
    title: "写作闸门",
    description: queueItem.title || "正在执行主稿写作与插图生成流程。",
  };
}

function resolveThemeWorkbenchGateByKey(
  gateKey: "topic_select" | "write_mode" | "publish_confirm",
  fallbackTitle?: string,
): {
  key: "topic_select" | "write_mode" | "publish_confirm";
  title: string;
  description: string;
} {
  if (gateKey === "publish_confirm") {
    return {
      key: "publish_confirm",
      title: "发布闸门",
      description: fallbackTitle || "正在准备发布前检查与平台适配结果。",
    };
  }
  if (gateKey === "topic_select") {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: fallbackTitle || "正在整理选题方向并生成可确认方案。",
    };
  }
  return {
    key: "write_mode",
    title: "写作闸门",
    description: fallbackTitle || "正在执行主稿写作与插图生成流程。",
  };
}

function formatThemeWorkbenchRunTimeLabel(
  raw: string | null | undefined,
): string {
  if (!raw) {
    return "--:--";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "--:--";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatThemeWorkbenchRunDurationLabel(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string | undefined {
  if (!startedAt || !finishedAt) {
    return undefined;
  }

  const started = new Date(startedAt);
  const finished = new Date(finishedAt);
  if (Number.isNaN(started.getTime()) || Number.isNaN(finished.getTime())) {
    return undefined;
  }

  const durationMs = finished.getTime() - started.getTime();
  if (durationMs < 0) {
    return undefined;
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(durationMs / 60000)}m${Math.round(
    (durationMs % 60000) / 1000,
  )}s`;
}

function resolveThemeWorkbenchApplyTargetByGateKey(
  gateKey: "topic_select" | "write_mode" | "publish_confirm" | "idle",
): string {
  if (gateKey === "topic_select") {
    return "选题池";
  }
  if (gateKey === "publish_confirm") {
    return "发布产物";
  }
  if (gateKey === "write_mode") {
    return "版本主稿";
  }
  return "主稿内容";
}

function extractExecutionIdFromSocialToolId(toolCallId: string): string | null {
  const normalized = toolCallId.trim();
  if (!normalized.startsWith("social-write-")) {
    return null;
  }
  const match = normalized.match(/^social-write-(.+)-[0-9a-f]{8}$/i);
  const executionId = match?.[1]?.trim();
  if (!executionId) {
    return null;
  }
  return executionId;
}

function resolveExecutionIdCandidatesForActivityLog(
  log: SidebarActivityLog,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  pushCandidate(log.executionId);
  pushCandidate(log.messageId);

  const normalizedLogId = log.id.trim();
  if (normalizedLogId) {
    let toolCallIdProbe = normalizedLogId;
    if (log.messageId) {
      const messagePrefix = `${log.messageId}-`;
      if (normalizedLogId.startsWith(messagePrefix)) {
        toolCallIdProbe = normalizedLogId.slice(messagePrefix.length);
      }
    }
    pushCandidate(extractExecutionIdFromSocialToolId(toolCallIdProbe));
  }

  return candidates;
}

function isThemeWorkbenchPrimaryDocumentArtifact(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.endsWith(".md") || normalized.endsWith(".markdown");
}

function inferTaskFileType(fileName: string): TaskFile["type"] {
  const normalized = fileName.trim().toLowerCase();
  const extension = normalized.split(".").pop() || "";

  if (extension === "md" || extension === "markdown" || extension === "txt") {
    return "document";
  }
  if (
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(
      extension,
    )
  ) {
    return "image";
  }
  if (
    ["mp3", "wav", "aac", "flac", "m4a", "ogg", "mid", "midi"].includes(
      extension,
    )
  ) {
    return "audio";
  }
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(extension)) {
    return "video";
  }
  return "other";
}

function looksLikeSocialPublishPayload(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      typeof parsed.article_path === "string" ||
      typeof parsed.cover_meta_path === "string" ||
      Array.isArray(parsed.pipeline) ||
      Array.isArray(parsed.recommended_channels)
    );
  } catch {
    return false;
  }
}

function looksLikeThemeWorkbenchErrorPayload(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith("ran into this error:") ||
    normalized.startsWith("request failed:") ||
    normalized.includes(
      "please retry if you think this is a transient or recoverable error.",
    ) ||
    normalized.includes("api key not valid")
  );
}

function isCorruptedThemeWorkbenchDocumentContent(
  content?: string | null,
): boolean {
  if (typeof content !== "string") {
    return false;
  }

  return (
    looksLikeSocialPublishPayload(content) ||
    looksLikeThemeWorkbenchErrorPayload(content)
  );
}

function resolveTaskFileType(
  fileName: string,
  content?: string | null,
): TaskFile["type"] {
  const inferredType = inferTaskFileType(fileName);
  if (
    inferredType === "document" &&
    isCorruptedThemeWorkbenchDocumentContent(content)
  ) {
    return "other";
  }
  return inferredType;
}

function normalizeSessionTaskFileType(
  fileType: string,
  fileName: string,
  content?: string | null,
): TaskFile["type"] {
  const normalized = fileType.trim().toLowerCase();
  if (
    normalized === "document" ||
    normalized === "image" ||
    normalized === "audio" ||
    normalized === "video" ||
    normalized === "other"
  ) {
    const resolvedByContent = resolveTaskFileType(fileName, content);
    if (normalized === "document" && resolvedByContent !== "document") {
      return resolvedByContent;
    }
    return normalized;
  }
  return resolveTaskFileType(fileName, content);
}

function isRenderableTaskFile(
  file: Pick<TaskFile, "name" | "type">,
  isThemeWorkbench: boolean,
): boolean {
  if (file.type !== "document") {
    return false;
  }
  if (!isThemeWorkbench) {
    return true;
  }
  return isThemeWorkbenchPrimaryDocumentArtifact(file.name);
}

function buildThemeWorkbenchWorkflowSteps(
  messages: Message[],
  backendRunState: BackendThemeWorkbenchRunState | null,
  isSending: boolean,
  skillDetailMap: Record<string, SkillDetailInfo | null>,
): Array<{ id: string; title: string; status: StepStatus }> {
  const liveSteps = buildThemeWorkbenchLiveWorkflowSteps(
    messages,
    skillDetailMap,
    isSending,
  );
  if (liveSteps.length > 0) {
    return liveSteps;
  }

  const queueItems = backendRunState?.queue_items || [];
  if (queueItems.length > 0) {
    if (queueItems.length === 1) {
      const item = queueItems[0];
      const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
      const workflowSteps = sourceRef
        ? skillDetailMap[sourceRef]?.workflow_steps || []
        : [];
      if (workflowSteps.length > 0) {
        const latestAssistantContent =
          messages
            .slice()
            .reverse()
            .find((m) => m.role === "assistant")?.content || "";
        const activeIndex =
          extractThemeWorkbenchWorkflowMarkerIndex(latestAssistantContent) ?? 0;
        return workflowSteps.map((step, index) => ({
          id: `${item.run_id}-${step.id}`,
          title: step.name,
          status:
            index < activeIndex
              ? ("completed" as StepStatus)
              : index === activeIndex
                ? ("active" as StepStatus)
                : ("pending" as StepStatus),
        }));
      }
    }
    return queueItems.map((item) => ({
      id: item.run_id,
      title: resolveThemeWorkbenchQueueItemTitle(item, skillDetailMap),
      status: resolveThemeWorkbenchRunStepStatus(item.status),
    }));
  }

  const latestTerminal = backendRunState?.latest_terminal;
  if (latestTerminal && backendRunState?.run_state !== "auto_running") {
    return [
      {
        id: latestTerminal.run_id,
        title: resolveThemeWorkbenchQueueItemTitle(
          latestTerminal,
          skillDetailMap,
        ),
        status: resolveThemeWorkbenchRunStepStatus(latestTerminal.status),
      },
    ];
  }

  return [];
}

function loadPersistedProjectId(key: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      return normalizeProjectId(typeof parsed === "string" ? parsed : stored);
    } catch {
      return normalizeProjectId(stored);
    }
  } catch {
    return null;
  }
}

function savePersistedProjectId(key: string, projectId: string) {
  const normalized = normalizeProjectId(projectId);
  if (!normalized) {
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch {
    // ignore write errors
  }
}

function loadPersistedBoolean(key: string, fallback = false): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(stored);
      return typeof parsed === "boolean" ? parsed : fallback;
    } catch {
      return stored === "true";
    }
  } catch {
    return fallback;
  }
}

function savePersistedBoolean(key: string, value: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore write errors
  }
}

export interface WorkflowProgressSnapshot {
  steps: Array<{
    id: string;
    title: string;
    status: StepStatus;
  }>;
  currentIndex: number;
}

/**
 * 判断画布状态是否为空
 * 用于决定是否自动触发 AI 引导
 */
const HARNESS_PANEL_VISIBILITY_KEY = "proxycast.chat.harness-panel.visible.v1";

function isCanvasStateEmpty(state: CanvasStateUnion | null): boolean {
  if (!state) return true;

  switch (state.type) {
    case "document":
      // 文档画布：检查 content 是否为空
      return !state.content || state.content.trim() === "";
    case "novel":
      // 小说画布：检查第一章内容是否为空
      return (
        state.chapters.length === 0 ||
        !state.chapters[0].content ||
        state.chapters[0].content.trim() === ""
      );
    case "script":
      // 剧本画布：检查场景是否有实际内容
      return (
        state.scenes.length === 0 ||
        (state.scenes.length === 1 &&
          state.scenes[0].dialogues.length === 0 &&
          !state.scenes[0].description)
      );
    case "music":
      // 音乐画布：检查 sections 是否为空
      return !state.sections || state.sections.length === 0;
    case "poster":
      // 海报画布：检查页面中是否有图层
      return (
        state.pages.length === 0 ||
        (state.pages.length === 1 && state.pages[0].layers.length === 0)
      );
    default:
      return true;
  }
}

function serializeCanvasStateForSync(state: CanvasStateUnion): string {
  switch (state.type) {
    case "document":
      return state.content || "";
    case "novel":
      return JSON.stringify(state.chapters);
    case "script":
      return JSON.stringify(state.scenes);
    case "music":
      return JSON.stringify(state.sections);
    case "poster":
      return JSON.stringify(state.pages);
    default:
      return JSON.stringify(state);
  }
}

function isSyncContentEmpty(content: string): boolean {
  return !content || content === "[]" || content === "{}";
}

function buildThemeWorkbenchRunStateSignature(
  state: BackendThemeWorkbenchRunState | null,
): string {
  if (!state) {
    return "null";
  }

  const queueSignature = (state.queue_items || [])
    .map((item) =>
      [
        item.run_id,
        item.execution_id || "",
        item.status,
        item.gate_key || "",
        item.source || "",
        item.source_ref || "",
      ].join(":"),
    )
    .join("|");

  const terminalSignature = state.latest_terminal
    ? [
        state.latest_terminal.run_id,
        state.latest_terminal.execution_id || "",
        state.latest_terminal.status,
        state.latest_terminal.gate_key || "",
        state.latest_terminal.source || "",
        state.latest_terminal.source_ref || "",
      ].join(":")
    : "";

  return [
    state.run_state,
    state.current_gate_key || "",
    queueSignature,
    terminalSignature,
  ].join("||");
}

export function AgentChatPage({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
  theme: initialTheme,
  initialCreationMode,
  lockTheme = false,
  fromResources = false,
  hideHistoryToggle = false,
  showChatPanel = true,
  hideTopBar = false,
  onBackToProjectManagement,
  hideInlineStepProgress = false,
  onWorkflowProgressChange,
  initialUserPrompt,
  initialSessionName,
  entryBannerMessage,
  onInitialUserPromptConsumed,
  newChatAt,
  onRecommendationClick: _onRecommendationClick,
  onHasMessagesChange,
  onSessionChange,
  preferContentReviewInRightRail = false,
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  contentId?: string;
  theme?: string;
  initialCreationMode?: CreationMode;
  lockTheme?: boolean;
  fromResources?: boolean;
  hideHistoryToggle?: boolean;
  showChatPanel?: boolean;
  hideTopBar?: boolean;
  onBackToProjectManagement?: () => void;
  hideInlineStepProgress?: boolean;
  onWorkflowProgressChange?: (
    snapshot: WorkflowProgressSnapshot | null,
  ) => void;
  initialUserPrompt?: string;
  initialSessionName?: string;
  entryBannerMessage?: string;
  onInitialUserPromptConsumed?: () => void;
  newChatAt?: number;
  onRecommendationClick?: (shortLabel: string, fullPrompt: string) => void;
  onHasMessagesChange?: (hasMessages: boolean) => void;
  onSessionChange?: (sessionId: string | null) => void;
  preferContentReviewInRightRail?: boolean;
}) {
  const [showSidebar, setShowSidebar] = useState(true);
  const [themeWorkbenchSidebarCollapsed, setThemeWorkbenchSidebarCollapsed] =
    useState(false);
  const [input, setInput] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [entryBannerVisible, setEntryBannerVisible] = useState(
    Boolean(entryBannerMessage),
  );
  const [chatToolPreferences, setChatToolPreferences] =
    useState<ChatToolPreferences>(() => loadChatToolPreferences());

  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const shouldBootstrapCanvasOnEntry =
    Boolean(contentId) && isContentCreationTheme(normalizedEntryTheme);

  // 内容创作相关状态
  const [activeTheme, setActiveTheme] = useState<string>(normalizedEntryTheme);
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    shouldBootstrapCanvasOnEntry ? "canvas" : "chat",
  );
  const [isInitialContentLoading, setIsInitialContentLoading] = useState(
    shouldBootstrapCanvasOnEntry,
  );
  const [initialContentLoadError, setInitialContentLoadError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!initialTheme) return;
    setActiveTheme(normalizeInitialTheme(initialTheme));
  }, [initialTheme]);

  useEffect(() => {
    if (!initialCreationMode) return;
    setCreationMode(initialCreationMode);
  }, [initialCreationMode]);

  useEffect(() => {
    setEntryBannerVisible(Boolean(entryBannerMessage));
  }, [entryBannerMessage]);

  useEffect(() => {
    saveChatToolPreferences(chatToolPreferences);
  }, [chatToolPreferences]);

  // 内部 projectId 状态（当外部未提供时使用）
  const [internalProjectId, setInternalProjectId] = useState<string | null>(
    null,
  );
  const handledNewChatRequestRef = useRef<string | null>(null);

  const incomingNewChatRequestKey =
    typeof newChatAt === "number" ? String(newChatAt) : null;
  const shouldResetToFreshHomeContext =
    !externalProjectId &&
    incomingNewChatRequestKey !== null &&
    handledNewChatRequestRef.current !== incomingNewChatRequestKey;

  // 使用外部或内部的 projectId
  const projectId =
    externalProjectId ??
    (shouldResetToFreshHomeContext ? undefined : internalProjectId) ??
    undefined;

  // 画布状态（支持多种画布类型）
  const [canvasState, setCanvasState] = useState<CanvasStateUnion | null>(
    () => {
      if (!shouldBootstrapCanvasOnEntry) {
        return null;
      }

      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    },
  );
  const [documentVersionStatusMap, setDocumentVersionStatusMap] = useState<
    Record<string, TopicBranchStatus>
  >({});
  const contentMetadataRef = useRef<Record<string, unknown>>({});
  const persistedWorkbenchSnapshotRef = useRef("");
  const lastCanvasSyncRequestRef = useRef<{
    contentId: string;
    body: string;
  } | null>(null);
  const themeWorkbenchRunStateSignatureRef = useRef("");
  const [novelChapterListCollapsed, setNovelChapterListCollapsed] =
    useState(false);
  const [themeWorkbenchBackendRunState, setThemeWorkbenchBackendRunState] =
    useState<BackendThemeWorkbenchRunState | null>(null);
  const [themeWorkbenchSkillDetailMap, setThemeWorkbenchSkillDetailMap] =
    useState<Record<string, SkillDetailInfo | null>>({});
  const [selectedThemeWorkbenchRunId, setSelectedThemeWorkbenchRunId] =
    useState<string | null>(null);
  const [selectedThemeWorkbenchRunDetail, setSelectedThemeWorkbenchRunDetail] =
    useState<AgentRun | null>(null);
  const [themeWorkbenchRunDetailLoading, setThemeWorkbenchRunDetailLoading] =
    useState(false);
  const [
    themeWorkbenchCreationTaskEvents,
    setThemeWorkbenchCreationTaskEvents,
  ] = useState<ThemeWorkbenchCreationTaskEvent[]>([]);
  const documentEditorFocusedRef = useRef(false);

  useEffect(() => {
    setActiveContentTarget(projectId, contentId, canvasState?.type ?? null);
  }, [canvasState?.type, contentId, projectId]);

  useEffect(() => {
    persistedWorkbenchSnapshotRef.current = "";
    contentMetadataRef.current = {};
    lastCanvasSyncRequestRef.current = null;
    if (!contentId) {
      setDocumentVersionStatusMap({});
    }
  }, [contentId]);

  // General 主题专用画布状态
  const [generalCanvasState, setGeneralCanvasState] =
    useState<GeneralCanvasState>(DEFAULT_CANVAS_STATE);

  // 任务文件状态
  const [taskFiles, setTaskFiles] = useState<TaskFile[]>([]);
  const [taskFilesExpanded, setTaskFilesExpanded] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();

  // 项目上下文状态
  const [project, setProject] = useState<Project | null>(null);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(
    null,
  );
  const [runtimeStyleSelection, setRuntimeStyleSelection] =
    useState<RuntimeStyleSelection>({
      presetId: "project-default",
      strength: DEFAULT_STYLE_PROFILE.simulationStrength,
      customNotes: "",
      source: "project-default",
      sourceLabel: undefined,
      sourceProfile: null,
    });

  useEffect(() => {
    setRuntimeStyleSelection((previous) => {
      if (
        previous.presetId !== "project-default" ||
        previous.customNotes.trim()
      ) {
        return previous;
      }

      const nextStrength =
        getStyleProfileFromGuide(projectMemory?.style_guide)
          ?.simulationStrength || DEFAULT_STYLE_PROFILE.simulationStrength;

      return previous.strength === nextStrength
        ? previous
        : {
            ...previous,
            strength: nextStrength,
          };
    });
  }, [projectMemory?.style_guide]);

  // 主动 workspace 健康检查失败标记（区别于 workspacePathMissing 发送失败场景）
  const [workspaceHealthError, setWorkspaceHealthError] = useState(false);

  // 引用的角色列表（用于注入到消息中）
  const [mentionedCharacters, setMentionedCharacters] = useState<Character[]>(
    [],
  );

  // 技能列表（用于 @ 引用）
  const [skills, setSkills] = useState<Skill[]>([]);

  // Workbench Store（用于主题工作台右侧面板状态同步）
  const pendingSkillKey = useWorkbenchStore((state) => state.pendingSkillKey);
  const clearThemeSkillsRailState = useWorkbenchStore(
    (state) => state.clearThemeSkillsRailState,
  );
  const consumePendingSkill = useWorkbenchStore(
    (state) => state.consumePendingSkill,
  );

  // 用于追踪已处理的消息 ID，避免重复处理
  const processedMessageIds = useRef<Set<string>>(new Set());
  const pendingTopicSwitchRef = useRef<{
    topicId: string;
    targetProjectId: string;
  } | null>(null);
  const isResolvingTopicProjectRef = useRef(false);

  // 文件写入回调 ref（用于传递给 useAgentChat）
  const handleWriteFileRef =
    useRef<(content: string, fileName: string) => void>();

  // 工作流状态（仅在内容创作模式下使用）
  const mappedTheme = activeTheme as ThemeType;

  useEffect(() => {
    setRuntimeStyleSelection({
      presetId: "project-default",
      strength: DEFAULT_STYLE_PROFILE.simulationStrength,
      customNotes: "",
    });
  }, [mappedTheme, projectId]);
  const { steps, currentStepIndex, goToStep, completeStep } = useWorkflow(
    mappedTheme,
    creationMode,
  );

  // 内容同步 Hook
  const { syncContent, syncStatus } = useContentSync({
    debounceMs: 2000,
    autoRetry: true,
    retryDelayMs: 5000,
  });

  // 判断是否为内容创作模式
  const isContentCreationMode = isContentCreationTheme(activeTheme);

  // Artifact 状态 - 用于在画布中显示
  const artifacts = useAtomValue(artifactsAtom);
  const selectedArtifact = useAtomValue(selectedArtifactAtom);
  const setSelectedArtifactId = useSetAtom(selectedArtifactIdAtom);

  // Artifact 预览状态
  const [artifactViewMode, setArtifactViewMode] = useState<
    "source" | "preview"
  >("source");
  const [artifactPreviewSize, setArtifactPreviewSize] = useState<
    "mobile" | "tablet" | "desktop"
  >("desktop");

  // 当有新的 artifact 时，自动打开画布
  useEffect(() => {
    if (activeTheme !== "general") return;
    if (artifacts.length === 0) return;

    // 自动打开画布显示 artifact
    setLayoutMode("chat-canvas");
  }, [artifacts.length, activeTheme]);

  // 跳转到设置页安装技能
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("settings", { tab: SettingsTabs.Skills });
  }, [_onNavigate]);

  // 加载项目、Memory 和内容
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      if (contentId) {
        setIsInitialContentLoading(true);
        setInitialContentLoadError(null);
      } else {
        setIsInitialContentLoading(false);
        setInitialContentLoadError(null);
      }

      if (!projectId) {
        if (cancelled) {
          return;
        }
        setProject(null);
        setProjectMemory(null);
        setIsInitialContentLoading(false);
        return;
      }

      try {
        const p = await getProject(projectId);
        if (!p) {
          if (cancelled) {
            return;
          }
          setProject(null);
          setProjectMemory(null);
          if (contentId) {
            setInitialContentLoadError("当前项目不存在或已被删除");
          }
          return;
        }

        if (cancelled) {
          return;
        }

        setProject(p);
        const theme = projectTypeToTheme(p.workspaceType);
        if (!lockTheme || !initialTheme) {
          setActiveTheme(theme);
        }

        const memory = await getProjectMemory(projectId);
        if (cancelled) {
          return;
        }
        setProjectMemory(memory);

        if (!contentId) {
          return;
        }

        const content = await getContent(contentId);
        if (cancelled) {
          return;
        }

        if (!content) {
          setInitialContentLoadError("文稿不存在或读取失败");
          return;
        }

        contentMetadataRef.current = content.metadata || {};
        const canvasTheme = (
          lockTheme && initialTheme
            ? normalizeInitialTheme(initialTheme)
            : theme
        ) as ThemeType;
        const rawBody = content.body || "";
        const sanitizedBody = isCorruptedThemeWorkbenchDocumentContent(rawBody)
          ? ""
          : rawBody;

        if (rawBody && sanitizedBody !== rawBody) {
          setInitialContentLoadError(
            "当前文稿未生成有效主稿，请重新生成或稍后重试",
          );
        } else {
          setInitialContentLoadError(null);
        }

        let initialState =
          createInitialCanvasState(canvasTheme, sanitizedBody) ||
          createInitialDocumentState(sanitizedBody);

        if (initialState.type === "document") {
          const backendDocumentState = await getThemeWorkbenchDocumentState(
            content.id,
          ).catch((error) => {
            console.warn(
              "[AgentChatPage] 读取主题工作台版本状态失败，降级为 metadata 解析:",
              error,
            );
            return null;
          });
          const backendApplied = backendDocumentState
            ? applyBackendThemeWorkbenchDocumentState(
                initialState,
                backendDocumentState,
                sanitizedBody,
              )
            : null;

          if (backendApplied) {
            initialState = backendApplied.state;
            setDocumentVersionStatusMap(backendApplied.statusMap);
          } else {
            const persisted = readPersistedThemeWorkbenchDocument(
              content.metadata,
            );
            if (persisted) {
              const restoredVersions = persisted.versions.map((version) =>
                version.id === persisted.currentVersionId
                  ? { ...version, content: sanitizedBody || version.content }
                  : version,
              );
              const currentVersion =
                restoredVersions.find(
                  (version) => version.id === persisted.currentVersionId,
                ) || restoredVersions[restoredVersions.length - 1];
              initialState = {
                ...initialState,
                versions: restoredVersions,
                currentVersionId: currentVersion.id,
                content: currentVersion.content,
              };
              setDocumentVersionStatusMap(persisted.versionStatusMap);
            } else {
              setDocumentVersionStatusMap({});
            }
          }
        } else {
          setDocumentVersionStatusMap({});
        }

        lastCanvasSyncRequestRef.current = {
          contentId: content.id,
          body: serializeCanvasStateForSync(initialState),
        };
        setCanvasState(initialState);
        setLayoutMode("canvas");
      } catch (error) {
        console.error("[AgentChatPage] 加载项目或文稿失败:", error);
        if (!cancelled && contentId) {
          setInitialContentLoadError("文稿加载失败，请稍后重试");
        }
      } finally {
        if (!cancelled) {
          setIsInitialContentLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [projectId, contentId, lockTheme, initialTheme]);

  useEffect(() => {
    if (!shouldBootstrapCanvasOnEntry) {
      return;
    }

    setLayoutMode("canvas");
    setCanvasState((previous) => {
      if (previous) {
        return previous;
      }

      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    });
  }, [normalizedEntryTheme, shouldBootstrapCanvasOnEntry]);

  // 当 projectId 变化时主动检查 workspace 目录健康状态
  // 静默修复（auto-created）或显示 banner 提示用户重新选择
  useEffect(() => {
    setWorkspaceHealthError(false);
    const normalizedId = normalizeProjectId(projectId);
    if (!normalizedId) return;

    ensureWorkspaceReady(normalizedId)
      .then(({ repaired, rootPath }) => {
        if (repaired) {
          recordWorkspaceRepair({
            workspaceId: normalizedId,
            rootPath,
            source: "agent_chat_page",
          });
          console.info("[AgentChatPage] workspace 目录已自动修复:", rootPath);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[AgentChatPage] workspace 目录检查失败:", message);
        setWorkspaceHealthError(true);
      });
  }, [projectId]);

  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      return;
    }

    if (project && project.id === normalizedProjectId && !project.isArchived) {
      savePersistedProjectId(LAST_PROJECT_ID_KEY, normalizedProjectId);
      return;
    }

    getProject(normalizedProjectId)
      .then((resolvedProject) => {
        if (!resolvedProject || resolvedProject.isArchived) {
          return;
        }
        savePersistedProjectId(LAST_PROJECT_ID_KEY, resolvedProject.id);
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 记录最近项目失败:", error);
      });
  }, [project, projectId]);

  const runtimeStylePrompt = useMemo(
    () =>
      buildRuntimeStyleOverridePrompt({
        projectStyleGuide: projectMemory?.style_guide,
        selection: runtimeStyleSelection,
        activeTheme: mappedTheme,
      }),
    [mappedTheme, projectMemory?.style_guide, runtimeStyleSelection],
  );

  const runtimeStyleMessagePrompt = useMemo(() => {
    const projectDefaultStrength =
      getStyleProfileFromGuide(projectMemory?.style_guide)
        ?.simulationStrength || DEFAULT_STYLE_PROFILE.simulationStrength;
    const hasPresetOverride =
      runtimeStyleSelection.presetId !== "project-default" ||
      runtimeStyleSelection.source === "library";
    const hasCustomNotes = runtimeStyleSelection.customNotes.trim().length > 0;
    const hasStrengthOverride =
      runtimeStyleSelection.strength !== projectDefaultStrength;

    return hasPresetOverride || hasCustomNotes || hasStrengthOverride
      ? runtimeStylePrompt
      : "";
  }, [projectMemory?.style_guide, runtimeStylePrompt, runtimeStyleSelection]);

  // 生成系统提示词（包含项目 Memory）
  const systemPrompt = useMemo(() => {
    let prompt = "";

    if (isContentCreationMode) {
      prompt = generateContentCreationPrompt(mappedTheme, creationMode);
    }

    // 注入项目 Memory
    if (projectMemory) {
      const memoryPrompt = generateProjectMemoryPrompt(projectMemory);
      if (memoryPrompt) {
        prompt = prompt ? `${prompt}\n\n${memoryPrompt}` : memoryPrompt;
      }
    }

    return prompt || undefined;
  }, [creationMode, isContentCreationMode, mappedTheme, projectMemory]);

  // 使用 Agent Chat Hook（传递系统提示词）
  const {
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    messages,
    isSending,
    sendMessage,
    stopSending,
    clearMessages,
    deleteMessage,
    editMessage,
    handlePermissionResponse,
    pendingActions,
    triggerAIGuide,
    topics,
    sessionId,
    createFreshSession,
    switchTopic: originalSwitchTopic,
    deleteTopic,
    renameTopic,
    workspacePathMissing,
    fixWorkspacePathAndRetry,
    dismissWorkspacePathError,
  } = useAgentChatUnified({
    systemPrompt,
    onWriteFile: (content, fileName) => {
      // 使用 ref 调用最新的 handleWriteFile
      handleWriteFileRef.current?.(content, fileName);
    },
    workspaceId: projectId ?? "",
  });
  const { providers: configuredProviders } = useConfiguredProviders();
  const subAgentRuntime = useSubAgentScheduler(sessionId);
  const harnessState = useMemo(
    () => deriveHarnessSessionState(messages, pendingActions),
    [messages, pendingActions],
  );
  const [harnessPanelVisible, setHarnessPanelVisible] = useState(() =>
    loadPersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, false),
  );
  const selectedProvider = useMemo(
    () => configuredProviders.find((provider) => provider.key === providerType),
    [configuredProviders, providerType],
  );
  const { models: providerModels } = useProviderModels(selectedProvider, {
    returnFullMetadata: true,
  });
  const thinkingVariantWarnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onSessionChange?.(sessionId ?? null);
  }, [onSessionChange, sessionId]);

  useEffect(() => {
    savePersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, harnessPanelVisible);
  }, [harnessPanelVisible]);

  const contextWorkspace = useThemeContextWorkspace({
    projectId,
    activeTheme,
    messages,
    providerType,
    model,
  });
  const installedSkills = useMemo(
    () => skills.filter((skill) => skill.installed),
    [skills],
  );
  const harnessPendingCount = harnessState.pendingApprovals.length;
  const showHarnessToggle =
    harnessPanelVisible || harnessState.hasSignals || subAgentRuntime.isRunning;
  const harnessAttentionLevel =
    harnessPendingCount > 0 ? "warning" : showHarnessToggle ? "active" : "idle";
  const visibleContextItems = useMemo(() => {
    const activeItems = contextWorkspace.sidebarContextItems.filter(
      (item) => item.active,
    );
    return activeItems.length > 0
      ? activeItems
      : contextWorkspace.sidebarContextItems;
  }, [contextWorkspace.sidebarContextItems]);
  const harnessEnvironment = useMemo(
    () => ({
      skillsCount: installedSkills.length,
      skillNames: installedSkills
        .map((skill) => skill.name || skill.key)
        .filter((name) => !!name.trim())
        .slice(0, 4),
      memorySignals: [
        projectMemory?.characters.length ? "角色" : null,
        projectMemory?.world_building ? "世界观" : null,
        projectMemory?.style_guide ? "风格" : null,
        projectMemory?.outline.length ? "大纲" : null,
      ].filter((item): item is string => item !== null),
      contextItemsCount: contextWorkspace.sidebarContextItems.length,
      activeContextCount: contextWorkspace.sidebarContextItems.filter(
        (item) => item.active,
      ).length,
      contextItemNames: visibleContextItems
        .map((item) => item.name)
        .filter((name) => !!name.trim())
        .slice(0, 4),
      contextEnabled: contextWorkspace.enabled,
    }),
    [
      contextWorkspace.enabled,
      contextWorkspace.sidebarContextItems,
      installedSkills,
      projectMemory?.characters.length,
      projectMemory?.outline.length,
      projectMemory?.style_guide,
      projectMemory?.world_building,
      visibleContextItems,
    ],
  );
  const isThemeWorkbench = contextWorkspace.enabled;
  const shouldUseCompactThemeWorkbench =
    isThemeWorkbench && (mappedTheme === "video" || mappedTheme === "poster");
  const shouldSkipThemeWorkbenchAutoGuideWithoutPrompt =
    isThemeWorkbench &&
    (shouldUseCompactThemeWorkbench || mappedTheme === "novel");
  const enableThemeWorkbenchPanelCollapse =
    isThemeWorkbench && mappedTheme === "social-media";

  // 加载 skills 列表
  useEffect(() => {
    let cancelled = false;
    skillsApi
      .getAll("proxycast")
      .then((loadedSkills) => {
        if (!cancelled) {
          setSkills(loadedSkills);
        }
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 加载 skills 失败:", error);
        if (!cancelled) {
          setSkills([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 主题工作台模式：同步 skills 状态到 store
  // 注意：不再设置 themeSkillsRailState，避免"操作面板"覆盖默认 Skills Rail
  // 默认 Skills Rail 已包含完整的技能分类（文字多搜索、视觉生成、音频生成等）
  useEffect(() => {
    if (!isThemeWorkbench) {
      clearThemeSkillsRailState();
    }
  }, [isThemeWorkbench, clearThemeSkillsRailState]);

  // 组件卸载时清理 store 状态
  useEffect(() => {
    return () => {
      clearThemeSkillsRailState();
    };
  }, [clearThemeSkillsRailState]);

  useEffect(() => {
    if (!isThemeWorkbench) {
      setThemeWorkbenchCreationTaskEvents([]);
    }
  }, [isThemeWorkbench]);

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      return;
    }

    setThemeWorkbenchCreationTaskEvents([]);

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    safeListen<CreationTaskSubmittedPayload>(
      THEME_WORKBENCH_CREATION_TASK_EVENT_NAME,
      (event) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeThemeWorkbenchCreationTaskEvent(
          event.payload || {},
        );
        if (!normalized) {
          return;
        }
        setThemeWorkbenchCreationTaskEvents((previous) => {
          const deduplicated = previous.filter(
            (item) =>
              item.taskId !== normalized.taskId &&
              item.path !== normalized.path,
          );
          return [normalized, ...deduplicated].slice(
            0,
            MAX_THEME_WORKBENCH_CREATION_TASK_EVENTS,
          );
        });
      },
    )
      .then((dispose) => {
        if (cancelled) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 监听任务提交事件失败:", error);
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [isThemeWorkbench, sessionId]);

  useEffect(() => {
    if (!isThemeWorkbench || canvasState) {
      return;
    }

    const initialThemeWorkbenchCanvas =
      createInitialCanvasState(mappedTheme, "") ||
      createInitialDocumentState("");
    if (!initialThemeWorkbenchCanvas) {
      return;
    }

    setCanvasState(initialThemeWorkbenchCanvas);
    setLayoutMode((previous) => (previous === "chat" ? "canvas" : previous));
  }, [canvasState, isThemeWorkbench, mappedTheme]);

  useEffect(() => {
    if (enableThemeWorkbenchPanelCollapse) {
      return;
    }
    setThemeWorkbenchSidebarCollapsed(false);
  }, [enableThemeWorkbenchPanelCollapse]);
  const versionTopics = useMemo(() => {
    if (!isThemeWorkbench || !canvasState || canvasState.type !== "document") {
      return [];
    }
    return canvasState.versions.map((version, index) => ({
      id: version.id,
      title: version.description?.trim() || `版本 ${index + 1}`,
      messagesCount: version.content.trim() ? 2 : 0,
    }));
  }, [canvasState, isThemeWorkbench]);
  const currentVersionId =
    isThemeWorkbench && canvasState?.type === "document"
      ? canvasState.currentVersionId
      : null;
  const { branchItems, setTopicStatus } = useTopicBranchBoard({
    enabled: isThemeWorkbench && canvasState?.type === "document",
    projectId,
    currentTopicId: currentVersionId,
    topics: versionTopics,
    externalStatusMap: documentVersionStatusMap,
    onStatusMapChange: setDocumentVersionStatusMap,
  });

  useEffect(() => {
    if (
      !isThemeWorkbench ||
      !contentId ||
      !canvasState ||
      canvasState.type !== "document"
    ) {
      return;
    }

    const persisted = buildPersistedThemeWorkbenchDocument(
      canvasState,
      documentVersionStatusMap,
    );
    if (!persisted) {
      return;
    }

    const snapshot = JSON.stringify(persisted);
    if (snapshot === persistedWorkbenchSnapshotRef.current) {
      return;
    }

    const nextMetadata = {
      ...(contentMetadataRef.current || {}),
      [THEME_WORKBENCH_DOCUMENT_META_KEY]: persisted,
    };

    const timer = setTimeout(() => {
      updateContent(contentId, {
        metadata: nextMetadata,
      })
        .then((updated) => {
          contentMetadataRef.current = updated.metadata || nextMetadata;
          persistedWorkbenchSnapshotRef.current = snapshot;
        })
        .catch((error) => {
          console.warn("[AgentChatPage] 保存文稿版本状态失败:", error);
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, [canvasState, contentId, documentVersionStatusMap, isThemeWorkbench]);

  const pendingActionRequest = useMemo(() => {
    if (!isThemeWorkbench) {
      return null;
    }
    return (
      [...messages]
        .reverse()
        .find((message) =>
          message.actionRequests?.some(
            (request) => request.status !== "submitted",
          ),
        )
        ?.actionRequests?.find((request) => request.status !== "submitted") ||
      null
    );
  }, [isThemeWorkbench, messages]);

  // 提取最新的 A2UI Form（从最后一条 assistant 消息的 content 解析）
  const pendingA2UIForm = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.role === "user") {
        return null;
      }

      if (msg.role === "assistant" && msg.content) {
        try {
          const parsed = parseAIResponse(msg.content, false);
          if (parsed.hasA2UI) {
            for (let j = parsed.parts.length - 1; j >= 0; j--) {
              const part = parsed.parts[j];
              if (part.type === "a2ui" && typeof part.content !== "string") {
                return part.content;
              }
            }
          }
        } catch {
          // 解析失败，忽略
        }
      }
    }
    return null;
  }, [messages]);

  const a2uiSubmissionNotice = useMemo(() => {
    if (pendingA2UIForm) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "user") {
        continue;
      }

      const content = msg.content.trim();
      if (!content.startsWith("我的选择：")) {
        return null;
      }

      const summary = content
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ");

      return {
        title: "需求已确认",
        summary: summary || "已收到你的补充信息，正在继续推进下一步。",
      };
    }

    return null;
  }, [messages, pendingA2UIForm]);

  useEffect(() => {
    const unsubscribe = subscribeDocumentEditorFocus((focused) => {
      documentEditorFocusedRef.current = focused;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      themeWorkbenchRunStateSignatureRef.current = "";
      setThemeWorkbenchBackendRunState(null);
      return;
    }

    let disposed = false;
    let inFlight = false;
    let timer: number | null = null;
    const activePollIntervalMs = isSending ? 1000 : 3000;
    const idlePollIntervalMs = isSending ? 1000 : 10000;
    const focusedPollIntervalMs = isSending ? 1000 : 15000;

    const scheduleNext = (delayMs: number) => {
      if (disposed) {
        return;
      }
      timer = window.setTimeout(() => {
        void fetchRunState();
      }, delayMs);
    };

    const fetchRunState = async () => {
      if (disposed || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const state = await executionRunGetThemeWorkbenchState(sessionId, 3);
        if (!disposed) {
          const nextSignature = buildThemeWorkbenchRunStateSignature(state);
          if (themeWorkbenchRunStateSignatureRef.current !== nextSignature) {
            themeWorkbenchRunStateSignatureRef.current = nextSignature;
            setThemeWorkbenchBackendRunState(state);
          }

          const hasFreshRunningQueueItem = (state.queue_items || []).some(
            (item) => {
              if (item.status !== "running") {
                return false;
              }
              const startedAt = new Date(item.started_at);
              if (Number.isNaN(startedAt.getTime())) {
                return false;
              }
              return (
                Date.now() - startedAt.getTime() <=
                THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS
              );
            },
          );

          const latestTerminalRunning =
            state.latest_terminal?.status === "running";
          const hasActiveBackendRun =
            state.run_state === "auto_running" ||
            hasFreshRunningQueueItem ||
            latestTerminalRunning;
          const isEditorFocused = documentEditorFocusedRef.current;
          scheduleNext(
            hasActiveBackendRun
              ? activePollIntervalMs
              : isEditorFocused
                ? focusedPollIntervalMs
                : idlePollIntervalMs,
          );
        }
      } catch (error) {
        if (!disposed) {
          console.warn("[AgentChatPage] 拉取主题工作台运行状态失败:", error);
          if (themeWorkbenchRunStateSignatureRef.current !== "null") {
            themeWorkbenchRunStateSignatureRef.current = "null";
            setThemeWorkbenchBackendRunState(null);
          }
          scheduleNext(
            documentEditorFocusedRef.current
              ? focusedPollIntervalMs
              : activePollIntervalMs,
          );
        }
      } finally {
        inFlight = false;
      }
    };

    void fetchRunState();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isSending, isThemeWorkbench, sessionId]);

  const themeWorkbenchRequiredSkillNames = useMemo(() => {
    if (!isThemeWorkbench) {
      return [] as string[];
    }

    const requiredSkillNames = new Set<string>();
    messages.forEach((message) => {
      if (message.role !== "user") {
        return;
      }
      const skillName = parseSkillSlashCommand(message.content)?.skillName;
      if (skillName) {
        requiredSkillNames.add(skillName);
      }
    });
    (themeWorkbenchBackendRunState?.queue_items || []).forEach((item) => {
      const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
      if (sourceRef) {
        requiredSkillNames.add(sourceRef);
      }
    });
    const terminalSourceRef = resolveThemeWorkbenchSkillSourceRef(
      themeWorkbenchBackendRunState?.latest_terminal || {},
    );
    if (terminalSourceRef) {
      requiredSkillNames.add(terminalSourceRef);
    }

    return [...requiredSkillNames].sort();
  }, [
    isThemeWorkbench,
    messages,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchBackendRunState?.queue_items,
  ]);

  useEffect(() => {
    if (!isThemeWorkbench) {
      setThemeWorkbenchSkillDetailMap((prev) =>
        Object.keys(prev).length === 0 ? prev : {},
      );
      return;
    }

    const missingSkillNames = themeWorkbenchRequiredSkillNames.filter(
      (skillName) => !(skillName in themeWorkbenchSkillDetailMap),
    );
    if (missingSkillNames.length === 0) {
      return;
    }

    let disposed = false;
    Promise.all(
      missingSkillNames.map(async (skillName) => {
        try {
          const detail = await skillExecutionApi.getSkillDetail(skillName);
          return [skillName, detail] as const;
        } catch (error) {
          console.warn(
            "[AgentChatPage] 加载 Skill 详情失败:",
            skillName,
            error,
          );
          return [skillName, null] as const;
        }
      }),
    ).then((entries) => {
      if (disposed) {
        return;
      }
      setThemeWorkbenchSkillDetailMap((prev) => {
        const next = { ...prev };
        entries.forEach(([skillName, detail]) => {
          next[skillName] = detail;
        });
        return next;
      });
    });

    return () => {
      disposed = true;
    };
  }, [
    isThemeWorkbench,
    themeWorkbenchRequiredSkillNames,
    themeWorkbenchSkillDetailMap,
  ]);

  const themeWorkbenchWorkflowSteps = useMemo(
    () =>
      buildThemeWorkbenchWorkflowSteps(
        messages,
        themeWorkbenchBackendRunState,
        isSending,
        themeWorkbenchSkillDetailMap,
      ),
    [
      isSending,
      messages,
      themeWorkbenchBackendRunState,
      themeWorkbenchSkillDetailMap,
    ],
  );

  const themeWorkbenchActiveQueueItem = useMemo(() => {
    const queueItems = themeWorkbenchBackendRunState?.queue_items || [];
    return (
      queueItems.find((item) => item.status === "running") ||
      queueItems[0] ||
      null
    );
  }, [themeWorkbenchBackendRunState?.queue_items]);

  const themeWorkbenchExecutionRunMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return map;
    }

    const register = (executionId?: string | null, runId?: string | null) => {
      const normalizedExecutionId = executionId?.trim();
      const normalizedRunId = runId?.trim();
      if (!normalizedExecutionId || !normalizedRunId) {
        return;
      }
      map.set(normalizedExecutionId, normalizedRunId);
    };

    (themeWorkbenchBackendRunState.queue_items || []).forEach((item) => {
      register(item.execution_id, item.run_id);
    });
    register(
      themeWorkbenchBackendRunState.latest_terminal?.execution_id,
      themeWorkbenchBackendRunState.latest_terminal?.run_id,
    );

    return map;
  }, [isThemeWorkbench, themeWorkbenchBackendRunState]);

  const themeWorkbenchBackendActivityLogs = useMemo<
    SidebarActivityLog[]
  >(() => {
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return [];
    }

    const runningLogs = (themeWorkbenchBackendRunState.queue_items || []).map(
      (item) => {
        const gateKey =
          item.gate_key || inferThemeWorkbenchGateFromQueueItem(item).key;
        return {
          id: `run-queue-${item.run_id}`,
          name: item.title || "执行主题工作台编排",
          status: "running" as const,
          timeLabel: formatThemeWorkbenchRunTimeLabel(item.started_at),
          applyTarget: resolveThemeWorkbenchApplyTargetByGateKey(gateKey),
          runId: item.run_id,
          executionId: item.execution_id || undefined,
          sessionId: item.session_id || undefined,
          artifactPaths:
            Array.isArray(item.artifact_paths) && item.artifact_paths.length > 0
              ? item.artifact_paths
              : undefined,
          gateKey,
          source: item.source,
        };
      },
    );

    const terminal = themeWorkbenchBackendRunState.latest_terminal;
    const terminalLog: SidebarActivityLog[] = terminal
      ? [
          {
            id: `run-terminal-${terminal.run_id}`,
            name: terminal.title || "执行主题工作台编排",
            status: terminal.status === "success" ? "completed" : "failed",
            timeLabel: formatThemeWorkbenchRunTimeLabel(
              terminal.finished_at || terminal.started_at,
            ),
            durationLabel: formatThemeWorkbenchRunDurationLabel(
              terminal.started_at,
              terminal.finished_at,
            ),
            applyTarget: resolveThemeWorkbenchApplyTargetByGateKey(
              terminal.gate_key || "idle",
            ),
            runId: terminal.run_id,
            executionId: terminal.execution_id || undefined,
            sessionId: terminal.session_id || undefined,
            artifactPaths:
              Array.isArray(terminal.artifact_paths) &&
              terminal.artifact_paths.length > 0
                ? terminal.artifact_paths
                : undefined,
            gateKey: terminal.gate_key || "idle",
            source: terminal.source,
          },
        ]
      : [];

    return [...runningLogs, ...terminalLog];
  }, [isThemeWorkbench, themeWorkbenchBackendRunState]);

  const themeWorkbenchActivityLogs = useMemo<SidebarActivityLog[]>(() => {
    if (!isThemeWorkbench) {
      return contextWorkspace.activityLogs;
    }
    const enrichedContextLogs = contextWorkspace.activityLogs.map((log) => {
      const normalizedRunId = log.runId?.trim();
      if (normalizedRunId) {
        return {
          ...log,
          runId: normalizedRunId,
        };
      }

      const candidateExecutionIds =
        resolveExecutionIdCandidatesForActivityLog(log);
      for (const executionId of candidateExecutionIds) {
        const mappedRunId = themeWorkbenchExecutionRunMap.get(executionId);
        if (!mappedRunId) {
          continue;
        }
        return {
          ...log,
          executionId,
          runId: mappedRunId,
        };
      }

      return log;
    });

    return [...themeWorkbenchBackendActivityLogs, ...enrichedContextLogs];
  }, [
    contextWorkspace.activityLogs,
    isThemeWorkbench,
    themeWorkbenchBackendActivityLogs,
    themeWorkbenchExecutionRunMap,
  ]);

  const handleViewThemeWorkbenchRunDetail = useCallback((runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }
    setSelectedThemeWorkbenchRunId(normalizedRunId);
  }, []);

  const handleViewContextDetail = useCallback(
    (contextId: string) => {
      const detail = contextWorkspace.getContextDetail(contextId);
      if (!detail) {
        toast.error("无法找到上下文详情");
        return;
      }

      // 显示上下文详情
      const sourceLabel =
        detail.source === "material"
          ? "素材库"
          : detail.source === "content"
            ? "历史内容"
            : "搜索结果";

      toast.info(
        <div style={{ maxWidth: "500px" }}>
          <div style={{ fontWeight: 600, marginBottom: "8px" }}>
            {detail.name}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "hsl(var(--muted-foreground))",
              marginBottom: "8px",
            }}
          >
            来源: {sourceLabel} · 约 {detail.estimatedTokens} tokens
          </div>
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.5",
              maxHeight: "300px",
              overflow: "auto",
            }}
          >
            {detail.bodyText || detail.previewText}
          </div>
        </div>,
        { duration: 10000 },
      );
    },
    [contextWorkspace],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !selectedThemeWorkbenchRunId) {
      setThemeWorkbenchRunDetailLoading(false);
      setSelectedThemeWorkbenchRunDetail(null);
      return;
    }

    let cancelled = false;
    setThemeWorkbenchRunDetailLoading(true);
    executionRunGet(selectedThemeWorkbenchRunId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedThemeWorkbenchRunDetail(detail);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedThemeWorkbenchRunDetail(null);
        console.warn("[AgentChatPage] 加载运行详情失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setThemeWorkbenchRunDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isThemeWorkbench, selectedThemeWorkbenchRunId]);

  const currentGateBase = useMemo(() => {
    if (!isThemeWorkbench) {
      return {
        key: "idle",
        title: "编排待启动",
        requiresUserDecision: false,
        description: "输入目标后将自动进入编排执行。",
      };
    }

    if (pendingActionRequest) {
      const prompt =
        pendingActionRequest.prompt ||
        pendingActionRequest.questions?.[0]?.question ||
        "等待你的决策以继续执行后续节点。";
      return {
        key: pendingActionRequest.actionType,
        title: "人工闸门",
        requiresUserDecision: true,
        description: prompt,
      };
    }

    if (themeWorkbenchBackendRunState?.run_state === "auto_running") {
      const backendGateKey = themeWorkbenchBackendRunState.current_gate_key;
      if (
        backendGateKey === "topic_select" ||
        backendGateKey === "write_mode" ||
        backendGateKey === "publish_confirm"
      ) {
        const backendGate = resolveThemeWorkbenchGateByKey(
          backendGateKey,
          themeWorkbenchActiveQueueItem?.title,
        );
        return {
          key: backendGate.key,
          title: backendGate.title,
          requiresUserDecision: false,
          description: backendGate.description,
        };
      }
      const backendGate = inferThemeWorkbenchGateFromQueueItem(
        themeWorkbenchActiveQueueItem,
      );
      return {
        key: backendGate.key,
        title: backendGate.title,
        requiresUserDecision: false,
        description: backendGate.description,
      };
    }

    return {
      key: "idle",
      title: "编排待启动",
      requiresUserDecision: false,
      description: "输入目标后将自动进入编排执行。",
    };
  }, [
    isThemeWorkbench,
    pendingActionRequest,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState?.current_gate_key,
    themeWorkbenchBackendRunState?.run_state,
  ]);

  const themeWorkbenchRunState = useMemo<
    "idle" | "auto_running" | "await_user_decision"
  >(() => {
    if (!isThemeWorkbench) {
      return "idle";
    }
    if (currentGateBase.requiresUserDecision) {
      return "await_user_decision";
    }
    if (themeWorkbenchBackendRunState) {
      if (themeWorkbenchBackendRunState.run_state !== "auto_running") {
        return "idle";
      }

      const hasFreshRunningQueueItem = (
        themeWorkbenchBackendRunState.queue_items || []
      ).some((item) => {
        if (item.status !== "running") {
          return false;
        }
        const startedAt = new Date(item.started_at);
        if (Number.isNaN(startedAt.getTime())) {
          return false;
        }
        return (
          Date.now() - startedAt.getTime() <=
          THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS
        );
      });

      if (hasFreshRunningQueueItem || isSending) {
        return "auto_running";
      }
      return "idle";
    }
    return isSending ? "auto_running" : "idle";
  }, [
    currentGateBase.requiresUserDecision,
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    isSending,
  ]);

  const currentGate = useMemo(() => {
    const status = currentGateBase.requiresUserDecision
      ? ("waiting" as const)
      : themeWorkbenchRunState === "auto_running"
        ? ("running" as const)
        : ("idle" as const);

    return {
      key: currentGateBase.key,
      title: currentGateBase.title,
      description: currentGateBase.description,
      status,
    };
  }, [currentGateBase, themeWorkbenchRunState]);

  useEffect(() => {
    if (!isThemeWorkbench || themeWorkbenchRunState !== "idle") {
      return;
    }
    if (!canvasState || canvasState.type !== "document") {
      return;
    }

    setDocumentVersionStatusMap((previous) => {
      const latestTerminal = themeWorkbenchBackendRunState?.latest_terminal;
      if (latestTerminal) {
        const terminalVersionId = latestTerminal.run_id;
        const terminalVersionExists = canvasState.versions.some(
          (version) => version.id === terminalVersionId,
        );
        if (terminalVersionExists) {
          const terminalStatus: TopicBranchStatus =
            latestTerminal.status === "success" ? "merged" : "candidate";
          if (previous[terminalVersionId] !== terminalStatus) {
            return {
              ...previous,
              [terminalVersionId]: terminalStatus,
            };
          }
        }
      }

      const currentVersionId = canvasState.currentVersionId;
      if (!currentVersionId || previous[currentVersionId] !== "in_progress") {
        return previous;
      }
      return {
        ...previous,
        [currentVersionId]: "pending",
      };
    });
  }, [
    canvasState,
    isThemeWorkbench,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchRunState,
  ]);

  // 会话文件持久化 hook
  const {
    saveFile: saveSessionFile,
    files: sessionFiles,
    readFile: readSessionFile,
    meta: sessionMeta,
  } = useSessionFiles({
    sessionId,
    theme: mappedTheme,
    creationMode,
    autoInit: true,
  });

  // 监听画布状态变化，自动同步到 Content
  useEffect(() => {
    if (!canvasState || !contentId) {
      return;
    }

    try {
      const content = serializeCanvasStateForSync(canvasState);
      if (isSyncContentEmpty(content)) {
        return;
      }

      const previousRequest = lastCanvasSyncRequestRef.current;
      if (
        previousRequest?.contentId === contentId &&
        previousRequest.body === content
      ) {
        return;
      }

      lastCanvasSyncRequestRef.current = { contentId, body: content };
      syncContent(contentId, content);
    } catch (error) {
      console.error("提取画布内容失败:", error);
    }
  }, [canvasState, contentId, syncContent]);

  // 追踪已恢复元数据和文件的会话 ID
  const restoredMetaSessionId = useRef<string | null>(null);
  const restoredFilesSessionId = useRef<string | null>(null);
  // 用于追踪是否已触发过 AI 引导
  const hasTriggeredGuide = useRef(false);
  const consumedInitialPromptRef = useRef<string | null>(null);

  // 当 sessionMeta 加载完成时，恢复主题和创建模式
  useEffect(() => {
    if (!sessionId || !sessionMeta) {
      return;
    }

    // 检查 sessionMeta 是否属于当前 sessionId
    if (sessionMeta.sessionId !== sessionId) {
      return;
    }

    // 避免重复恢复
    if (restoredMetaSessionId.current === sessionId) {
      return;
    }

    console.log("[AgentChatPage] 恢复会话元数据:", sessionId, sessionMeta);

    // 从会话元数据恢复主题（类型已统一，直接使用）
    if (sessionMeta.theme && (!lockTheme || !initialTheme)) {
      // 通用对话入口（initialTheme 为空或 "general"）不应恢复为内容创作主题，
      // 避免切换历史话题时错误激活社媒等创作模式
      const entryIsGeneral = !initialTheme || initialTheme === "general";
      const restoredIsCreation = isContentCreationTheme(sessionMeta.theme);
      if (entryIsGeneral && restoredIsCreation) {
        console.log(
          "[AgentChatPage] 通用对话入口，跳过恢复内容创作主题:",
          sessionMeta.theme,
        );
      } else {
        console.log("[AgentChatPage] 恢复主题:", sessionMeta.theme);
        setActiveTheme(sessionMeta.theme);
      }
    }

    // 从会话元数据恢复创建模式
    if (sessionMeta.creationMode) {
      console.log("[AgentChatPage] 恢复创建模式:", sessionMeta.creationMode);
      setCreationMode(sessionMeta.creationMode as CreationMode);
    }

    restoredMetaSessionId.current = sessionId;
  }, [sessionId, sessionMeta, lockTheme, initialTheme]);

  // 当 sessionFiles 加载完成时，恢复文件到 taskFiles
  useEffect(() => {
    if (!sessionId || sessionFiles.length === 0) {
      return;
    }

    // 避免重复恢复
    if (restoredFilesSessionId.current === sessionId) {
      return;
    }

    // 如果当前已有 taskFiles，说明是本次会话新生成的文件，不需要从持久化恢复
    if (taskFiles.length > 0) {
      restoredFilesSessionId.current = sessionId;
      return;
    }

    console.log(
      "[AgentChatPage] 开始恢复文件:",
      sessionId,
      sessionFiles.length,
      "个文件",
    );

    // 恢复文件到 taskFiles
    const restoreFiles = async () => {
      const restoredFiles: TaskFile[] = [];

      for (const file of sessionFiles) {
        try {
          const content = await readSessionFile(file.name);
          if (content) {
            restoredFiles.push({
              id: crypto.randomUUID(),
              name: file.name,
              type: normalizeSessionTaskFileType(
                file.fileType,
                file.name,
                content,
              ),
              content,
              version: 1,
              createdAt: file.createdAt,
              updatedAt: file.updatedAt,
            });
          }
        } catch (err) {
          console.error("[AgentChatPage] 恢复文件失败:", file.name, err);
        }
      }

      if (restoredFiles.length > 0) {
        console.log(
          "[AgentChatPage] 从持久化存储恢复",
          restoredFiles.length,
          "个文件",
        );
        setTaskFiles(restoredFiles);
      }
      restoredFilesSessionId.current = sessionId;
    };

    restoreFiles();
  }, [sessionId, sessionFiles, readSessionFile, taskFiles.length]);

  const resetTopicLocalState = useCallback(() => {
    setLayoutMode("chat");
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    processedMessageIds.current.clear();
    restoredMetaSessionId.current = null;
    restoredFilesSessionId.current = null;
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;
  }, []);

  const runTopicSwitch = useCallback(
    async (topicId: string) => {
      console.log("[AgentChatPage] switchTopic 包装函数被调用:", topicId);
      resetTopicLocalState();
      console.log("[AgentChatPage] 调用 originalSwitchTopic");
      await originalSwitchTopic(topicId);
      console.log("[AgentChatPage] originalSwitchTopic 完成");
    },
    [originalSwitchTopic, resetTopicLocalState],
  );

  const switchTopic = useCallback(
    async (topicId: string) => {
      if (isResolvingTopicProjectRef.current) {
        return;
      }

      isResolvingTopicProjectRef.current = true;
      try {
        const decision = await resolveTopicSwitchProject({
          lockedProjectId: externalProjectId ?? null,
          topicBoundProjectId: loadPersistedProjectId(
            `${TOPIC_PROJECT_KEY_PREFIX}${topicId}`,
          ),
          lastProjectId: loadPersistedProjectId(LAST_PROJECT_ID_KEY),
          loadProjectById: async (candidateProjectId) => {
            const project = await getProject(candidateProjectId);
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
          loadDefaultProject: async () => {
            const project = await getDefaultProject();
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
          createDefaultProject: async () => {
            const project = await getOrCreateDefaultProject();
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
        });

        if (decision.status === "blocked") {
          toast.error("该话题绑定了其他项目，请先切换到对应项目");
          return;
        }

        if (decision.status === "missing") {
          toast.error("未找到可用项目，请先创建项目");
          return;
        }

        const targetProjectId = decision.projectId;
        if (decision.createdDefault) {
          toast.info("未找到可用项目，已自动创建默认项目");
        }

        savePersistedProjectId(LAST_PROJECT_ID_KEY, targetProjectId);

        const currentProjectId = normalizeProjectId(projectId);
        if (currentProjectId !== targetProjectId) {
          pendingTopicSwitchRef.current = { topicId, targetProjectId };
          setInternalProjectId(targetProjectId);
          return;
        }

        await runTopicSwitch(topicId);
      } catch (error) {
        console.error("[AgentChatPage] 解析话题项目失败:", error);
        toast.error("切换话题失败，请稍后重试");
      } finally {
        isResolvingTopicProjectRef.current = false;
      }
    },
    [externalProjectId, projectId, runTopicSwitch],
  );

  useEffect(() => {
    const pending = pendingTopicSwitchRef.current;
    if (!pending) {
      return;
    }

    const currentProjectId = normalizeProjectId(projectId);
    if (currentProjectId !== pending.targetProjectId) {
      return;
    }

    pendingTopicSwitchRef.current = null;
    runTopicSwitch(pending.topicId).catch((error) => {
      console.error("[AgentChatPage] 执行待切换话题失败:", error);
      toast.error("加载话题失败，请重试");
    });
  }, [projectId, runTopicSwitch]);

  /**
   * 从 AI 响应中提取文档内容
   * 支持多种格式：
   * 1. <document>...</document> 标签（推荐）
   * 2. ```markdown ... ``` 代码块
   * 3. 以 # 开头的 Markdown 内容（仅非主题工作台）
   */
  const extractDocumentContent = useCallback(
    (content: string): string | null => {
      // 1. 检查 <document> 标签
      const documentMatch = content.match(/<document>([\s\S]*?)<\/document>/);
      if (documentMatch) {
        return documentMatch[1].trim();
      }

      // 2. 检查 markdown 代码块
      const markdownMatch = content.match(/```(?:markdown|md)\n([\s\S]*?)```/);
      if (markdownMatch) {
        return markdownMatch[1].trim();
      }

      // 3. 主题工作台：不使用启发式规则，避免误判普通回复
      if (isThemeWorkbench) {
        return null;
      }

      // 4. 非主题工作台：如果整个内容以 # 开头且长度超过 200 字符，认为是文档
      if (content.trim().startsWith("#") && content.length > 200) {
        return content.trim();
      }

      return null;
    },
    [isThemeWorkbench],
  );

  const looksLikeSerializedNovelState = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return false;

    const jsonCandidate =
      trimmed.match(/^```json\s*([\s\S]*?)```$/i)?.[1] || trimmed;

    if (!(jsonCandidate.startsWith("[") || jsonCandidate.startsWith("{"))) {
      return false;
    }

    return (
      jsonCandidate.includes('"title"') &&
      (jsonCandidate.includes('"number"') ||
        jsonCandidate.includes('"chapters"'))
    );
  }, []);

  const upsertNovelCanvasState = useCallback(
    (prev: CanvasStateUnion | null, content: string) => {
      if (!prev || prev.type !== "novel") {
        return createInitialNovelState(content);
      }

      if (looksLikeSerializedNovelState(content)) {
        return createInitialNovelState(content);
      }

      const targetChapterId =
        prev.currentChapterId || prev.chapters[0]?.id || crypto.randomUUID();
      const now = Date.now();

      if (prev.chapters.length === 0) {
        const initialized = createInitialNovelState(content);
        return {
          ...initialized,
          currentChapterId: initialized.chapters[0]?.id || targetChapterId,
        };
      }

      return {
        ...prev,
        chapters: prev.chapters.map((chapter) =>
          chapter.id === targetChapterId
            ? {
                ...chapter,
                content,
                wordCount: countNovelWords(content),
                updatedAt: now,
              }
            : chapter,
        ),
      };
    },
    [looksLikeSerializedNovelState],
  );

  // 监听 AI 消息变化，自动提取文档内容
  useEffect(() => {
    if (!isContentCreationMode) return;

    // 找到最新的 assistant 消息
    const lastAssistantMsg = [...messages]
      .reverse()
      .find(
        (msg) =>
          msg.role === "assistant" &&
          !msg.isThinking &&
          msg.content &&
          msg.purpose !== "content_review" &&
          msg.purpose !== "style_audit",
      );

    if (!lastAssistantMsg) return;

    // 主题工作台 fallback：仅在 AI 未使用 write_file 且画布为空时提取
    if (isThemeWorkbench) {
      const hasWriteFileToolCall = lastAssistantMsg.toolCalls?.some((tc) => {
        const name = (tc.name || "").toLowerCase();
        return name.includes("write") || name.includes("create_file");
      });
      if (hasWriteFileToolCall) return;
      if (canvasState && !isCanvasStateEmpty(canvasState)) return;
    }

    // 检查是否已处理过
    if (processedMessageIds.current.has(lastAssistantMsg.id)) return;

    // 提取文档内容
    const docContent = extractDocumentContent(lastAssistantMsg.content);
    if (docContent) {
      // 标记为已处理
      processedMessageIds.current.add(lastAssistantMsg.id);

      // 更新画布内容（仅文档类型画布支持流式更新）
      setCanvasState((prev) => {
        // 如果是海报主题，不自动更新画布
        if (mappedTheme === "poster") {
          return prev;
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, docContent);
        }

        if (!prev || prev.type !== "document") {
          return createInitialDocumentState(docContent);
        }
        // 添加新版本
        const newVersion = {
          id: crypto.randomUUID(),
          content: docContent,
          createdAt: Date.now(),
          description: `AI 生成 - 版本 ${prev.versions.length + 1}`,
        };
        return {
          ...prev,
          content: docContent,
          versions: [...prev.versions, newVersion],
          currentVersionId: newVersion.id,
        };
      });

      // 自动打开画布
      setLayoutMode("chat-canvas");
    }
  }, [
    messages,
    isContentCreationMode,
    isThemeWorkbench,
    extractDocumentContent,
    mappedTheme,
    upsertNovelCanvasState,
    canvasState,
  ]);

  const handleSend = useCallback(
    async (
      images?: MessageImage[],
      webSearch?: boolean,
      thinking?: boolean,
      textOverride?: string,
      sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
      autoContinuePayload?: AutoContinueRequestPayload,
      sendOptions?: HandleSendOptions,
    ) => {
      let sourceText = textOverride ?? input;
      if (!sourceText.trim() && (!images || images.length === 0)) return;
      const effectiveWebSearch = webSearch ?? chatToolPreferences.webSearch;
      const effectiveThinking = thinking ?? chatToolPreferences.thinking;

      if (!projectId) {
        sendOptions?.observer?.onError?.("请先选择项目后再开始对话");
        toast.error("请先选择项目后再开始对话");
        return;
      }

      if (
        isThemeWorkbench &&
        mappedTheme === "social-media" &&
        sourceText.trim() &&
        !sourceText.trimStart().startsWith("/") &&
        !sendOptions?.skipThemeSkillPrefix
      ) {
        sourceText = `/${SOCIAL_ARTICLE_SKILL_KEY} ${sourceText}`.trim();
      }

      let text = sourceText;

      const preparedActiveContextPrompt = contextWorkspace.enabled
        ? await contextWorkspace.prepareActiveContextPrompt()
        : "";

      if (contextWorkspace.enabled && preparedActiveContextPrompt) {
        const slashCommandMatch = text.match(
          /^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/,
        );
        if (slashCommandMatch) {
          const [, skillName, skillArgs] = slashCommandMatch;
          const mergedArgs = [preparedActiveContextPrompt, skillArgs.trim()]
            .filter((part) => part.length > 0)
            .join("\n\n");
          text = `/${skillName} ${mergedArgs}`.trim();
        } else {
          text = `${preparedActiveContextPrompt}\n\n${text}`;
        }
      }

      // 如果有引用的角色，注入角色信息
      if (mentionedCharacters.length > 0) {
        const characterContext = mentionedCharacters
          .map((char) => {
            let context = `角色：${char.name}`;
            if (char.description) context += `\n简介：${char.description}`;
            if (char.personality) context += `\n性格：${char.personality}`;
            if (char.background) context += `\n背景：${char.background}`;
            return context;
          })
          .join("\n\n");

        text = `[角色上下文]\n${characterContext}\n\n[用户输入]\n${text}`;
      }

      if (!sendOptions?.purpose && runtimeStyleMessagePrompt) {
        text = `[本次任务风格要求]\n${runtimeStyleMessagePrompt}\n\n[用户输入]\n${text}`;
      }

      setInput("");
      setMentionedCharacters([]); // 清空引用的角色

      try {
        const memoryParams = {
          scope: "aster" as const,
          workspaceId: projectId,
          sessionId,
          providerKey: providerType,
        };
        const rememberedBaseModel = loadRememberedBaseModel(memoryParams);
        let effectiveModel = model;

        if (effectiveThinking) {
          if (!isReasoningModel(model, providerModels)) {
            saveRememberedBaseModel({
              ...memoryParams,
              modelId: model,
            });
          }

          const thinkingResult = resolveThinkingModel({
            currentModelId: model,
            models: providerModels,
          });
          effectiveModel = thinkingResult.targetModelId;

          if (thinkingResult.switched) {
            setModel(thinkingResult.targetModelId);
          } else if (
            thinkingResult.reason === "no_variant" &&
            providerModels.length > 0
          ) {
            const warnKey = `${providerType}:${model}`;
            if (!thinkingVariantWarnedRef.current.has(warnKey)) {
              thinkingVariantWarnedRef.current.add(warnKey);
              toast.warning(
                "当前 Provider 没有可用的 Thinking 模型，已保持原模型",
              );
            }
          }
        } else {
          const restoreResult = resolveBaseModelOnThinkingOff({
            currentModelId: model,
            models: providerModels,
            rememberedBaseModel,
          });
          effectiveModel = restoreResult.targetModelId;

          if (restoreResult.switched) {
            setModel(restoreResult.targetModelId);
          }
        }

        const compatibilityResult = resolveProviderModelCompatibility({
          providerType,
          configuredProviderType: selectedProvider?.type,
          model: effectiveModel,
        });
        if (compatibilityResult.changed) {
          effectiveModel = compatibilityResult.model;
          if (model !== compatibilityResult.model) {
            setModel(compatibilityResult.model);
          }
          if (compatibilityResult.reason) {
            toast.warning(compatibilityResult.reason);
          }
        }

        if (autoContinuePayload) {
          await sendMessage(
            text,
            images || [],
            effectiveWebSearch,
            effectiveThinking,
            false,
            sendExecutionStrategy,
            effectiveModel,
            autoContinuePayload,
            sendOptions,
          );
        } else {
          await sendMessage(
            text,
            images || [],
            effectiveWebSearch,
            effectiveThinking,
            false,
            sendExecutionStrategy,
            effectiveModel,
            undefined,
            sendOptions,
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        sendOptions?.observer?.onError?.(errorMessage);
        console.error("[AgentChat] 发送消息失败:", error);
        toast.error(`发送失败: ${errorMessage}`);
        // 恢复输入内容，让用户可以重试
        setInput(sourceText);
      }
    },
    [
      chatToolPreferences,
      contextWorkspace,
      input,
      isThemeWorkbench,
      mentionedCharacters,
      mappedTheme,
      model,
      projectId,
      providerModels,
      providerType,
      runtimeStyleMessagePrompt,
      selectedProvider?.type,
      sendMessage,
      sessionId,
      setModel,
    ],
  );

  const handleSendRef = useRef(handleSend);
  const webSearchPreferenceRef = useRef(chatToolPreferences.webSearch);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    webSearchPreferenceRef.current = chatToolPreferences.webSearch;
  }, [chatToolPreferences.webSearch]);

  const handleDocumentThinkingEnabledChange = useCallback(
    (enabled: boolean) => {
      setChatToolPreferences((previous) =>
        previous.thinking === enabled
          ? previous
          : {
              ...previous,
              thinking: enabled,
            },
      );
    },
    [],
  );

  const handleDocumentAutoContinueRun = useCallback(
    async (payload: AutoContinueRunPayload) => {
      await handleSendRef.current(
        [],
        webSearchPreferenceRef.current,
        payload.thinkingEnabled,
        payload.prompt,
        undefined,
        {
          enabled: payload.settings.enabled,
          fast_mode_enabled: payload.settings.fastModeEnabled,
          continuation_length: payload.settings.continuationLength,
          sensitivity: payload.settings.sensitivity,
          source: "theme_workbench_document_auto_continue",
        },
      );
    },
    [],
  );

  const handleDocumentContentReviewRun = useCallback(
    async (payload: ContentReviewRunPayload) => {
      return await new Promise<string>((resolve, reject) => {
        void handleSendRef
          .current(
            [],
            webSearchPreferenceRef.current,
            payload.thinkingEnabled,
            payload.prompt,
            undefined,
            undefined,
            {
              skipThemeSkillPrefix: true,
              purpose: "content_review",
              observer: {
                onComplete: resolve,
                onError: (message) => reject(new Error(message)),
              },
            },
          )
          .catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
    [],
  );

  const handleDocumentTextStylizeRun = useCallback(
    async (payload: TextStylizeRunPayload) => {
      return await new Promise<string>((resolve, reject) => {
        void handleSendRef
          .current(
            [],
            webSearchPreferenceRef.current,
            payload.thinkingEnabled,
            payload.prompt,
            undefined,
            undefined,
            {
              skipThemeSkillPrefix: true,
              purpose: "text_stylize",
              observer: {
                onComplete: resolve,
                onError: (message) => reject(new Error(message)),
              },
            },
          )
          .catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
    [],
  );

  // 监听主题工作台技能触发
  useEffect(() => {
    if (!pendingSkillKey || !isThemeWorkbench) {
      return;
    }

    // 立即消费，避免重复触发
    consumePendingSkill();

    // 触发技能命令
    const command = `/${pendingSkillKey}`;
    console.log("[AgentChatPage] 执行技能命令:", command);
    handleSend([], false, false, command);
  }, [pendingSkillKey, isThemeWorkbench, consumePendingSkill, handleSend]);

  const handleClearMessages = useCallback(() => {
    clearMessages();
    setInput("");
    setSelectedText("");
    // 重置布局模式
    setLayoutMode("chat");
    // 恢复侧边栏显示
    setShowSidebar(true);
    // 清理画布和文件状态
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    processedMessageIds.current.clear();
    pendingTopicSwitchRef.current = null;
    isResolvingTopicProjectRef.current = false;
  }, [clearMessages]);

  const handleSwitchBranchVersion = useCallback(
    (versionId: string) => {
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          return previous;
        }

        const targetVersion = previous.versions.find(
          (version) => version.id === versionId,
        );
        if (!targetVersion) {
          return previous;
        }

        return {
          ...previous,
          currentVersionId: targetVersion.id,
          content: targetVersion.content,
        };
      });
    },
    [setCanvasState],
  );

  const handleCreateVersionSnapshot = useCallback(() => {
    setCanvasState((previous) => {
      if (!previous || previous.type !== "document") {
        toast.info("当前没有可管理的文稿版本");
        return previous;
      }

      const content = previous.content.trim();
      if (!content) {
        toast.info("主稿为空，无法创建版本快照");
        return previous;
      }

      const nextIndex = previous.versions.length + 1;
      const newVersion = {
        id: crypto.randomUUID(),
        content: previous.content,
        createdAt: Date.now(),
        description: `手动快照 - 版本 ${nextIndex}`,
      };

      toast.success("已创建版本快照");
      return {
        ...previous,
        versions: [...previous.versions, newVersion],
        currentVersionId: newVersion.id,
      };
    });
  }, [setCanvasState]);

  const handleSetBranchStatus = useCallback(
    (
      topicId: string,
      status: "in_progress" | "pending" | "merged" | "candidate",
    ) => {
      setTopicStatus(topicId, status);
      if (status === "merged") {
        toast.success("已将该版本标记为主稿");
      } else if (status === "pending") {
        toast.info("已将该版本标记为待评审");
      }
    },
    [setTopicStatus],
  );

  const handleAddImage = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "图片",
            extensions: ["jpg", "jpeg", "png", "gif", "webp"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const filePath = selected;
      if (!filePath) {
        toast.error("未选择文件");
        return;
      }

      if (!sessionId) {
        toast.error("会话未就绪");
        return;
      }

      toast.info("正在上传图片...");

      // 上传图片到会话
      const imageUrl = await uploadImageToSession(sessionId, filePath);

      // 插入图片到文档
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          toast.error("当前不在文档编辑模式");
          return previous;
        }

        const fileName = filePath.split(/[\\/]/).pop() || "image";
        const imageMarkdown = `\n\n![${fileName}](${imageUrl})\n\n`;

        return {
          ...previous,
          content: previous.content + imageMarkdown,
        };
      });

      toast.success("图片已添加");
    } catch (error) {
      console.error("添加图片失败:", error);
      toast.error(error instanceof Error ? error.message : "添加图片失败");
    }
  }, [sessionId, setCanvasState]);

  const handleImportDocument = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "文档",
            extensions: ["md", "txt"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const filePath = selected;
      if (!filePath) {
        toast.error("未选择文件");
        return;
      }

      toast.info("正在导入文稿...");

      // 调用后端解析接口
      const content = await importDocument(filePath);

      // 加载到文档
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          toast.error("当前不在文档编辑模式");
          return previous;
        }

        return {
          ...previous,
          content: content,
        };
      });

      toast.success("文稿已导入");
    } catch (error) {
      console.error("导入文稿失败:", error);
      toast.error(error instanceof Error ? error.message : "导入文稿失败");
    }
  }, [setCanvasState]);

  // 响应首页导航触发的新会话请求
  useEffect(() => {
    if (!newChatAt) {
      return;
    }

    const requestKey = String(newChatAt);
    if (handledNewChatRequestRef.current === requestKey) {
      return;
    }
    handledNewChatRequestRef.current = requestKey;

    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setLayoutMode("chat");
    setShowSidebar(true);
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    setMentionedCharacters([]);
    processedMessageIds.current.clear();
    pendingTopicSwitchRef.current = null;
    isResolvingTopicProjectRef.current = false;
    restoredMetaSessionId.current = null;
    restoredFilesSessionId.current = null;
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;

    if (!externalProjectId) {
      setInternalProjectId(null);
      setProject(null);
      setProjectMemory(null);
      setActiveTheme(normalizeInitialTheme(initialTheme));
      setCreationMode(initialCreationMode ?? "guided");
    }

    const toastId = initialSessionName
      ? "openclaw-agent-handoff"
      : "agent-new-chat";
    const canCreateFreshSession = Boolean(projectId?.trim());

    if (!canCreateFreshSession) {
      return;
    }

    void (async () => {
      const newSessionId = await createFreshSession(initialSessionName);
      if (newSessionId) {
        toast.success(
          initialSessionName
            ? `已创建新话题：${initialSessionName}`
            : "已创建新话题",
          { id: toastId },
        );
      } else {
        toast.error("创建新话题失败，请重试。", { id: toastId });
      }
    })();
  }, [
    createFreshSession,
    initialSessionName,
    newChatAt,
    clearMessages,
    externalProjectId,
    initialTheme,
    initialCreationMode,
    projectId,
  ]);

  const handleBackHome = useCallback(() => {
    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setLayoutMode("chat");
    setShowSidebar(true);
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    processedMessageIds.current.clear();
    pendingTopicSwitchRef.current = null;
    isResolvingTopicProjectRef.current = false;
    setInternalProjectId(null);
    setProject(null);
    setProjectMemory(null);
    setActiveTheme("general");
    setCreationMode("guided");
    _onNavigate?.("agent", buildHomeAgentParams());
  }, [clearMessages, _onNavigate]);

  // 当开始对话时自动折叠侧边栏
  const hasMessages = messages.length > 0;

  const handleCanvasSelectionTextChange = useCallback((text: string) => {
    const normalized = text.trim().replace(/\s+/g, " ");
    const nextValue =
      normalized.length > 500 ? normalized.slice(0, 500) : normalized;
    startTransition(() => {
      setSelectedText((previous) =>
        previous === nextValue ? previous : nextValue,
      );
    });
  }, []);

  useEffect(() => {
    setSelectedText("");
  }, [activeTheme, contentId]);

  useEffect(() => {
    if (!canvasState || canvasState.type !== "novel") {
      setNovelChapterListCollapsed(false);
    }
  }, [canvasState]);

  useEffect(() => {
    if (showChatPanel) {
      setLayoutMode((previous) =>
        previous === "canvas" ? "chat-canvas" : previous,
      );
      return;
    }

    setShowSidebar(false);

    if (layoutMode === "canvas") {
      return;
    }

    if (layoutMode === "chat-canvas") {
      setLayoutMode("canvas");
      return;
    }

    const fallbackContent = "# 新文档\n\n在这里开始编写内容...";

    if (activeTheme === "general") {
      setGeneralCanvasState((previous) => ({
        ...previous,
        isOpen: true,
        contentType:
          previous.contentType === "empty" ? "markdown" : previous.contentType,
        content: previous.content || fallbackContent,
      }));
    } else if (!canvasState) {
      const initialState =
        createInitialCanvasState(mappedTheme, fallbackContent) ||
        createInitialDocumentState(fallbackContent);
      setCanvasState(initialState);
    }

    setLayoutMode("canvas");
  }, [showChatPanel, layoutMode, activeTheme, canvasState, mappedTheme]);

  useEffect(() => {
    onHasMessagesChange?.(hasMessages);
  }, [hasMessages, onHasMessagesChange]);

  // 当有可渲染主稿文件时，仅在需要时同步到画布，避免打断当前编辑
  useEffect(() => {
    const renderableFiles = taskFiles.filter((file) =>
      isRenderableTaskFile(file, isThemeWorkbench),
    );
    if (renderableFiles.length === 0) {
      return;
    }

    const { targetFile, nextSelectedFileId } = resolveCanvasTaskFileTarget(
      renderableFiles,
      selectedFileId,
    );
    if (!targetFile?.content) {
      return;
    }

    if (nextSelectedFileId) {
      setSelectedFileId((previous) =>
        previous === nextSelectedFileId ? previous : nextSelectedFileId,
      );
    }

    if (
      shouldDeferCanvasSyncWhileEditing({
        canvasType: canvasState?.type ?? null,
        editorFocused: documentEditorFocusedRef.current,
      })
    ) {
      return;
    }

    const targetContent = targetFile.content;
    setCanvasState((prev) => {
      if (mappedTheme === "music") {
        const sections = parseLyrics(targetContent);
        if (!prev || prev.type !== "music") {
          const musicState = createInitialMusicState();
          musicState.sections = sections;
          const titleMatch = targetContent.match(/^#\s*(.+)$/m);
          if (titleMatch) {
            musicState.spec.title = titleMatch[1].trim();
          }
          return musicState;
        }
        return { ...prev, sections };
      }

      if (mappedTheme === "novel") {
        return upsertNovelCanvasState(prev, targetContent);
      }

      if (!prev || prev.type !== "document") {
        return createInitialDocumentState(targetContent);
      }
      if (prev.content === targetContent) {
        return prev;
      }
      return { ...prev, content: targetContent };
    });
    setLayoutMode("chat-canvas");
  }, [
    taskFiles,
    isThemeWorkbench,
    mappedTheme,
    upsertNovelCanvasState,
    selectedFileId,
    canvasState?.type,
  ]);

  const handleToggleSidebar = useCallback(() => {
    if (!showChatPanel) {
      return;
    }
    setShowSidebar((prev) => !prev);
  }, [showChatPanel]);

  const handleToggleNovelChapterList = useCallback(() => {
    setNovelChapterListCollapsed((prev) => !prev);
  }, []);

  const handleAddNovelChapter = useCallback(() => {
    setCanvasState((prev) => {
      if (!prev || prev.type !== "novel") {
        return prev;
      }

      const now = Date.now();
      const chapterNumber = prev.chapters.length + 1;
      const title = `第${chapterNumber}章`;
      const newChapter = {
        id: crypto.randomUUID(),
        number: chapterNumber,
        title,
        content: `# ${title}\n\n`,
        wordCount: 0,
        status: "draft" as const,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...prev,
        chapters: [...prev.chapters, newChapter],
        currentChapterId: newChapter.id,
      };
    });
    setNovelChapterListCollapsed(false);
  }, []);

  // 切换画布显示
  const handleToggleCanvas = useCallback(() => {
    // General 主题使用专门的画布
    if (activeTheme === "general") {
      setGeneralCanvasState((prev) => ({
        ...prev,
        isOpen: !prev.isOpen,
        contentType:
          prev.contentType === "empty" ? "markdown" : prev.contentType,
        content: prev.content || "# 新文档\n\n在这里开始编写内容...",
      }));
      setLayoutMode((prev) => (prev === "chat" ? "chat-canvas" : "chat"));
      return;
    }

    setLayoutMode((prev) => {
      if (prev === "chat") {
        // 打开画布时，如果没有画布状态则创建初始状态
        if (!canvasState) {
          const initialState =
            createInitialCanvasState(
              mappedTheme,
              "# 新文档\n\n在这里开始编写内容...",
            ) ||
            createInitialDocumentState("# 新文档\n\n在这里开始编写内容...");
          setCanvasState(initialState);
        }
        return "chat-canvas";
      }
      return "chat";
    });
  }, [canvasState, mappedTheme, activeTheme]);

  // 关闭画布
  const handleCloseCanvas = useCallback(() => {
    setLayoutMode("chat");
    setNovelChapterListCollapsed(false);
    // General 主题关闭画布状态
    if (activeTheme === "general") {
      setGeneralCanvasState((prev) => ({ ...prev, isOpen: false }));
    }
  }, [activeTheme]);

  const resolvedCanvasState = useMemo<CanvasStateUnion | null>(() => {
    if (canvasState) {
      return canvasState;
    }

    if (shouldBootstrapCanvasOnEntry) {
      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    }

    if (isThemeWorkbench && isContentCreationTheme(activeTheme)) {
      return (
        createInitialCanvasState(mappedTheme, "") ||
        createInitialDocumentState("")
      );
    }

    return null;
  }, [
    activeTheme,
    canvasState,
    isThemeWorkbench,
    mappedTheme,
    normalizedEntryTheme,
    shouldBootstrapCanvasOnEntry,
  ]);

  const showNovelNavbarControls =
    layoutMode !== "chat" && resolvedCanvasState?.type === "novel";

  // 处理文件写入 - 同名文件更新内容，不同名文件独立保存
  const handleWriteFile = useCallback(
    (content: string, fileName: string) => {
      console.log(
        "[AgentChatPage] 收到文件写入:",
        fileName,
        content.length,
        "字符",
      );

      // General 主题使用专门的画布处理
      if (activeTheme === "general") {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const isCode = [
          "js",
          "ts",
          "tsx",
          "jsx",
          "py",
          "rs",
          "go",
          "java",
          "c",
          "cpp",
          "h",
          "css",
          "scss",
          "json",
          "yaml",
          "yml",
          "toml",
          "xml",
          "html",
          "sql",
          "sh",
          "bash",
        ].includes(ext);
        const isMd = ["md", "markdown"].includes(ext);

        console.log(
          "[AgentChatPage] General 主题文件写入:",
          fileName,
          "类型:",
          isCode ? "code" : isMd ? "markdown" : "file",
        );

        setGeneralCanvasState({
          isOpen: true,
          contentType: isCode ? "code" : isMd ? "markdown" : "file",
          content,
          language: isCode ? ext : undefined,
          filename: fileName,
          isEditing: false,
        });
        setLayoutMode("chat-canvas");
        return;
      }

      const now = Date.now();
      const nextFileType = resolveTaskFileType(fileName, content);
      const activeQueueItem = themeWorkbenchActiveQueueItem;
      const activeRunVersionId = activeQueueItem?.run_id?.trim() || null;
      const activeRunDescription =
        activeQueueItem?.title?.trim() || `产物更新 - ${fileName}`;
      const isThemeWorkbenchPrimaryArtifact =
        !isThemeWorkbench || isThemeWorkbenchPrimaryDocumentArtifact(fileName);
      const shouldApplyToMainDocument =
        nextFileType === "document" &&
        isThemeWorkbenchPrimaryArtifact &&
        (!isThemeWorkbench || currentGate.key !== "topic_select");
      const effectiveThemeWorkbenchVersionId =
        activeRunVersionId ||
        (isThemeWorkbench && shouldApplyToMainDocument
          ? `artifact:${fileName}`
          : null);

      if (isThemeWorkbench && effectiveThemeWorkbenchVersionId) {
        const nextStatus: TopicBranchStatus =
          activeQueueItem?.status === "running" ? "in_progress" : "pending";
        setDocumentVersionStatusMap((previous) => {
          if (previous[effectiveThemeWorkbenchVersionId] === nextStatus) {
            return previous;
          }
          return {
            ...previous,
            [effectiveThemeWorkbenchVersionId]: nextStatus,
          };
        });
      }

      // 持久化文件到会话目录
      saveSessionFile(fileName, content).catch((err) => {
        console.error("[AgentChatPage] 持久化文件失败:", err);
      });

      // 同步内容到项目（如果有 contentId，先验证存在性）
      if (contentId && shouldApplyToMainDocument) {
        getContent(contentId)
          .then((existingContent) => {
            if (existingContent) {
              updateContent(contentId, {
                body: content,
              }).catch((err) => {
                console.error("[AgentChatPage] 同步内容到项目失败:", err);
              });
            } else {
              console.warn(
                "[AgentChatPage] contentId 对应的内容不存在，跳过同步:",
                contentId,
              );
            }
          })
          .catch((err) => {
            console.error("[AgentChatPage] 检查内容存在性失败:", err);
          });
      } else if (isThemeWorkbench && !shouldApplyToMainDocument) {
        console.log("[AgentChatPage] 主题工作台非成文阶段，跳过主稿写入:", {
          gate: currentGate.key,
          fileName,
          isPrimaryArtifact: isThemeWorkbenchPrimaryArtifact,
        });
      }

      // 根据文件名推进工作流步骤（使用动态映射）
      const fileToStepMap = getFileToStepMap(mappedTheme);
      const stepIndex = fileToStepMap[fileName];
      if (
        stepIndex !== undefined &&
        stepIndex === currentStepIndex &&
        isContentCreationMode
      ) {
        console.log(
          "[AgentChatPage] 推进工作流步骤:",
          stepIndex,
          "->",
          stepIndex + 1,
        );
        completeStep({
          aiOutput: { fileName, preview: content.slice(0, 100) },
        });
      }

      // 更新或创建文件
      setTaskFiles((prev) => {
        // 查找同名文件
        const existingIndex = prev.findIndex((f) => f.name === fileName);

        if (existingIndex >= 0) {
          // 同名文件存在 - 直接更新内容（不创建新版本）
          const existing = prev[existingIndex];

          // 如果内容完全相同，跳过
          if (existing.content === content) {
            console.log("[AgentChatPage] 文件内容相同，跳过:", fileName);
            setSelectedFileId(existing.id);
            return prev;
          }

          // 更新文件内容
          console.log("[AgentChatPage] 更新文件:", fileName);
          const updated = [...prev];
          updated[existingIndex] = {
            ...existing,
            type: nextFileType,
            content,
            updatedAt: now,
          };
          setSelectedFileId(existing.id);
          return updated;
        }

        // 新文件 - 添加到列表
        console.log("[AgentChatPage] 创建新文件:", fileName);
        const newFile: TaskFile = {
          id: crypto.randomUUID(),
          name: fileName,
          type: nextFileType,
          content,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        setSelectedFileId(newFile.id);
        return [...prev, newFile];
      });

      if (!shouldApplyToMainDocument) {
        return;
      }

      // 更新画布内容
      setCanvasState((prev) => {
        console.log("[AgentChatPage] 更新画布状态:", {
          prevType: prev?.type,
          mappedTheme,
          contentLength: content.length,
        });

        // 海报主题不自动更新画布
        if (mappedTheme === "poster") {
          return prev;
        }

        // 音乐主题：解析歌词并更新 sections
        if (mappedTheme === "music") {
          const sections = parseLyrics(content);
          if (!prev || prev.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            // 尝试从内容中提取歌曲名称
            const titleMatch = content.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            console.log("[AgentChatPage] 创建新音乐状态");
            return musicState;
          }
          // 更新现有音乐状态的 sections
          return {
            ...prev,
            sections,
          };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, content);
        }

        // 文档类型画布
        if (!prev || prev.type !== "document") {
          console.log("[AgentChatPage] 创建新文档状态");
          const initialDocumentState = createInitialDocumentState(content);
          if (!isThemeWorkbench || !effectiveThemeWorkbenchVersionId) {
            return initialDocumentState;
          }
          return {
            ...initialDocumentState,
            versions: [
              {
                id: effectiveThemeWorkbenchVersionId,
                content,
                createdAt: now,
                description: activeRunDescription,
              },
            ],
            currentVersionId: effectiveThemeWorkbenchVersionId,
            content,
          };
        }

        if (isThemeWorkbench && effectiveThemeWorkbenchVersionId) {
          const existingIndex = prev.versions.findIndex(
            (version) => version.id === effectiveThemeWorkbenchVersionId,
          );

          if (existingIndex >= 0) {
            const nextVersions = [...prev.versions];
            const currentVersion = nextVersions[existingIndex];
            nextVersions[existingIndex] = {
              ...currentVersion,
              content,
              description: currentVersion.description || activeRunDescription,
            };
            return {
              ...prev,
              content,
              versions: nextVersions,
              currentVersionId: effectiveThemeWorkbenchVersionId,
            };
          }

          const nextVersions = [
            ...prev.versions,
            {
              id: effectiveThemeWorkbenchVersionId,
              content,
              createdAt: now,
              description: activeRunDescription,
            },
          ].slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);

          return {
            ...prev,
            content,
            versions: nextVersions,
            currentVersionId: effectiveThemeWorkbenchVersionId,
          };
        }
        console.log("[AgentChatPage] 更新现有文档状态");
        return {
          ...prev,
          content,
        };
      });

      // 自动打开画布显示流式内容
      setLayoutMode("chat-canvas");
    },
    [
      activeTheme, // 添加 activeTheme 依赖
      currentGate.key,
      contentId,
      currentStepIndex,
      isContentCreationMode,
      isThemeWorkbench,
      completeStep,
      mappedTheme,
      saveSessionFile,
      themeWorkbenchActiveQueueItem,
      upsertNovelCanvasState,
    ],
  );

  // 更新 ref，供 useAgentChat 使用
  useEffect(() => {
    handleWriteFileRef.current = handleWriteFile;
  }, [handleWriteFile]);

  // 处理文件点击 - 在画布中显示文件内容
  const handleFileClick = useCallback(
    (fileName: string, content: string) => {
      console.log("[AgentChatPage] 文件点击:", fileName, "主题:", activeTheme);

      // General 主题使用专门的画布
      if (activeTheme === "general") {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const isCode = [
          "js",
          "ts",
          "tsx",
          "jsx",
          "py",
          "rs",
          "go",
          "java",
          "c",
          "cpp",
          "h",
          "css",
          "scss",
          "json",
          "yaml",
          "yml",
          "toml",
          "xml",
          "html",
          "sql",
          "sh",
          "bash",
        ].includes(ext);
        const isMd = ["md", "markdown"].includes(ext);

        setGeneralCanvasState({
          isOpen: true,
          contentType: isCode ? "code" : isMd ? "markdown" : "file",
          content,
          language: isCode ? ext : undefined,
          filename: fileName,
          isEditing: false,
        });
        setLayoutMode("chat-canvas");
        return;
      }

      // 查找或创建任务文件
      const nextFileType = resolveTaskFileType(fileName, content);
      setTaskFiles((prev) => {
        const existingFile = prev.find((f) => f.name === fileName);
        if (existingFile) {
          setSelectedFileId(existingFile.id);
          return prev;
        }
        // 如果文件不存在，添加到列表
        const newFile: TaskFile = {
          id: crypto.randomUUID(),
          name: fileName,
          type: nextFileType,
          content,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSelectedFileId(newFile.id);
        return [...prev, newFile];
      });

      if (
        !isRenderableTaskFile(
          { name: fileName, type: nextFileType },
          isThemeWorkbench,
        )
      ) {
        toast.info("该文件为辅助产物，暂不在主稿画布渲染");
        return;
      }

      // 更新画布内容
      setCanvasState((prev) => {
        // 音乐主题：解析歌词并更新 sections
        if (mappedTheme === "music") {
          const sections = parseLyrics(content);
          if (!prev || prev.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            const titleMatch = content.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            return musicState;
          }
          return { ...prev, sections };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, content);
        }

        // 文档类型画布
        if (!prev || prev.type !== "document") {
          return createInitialDocumentState(content);
        }
        return {
          ...prev,
          content,
        };
      });

      // 打开画布
      setLayoutMode("chat-canvas");
    },
    [activeTheme, isThemeWorkbench, mappedTheme, upsertNovelCanvasState],
  );

  const handleHarnessLoadFilePreview = useCallback(
    async (path: string): Promise<HarnessFilePreviewResult> => {
      const normalizedPath = path.trim();
      const createFallbackResult = (
        overrides: Partial<HarnessFilePreviewResult> = {},
      ): HarnessFilePreviewResult => ({
        path: normalizedPath,
        content: null,
        isBinary: false,
        size: 0,
        error: null,
        ...overrides,
      });

      if (!normalizedPath) {
        return createFallbackResult({ error: "文件路径为空" });
      }

      const fileName = extractFileNameFromPath(normalizedPath);
      const candidateNames = [...new Set([normalizedPath, fileName])];

      const matchedTaskFile = taskFiles.find((file) =>
        candidateNames.includes(file.name),
      );
      if (matchedTaskFile) {
        const content = matchedTaskFile.content ?? "";
        return createFallbackResult({
          path: matchedTaskFile.name,
          content,
          size: content.length,
        });
      }

      const matchedSessionFile = sessionFiles.find((file) =>
        candidateNames.includes(file.name),
      );
      if (matchedSessionFile) {
        const content = await readSessionFile(matchedSessionFile.name);
        if (content !== null) {
          return createFallbackResult({
            path: matchedSessionFile.name,
            content,
            size: content.length,
          });
        }
      }

      try {
        const result = await readFilePreview(normalizedPath, 64 * 1024);

        return createFallbackResult({
          path: result.path || normalizedPath,
          content: result.content ?? null,
          isBinary: result.isBinary ?? false,
          size: result.size ?? 0,
          error: result.error ?? null,
        });
      } catch (error) {
        return createFallbackResult({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [readSessionFile, sessionFiles, taskFiles],
  );

  // 处理代码块点击 - 在画布中显示代码（General 主题专用）
  const handleCodeBlockClick = useCallback(
    (language: string, code: string) => {
      console.log("[AgentChatPage] 代码块点击:", language);

      // 尝试找到匹配的 artifact（根据内容匹配）
      const matchingArtifact = artifacts.find((a) => a.content === code);

      if (matchingArtifact) {
        // 如果找到匹配的 artifact，选中它
        console.log(
          "[AgentChatPage] 找到匹配的 artifact:",
          matchingArtifact.id,
        );
        setSelectedArtifactId(matchingArtifact.id);
      } else {
        // 如果没有匹配的 artifact，使用 General 画布显示代码
        console.log("[AgentChatPage] 未找到匹配的 artifact，使用 General 画布");
        setGeneralCanvasState({
          isOpen: true,
          contentType: "code",
          content: code,
          language: language || "text",
          filename: `代码片段.${language || "txt"}`,
          isEditing: false,
        });
      }
      setLayoutMode("chat-canvas");
    },
    [artifacts, setSelectedArtifactId],
  );

  // 判断是否应该折叠代码块（当画布打开且有 artifact 时）
  const shouldCollapseCodeBlocks = useMemo(() => {
    if (activeTheme !== "general") return false;
    if (layoutMode === "chat") return false;
    // 当画布打开时折叠代码块
    return artifacts.length > 0 || generalCanvasState.isOpen;
  }, [activeTheme, layoutMode, artifacts.length, generalCanvasState.isOpen]);

  // 处理任务文件点击 - 在画布中显示文件内容
  const handleTaskFileClick = useCallback(
    (file: TaskFile) => {
      setSelectedFileId(file.id);

      if (
        !isRenderableTaskFile(file, isThemeWorkbench) ||
        looksLikeSocialPublishPayload(file.content || "") ||
        !file.content?.trim()
      ) {
        toast.info("该文件为辅助产物，暂不在主稿画布渲染");
        return;
      }

      const fileContent = file.content ?? "";

      setCanvasState((prev) => {
        // 音乐主题：解析歌词并更新 sections
        if (mappedTheme === "music") {
          const sections = parseLyrics(fileContent);
          if (!prev || prev.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            const titleMatch = fileContent.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            return musicState;
          }
          return { ...prev, sections };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, fileContent);
        }

        // 文档类型画布
        if (!prev || prev.type !== "document") {
          return createInitialDocumentState(fileContent);
        }
        return {
          ...prev,
          content: fileContent,
        };
      });
      // 只打开画布，不关闭文件列表（让用户自己关闭）
      setLayoutMode("chat-canvas");
    },
    [isThemeWorkbench, mappedTheme, upsertNovelCanvasState],
  );

  // A2UI 表单提交处理
  const handleA2UISubmit = useCallback(
    async (formData: A2UIFormData, _messageId: string) => {
      console.log("[AgentChatPage] A2UI 表单提交:", formData);

      // 将表单数据格式化为用户消息
      const formattedData = Object.entries(formData)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `- ${key}: ${value.join(", ")}`;
          }
          return `- ${key}: ${value}`;
        })
        .join("\n");

      const userMessage = `我的选择：\n${formattedData}`;

      // 发送用户消息
      await sendMessage(userMessage, [], false, false);
    },
    [sendMessage],
  );

  // 包装 A2UI 表单提交，适配 Inputbar 的签名
  const handleInputbarA2UISubmit = useCallback(
    (formData: A2UIFormData) => {
      void handleA2UISubmit(formData, "");
    },
    [handleA2UISubmit],
  );

  // 存储 triggerAIGuide 函数引用，避免在 useEffect 依赖中包含函数
  const triggerAIGuideRef = useRef(triggerAIGuide);
  triggerAIGuideRef.current = triggerAIGuide;

  // 当从项目进入且有 contentId 时，自动启动创作引导
  useEffect(() => {
    if (shouldUseCompactThemeWorkbench) {
      return;
    }

    // 条件：
    // - 有 contentId（从项目创建内容进入）
    // - 没有消息（messages.length === 0）
    // - 项目已加载
    // - 系统提示词已准备好
    // - 不在发送中
    // - 画布内容为空（canvasState 没有实际内容）
    // - 尚未触发过引导
    const canvasEmpty = isCanvasStateEmpty(canvasState);
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const defaultGuidePrompt =
      contentId && canvasEmpty && !isThemeWorkbench
        ? getDefaultGuidePromptByTheme(mappedTheme)
        : undefined;

    if (
      contentId &&
      messages.length === 0 &&
      project &&
      systemPrompt &&
      !isSending &&
      canvasEmpty
    ) {
      if (pendingInitialPrompt) {
        if (consumedInitialPromptRef.current === pendingInitialPrompt) {
          return;
        }
        consumedInitialPromptRef.current = pendingInitialPrompt;
        hasTriggeredGuide.current = true;
        console.log("[AgentChatPage] 自动发送首条创作意图消息");
        void (async () => {
          await handleSend(
            [],
            chatToolPreferences.webSearch,
            chatToolPreferences.thinking,
            pendingInitialPrompt,
          );
          onInitialUserPromptConsumed?.();
        })();
        return;
      }

      if (hasTriggeredGuide.current) {
        return;
      }

      if (defaultGuidePrompt) {
        hasTriggeredGuide.current = true;
        setInput((previous) => previous.trim() || defaultGuidePrompt);
        return;
      }

      if (isThemeWorkbench) {
        if (shouldSkipThemeWorkbenchAutoGuideWithoutPrompt) {
          return;
        }
        hasTriggeredGuide.current = true;
        console.log("[AgentChatPage] 主题工作台：触发 AI 引导，创建后端工作流");
        // 同步创建后端工作流（不阻塞触发）
        void (async () => {
          try {
            const { contentWorkflowApi } = await import(
              "@/lib/api/content-workflow"
            );
            const themeForApi =
              mappedTheme as import("@/lib/api/content-workflow").ThemeType;
            const modeForApi =
              (creationMode as import("@/lib/api/content-workflow").CreationMode) ??
              "guided";
            await contentWorkflowApi.create(
              contentId!,
              themeForApi,
              modeForApi,
            );
            console.log("[AgentChatPage] 后端工作流创建成功");
          } catch (e) {
            console.warn(
              "[AgentChatPage] 后端工作流创建失败（不影响主流程）:",
              e,
            );
          }
        })();
        triggerAIGuideRef.current();
        return;
      }

      hasTriggeredGuide.current = true;
      console.log("[AgentChatPage] 自动触发 AI 创作引导");
      triggerAIGuideRef.current();
    }
  }, [
    activeTheme,
    contentId,
    mappedTheme,
    creationMode,
    messages.length,
    project,
    systemPrompt,
    isSending,
    canvasState,
    initialUserPrompt,
    setInput,
    isThemeWorkbench,
    handleSend,
    chatToolPreferences,
    onInitialUserPromptConsumed,
    shouldUseCompactThemeWorkbench,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
  ]);

  // 通用聊天场景：若带有 initialUserPrompt，则自动新建并发送首条消息
  useEffect(() => {
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    if (
      shouldUseCompactThemeWorkbench ||
      !pendingInitialPrompt ||
      contentId ||
      !sessionId ||
      messages.length > 0 ||
      isSending
    ) {
      return;
    }

    if (consumedInitialPromptRef.current === pendingInitialPrompt) {
      return;
    }

    consumedInitialPromptRef.current = pendingInitialPrompt;
    void (async () => {
      await handleSend(
        [],
        chatToolPreferences.webSearch,
        chatToolPreferences.thinking,
        pendingInitialPrompt,
      );
      onInitialUserPromptConsumed?.();
    })();
  }, [
    chatToolPreferences,
    contentId,
    handleSend,
    initialUserPrompt,
    isSending,
    messages.length,
    onInitialUserPromptConsumed,
    sessionId,
    shouldUseCompactThemeWorkbench,
  ]);

  // 当 contentId 变化时重置引导状态
  useEffect(() => {
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;
  }, [contentId]);

  // 当 contentId 变化且是主题工作台时，尝试从后端恢复工作流
  useEffect(() => {
    if (!contentId || !isThemeWorkbench) return;

    void (async () => {
      try {
        const { contentWorkflowApi } = await import(
          "@/lib/api/content-workflow"
        );
        const workflow = await contentWorkflowApi.getByContent(contentId);
        if (workflow) {
          const completedCount = workflow.steps.filter(
            (s) => s.status === "completed" || s.status === "skipped",
          ).length;
          console.log(
            `[AgentChatPage] 找到已有工作流: ${workflow.id}，已完成步骤 ${completedCount}/${workflow.steps.length}`,
          );
        }
      } catch (e) {
        // 查询失败不影响主流程
        console.debug("[AgentChatPage] 查询后端工作流失败:", e);
      }
    })();
  }, [contentId, isThemeWorkbench]);

  // 监听封面图重新生成成功事件，将占位 URL 替换为真实图片 URL
  useEffect(() => {
    const handler = (e: Event) => {
      const { placeholder, imageUrl } = (
        e as CustomEvent<CoverImageReplacedDetail>
      ).detail;
      if (!placeholder || !imageUrl) return;
      setCanvasState((prev) => {
        if (!prev || prev.type !== "document") return prev;
        const updatedContent = prev.content.split(placeholder).join(imageUrl);
        if (updatedContent === prev.content) return prev;
        return { ...prev, content: updatedContent };
      });
    };
    window.addEventListener(COVER_IMAGE_REPLACED_EVENT, handler);
    return () =>
      window.removeEventListener(COVER_IMAGE_REPLACED_EVENT, handler);
  }, []);

  // 主题工作台始终使用聊天布局与浮层输入，不走旧 EmptyState 输入流程
  const showChatLayout = hasMessages || isThemeWorkbench;
  const shouldHideThemeWorkbenchInputForTheme = shouldUseCompactThemeWorkbench;
  const shouldShowThemeWorkbenchSidebarForTheme =
    !shouldUseCompactThemeWorkbench;
  const showThemeWorkbenchSidebar =
    showChatPanel &&
    showSidebar &&
    isThemeWorkbench &&
    shouldShowThemeWorkbenchSidebarForTheme &&
    (!enableThemeWorkbenchPanelCollapse || !themeWorkbenchSidebarCollapsed);
  const showThemeWorkbenchLeftExpandButton =
    showChatPanel &&
    showSidebar &&
    shouldShowThemeWorkbenchSidebarForTheme &&
    enableThemeWorkbenchPanelCollapse &&
    themeWorkbenchSidebarCollapsed;
  const handleThemeWorkbenchDeleteTopic = useCallback(() => {}, []);
  const handleThemeWorkbenchSidebarCollapse = useCallback(() => {
    setThemeWorkbenchSidebarCollapsed(true);
  }, []);
  const themeWorkbenchSidebarCollapseHandler = useMemo(
    () =>
      enableThemeWorkbenchPanelCollapse
        ? handleThemeWorkbenchSidebarCollapse
        : undefined,
    [enableThemeWorkbenchPanelCollapse, handleThemeWorkbenchSidebarCollapse],
  );
  const themeWorkbenchSidebarNode = useMemo(() => {
    if (!showThemeWorkbenchSidebar) {
      return null;
    }
    return (
      <ThemeWorkbenchSidebar
        branchMode="version"
        onNewTopic={handleCreateVersionSnapshot}
        onSwitchTopic={handleSwitchBranchVersion}
        onDeleteTopic={handleThemeWorkbenchDeleteTopic}
        branchItems={branchItems}
        onSetBranchStatus={handleSetBranchStatus}
        workflowSteps={themeWorkbenchWorkflowSteps}
        contextSearchQuery={contextWorkspace.contextSearchQuery}
        onContextSearchQueryChange={contextWorkspace.setContextSearchQuery}
        contextSearchMode={contextWorkspace.contextSearchMode}
        onContextSearchModeChange={contextWorkspace.setContextSearchMode}
        contextSearchLoading={contextWorkspace.contextSearchLoading}
        contextSearchError={contextWorkspace.contextSearchError}
        contextSearchBlockedReason={contextWorkspace.contextSearchBlockedReason}
        onSubmitContextSearch={contextWorkspace.submitContextSearch}
        onAddTextContext={contextWorkspace.addTextContext}
        onAddLinkContext={contextWorkspace.addLinkContext}
        onAddFileContext={contextWorkspace.addFileContext}
        onAddImage={handleAddImage}
        onImportDocument={handleImportDocument}
        contextItems={contextWorkspace.sidebarContextItems}
        onToggleContextActive={contextWorkspace.toggleContextActive}
        onViewContextDetail={handleViewContextDetail}
        contextBudget={contextWorkspace.contextBudget}
        activityLogs={themeWorkbenchActivityLogs}
        creationTaskEvents={themeWorkbenchCreationTaskEvents}
        onViewRunDetail={handleViewThemeWorkbenchRunDetail}
        activeRunDetail={selectedThemeWorkbenchRunDetail}
        activeRunDetailLoading={themeWorkbenchRunDetailLoading}
        onRequestCollapse={themeWorkbenchSidebarCollapseHandler}
        messages={messages}
      />
    );
  }, [
    branchItems,
    contextWorkspace.addFileContext,
    contextWorkspace.addLinkContext,
    contextWorkspace.addTextContext,
    contextWorkspace.contextBudget,
    contextWorkspace.contextSearchBlockedReason,
    contextWorkspace.contextSearchError,
    contextWorkspace.contextSearchLoading,
    contextWorkspace.contextSearchMode,
    contextWorkspace.contextSearchQuery,
    contextWorkspace.setContextSearchMode,
    contextWorkspace.setContextSearchQuery,
    contextWorkspace.sidebarContextItems,
    contextWorkspace.submitContextSearch,
    contextWorkspace.toggleContextActive,
    handleAddImage,
    handleImportDocument,
    handleCreateVersionSnapshot,
    handleSetBranchStatus,
    handleSwitchBranchVersion,
    handleThemeWorkbenchDeleteTopic,
    handleViewContextDetail,
    handleViewThemeWorkbenchRunDetail,
    selectedThemeWorkbenchRunDetail,
    showThemeWorkbenchSidebar,
    themeWorkbenchCreationTaskEvents,
    themeWorkbenchActivityLogs,
    themeWorkbenchRunDetailLoading,
    themeWorkbenchSidebarCollapseHandler,
    themeWorkbenchWorkflowSteps,
    messages,
  ]);

  const workflowProgressSignature = useMemo(() => {
    const shouldShow = isContentCreationMode && hasMessages && steps.length > 0;
    if (!shouldShow) {
      return "hidden";
    }

    const stepSignature = steps
      .map((step) => `${step.id}:${step.status}:${step.title}`)
      .join("|");
    return `${currentStepIndex}:${stepSignature}`;
  }, [isContentCreationMode, hasMessages, steps, currentStepIndex]);

  const lastWorkflowProgressSignatureRef = useRef<string>("");
  useEffect(() => {
    if (!onWorkflowProgressChange) return;
    if (
      lastWorkflowProgressSignatureRef.current === workflowProgressSignature
    ) {
      return;
    }
    lastWorkflowProgressSignatureRef.current = workflowProgressSignature;

    const shouldShow = isContentCreationMode && hasMessages && steps.length > 0;
    if (!shouldShow) {
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
    onWorkflowProgressChange,
    workflowProgressSignature,
    isContentCreationMode,
    hasMessages,
    steps,
    currentStepIndex,
  ]);

  useEffect(() => {
    return () => {
      onWorkflowProgressChange?.(null);
    };
  }, [onWorkflowProgressChange]);

  const handleManageProviders = useCallback(() => {
    _onNavigate?.("settings", {
      tab: SettingsTabs.Providers,
    });
  }, [_onNavigate]);

  const handleBackToResources = useCallback(() => {
    _onNavigate?.("resources");
  }, [_onNavigate]);

  const handleProjectChange = useCallback(
    (newProjectId: string) => {
      if (externalProjectId) {
        return;
      }
      pendingTopicSwitchRef.current = null;
      isResolvingTopicProjectRef.current = false;
      savePersistedProjectId(LAST_PROJECT_ID_KEY, newProjectId);
      setInternalProjectId(newProjectId);
    },
    [externalProjectId],
  );

  const handleSelectWorkspaceDirectory = useCallback(async () => {
    const newPath = await openDialog({ directory: true, multiple: false });
    if (!newPath) return;
    if (workspacePathMissing) {
      // 发送失败场景：更新路径并重试原来的消息
      await fixWorkspacePathAndRetry(newPath);
    } else if (projectId) {
      // 主动健康检查发现问题：只更新路径，不需要重试
      try {
        await updateProjectById(projectId, { rootPath: newPath });
        setWorkspaceHealthError(false);
        toast.success("工作区目录已更新");
      } catch (err) {
        toast.error(
          `更新路径失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }, [fixWorkspacePathAndRetry, projectId, workspacePathMissing]);

  const handleSelectCharacter = useCallback((character: Character) => {
    setMentionedCharacters((prev) => {
      if (prev.find((c) => c.id === character.id)) {
        return prev;
      }
      return [...prev, character];
    });
  }, []);

  const handleToggleTaskFiles = useCallback(() => {
    setTaskFilesExpanded((previous) => !previous);
  }, []);

  const visibleTaskFiles = useMemo(
    () =>
      taskFiles.filter((file) => isRenderableTaskFile(file, isThemeWorkbench)),
    [taskFiles, isThemeWorkbench],
  );

  const visibleSelectedFileId = useMemo(() => {
    if (!selectedFileId) {
      return undefined;
    }
    return visibleTaskFiles.some((file) => file.id === selectedFileId)
      ? selectedFileId
      : undefined;
  }, [selectedFileId, visibleTaskFiles]);

  const styleActionContent = useMemo(
    () =>
      extractStyleActionContent({
        activeTheme: mappedTheme,
        generalCanvasState,
        resolvedCanvasState,
        taskFiles: visibleTaskFiles,
        selectedFileId: visibleSelectedFileId,
      }),
    [
      generalCanvasState,
      mappedTheme,
      resolvedCanvasState,
      visibleSelectedFileId,
      visibleTaskFiles,
    ],
  );

  const styleActionFileName = useMemo(
    () =>
      resolveStyleActionFileName({
        activeTheme: mappedTheme,
        generalCanvasState,
        resolvedCanvasState,
        taskFiles: visibleTaskFiles,
        selectedFileId: visibleSelectedFileId,
      }),
    [
      generalCanvasState,
      mappedTheme,
      resolvedCanvasState,
      visibleSelectedFileId,
      visibleTaskFiles,
    ],
  );

  const styleActionsDisabled =
    !projectId || !runtimeStylePrompt || !styleActionContent.trim();

  const handleRunStyleRewrite = useCallback(() => {
    if (!styleActionContent.trim()) {
      toast.error("当前画布还没有可重写的正文内容");
      return;
    }

    if (!runtimeStylePrompt) {
      toast.error("请先选择项目默认风格或任务风格");
      return;
    }

    void handleSend(
      [],
      chatToolPreferences.webSearch,
      chatToolPreferences.thinking,
      buildStyleRewritePrompt({
        content: styleActionContent,
        stylePrompt: runtimeStylePrompt,
        fileName: styleActionFileName,
      }),
      undefined,
      undefined,
      {
        skipThemeSkillPrefix: true,
        purpose: "style_rewrite",
      },
    );
  }, [
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    handleSend,
    runtimeStylePrompt,
    styleActionContent,
    styleActionFileName,
  ]);

  const handleRunStyleAudit = useCallback(() => {
    if (!styleActionContent.trim()) {
      toast.error("当前画布还没有可检查的正文内容");
      return;
    }

    if (!runtimeStylePrompt) {
      toast.error("请先选择项目默认风格或任务风格");
      return;
    }

    void handleSend(
      [],
      chatToolPreferences.webSearch,
      chatToolPreferences.thinking,
      buildStyleAuditPrompt({
        content: styleActionContent,
        stylePrompt: runtimeStylePrompt,
      }),
      undefined,
      undefined,
      {
        skipThemeSkillPrefix: true,
        purpose: "style_audit",
      },
    );
  }, [
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    handleSend,
    runtimeStylePrompt,
    styleActionContent,
  ]);

  const inputbarNode = useMemo(
    () => (
      <Inputbar
        input={input}
        setInput={setInput}
        variant={isThemeWorkbench ? "theme_workbench" : "default"}
        themeWorkbenchGate={isThemeWorkbench ? currentGate : null}
        pendingA2UIForm={pendingA2UIForm || null}
        onA2UISubmit={handleInputbarA2UISubmit}
        a2uiSubmissionNotice={a2uiSubmissionNotice}
        workflowSteps={isThemeWorkbench ? themeWorkbenchWorkflowSteps : steps}
        themeWorkbenchRunState={themeWorkbenchRunState}
        onSend={handleSend}
        onStop={stopSending}
        isLoading={isSending}
        providerType={providerType}
        setProviderType={setProviderType}
        model={model}
        setModel={setModel}
        executionStrategy={executionStrategy}
        setExecutionStrategy={setExecutionStrategy}
        activeTheme={activeTheme}
        onManageProviders={handleManageProviders}
        disabled={!projectId}
        onClearMessages={handleClearMessages}
        onToggleCanvas={handleToggleCanvas}
        isCanvasOpen={layoutMode !== "chat"}
        taskFiles={visibleTaskFiles}
        selectedFileId={visibleSelectedFileId}
        taskFilesExpanded={taskFilesExpanded}
        onToggleTaskFiles={handleToggleTaskFiles}
        onTaskFileClick={handleTaskFileClick}
        characters={projectMemory?.characters || []}
        skills={skills}
        toolStates={chatToolPreferences}
        onToolStatesChange={setChatToolPreferences}
        onSelectCharacter={handleSelectCharacter}
        onNavigateToSettings={handleNavigateToSkillSettings}
      />
    ),
    [
      activeTheme,
      chatToolPreferences,
      currentGate,
      executionStrategy,
      handleClearMessages,
      handleManageProviders,
      handleNavigateToSkillSettings,
      handleSelectCharacter,
      handleSend,
      handleTaskFileClick,
      handleToggleCanvas,
      handleToggleTaskFiles,
      input,
      isSending,
      isThemeWorkbench,
      layoutMode,
      model,
      projectId,
      projectMemory?.characters,
      providerType,
      setExecutionStrategy,
      setInput,
      setModel,
      setProviderType,
      skills,
      steps,
      stopSending,
      visibleSelectedFileId,
      visibleTaskFiles,
      taskFilesExpanded,
      themeWorkbenchRunState,
      themeWorkbenchWorkflowSteps,
      handleInputbarA2UISubmit,
      pendingA2UIForm,
      a2uiSubmissionNotice,
    ],
  );

  // 聊天区域内容
  const chatContent = useMemo(
    () => (
      <ChatContainer>
        <ChatContainerInner>
          {entryBannerVisible && entryBannerMessage ? (
            <EntryBanner>
              <Info className="h-4 w-4 shrink-0" />
              <span>{entryBannerMessage}</span>
              <EntryBannerClose
                type="button"
                onClick={() => setEntryBannerVisible(false)}
                aria-label="关闭入口提示"
              >
                关闭
              </EntryBannerClose>
            </EntryBanner>
          ) : null}
          {!hideInlineStepProgress &&
            isContentCreationMode &&
            hasMessages &&
            steps.length > 0 && (
              <StepProgress
                steps={steps}
                currentIndex={currentStepIndex}
                onStepClick={goToStep}
              />
            )}

          {isContentCreationMode && projectId ? (
            <RuntimeStyleControlBar
              projectId={projectId}
              activeTheme={mappedTheme}
              projectStyleGuide={projectMemory?.style_guide}
              selection={runtimeStyleSelection}
              onSelectionChange={setRuntimeStyleSelection}
              onRewrite={handleRunStyleRewrite}
              onAudit={handleRunStyleAudit}
              actionsDisabled={styleActionsDisabled}
            />
          ) : null}

          {harnessPanelVisible ? (
            <HarnessStatusPanel
              harnessState={harnessState}
              subAgentRuntime={subAgentRuntime}
              environment={harnessEnvironment}
              onLoadFilePreview={handleHarnessLoadFilePreview}
              onOpenFile={handleFileClick}
            />
          ) : null}

          {showChatLayout ? (
            <ChatContent>
              {contextWorkspace.enabled ? (
                <MessageViewport>
                  <MessageList
                    messages={messages}
                    onDeleteMessage={deleteMessage}
                    onEditMessage={editMessage}
                    onA2UISubmit={handleA2UISubmit}
                    onWriteFile={handleWriteFile}
                    onFileClick={handleFileClick}
                    onPermissionResponse={handlePermissionResponse}
                    collapseCodeBlocks={shouldCollapseCodeBlocks}
                    onCodeBlockClick={handleCodeBlockClick}
                  />
                </MessageViewport>
              ) : (
                <MessageList
                  messages={messages}
                  onDeleteMessage={deleteMessage}
                  onEditMessage={editMessage}
                  onA2UISubmit={handleA2UISubmit}
                  onWriteFile={handleWriteFile}
                  onFileClick={handleFileClick}
                  onPermissionResponse={handlePermissionResponse}
                  collapseCodeBlocks={shouldCollapseCodeBlocks}
                  onCodeBlockClick={handleCodeBlockClick}
                />
              )}
              {contextWorkspace.enabled && !isThemeWorkbench ? (
                <FloatingInputbarContainer>
                  {inputbarNode}
                </FloatingInputbarContainer>
              ) : null}
            </ChatContent>
          ) : (
            <EmptyState
              input={input}
              setInput={setInput}
              onSend={(text, sendExecutionStrategy, images) => {
                handleSend(
                  images || [],
                  chatToolPreferences.webSearch,
                  chatToolPreferences.thinking,
                  text,
                  sendExecutionStrategy,
                );
              }}
              providerType={providerType}
              setProviderType={setProviderType}
              model={model}
              setModel={setModel}
              executionStrategy={executionStrategy}
              setExecutionStrategy={setExecutionStrategy}
              onManageProviders={handleManageProviders}
              webSearchEnabled={chatToolPreferences.webSearch}
              onWebSearchEnabledChange={(enabled) =>
                setChatToolPreferences((prev) => ({
                  ...prev,
                  webSearch: enabled,
                }))
              }
              thinkingEnabled={chatToolPreferences.thinking}
              onThinkingEnabledChange={(enabled) =>
                setChatToolPreferences((prev) => ({
                  ...prev,
                  thinking: enabled,
                }))
              }
              creationMode={creationMode}
              onCreationModeChange={setCreationMode}
              activeTheme={activeTheme}
              onThemeChange={(theme) => {
                if (!lockTheme) {
                  setActiveTheme(theme);
                }
              }}
              showThemeTabs={false}
              hasCanvasContent={
                activeTheme === "general"
                  ? Boolean(generalCanvasState.content?.trim())
                  : !isCanvasStateEmpty(resolvedCanvasState)
              }
              hasContentId={Boolean(contentId)}
              selectedText={selectedText}
              onRecommendationClick={(shortLabel, fullPrompt) => {
                setInput(fullPrompt);
              }}
              characters={projectMemory?.characters || []}
              skills={skills}
              onNavigateToSettings={handleNavigateToSkillSettings}
            />
          )}

          {showChatLayout && (
            <>
              {(workspacePathMissing || workspaceHealthError) && (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="flex-1">
                    工作区目录不存在，请重新选择一个本地目录后继续
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSelectWorkspaceDirectory()}
                    className="shrink-0 rounded-md bg-amber-200 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                  >
                    重新选择目录
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceHealthError(false);
                      dismissWorkspacePathError();
                    }}
                    className="shrink-0 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
              )}
              {!contextWorkspace.enabled &&
              !shouldHideThemeWorkbenchInputForTheme
                ? inputbarNode
                : null}
            </>
          )}
        </ChatContainerInner>
      </ChatContainer>
    ),
    [
      activeTheme,
      chatToolPreferences.thinking,
      chatToolPreferences.webSearch,
      contentId,
      contextWorkspace.enabled,
      creationMode,
      currentStepIndex,
      deleteMessage,
      dismissWorkspacePathError,
      entryBannerMessage,
      entryBannerVisible,
      editMessage,
      executionStrategy,
      generalCanvasState.content,
      goToStep,
      handleA2UISubmit,
      handleCodeBlockClick,
      handleFileClick,
      handleHarnessLoadFilePreview,
      handleManageProviders,
      handleNavigateToSkillSettings,
      handlePermissionResponse,
      handleSelectWorkspaceDirectory,
      handleSend,
      handleWriteFile,
      harnessEnvironment,
      harnessPanelVisible,
      hasMessages,
      harnessState,
      hideInlineStepProgress,
      input,
      inputbarNode,
      isContentCreationMode,
      isThemeWorkbench,
      lockTheme,
      messages,
      model,
      projectId,
      projectMemory?.characters,
      projectMemory?.style_guide,
      providerType,
      setCreationMode,
      setExecutionStrategy,
      setInput,
      setModel,
      setProviderType,
      setWorkspaceHealthError,
      shouldCollapseCodeBlocks,
      selectedText,
      setEntryBannerVisible,
      showChatLayout,
      handleRunStyleAudit,
      handleRunStyleRewrite,
      mappedTheme,
      runtimeStyleSelection,
      styleActionsDisabled,
      subAgentRuntime,
      skills,
      steps,
      workspaceHealthError,
      workspacePathMissing,
      resolvedCanvasState,
      shouldHideThemeWorkbenchInputForTheme,
    ],
  );

  // 画布区域内容
  const canvasContent = useMemo(() => {
    const renderCanvasTheme = (
      shouldBootstrapCanvasOnEntry ? normalizedEntryTheme : mappedTheme
    ) as ThemeType;

    // 如果有 artifact，优先使用 ArtifactRenderer 渲染
    const currentArtifact =
      selectedArtifact ||
      (artifacts.length > 0 ? artifacts[artifacts.length - 1] : null);
    if (renderCanvasTheme === "general" && currentArtifact) {
      return (
        <div className="flex flex-col h-full bg-[#1e2227]">
          {/* 使用 ArtifactToolbar 组件 */}
          <ArtifactToolbar
            artifact={currentArtifact}
            onClose={handleCloseCanvas}
            isStreaming={currentArtifact.status === "streaming"}
            viewMode={artifactViewMode}
            onViewModeChange={setArtifactViewMode}
            previewSize={artifactPreviewSize}
            onPreviewSizeChange={setArtifactPreviewSize}
          />
          {/* 渲染区域 */}
          <div className="flex-1 overflow-auto">
            <ArtifactRenderer
              artifact={currentArtifact}
              isStreaming={currentArtifact.status === "streaming"}
              hideToolbar={true}
              viewMode={artifactViewMode}
              previewSize={artifactPreviewSize}
            />
          </div>
        </div>
      );
    }

    // General 主题使用专门的预览画布（无 artifact 时）
    if (renderCanvasTheme === "general") {
      if (generalCanvasState.isOpen) {
        return (
          <GeneralCanvasPanel
            state={generalCanvasState}
            onClose={handleCloseCanvas}
            onContentChange={(content) =>
              setGeneralCanvasState((prev) => ({ ...prev, content }))
            }
          />
        );
      }
      return null;
    }

    const shouldShowCanvasLoadingState =
      (!canvasState &&
        (shouldBootstrapCanvasOnEntry ||
          isInitialContentLoading ||
          Boolean(initialContentLoadError))) ||
      (resolvedCanvasState?.type === "document" &&
        !resolvedCanvasState.content.trim() &&
        (isInitialContentLoading || Boolean(initialContentLoadError)));

    if (shouldShowCanvasLoadingState) {
      return (
        <div
          data-testid="canvas-loading-state"
          className="flex h-full items-center justify-center rounded-[14px] border border-dashed border-border bg-background text-sm text-muted-foreground"
        >
          {isInitialContentLoading
            ? "正在加载文稿内容..."
            : initialContentLoadError || "正在准备文稿画布..."}
        </div>
      );
    }

    // 其他主题使用 CanvasFactory
    if (resolvedCanvasState) {
      return (
        <CanvasFactory
          theme={renderCanvasTheme}
          state={resolvedCanvasState}
          onStateChange={setCanvasState}
          onBackHome={handleBackHome}
          onClose={handleCloseCanvas}
          isStreaming={isSending}
          onSelectionTextChange={handleCanvasSelectionTextChange}
          projectId={projectId ?? null}
          contentId={contentId ?? null}
          autoImageTopic={project?.name || undefined}
          autoContinueProviderType={providerType}
          onAutoContinueProviderTypeChange={setProviderType}
          autoContinueModel={model}
          onAutoContinueModelChange={setModel}
          autoContinueThinkingEnabled={chatToolPreferences.thinking}
          onAutoContinueThinkingEnabledChange={
            handleDocumentThinkingEnabledChange
          }
          onAutoContinueRun={handleDocumentAutoContinueRun}
          onAddImage={handleAddImage}
          onImportDocument={handleImportDocument}
          onContentReviewRun={handleDocumentContentReviewRun}
          onTextStylizeRun={handleDocumentTextStylizeRun}
          documentContentReviewPlacement={
            preferContentReviewInRightRail ? "external-rail" : "inline"
          }
          novelControls={
            resolvedCanvasState.type === "novel"
              ? {
                  useExternalToolbar: true,
                  chapterListCollapsed: novelChapterListCollapsed,
                  onChapterListCollapsedChange: setNovelChapterListCollapsed,
                }
              : null
          }
        />
      );
    }
    return null;
  }, [
    artifacts,
    selectedArtifact,
    generalCanvasState,
    canvasState,
    resolvedCanvasState,
    mappedTheme,
    normalizedEntryTheme,
    project,
    projectId,
    contentId,
    handleCloseCanvas,
    handleBackHome,
    isSending,
    providerType,
    setProviderType,
    model,
    setModel,
    chatToolPreferences.thinking,
    handleCanvasSelectionTextChange,
    handleAddImage,
    handleDocumentAutoContinueRun,
    handleDocumentContentReviewRun,
    handleDocumentThinkingEnabledChange,
    handleDocumentTextStylizeRun,
    handleImportDocument,
    artifactViewMode,
    artifactPreviewSize,
    novelChapterListCollapsed,
    isInitialContentLoading,
    initialContentLoadError,
    shouldBootstrapCanvasOnEntry,
    preferContentReviewInRightRail,
  ]);

  const mainAreaNode = useMemo(
    () => (
      <MainArea>
        {!hideTopBar && (
          <>
            <ChatNavbar
              isRunning={isSending}
              onToggleHistory={handleToggleSidebar}
              showHistoryToggle={!hideHistoryToggle && showChatPanel}
              onToggleFullscreen={() => {}}
              onBackToProjectManagement={onBackToProjectManagement}
              onBackToResources={
                fromResources ? handleBackToResources : undefined
              }
              projectId={projectId ?? null}
              onProjectChange={handleProjectChange}
              workspaceType={activeTheme}
              onBackHome={handleBackHome}
              showHarnessToggle={showHarnessToggle}
              harnessPanelVisible={harnessPanelVisible}
              onToggleHarnessPanel={() =>
                setHarnessPanelVisible((current) => !current)
              }
              harnessPendingCount={harnessPendingCount}
              harnessAttentionLevel={harnessAttentionLevel}
              onToggleSettings={() => {
                _onNavigate?.("settings", {
                  tab: SettingsTabs.ChatAppearance,
                });
              }}
              novelCanvasControls={
                showNovelNavbarControls
                  ? {
                      chapterListCollapsed: novelChapterListCollapsed,
                      onToggleChapterList: handleToggleNovelChapterList,
                      onAddChapter: handleAddNovelChapter,
                      onCloseCanvas: handleCloseCanvas,
                    }
                  : null
              }
            />

            {!isThemeWorkbench ? (
              <LatestRunStatusBadge
                source="chat"
                label="统一执行状态"
                className="px-4 py-1 border-b border-border/60"
              />
            ) : null}

            {!isThemeWorkbench && contentId && syncStatus !== "idle" && (
              <div
                style={{
                  padding: "4px 16px",
                  fontSize: "12px",
                  color:
                    syncStatus === "syncing"
                      ? "hsl(var(--muted-foreground))"
                      : syncStatus === "success"
                        ? "hsl(142, 76%, 36%)"
                        : "hsl(0, 84%, 60%)",
                  backgroundColor:
                    syncStatus === "syncing"
                      ? "hsl(var(--muted) / 0.3)"
                      : syncStatus === "success"
                        ? "hsl(142, 76%, 96%)"
                        : "hsl(0, 84%, 96%)",
                  borderBottom: "1px solid hsl(var(--border))",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {syncStatus === "syncing" && "正在同步..."}
                {syncStatus === "success" && "✓ 已同步"}
                {syncStatus === "error" && "⚠ 同步失败，将自动重试"}
              </div>
            )}
          </>
        )}

        <ThemeWorkbenchLayoutShell
          $bottomInset={
            isThemeWorkbench &&
            showChatLayout &&
            !shouldHideThemeWorkbenchInputForTheme
              ? canvasContent
                ? themeWorkbenchRunState === "auto_running"
                  ? "24px"
                  : currentGate.status === "waiting"
                    ? "12px"
                    : "0"
                : themeWorkbenchRunState === "auto_running"
                  ? "168px"
                  : currentGate.status === "waiting"
                    ? "136px"
                    : "88px"
              : "0"
          }
        >
          <LayoutTransitionRenderGate
            mode={isThemeWorkbench && canvasContent ? "canvas" : layoutMode}
            chatContent={chatContent}
            canvasContent={canvasContent}
          />
        </ThemeWorkbenchLayoutShell>
        {isThemeWorkbench &&
        showChatLayout &&
        !shouldHideThemeWorkbenchInputForTheme ? (
          <ThemeWorkbenchInputOverlay
            $hasPendingA2UIForm={Boolean(pendingA2UIForm)}
          >
            {inputbarNode}
          </ThemeWorkbenchInputOverlay>
        ) : null}
      </MainArea>
    ),
    [
      _onNavigate,
      activeTheme,
      canvasContent,
      chatContent,
      contentId,
      currentGate.status,
      fromResources,
      handleAddNovelChapter,
      handleBackHome,
      handleBackToResources,
      handleCloseCanvas,
      handleProjectChange,
      handleToggleNovelChapterList,
      handleToggleSidebar,
      hideHistoryToggle,
      hideTopBar,
      inputbarNode,
      isSending,
      isThemeWorkbench,
      harnessAttentionLevel,
      harnessPanelVisible,
      harnessPendingCount,
      layoutMode,
      novelChapterListCollapsed,
      onBackToProjectManagement,
      pendingA2UIForm,
      projectId,
      shouldHideThemeWorkbenchInputForTheme,
      showChatLayout,
      showChatPanel,
      showHarnessToggle,
      showNovelNavbarControls,
      syncStatus,
      themeWorkbenchRunState,
    ],
  );

  // ========== 渲染逻辑 ==========

  // 所有主题统一使用 useAgentChat 的状态和渲染逻辑
  // General 主题与其他主题的区别仅在于不显示步骤进度条
  return (
    <PageContainer>
      {isThemeWorkbench ? (
        themeWorkbenchSidebarNode
      ) : showChatPanel && showSidebar ? (
        <ChatSidebar
          onNewChat={handleClearMessages}
          topics={topics}
          currentTopicId={sessionId}
          onSwitchTopic={switchTopic}
          onDeleteTopic={deleteTopic}
          onRenameTopic={renameTopic}
        />
      ) : null}
      {showThemeWorkbenchLeftExpandButton ? (
        <ThemeWorkbenchLeftExpandButton
          type="button"
          aria-label="展开上下文侧栏"
          onClick={() => setThemeWorkbenchSidebarCollapsed(false)}
          title="展开上下文侧栏"
        >
          <PanelLeftOpen size={14} />
        </ThemeWorkbenchLeftExpandButton>
      ) : null}

      {mainAreaNode}
    </PageContainer>
  );
}
