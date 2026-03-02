/**
 * AI Agent 聊天页面
 *
 * 包含聊天区域和侧边栏（话题列表）
 * 支持内容创作模式下的布局过渡和步骤引导
 * 当主题为 general 时，使用 GeneralChat 组件实现
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import styled from "styled-components";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAgentChatUnified } from "./hooks";
import { useSessionFiles } from "./hooks/useSessionFiles";
import { useContentSync } from "./hooks/useContentSync";
import { ChatNavbar } from "./components/ChatNavbar";
import { ChatSidebar } from "./components/ChatSidebar";
import { MessageList } from "./components/MessageList";
import { Inputbar } from "./components/Inputbar";
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
import { CanvasPanel as GeneralCanvasPanel } from "@/components/general-chat/canvas";
import {
  type CanvasState as GeneralCanvasState,
  DEFAULT_CANVAS_STATE,
} from "@/components/general-chat/types";
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
  updateContent,
  type Project,
  type ProjectType,
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
import { LatestRunStatusBadge } from "@/components/execution/LatestRunStatusBadge";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";

import type { MessageImage } from "./types";
import type {
  ThemeType,
  LayoutMode,
  StepStatus,
} from "@/components/content-creator/types";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
import { getFileToStepMap } from "./utils/workflowMapping";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import { resolveTopicSwitchProject } from "./utils/topicProjectSwitch";
import { getDefaultGuidePromptByTheme } from "./utils/defaultGuidePrompt";

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
`;

const MainArea = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
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

const ChatContent = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0 6px;
  overflow: hidden;
  height: 100%;
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
  onInitialUserPromptConsumed,
  newChatAt,
  onRecommendationClick: _onRecommendationClick,
  onHasMessagesChange,
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
  onInitialUserPromptConsumed?: () => void;
  newChatAt?: number;
  onRecommendationClick?: (shortLabel: string, fullPrompt: string) => void;
  onHasMessagesChange?: (hasMessages: boolean) => void;
}) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [input, setInput] = useState("");
  const [selectedText, setSelectedText] = useState("");

  // 内容创作相关状态
  const [activeTheme, setActiveTheme] = useState<string>(
    normalizeInitialTheme(initialTheme),
  );
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("chat");

  useEffect(() => {
    if (!initialTheme) return;
    setActiveTheme(normalizeInitialTheme(initialTheme));
  }, [initialTheme]);

  useEffect(() => {
    if (!initialCreationMode) return;
    setCreationMode(initialCreationMode);
  }, [initialCreationMode]);

  // 内部 projectId 状态（当外部未提供时使用）
  const [internalProjectId, setInternalProjectId] = useState<string | null>(
    null,
  );

  // 使用外部或内部的 projectId
  const projectId = externalProjectId ?? internalProjectId ?? undefined;

  // 画布状态（支持多种画布类型）
  const [canvasState, setCanvasState] = useState<CanvasStateUnion | null>(null);
  const [novelChapterListCollapsed, setNovelChapterListCollapsed] =
    useState(false);

  useEffect(() => {
    setActiveContentTarget(projectId, contentId, canvasState?.type ?? null);
  }, [canvasState?.type, contentId, projectId]);

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

  // 主动 workspace 健康检查失败标记（区别于 workspacePathMissing 发送失败场景）
  const [workspaceHealthError, setWorkspaceHealthError] = useState(false);

  // 引用的角色列表（用于注入到消息中）
  const [mentionedCharacters, setMentionedCharacters] = useState<Character[]>(
    [],
  );

  // 技能列表（用于 @ 引用）
  const [skills, setSkills] = useState<Skill[]>([]);

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

  // 加载技能列表
  useEffect(() => {
    skillsApi
      .getAll("proxycast")
      .then(setSkills)
      .catch((err) => console.error("加载技能列表失败:", err));
  }, []);

  // 跳转到设置页安装技能
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("settings", { tab: SettingsTabs.Skills });
  }, [_onNavigate]);

  // 加载项目、Memory 和内容
  useEffect(() => {
    const loadData = async () => {
      if (!projectId) {
        setProject(null);
        setProjectMemory(null);
        return;
      }

      // 1. 加载项目
      const p = await getProject(projectId);
      if (!p) return;

      setProject(p);
      // 直接使用 projectType 作为 theme（类型已统一）
      const theme = projectTypeToTheme(p.workspaceType);
      if (!lockTheme || !initialTheme) {
        setActiveTheme(theme);
      }

      // 2. 加载 Memory
      const memory = await getProjectMemory(projectId);
      setProjectMemory(memory);

      // 3. 如果有 contentId，加载内容并打开画布
      if (contentId) {
        const content = await getContent(contentId);
        if (content) {
          const canvasTheme = (
            lockTheme && initialTheme
              ? normalizeInitialTheme(initialTheme)
              : theme
          ) as ThemeType;

          const initialState =
            createInitialCanvasState(canvasTheme, content.body || "") ||
            createInitialDocumentState(content.body || "");
          setCanvasState(initialState);
          setLayoutMode("chat-canvas");
        }
      }
    };

    loadData();
  }, [projectId, contentId, lockTheme, initialTheme]);

  // 当 projectId 变化时主动检查 workspace 目录健康状态
  // 静默修复（auto-created）或显示 banner 提示用户重新选择
  useEffect(() => {
    setWorkspaceHealthError(false);
    const normalizedId = normalizeProjectId(projectId);
    if (!normalizedId) return;

    invoke<{ created: boolean; rootPath: string }>("workspace_ensure_ready", {
      id: normalizedId,
    })
      .then(({ created, rootPath }) => {
        if (created) {
          recordWorkspaceRepair({
            workspaceId: normalizedId,
            rootPath,
            source: "agent_chat_page",
          });
          console.info(
            "[AgentChatPage] workspace 目录已自动修复:",
            rootPath,
          );
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
  }, [isContentCreationMode, mappedTheme, creationMode, projectMemory]);

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
    triggerAIGuide,
    topics,
    sessionId,
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
    if (!canvasState) return;

    // 提取画布内容
    let content = "";
    try {
      switch (canvasState.type) {
        case "document":
          content = canvasState.content || "";
          break;
        case "novel":
          content = JSON.stringify(canvasState.chapters);
          break;
        case "script":
          content = JSON.stringify(canvasState.scenes);
          break;
        case "music":
          content = JSON.stringify(canvasState.sections);
          break;
        case "poster":
          content = JSON.stringify(canvasState.pages);
          break;
        default:
          content = JSON.stringify(canvasState);
      }

      // 如果有 contentId，先验证内容存在再同步
      if (contentId && content) {
        // 先检查内容是否存在，避免同步到不存在的记录
        getContent(contentId)
          .then((existingContent) => {
            if (existingContent) {
              const existingBody = existingContent.body || "";
              if (existingBody !== content) {
                syncContent(contentId, content);
              }
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
      }
      // 如果没有 contentId 但有 projectId，自动创建 Content
      else if (!contentId && projectId && content && project) {
        // 只在内容不为空时创建
        const isEmpty =
          !content || content === "" || content === "[]" || content === "{}";
        if (!isEmpty) {
          console.log("[AgentChatPage] 自动创建 Content 记录");
          // TODO: 实现自动创建 Content 的逻辑
          // 这里需要调用 createContent API，但为了避免重复创建，需要添加防抖和状态管理
        }
      }
    } catch (error) {
      console.error("提取画布内容失败:", error);
    }
  }, [canvasState, contentId, projectId, project, syncContent]);

  // 追踪已恢复元数据和文件的会话 ID
  const restoredMetaSessionId = useRef<string | null>(null);
  const restoredFilesSessionId = useRef<string | null>(null);
  const handledNewChatRequestRef = useRef<string | null>(null);
  // 用于追踪是否已触发过 AI 引导
  const hasTriggeredGuide = useRef(false);

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
      console.log("[AgentChatPage] 恢复主题:", sessionMeta.theme);
      setActiveTheme(sessionMeta.theme);
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
              type: file.fileType === "document" ? "document" : "document",
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
   * 1. <document>...</document> 标签
   * 2. ```markdown ... ``` 代码块
   * 3. 以 # 开头的 Markdown 内容（整个响应）
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

      // 3. 如果整个内容以 # 开头且长度超过 200 字符，认为是文档
      if (content.trim().startsWith("#") && content.length > 200) {
        return content.trim();
      }

      return null;
    },
    [],
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
        (msg) => msg.role === "assistant" && !msg.isThinking && msg.content,
      );

    if (!lastAssistantMsg) return;

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
    extractDocumentContent,
    mappedTheme,
    upsertNovelCanvasState,
  ]);

  const handleSend = useCallback(
    async (
      images?: MessageImage[],
      webSearch?: boolean,
      thinking?: boolean,
      textOverride?: string,
      sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
    ) => {
      const sourceText = textOverride ?? input;
      if (!sourceText.trim() && (!images || images.length === 0)) return;

      if (!projectId) {
        toast.error("请先选择项目后再开始对话");
        return;
      }

      let text = sourceText;

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

      setInput("");
      setMentionedCharacters([]); // 清空引用的角色

      try {
        await sendMessage(
          text,
          images || [],
          webSearch,
          thinking,
          false,
          sendExecutionStrategy,
        );
      } catch (error) {
        console.error("[AgentChat] 发送消息失败:", error);
        toast.error(`发送失败: ${error instanceof Error ? error.message : String(error)}`);
        // 恢复输入内容，让用户可以重试
        setInput(sourceText);
      }
    },
    [input, mentionedCharacters, projectId, sendMessage],
  );

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

    if (!externalProjectId) {
      setInternalProjectId(null);
      setProject(null);
      setProjectMemory(null);
      setActiveTheme(normalizeInitialTheme(initialTheme));
      setCreationMode(initialCreationMode ?? "guided");
    }
  }, [
    newChatAt,
    clearMessages,
    externalProjectId,
    initialTheme,
    initialCreationMode,
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
    const nextValue = normalized.length > 500 ? normalized.slice(0, 500) : normalized;
    setSelectedText((previous) => (previous === nextValue ? previous : nextValue));
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

  // 当有文件时默认在画布中显示最新文件（按更新时间）
  useEffect(() => {
    if (taskFiles.length > 0) {
      const latestFile = taskFiles.reduce<TaskFile | null>(
        (candidate, file) => {
          if (!candidate) {
            return file;
          }
          const candidateTimestamp = Math.max(
            candidate.updatedAt,
            candidate.createdAt,
          );
          const fileTimestamp = Math.max(file.updatedAt, file.createdAt);
          return fileTimestamp >= candidateTimestamp ? file : candidate;
        },
        null,
      );

      if (!latestFile) {
        return;
      }

      // 设置选中的文件
      setSelectedFileId(latestFile.id);
      // 如果文件有内容，在画布中显示
      const latestContent = latestFile.content;
      if (latestContent) {
        setCanvasState((prev) => {
          if (mappedTheme === "music") {
            const sections = parseLyrics(latestContent);
            if (!prev || prev.type !== "music") {
              const musicState = createInitialMusicState();
              musicState.sections = sections;
              const titleMatch = latestContent.match(/^#\s*(.+)$/m);
              if (titleMatch) {
                musicState.spec.title = titleMatch[1].trim();
              }
              return musicState;
            }
            return { ...prev, sections };
          }

          if (mappedTheme === "novel") {
            return upsertNovelCanvasState(prev, latestContent);
          }

          if (!prev || prev.type !== "document") {
            return createInitialDocumentState(latestContent);
          }
          return { ...prev, content: latestContent };
        });
        setLayoutMode("chat-canvas");
      }
    }
  }, [taskFiles, mappedTheme, upsertNovelCanvasState]);

  const handleToggleSidebar = () => {
    if (!showChatPanel) {
      return;
    }
    setShowSidebar((prev) => !prev);
  };

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

  const showNovelNavbarControls =
    layoutMode !== "chat" && canvasState?.type === "novel";

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

      // 持久化文件到会话目录
      saveSessionFile(fileName, content).catch((err) => {
        console.error("[AgentChatPage] 持久化文件失败:", err);
      });

      // 同步内容到项目（如果有 contentId，先验证存在性）
      if (contentId) {
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
          type: "document",
          content,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        setSelectedFileId(newFile.id);
        return [...prev, newFile];
      });

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
          return createInitialDocumentState(content);
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
      contentId,
      currentStepIndex,
      isContentCreationMode,
      completeStep,
      mappedTheme,
      saveSessionFile,
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
          type: "document",
          content,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSelectedFileId(newFile.id);
        return [...prev, newFile];
      });

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
    [activeTheme, mappedTheme, upsertNovelCanvasState],
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
      if (file.type === "document" && file.content) {
        setSelectedFileId(file.id);
        setCanvasState((prev) => {
          // 音乐主题：解析歌词并更新 sections
          if (mappedTheme === "music") {
            const sections = parseLyrics(file.content!);
            if (!prev || prev.type !== "music") {
              const musicState = createInitialMusicState();
              musicState.sections = sections;
              const titleMatch = file.content!.match(/^#\s*(.+)$/m);
              if (titleMatch) {
                musicState.spec.title = titleMatch[1].trim();
              }
              return musicState;
            }
            return { ...prev, sections };
          }

          if (mappedTheme === "novel") {
            return upsertNovelCanvasState(prev, file.content!);
          }

          // 文档类型画布
          if (!prev || prev.type !== "document") {
            return createInitialDocumentState(file.content!);
          }
          return {
            ...prev,
            content: file.content!,
          };
        });
        // 只打开画布，不关闭文件列表（让用户自己关闭）
        setLayoutMode("chat-canvas");
      }
    },
    [mappedTheme, upsertNovelCanvasState],
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

  // 存储 triggerAIGuide 函数引用，避免在 useEffect 依赖中包含函数
  const triggerAIGuideRef = useRef(triggerAIGuide);
  triggerAIGuideRef.current = triggerAIGuide;

  // 当从项目进入且有 contentId 时，自动启动创作引导
  useEffect(() => {
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

    if (
      contentId &&
      messages.length === 0 &&
      project &&
      systemPrompt &&
      !isSending &&
      canvasEmpty &&
      !hasTriggeredGuide.current
    ) {
      hasTriggeredGuide.current = true;

      if (pendingInitialPrompt) {
        console.log("[AgentChatPage] 自动发送首条创作意图消息");
        void (async () => {
          await handleSend([], false, false, pendingInitialPrompt);
          onInitialUserPromptConsumed?.();
        })();
        return;
      }

      const defaultGuidePrompt = getDefaultGuidePromptByTheme(activeTheme);
      if (defaultGuidePrompt) {
        console.log("[AgentChatPage] 自动预填主题引导词");
        setInput((previous) => {
          if (previous.trim()) {
            return previous;
          }
          return defaultGuidePrompt;
        });
        return;
      }

      console.log("[AgentChatPage] 自动触发 AI 创作引导");
      triggerAIGuideRef.current();
    }
  }, [
    activeTheme,
    contentId,
    messages.length,
    project,
    systemPrompt,
    isSending,
    canvasState,
    initialUserPrompt,
    handleSend,
    onInitialUserPromptConsumed,
  ]);

  // 当 contentId 变化时重置引导状态
  useEffect(() => {
    hasTriggeredGuide.current = false;
  }, [contentId]);

  // 判断是否应该显示聊天布局（有消息）
  const showChatLayout = hasMessages;

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

  const handleSelectWorkspaceDirectory = useCallback(async () => {
    const newPath = await openDialog({ directory: true, multiple: false });
    if (!newPath) return;
    if (workspacePathMissing) {
      // 发送失败场景：更新路径并重试原来的消息
      await fixWorkspacePathAndRetry(newPath);
    } else if (projectId) {
      // 主动健康检查发现问题：只更新路径，不需要重试
      try {
        await invoke("workspace_update", {
          id: projectId,
          request: { rootPath: newPath },
        });
        setWorkspaceHealthError(false);
        toast.success("工作区目录已更新");
      } catch (err) {
        toast.error(
          `更新路径失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }, [fixWorkspacePathAndRetry, projectId, workspacePathMissing]);

  // 聊天区域内容
  const chatContent = (
    <ChatContainer>
      <ChatContainerInner>
        {/* 步骤进度条 - 仅在内容创作模式且有消息时显示 */}
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

        {showChatLayout ? (
          <ChatContent>
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
          </ChatContent>
        ) : (
          <EmptyState
            input={input}
            setInput={setInput}
            onSend={(text, sendExecutionStrategy) => {
              handleSend([], false, false, text, sendExecutionStrategy);
            }}
            providerType={providerType}
            setProviderType={setProviderType}
            model={model}
            setModel={setModel}
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
            onManageProviders={handleManageProviders}
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
                : !isCanvasStateEmpty(canvasState)
            }
            hasContentId={Boolean(contentId)}
            selectedText={selectedText}
            onRecommendationClick={(shortLabel, fullPrompt) => {
              // 直接将推荐提示词放入输入框，不创建项目
              setInput(fullPrompt);
            }}
          />
        )}

        {showChatLayout && (
          <>
            {(workspacePathMissing || workspaceHealthError) && (
              <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <span className="flex-1">工作区目录不存在，请重新选择一个本地目录后继续</span>
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
            <Inputbar
              input={input}
              setInput={setInput}
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
              taskFiles={taskFiles}
              selectedFileId={selectedFileId}
              taskFilesExpanded={taskFilesExpanded}
              onToggleTaskFiles={() => setTaskFilesExpanded(!taskFilesExpanded)}
              onTaskFileClick={handleTaskFileClick}
              characters={projectMemory?.characters || []}
              skills={skills}
              onSelectCharacter={(character) => {
                setMentionedCharacters((prev) => {
                  // 避免重复添加
                  if (prev.find((c) => c.id === character.id)) return prev;
                  return [...prev, character];
                });
              }}
              onNavigateToSettings={handleNavigateToSkillSettings}
            />
          </>
        )}
      </ChatContainerInner>
    </ChatContainer>
  );

  // 画布区域内容
  const canvasContent = useMemo(() => {
    // 如果有 artifact，优先使用 ArtifactRenderer 渲染
    const currentArtifact =
      selectedArtifact ||
      (artifacts.length > 0 ? artifacts[artifacts.length - 1] : null);
    if (activeTheme === "general" && currentArtifact) {
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
    if (activeTheme === "general") {
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

    // 其他主题使用 CanvasFactory
    if (canvasState) {
      return (
        <CanvasFactory
          theme={mappedTheme}
          state={canvasState}
          onStateChange={setCanvasState}
          onBackHome={handleBackHome}
          onClose={handleCloseCanvas}
          isStreaming={isSending}
          onSelectionTextChange={handleCanvasSelectionTextChange}
          projectId={projectId ?? null}
          contentId={contentId ?? null}
          autoImageTopic={project?.name || undefined}
          novelControls={
            canvasState.type === "novel"
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
    activeTheme,
    artifacts,
    selectedArtifact,
    generalCanvasState,
    canvasState,
    mappedTheme,
    project,
    projectId,
    contentId,
    handleCloseCanvas,
    handleBackHome,
    isSending,
    handleCanvasSelectionTextChange,
    artifactViewMode,
    artifactPreviewSize,
    novelChapterListCollapsed,
  ]);

  // ========== 渲染逻辑 ==========

  // 所有主题统一使用 useAgentChat 的状态和渲染逻辑
  // General 主题与其他主题的区别仅在于不显示步骤进度条
  return (
    <PageContainer>
      {showChatPanel && showSidebar && (
        <ChatSidebar
          onNewChat={handleClearMessages}
          topics={topics}
          currentTopicId={sessionId}
          onSwitchTopic={switchTopic}
          onDeleteTopic={deleteTopic}
          onRenameTopic={renameTopic}
        />
      )}

      <MainArea>
        {!hideTopBar && (
          <>
            <ChatNavbar
              isRunning={isSending}
              onToggleHistory={handleToggleSidebar}
              showHistoryToggle={!hideHistoryToggle && showChatPanel}
              onToggleFullscreen={() => {}}
              onBackToProjectManagement={onBackToProjectManagement}
              onBackToResources={fromResources ? handleBackToResources : undefined}
              projectId={projectId ?? null}
              onProjectChange={(newProjectId) => {
                if (externalProjectId) {
                  return;
                }
                pendingTopicSwitchRef.current = null;
                isResolvingTopicProjectRef.current = false;
                savePersistedProjectId(LAST_PROJECT_ID_KEY, newProjectId);
                setInternalProjectId(newProjectId);
              }}
              workspaceType={activeTheme}
              onBackHome={handleBackHome}
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

            <LatestRunStatusBadge
              source="chat"
              label="统一执行状态"
              className="px-4 py-1 border-b border-border/60"
            />

            {/* 同步状态指示器 */}
            {contentId && syncStatus !== "idle" && (
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

        {/* 使用布局过渡组件 */}
        <LayoutTransition
          mode={layoutMode}
          chatContent={chatContent}
          canvasContent={canvasContent}
        />
      </MainArea>
    </PageContainer>
  );
}
