/**
 * @file 文档画布主组件
 * @description 整合工具栏、渲染器、编辑器、平台标签
 * @module components/content-creator/canvas/document/DocumentCanvas
 */

import React, {
  memo,
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import {
  searchPixabayImages,
  searchWebImages,
  type PixabaySearchResponse,
  type WebImageSearchResponse,
} from "@/lib/api/imageSearch";
import type {
  AutoContinueSettings,
  ContentReviewExpert,
  ContentReviewRunPayload,
  CustomContentReviewExpertInput,
  DocumentCanvasProps,
  ExportFormat,
  PlatformType,
} from "./types";
import { ContentReviewPanel } from "./ContentReviewPanel";
import {
  DEFAULT_CONTENT_REVIEW_EXPERTS,
  createCustomContentReviewExpert,
} from "./contentReviewExperts";
import { DocumentToolbar } from "./DocumentToolbar";
import { DocumentRenderer } from "./DocumentRenderer";
import { NotionEditor, type NotionEditorHandle } from "./editor";
import { PlatformTabs } from "./PlatformTabs";
import { resolveDocumentCanvasHotkeyAction } from "./documentCanvasHotkeys";
import {
  loadChatToolPreferences,
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "@/components/agent/chat/utils/chatToolPreferences";
import { exportDocumentContent } from "./utils/exportDocument";
import {
  ackCanvasImageInsertRequest,
  emitCanvasImageInsertAck,
  getPendingCanvasImageInsertRequests,
  matchesCanvasImageInsertTarget,
  onCanvasImageInsertRequest,
  type CanvasImageInsertRequest,
  type InsertableImage,
} from "@/lib/canvasImageInsertBus";
import {
  applySectionImageAssignments,
  appendImageToMarkdown,
  buildSectionSearchQuery,
  extractLevel2Sections,
} from "./utils/autoImageInsert";
import {
  loadAutoContinueSettings,
  saveAutoContinueSettings,
} from "./utils/autoContinueSettings";
import { logRenderPerf } from "@/lib/perfDebug";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  padding: 0 4px 6px 4px;
  gap: 10px;
  box-sizing: border-box;
`;

const InnerContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  border-radius: 0;
  border: none;
  overflow: hidden;
  box-shadow: none;
`;

const ContentArea = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: hsl(var(--background));
`;

const MainContent = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const Toast = styled.div<{ $visible: boolean }>`
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: hsl(var(--foreground));
  color: hsl(var(--background));
  border-radius: 8px;
  font-size: 14px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  visibility: ${({ $visible }) => ($visible ? "visible" : "hidden")};
  transition: all 0.3s;
  z-index: 1000;
`;

const PLATFORM_LABELS: Record<PlatformType, string> = {
  wechat: "公众号",
  xiaohongshu: "小红书",
  zhihu: "知乎",
  markdown: "通用文稿",
};

function buildTextStylizePrompt(content: string, platform: PlatformType): string {
  const normalizedContent = content.trim();
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;

  return `请对以下文本进行风格化优化，使表达更流畅、更有感染力，但不要改变原文事实、判断、核心信息与结论。

优化要求：
1. 优先优化措辞、句式、节奏和段落衔接，不要引入新事实。
2. 保持内容真实、自然、可读，不过度夸张。
3. 结合当前平台的阅读语境调整表达方式，但不要套模板腔。
4. 输出纯文本，不要使用 Markdown 格式。

当前平台：${platformLabel}

原始文本：
<<<CONTENT
${normalizedContent}
CONTENT

请直接输出优化后的文本，不要添加任何说明或注释。`;
}

/**
 * 文档画布主组件
 */
export const DocumentCanvas: React.FC<DocumentCanvasProps> = memo(
  ({
    state,
    onStateChange,
    onClose: _onClose,
    isStreaming = false,
    onSelectionTextChange,
    projectId,
    contentId,
    autoImageTopic,
    autoContinueProviderType,
    onAutoContinueProviderTypeChange,
    autoContinueModel,
    onAutoContinueModelChange,
    autoContinueThinkingEnabled,
    onAutoContinueThinkingEnabledChange,
    onAutoContinueRun,
    onAddImage,
    onImportDocument,
    onContentReviewRun,
    contentReviewPlacement = "inline",
    onTextStylizeRun,
  }) => {
    const [editingContent, setEditingContent] = useState(state.content);
    const [toastMessage, setToastMessage] = useState("");
    const [showToast, setShowToast] = useState(false);
    const [autoInsertLoading, setAutoInsertLoading] = useState(false);

    // Undo/Redo 历史栈
    const undoStackRef = useRef<string[]>([]);
    const redoStackRef = useRef<string[]>([]);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const lastPushedContentRef = useRef(state.content);

    const pushUndoHistory = useCallback((content: string) => {
      if (content === lastPushedContentRef.current) return;
      undoStackRef.current.push(lastPushedContentRef.current);
      if (undoStackRef.current.length > 50) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
      lastPushedContentRef.current = content;
      setCanUndo(undoStackRef.current.length > 0);
      setCanRedo(false);
    }, []);

    const handleUndo = useCallback(() => {
      if (undoStackRef.current.length === 0) return;
      const previous = undoStackRef.current.pop()!;
      redoStackRef.current.push(lastPushedContentRef.current);
      lastPushedContentRef.current = previous;
      setEditingContent(previous);
      onStateChange({ ...latestStateRef.current, content: previous });
      setCanUndo(undoStackRef.current.length > 0);
      setCanRedo(true);
    }, [onStateChange]);

    const handleRedo = useCallback(() => {
      if (redoStackRef.current.length === 0) return;
      const next = redoStackRef.current.pop()!;
      undoStackRef.current.push(lastPushedContentRef.current);
      lastPushedContentRef.current = next;
      setEditingContent(next);
      onStateChange({ ...latestStateRef.current, content: next });
      setCanUndo(true);
      setCanRedo(redoStackRef.current.length > 0);
    }, [onStateChange]);

    // 键盘快捷键：Cmd+Z 撤销，Cmd+Shift+Z 重做
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const action = resolveDocumentCanvasHotkeyAction(e);
        if (!action) {
          return;
        }

        e.preventDefault();
        if (action === "redo") {
          handleRedo();
          return;
        }

        handleUndo();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleUndo, handleRedo]);

    const [autoContinueSettings, setAutoContinueSettings] =
      useState<AutoContinueSettings>(() => loadAutoContinueSettings(projectId));
    const [chatToolPreferences, setChatToolPreferences] =
      useState<ChatToolPreferences>(() => loadChatToolPreferences());
    const [fallbackProviderType, setFallbackProviderType] = useState("");
    const [fallbackModel, setFallbackModel] = useState("");
    const [contentReviewOpen, setContentReviewOpen] = useState(false);
    const [customReviewExperts, setCustomReviewExperts] = useState<
      ContentReviewExpert[]
    >([]);
    const [selectedReviewExpertIds, setSelectedReviewExpertIds] = useState<
      string[]
    >([DEFAULT_CONTENT_REVIEW_EXPERTS[0]?.id ?? ""]);
    const [contentReviewRunning, setContentReviewRunning] = useState(false);
    const [contentReviewResult, setContentReviewResult] = useState("");
    const [contentReviewError, setContentReviewError] = useState("");
    const [pendingEditorInsert, setPendingEditorInsert] = useState<{
      requestId: string;
      image: InsertableImage;
    } | null>(null);
    const setContentReviewRailState = useWorkbenchStore(
      (store) => store.setContentReviewRailState,
    );
    const clearContentReviewRailState = useWorkbenchStore(
      (store) => store.clearContentReviewRailState,
    );
    const editorRef = useRef<NotionEditorHandle | null>(null);
    const latestStateRef = useRef(state);
    const renderCountRef = useRef(0);
    const lastCommitAtRef = useRef<number | null>(null);
    renderCountRef.current += 1;
    const currentRenderCount = renderCountRef.current;
    const isEditing = true;
    const resolvedAutoContinueProviderType =
      autoContinueProviderType ?? fallbackProviderType;
    const resolvedAutoContinueModel = autoContinueModel ?? fallbackModel;
    const resolvedThinkingEnabled =
      autoContinueThinkingEnabled ?? chatToolPreferences.thinking;
    const reviewExperts = useMemo(
      () => [...customReviewExperts, ...DEFAULT_CONTENT_REVIEW_EXPERTS],
      [customReviewExperts],
    );
    const selectedReviewExperts = useMemo(
      () =>
        reviewExperts.filter((expert) =>
          selectedReviewExpertIds.includes(expert.id),
        ),
      [reviewExperts, selectedReviewExpertIds],
    );
    useEffect(() => {
      onSelectionTextChange?.("");
    }, [state.currentVersionId, isEditing, onSelectionTextChange]);

    useEffect(() => {
      setAutoContinueSettings(loadAutoContinueSettings(projectId));
    }, [projectId]);

    useEffect(() => {
      saveAutoContinueSettings(projectId, autoContinueSettings);
    }, [autoContinueSettings, projectId]);

    useEffect(() => {
      saveChatToolPreferences(chatToolPreferences);
    }, [chatToolPreferences]);

    useEffect(() => {
      if (!isEditing) {
        return;
      }
      if (state.content === editingContent) {
        return;
      }
      setEditingContent(state.content);
    }, [editingContent, isEditing, state.content, state.currentVersionId]);

    useEffect(() => {
      latestStateRef.current = state;
    }, [state]);

    useEffect(() => {
      const now = performance.now();
      const sinceLastCommitMs =
        lastCommitAtRef.current === null ? null : now - lastCommitAtRef.current;
      lastCommitAtRef.current = now;
      logRenderPerf("DocumentCanvas", currentRenderCount, sinceLastCommitMs, {
        isStreaming,
        isEditing,
        versionsCount: state.versions.length,
        contentChars: state.content.length,
        editingChars: editingContent.length,
        hasPendingEditorInsert: Boolean(pendingEditorInsert),
        autoInsertLoading,
      });
    });

    const commitEditingContent = useCallback(
      (nextContent: string) => {
        setEditingContent((previous) =>
          previous === nextContent ? previous : nextContent,
        );

        const latestState = latestStateRef.current;
        if (latestState.content === nextContent) {
          return nextContent;
        }

        pushUndoHistory(nextContent);
        onStateChange({
          ...latestState,
          content: nextContent,
        });
        return nextContent;
      },
      [onStateChange, pushUndoHistory],
    );

    const flushEditorDraft = useCallback(() => {
      const flushed = editorRef.current?.flushContent();
      const resolvedContent = flushed ?? editingContent;
      return commitEditingContent(resolvedContent);
    }, [commitEditingContent, editingContent]);

    // 显示提示
    const showMessage = useCallback((message: string) => {
      setToastMessage(message);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    }, []);

    const appendImageIntoDocument = useCallback(
      (image: InsertableImage, description = "插入图片") => {
        const latestState = latestStateRef.current;
        const baseContent = flushEditorDraft();
        const nextContent = appendImageToMarkdown(baseContent, image, true);
        if (nextContent === baseContent) {
          showMessage("ℹ️ 图片已存在，跳过插入");
          return false;
        }

        const newVersion = {
          id: crypto.randomUUID(),
          content: nextContent,
          createdAt: Date.now(),
          description,
        };
        onStateChange({
          ...latestState,
          content: nextContent,
          versions: [...latestState.versions, newVersion],
          currentVersionId: newVersion.id,
        });
        setEditingContent(nextContent);
        return true;
      },
      [flushEditorDraft, onStateChange, showMessage],
    );

    const matchesRequestTarget = useCallback(
      (request: CanvasImageInsertRequest): boolean =>
        matchesCanvasImageInsertTarget(request, {
          projectId: projectId || null,
          contentId: contentId || null,
          canvasType: "document",
        }),
      [contentId, projectId],
    );

    const processInsertRequest = useCallback(
      (request: CanvasImageInsertRequest) => {
        if (!matchesRequestTarget(request)) {
          return;
        }

        if (isEditing) {
          setPendingEditorInsert({
            requestId: request.requestId,
            image: request.image,
          });
          return;
        }

        const inserted = appendImageIntoDocument(request.image, "手动插图");
        if (inserted) {
          showMessage("🖼️ 已插入文稿");
        }
        emitCanvasImageInsertAck({
          requestId: request.requestId,
          success: inserted,
          canvasType: "document",
          locationLabel: inserted ? "文档正文末尾" : "文档中已存在同图",
          reason: inserted ? undefined : "duplicate",
        });
        ackCanvasImageInsertRequest(request.requestId);
      },
      [appendImageIntoDocument, isEditing, matchesRequestTarget, showMessage],
    );

    useEffect(() => {
      const unsubscribe = onCanvasImageInsertRequest((request) => {
        processInsertRequest(request);
      });

      return unsubscribe;
    }, [processInsertRequest]);

    useEffect(() => {
      const pendingRequests = getPendingCanvasImageInsertRequests();
      pendingRequests.forEach((request) => {
        processInsertRequest(request);
      });
    }, [processInsertRequest]);

    const mapWebHitToInsertable = useCallback(
      (hit: WebImageSearchResponse["hits"][number], provider: string) => {
        const contentUrl = hit.content_url || hit.thumbnail_url || "";
        const previewUrl = hit.thumbnail_url || hit.content_url || "";
        if (!contentUrl || !previewUrl) {
          return null;
        }
        return {
          id: hit.id || crypto.randomUUID(),
          previewUrl,
          contentUrl,
          pageUrl: hit.host_page_url,
          title: hit.name || "插图",
          width: hit.width,
          height: hit.height,
          attributionName: provider || "Pexels",
          provider,
        } as InsertableImage;
      },
      [],
    );

    const mapPixabayHitToInsertable = useCallback(
      (hit: PixabaySearchResponse["hits"][number]) => {
        const contentUrl = hit.large_image_url || hit.preview_url || "";
        const previewUrl = hit.preview_url || hit.large_image_url || "";
        if (!contentUrl || !previewUrl) {
          return null;
        }
        return {
          id: String(hit.id || crypto.randomUUID()),
          previewUrl,
          contentUrl,
          pageUrl: hit.page_url,
          title: hit.tags || "插图",
          width: hit.image_width,
          height: hit.image_height,
          attributionName: "Pixabay",
          provider: "pixabay",
        } as InsertableImage;
      },
      [],
    );

    const searchImageWithFallback = useCallback(
      async (query: string): Promise<InsertableImage | null> => {
        if (!query.trim()) {
          return null;
        }

        try {
          const webResp = await searchWebImages({
            query,
            page: 1,
            perPage: 6,
          });
          const fromWeb = webResp.hits
            .map((hit) =>
              mapWebHitToInsertable(hit, webResp.provider || "pexels"),
            )
            .find(Boolean);
          if (fromWeb) {
            return fromWeb;
          }
        } catch {
          // 回退到 Pixabay
        }

        try {
          const pixabayResp = await searchPixabayImages({
            query,
            page: 1,
            perPage: 6,
          });
          const fromPixabay = pixabayResp.hits
            .map((hit) => mapPixabayHitToInsertable(hit))
            .find(Boolean);
          return fromPixabay || null;
        } catch {
          return null;
        }
      },
      [mapPixabayHitToInsertable, mapWebHitToInsertable],
    );

    const handleAutoInsertImages = useCallback(async () => {
      if (autoInsertLoading) {
        return;
      }

      setAutoInsertLoading(true);
      try {
        const latestState = latestStateRef.current;
        const baseContent = flushEditorDraft();
        const sections = extractLevel2Sections(baseContent).slice(0, 6);
        const sectionTitles =
          sections.length > 0
            ? sections.map((section) => section.title)
            : [autoImageTopic || "文稿主题"];

        const assignments: Array<{
          sectionTitle: string;
          image: InsertableImage;
        }> = [];

        for (let index = 0; index < sectionTitles.length; index += 1) {
          const sectionTitle = sectionTitles[index];
          const query = buildSectionSearchQuery(autoImageTopic, sectionTitle);
          if (!query) {
            continue;
          }
          showMessage(`🖼️ 正在匹配配图 ${index + 1}/${sectionTitles.length}`);
          const image = await searchImageWithFallback(query);
          if (image) {
            assignments.push({
              sectionTitle,
              image,
            });
          }
        }

        if (!assignments.length) {
          showMessage("⚠️ 未找到可用图片，建议手动插图");
          return;
        }

        const nextContent = applySectionImageAssignments(
          baseContent,
          assignments,
          {
            includeAttribution: true,
          },
        );

        if (nextContent === baseContent) {
          showMessage("ℹ️ 当前小节已有图片，未重复插入");
          return;
        }

        const newVersion = {
          id: crypto.randomUUID(),
          content: nextContent,
          createdAt: Date.now(),
          description: "主题自动配图",
        };
        onStateChange({
          ...latestState,
          content: nextContent,
          versions: [...latestState.versions, newVersion],
          currentVersionId: newVersion.id,
        });
        setEditingContent(nextContent);
        showMessage(`✅ 自动配图完成，已插入 ${assignments.length} 张`);
      } finally {
        setAutoInsertLoading(false);
      }
    }, [
      autoImageTopic,
      autoInsertLoading,
      flushEditorDraft,
      onStateChange,
      searchImageWithFallback,
      showMessage,
    ]);

    // 保存快照（快捷键 Cmd/Ctrl + S）
    const handleSave = useCallback(
      (latestContent?: string) => {
        const baseState = latestStateRef.current;
        const candidateContent =
          latestContent ?? editorRef.current?.flushContent() ?? editingContent;
        commitEditingContent(candidateContent);
        const snapshotContent = candidateContent.trim()
          ? candidateContent
          : baseState.content;
        if (!snapshotContent.trim()) {
          showMessage("ℹ️ 当前内容为空，跳过快照");
          return;
        }
        const newVersion = {
          id: crypto.randomUUID(),
          content: snapshotContent,
          createdAt: Date.now(),
          description: "手动快照",
        };
        onStateChange({
          ...baseState,
          content: snapshotContent,
          versions: [...baseState.versions, newVersion],
          currentVersionId: newVersion.id,
        });
        setEditingContent(snapshotContent);
        showMessage("✅ 已创建快照版本");
      },
      [commitEditingContent, editingContent, onStateChange, showMessage],
    );

    // 当前模式不切换预览，Esc 作为轻提示
    const handleCancel = useCallback(() => {
      showMessage("ℹ️ 当前为自动保存模式");
    }, [showMessage]);

    // 导出文档
    const handleExport = useCallback(
      async (format: ExportFormat) => {
        const content = flushEditorDraft();
        const message = await exportDocumentContent(content, format);
        if (message) {
          showMessage(message);
        }
      },
      [flushEditorDraft, showMessage],
    );

    const handleAutoContinueSettingsChange = useCallback(
      (patch: Partial<AutoContinueSettings>) => {
        setAutoContinueSettings((prev) => ({ ...prev, ...patch }));
      },
      [],
    );

    const handleAutoContinueProviderChange = useCallback(
      (providerType: string) => {
        if (onAutoContinueProviderTypeChange) {
          onAutoContinueProviderTypeChange(providerType);
          return;
        }
        setFallbackProviderType(providerType);
        if (!onAutoContinueModelChange) {
          setFallbackModel("");
        }
      },
      [onAutoContinueModelChange, onAutoContinueProviderTypeChange],
    );

    const handleAutoContinueModelSelectionChange = useCallback(
      (model: string) => {
        if (onAutoContinueModelChange) {
          onAutoContinueModelChange(model);
          return;
        }
        setFallbackModel(model);
      },
      [onAutoContinueModelChange],
    );

    const handleThinkingChange = useCallback(
      (enabled: boolean) => {
        if (onAutoContinueThinkingEnabledChange) {
          onAutoContinueThinkingEnabledChange(enabled);
          return;
        }
        setChatToolPreferences((prev) => ({
          ...prev,
          thinking: enabled,
        }));
      },
      [onAutoContinueThinkingEnabledChange],
    );

    const buildAutoContinuePrompt = useCallback(
      (contentOverride?: string) => {
        const baseContent = (
          contentOverride?.trim() ||
          editingContent.trim() ||
          latestStateRef.current.content ||
          ""
        ).trim();
        if (!baseContent) {
          return "";
        }

        const lengthInstructionMap = [
          "续写长度：短（约 1-2 段，聚焦核心信息补全）。",
          "续写长度：中（约 3-5 段，补全结构与细节）。",
          "续写长度：长（完整扩展为可发布草稿，结构清晰）。",
        ] as const;
        const lengthInstruction =
          lengthInstructionMap[
            Math.min(2, Math.max(0, autoContinueSettings.continuationLength))
          ];

        const sensitivity = Math.min(
          100,
          Math.max(0, autoContinueSettings.sensitivity),
        );
        const toneInstruction =
          sensitivity <= 33
            ? "灵敏度：低（稳健延续原文风格，少量探索）。"
            : sensitivity <= 66
              ? "灵敏度：中（保持原文一致性并适度优化表达）。"
              : "灵敏度：高（在不偏题前提下更积极补充观点与亮点）。";

        const modeInstruction = autoContinueSettings.fastModeEnabled
          ? "快速模式：优先产出可用草稿，减少解释与自我说明。"
          : "标准模式：兼顾质量、连贯性和可发布性。";

        return `请对下面文稿进行“自动续写”。要求：
1. 不重复已有内容，直接从现有结尾自然衔接；
2. 维持当前语气、目标受众与主题方向；
3. ${lengthInstruction}
4. ${toneInstruction}
5. ${modeInstruction}

【现有文稿】
${baseContent}`;
      },
      [autoContinueSettings, editingContent],
    );

    const handleAutoContinueRun = useCallback(async () => {
      if (!autoContinueSettings.enabled) {
        showMessage("ℹ️ 请先开启自动续写");
        return;
      }

      const latestContent = flushEditorDraft();
      const prompt = buildAutoContinuePrompt(latestContent);
      if (!prompt) {
        showMessage("ℹ️ 当前文稿为空，无法续写");
        return;
      }

      if (!onAutoContinueRun) {
        showMessage("⚠️ 自动续写执行链路未接入");
        return;
      }

      try {
        await onAutoContinueRun({
          prompt,
          thinkingEnabled: resolvedThinkingEnabled,
          settings: autoContinueSettings,
        });
        showMessage("🪄 已触发自动续写");
      } catch (error) {
        console.error("[DocumentCanvas] 自动续写失败:", error);
        showMessage("⚠️ 自动续写失败，请重试");
      }
    }, [
      autoContinueSettings,
      buildAutoContinuePrompt,
      flushEditorDraft,
      onAutoContinueRun,
      resolvedThinkingEnabled,
      showMessage,
    ]);

    const buildContentReviewPrompt = useCallback(
      (contentOverride?: string): ContentReviewRunPayload | null => {
        const baseContent = (
          contentOverride?.trim() ||
          editingContent.trim() ||
          latestStateRef.current.content ||
          ""
        ).trim();
        if (!baseContent) {
          return null;
        }

        if (selectedReviewExperts.length === 0) {
          return null;
        }

        const expertInstruction = selectedReviewExperts
          .map(
            (expert, index) =>
              `${index + 1}. ${expert.name}｜${expert.title}｜${expert.description}`,
          )
          .join("\n");

        return {
          prompt: `请作为“内容评审专家团”对下列文稿进行深度评审。

评审要求：
1. 逐位使用给定专家身份进行点评，每位专家都要给出：核心判断、主要问题、优化建议、风险提醒。
2. 最后补充“综合结论”和“优先修改清单（最多 5 条）”。
3. 输出必须是纯文本，不要使用 Markdown 标题、代码块、表格，也不要输出 <document> 标签。
4. 回答第一行固定写“内容评审结果：”。
5. 除非用于举例，不要直接重写整篇文稿。
6. 如果发现文稿亮点，也请明确指出。

当前平台：${state.platform}

评审专家：
${expertInstruction}

待评审文稿：
<<<CONTENT
${baseContent}
CONTENT`,
          thinkingEnabled: resolvedThinkingEnabled,
          experts: selectedReviewExperts,
        };
      },
      [
        editingContent,
        resolvedThinkingEnabled,
        selectedReviewExperts,
        state.platform,
      ],
    );

    const handleTextStylize = useCallback(async () => {
      if (!onTextStylizeRun) {
        showMessage("⚠️ 文本风格化功能未配置");
        return;
      }

      const baseContent = (
        editingContent.trim() ||
        latestStateRef.current.content ||
        ""
      ).trim();

      if (!baseContent) {
        showMessage("⚠️ 请先输入内容");
        return;
      }

      try {
        showMessage("✨ 正在进行文本风格化...");

        const prompt = buildTextStylizePrompt(baseContent, state.platform);

        const result = await onTextStylizeRun({
          prompt,
          thinkingEnabled: resolvedThinkingEnabled,
          originalContent: baseContent,
        });

        if (result && result.trim()) {
          // 更新编辑器内容
          setEditingContent(result.trim());
          showMessage("✨ 文本风格化完成");
        } else {
          showMessage("⚠️ 风格化结果为空");
        }
      } catch (error) {
        console.error("[DocumentCanvas] 文本风格化失败:", error);
        showMessage("⚠️ 文本风格化失败，请重试");
      }
    }, [
      onTextStylizeRun,
      editingContent,
      state.platform,
      resolvedThinkingEnabled,
      showMessage,
    ]);

    const handleCloseContentReview = useCallback(() => {
      setContentReviewOpen(false);
      if (contentReviewPlacement === "external-rail") {
        clearContentReviewRailState();
      }
    }, [clearContentReviewRailState, contentReviewPlacement]);

    const handleContentReview = useCallback(() => {
      setContentReviewOpen((prev) => !prev);
    }, []);

    const handleReviewExpertToggle = useCallback((expertId: string) => {
      setSelectedReviewExpertIds((prev) => {
        if (prev.includes(expertId)) {
          return prev.filter((id) => id !== expertId);
        }
        return [...prev, expertId];
      });
      setContentReviewError("");
      setContentReviewResult("");
    }, []);

    const handleCreateReviewExpert = useCallback(
      (input: CustomContentReviewExpertInput) => {
        const expert = createCustomContentReviewExpert(input);
        setCustomReviewExperts((prev) => [expert, ...prev]);
        setSelectedReviewExpertIds((prev) =>
          prev.includes(expert.id) ? prev : [expert.id, ...prev],
        );
        setContentReviewError("");
        setContentReviewResult("");
        setContentReviewOpen(true);
        showMessage(`👥 已添加评审专家「${expert.name}」`);
      },
      [showMessage],
    );

    const handleStartContentReview = useCallback(async () => {
      if (selectedReviewExpertIds.length === 0) {
        showMessage("ℹ️ 请先选择至少一位评审专家");
        return;
      }

      const latestContent = flushEditorDraft();
      const payload = buildContentReviewPrompt(latestContent);
      if (!payload) {
        showMessage("ℹ️ 当前文稿为空，无法发起评审");
        return;
      }

      if (!onContentReviewRun) {
        showMessage("⚠️ 内容评审执行链路未接入");
        return;
      }

      setContentReviewRunning(true);
      setContentReviewError("");
      setContentReviewResult("");

      try {
        const result = await onContentReviewRun(payload);
        const normalizedResult = result.trim();
        setContentReviewResult(normalizedResult || "内容评审结果为空");
        showMessage(`🧪 已完成 ${payload.experts.length} 位专家的深度评审`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "内容评审失败，请重试";
        console.error("[DocumentCanvas] 内容评审失败:", error);
        setContentReviewError(errorMessage);
        showMessage("⚠️ 内容评审失败，请重试");
      } finally {
        setContentReviewRunning(false);
      }
    }, [
      buildContentReviewPrompt,
      flushEditorDraft,
      onContentReviewRun,
      selectedReviewExpertIds.length,
      showMessage,
    ]);

    useEffect(() => {
      if (contentReviewPlacement !== "external-rail" || !contentReviewOpen) {
        clearContentReviewRailState();
        return;
      }

      setContentReviewRailState({
        experts: reviewExperts,
        selectedExpertIds: selectedReviewExpertIds,
        onToggleExpert: handleReviewExpertToggle,
        onClose: handleCloseContentReview,
        onCreateExpert: handleCreateReviewExpert,
        onStartReview: () => {
          void handleStartContentReview();
        },
        reviewRunning: contentReviewRunning,
        reviewResult: contentReviewResult,
        reviewError: contentReviewError,
      });
    }, [
      clearContentReviewRailState,
      contentReviewError,
      contentReviewOpen,
      contentReviewPlacement,
      contentReviewResult,
      contentReviewRunning,
      handleCloseContentReview,
      handleCreateReviewExpert,
      handleReviewExpertToggle,
      handleStartContentReview,
      reviewExperts,
      selectedReviewExpertIds,
      setContentReviewRailState,
    ]);

    useEffect(() => {
      return () => {
        clearContentReviewRailState();
      };
    }, [clearContentReviewRailState]);

    // 切换平台
    const handlePlatformChange = useCallback(
      (platform: PlatformType) => {
        onStateChange({ ...latestStateRef.current, platform });
      },
      [onStateChange],
    );

    return (
      <Container>
        <InnerContainer>
          <DocumentToolbar
            isStreaming={isStreaming}
            onExport={handleExport}
            onAutoInsertImages={handleAutoInsertImages}
            onAddImage={onAddImage}
            onImportDocument={onImportDocument}
            onTextStylize={handleTextStylize}
            onContentReview={handleContentReview}
            contentReviewActive={contentReviewOpen}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
            autoContinueSettings={autoContinueSettings}
            autoContinueProviderType={resolvedAutoContinueProviderType}
            onAutoContinueProviderChange={handleAutoContinueProviderChange}
            selectedAutoContinueModel={resolvedAutoContinueModel}
            autoContinueModelLoading={false}
            onAutoContinueModelChange={handleAutoContinueModelSelectionChange}
            thinkingEnabled={resolvedThinkingEnabled}
            onThinkingChange={handleThinkingChange}
            onAutoContinueSettingsChange={handleAutoContinueSettingsChange}
            onAutoContinueRun={handleAutoContinueRun}
            autoContinueRunDisabled={isStreaming}
          />

          <ContentArea>
            <MainContent>
              {isEditing ? (
                <NotionEditor
                  ref={editorRef}
                  content={editingContent}
                  contentVersionKey={state.currentVersionId}
                  readOnly={isStreaming}
                  onCommit={commitEditingContent}
                  onSave={handleSave}
                  onCancel={handleCancel}
                  onSelectionTextChange={onSelectionTextChange}
                  externalImageInsert={
                    pendingEditorInsert
                      ? {
                          requestId: pendingEditorInsert.requestId,
                          url: pendingEditorInsert.image.contentUrl,
                          alt: pendingEditorInsert.image.title || "插图",
                        }
                      : null
                  }
                  onExternalImageInsertComplete={(requestId, success) => {
                    if (success) {
                      showMessage("🖼️ 已插入文稿（编辑态）");
                    } else {
                      showMessage("⚠️ 插图失败，请重试");
                    }
                    emitCanvasImageInsertAck({
                      requestId,
                      success,
                      canvasType: "document",
                      locationLabel: success
                        ? "文档编辑器当前光标位置"
                        : undefined,
                      reason: success ? undefined : "editor_insert_failed",
                    });
                    ackCanvasImageInsertRequest(requestId);
                    setPendingEditorInsert((prev) =>
                      prev?.requestId === requestId ? null : prev,
                    );
                  }}
                />
              ) : (
                <DocumentRenderer
                  content={state.content}
                  platform={state.platform}
                  isStreaming={isStreaming}
                  onSelectionTextChange={onSelectionTextChange}
                />
              )}
            </MainContent>

            {contentReviewPlacement !== "external-rail" ? (
              <ContentReviewPanel
                open={contentReviewOpen}
                experts={reviewExperts}
                selectedExpertIds={selectedReviewExpertIds}
                onToggleExpert={handleReviewExpertToggle}
                onClose={handleCloseContentReview}
                onCreateExpert={handleCreateReviewExpert}
                onStartReview={handleStartContentReview}
                reviewRunning={contentReviewRunning}
                reviewResult={contentReviewResult}
                reviewError={contentReviewError}
              />
            ) : null}
          </ContentArea>

          {!isEditing && (
            <PlatformTabs
              currentPlatform={state.platform}
              onPlatformChange={handlePlatformChange}
            />
          )}
        </InnerContainer>

        <Toast $visible={showToast}>{toastMessage}</Toast>
      </Container>
    );
  },
);

DocumentCanvas.displayName = "DocumentCanvas";
