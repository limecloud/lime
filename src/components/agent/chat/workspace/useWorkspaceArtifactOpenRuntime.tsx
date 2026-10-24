import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  createInitialVideoState,
  type CanvasStateUnion,
} from "@/components/workspace/canvas/canvasUtils";
import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";
import { normalizeArtifactProtocolPath } from "@/lib/artifact-protocol";
import type { SessionFile } from "@/lib/api/session-files";
import type { Artifact } from "@/lib/artifact/types";
import { requestWorkspaceRightSurface } from "@/lib/api/workspaceRightSurface";
import { createPreviewArtifact } from "@/lib/artifact/previewArtifact";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";
import type { CanvasWorkbenchLayoutMode } from "../components/CanvasWorkbenchLayout";
import type { TaskFile } from "../components/TaskFiles";
import type { WorkspaceWorkbenchRequestsController } from "../hooks/useWorkspaceWorkbenchRequests";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";
import type { SearchResultPreviewItem } from "../utils/searchResultPreview";
import type {
  AgentThreadItem,
  Message,
  MessagePreviewTarget,
  SiteSavedContentTarget,
} from "../types";
import {
  normalizeVideoAspectRatio,
  normalizeVideoResolution,
  resolveTaskPreviewArtifact,
  resolveVideoCanvasStatusFromPreview,
} from "./agentChatWorkspaceHelpers";
import { openCanvasForReason } from "./canvasOpenPolicy";
import { MediaReferencePreviewPaginationActions } from "./mediaReferencePreviewToolbarActions";
import { resolveMediaReferencePreviewPageRequest } from "./mediaReferencePreviewToolbarState";
import type { ApplyArtifactViewMode } from "./useWorkspaceArtifactViewModeControl";
import {
  useWorkspaceArtifactDocumentSaveRuntime,
  type WorkspaceArtifactWriteFile,
} from "./useWorkspaceArtifactDocumentSaveRuntime";
import { useWorkspaceArtifactPreviewActions } from "./useWorkspaceArtifactPreviewActions";
import { useWorkspaceArtifactWorkbenchActions } from "./useWorkspaceArtifactWorkbenchActions";
import { useWorkspaceMediaReferencePreviewRuntime } from "./useWorkspaceMediaReferencePreviewRuntime";
import { useWorkspaceRightSurfaceArtifactOpenRuntime } from "./useWorkspaceRightSurfaceArtifactOpenRuntime";
import { useWorkspaceServiceSkillResultFileRuntime } from "./useWorkspaceServiceSkillResultFileRuntime";
import { resolveImageWorkbenchStateForPreviewSelection } from "./imageWorkbenchPreviewSelection";
import type { WorkspaceArticleWorkspace } from "./workspaceArticleWorkspaceModel";
import { doesWorkspaceFileCandidateMatch } from "./workspaceFilePathMatch";
import {
  isAbsoluteWorkspacePath,
  resolveAbsoluteWorkspacePath,
} from "./workspacePath";
import type { WorkspaceImageWorkbenchSessionRuntimeState } from "./useWorkspaceImageWorkbenchSessionRuntime";

type SetBoolean = (value: boolean) => void;

export interface UseWorkspaceArtifactOpenRuntimeParams {
  activeTheme: string;
  artifacts: Artifact[];
  contentId?: string | null;
  currentCanvasArtifact: Artifact | null;
  currentTurnId?: string | null;
  effectiveThreadItems: AgentThreadItem[];
  generalCanvasState: GeneralCanvasState;
  handleWriteFile: WorkspaceArtifactWriteFile;
  initialProjectFileOpenTarget?: AgentChatWorkspaceProps["initialProjectFileOpenTarget"];
  isInitialContentLoading: boolean;
  layoutMode: LayoutMode;
  messages: Message[];
  onNavigate?: AgentChatWorkspaceProps["onNavigate"];
  openArticleWorkspaceRightSurface: (
    articleWorkspace: WorkspaceArticleWorkspace,
  ) => void;
  openWorkspaceFile: (path: string) => void;
  projectId?: string | null;
  projectRootPath?: string | null;
  readSessionFile: (fileName: string) => Promise<string | null>;
  sessionFiles: SessionFile[];
  threadId?: string | null;
  sessionId?: string | null;
  setArtifactViewMode: ApplyArtifactViewMode;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setCanvasWorkbenchLayoutMode: Dispatch<
    SetStateAction<CanvasWorkbenchLayoutMode>
  >;
  setExpertInfoPanelCollapsed: SetBoolean;
  setGeneralCanvasState: Dispatch<SetStateAction<GeneralCanvasState>>;
  setHarnessPanelVisible: SetBoolean;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setSelectedArtifactId: (artifactId: string | null) => void;
  taskFiles: TaskFile[];
  updateCurrentImageWorkbenchState: WorkspaceImageWorkbenchSessionRuntimeState["updateCurrentImageWorkbenchState"];
  upsertGeneralArtifact: (artifact: Artifact) => void;
  workbenchRequests: WorkspaceWorkbenchRequestsController;
}

export function useWorkspaceArtifactOpenRuntime({
  activeTheme,
  artifacts,
  contentId,
  currentCanvasArtifact,
  currentTurnId,
  effectiveThreadItems,
  generalCanvasState,
  handleWriteFile,
  initialProjectFileOpenTarget,
  isInitialContentLoading,
  layoutMode,
  messages,
  onNavigate,
  openArticleWorkspaceRightSurface,
  openWorkspaceFile,
  projectId,
  projectRootPath,
  readSessionFile,
  sessionFiles,
  threadId,
  sessionId,
  setArtifactViewMode,
  setCanvasState,
  setCanvasWorkbenchLayoutMode,
  setExpertInfoPanelCollapsed,
  setGeneralCanvasState,
  setHarnessPanelVisible,
  setLayoutMode,
  setSelectedArtifactId,
  taskFiles,
  updateCurrentImageWorkbenchState,
  upsertGeneralArtifact,
  workbenchRequests,
}: UseWorkspaceArtifactOpenRuntimeParams) {
  const { t } = useTranslation("agent");
  const handledInitialProjectFileOpenSignatureRef = useRef("");
  const {
    clearFocusedArtifactBlock,
    focusArtifactBlock,
    requestCanvasWorkbenchPreviewOpen,
  } = workbenchRequests;

  const handleRequestCanvasPreviewOpen = useCallback(
    (request: Parameters<typeof requestCanvasWorkbenchPreviewOpen>[0]) => {
      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: false,
      }));
      requestCanvasWorkbenchPreviewOpen(request);
    },
    [requestCanvasWorkbenchPreviewOpen, updateCurrentImageWorkbenchState],
  );

  const handleSaveArtifactDocument = useWorkspaceArtifactDocumentSaveRuntime({
    handleWriteFile,
  });

  const { renderToolbarActions: renderBaseArtifactWorkbenchToolbarActions } =
    useWorkspaceArtifactWorkbenchActions({
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

  const {
    handleHarnessLoadFilePreview,
    openArtifactInWorkbench: openWorkspaceArtifactInWorkbench,
    handleArtifactClick,
    handleFileClick,
    handleCodeBlockClick,
    shouldCollapseCodeBlocks,
    shouldCollapseCodeBlockInChat,
  } = useWorkspaceArtifactPreviewActions({
    activeTheme,
    layoutMode,
    isGeneralCanvasOpen: generalCanvasState.isOpen,
    artifacts,
    currentCanvasArtifact,
    taskFiles,
    sessionFiles,
    threadId,
    sessionId,
    projectRootPath,
    openWorkspaceFile,
    readSessionFile,
    onRequestCanvasPreviewOpen: handleRequestCanvasPreviewOpen,
    upsertGeneralArtifact,
    setSelectedArtifactId,
    setArtifactViewMode,
    setLayoutMode,
    setGeneralCanvasState,
  });

  const {
    bindArticleEditorRightSurface,
    bindRightSurfacePendingActions,
    handleWorkspaceArtifactClick,
  } = useWorkspaceRightSurfaceArtifactOpenRuntime({
    clearFocusedArtifactBlock,
    fallbackOpenArtifact: handleArtifactClick,
    openArticleWorkspaceRightSurface,
    setExpertInfoPanelCollapsed,
    setHarnessPanelVisible,
  });

  const handleWorkspaceFileClick = useCallback(
    (fileName: string, content: string) => {
      clearFocusedArtifactBlock();
      setHarnessPanelVisible(false);
      setExpertInfoPanelCollapsed(true);
      handleFileClick(fileName, content);
    },
    [
      clearFocusedArtifactBlock,
      handleFileClick,
      setExpertInfoPanelCollapsed,
      setHarnessPanelVisible,
    ],
  );

  const handleOpenSavedSiteContent = useCallback(
    async ({
      projectId: targetProjectId,
      contentId: targetContentId,
      preferredTarget,
      projectFile,
    }: SiteSavedContentTarget) => {
      const relativePath = projectFile?.relativePath?.trim() || "";
      const canOpenInlineInCurrentWorkspace =
        preferredTarget === "project_file" &&
        Boolean(relativePath) &&
        Boolean(projectRootPath) &&
        Boolean(projectId) &&
        targetProjectId === projectId;

      if (canOpenInlineInCurrentWorkspace) {
        const absolutePath = resolveAbsoluteWorkspacePath(
          projectRootPath,
          relativePath,
        );
        if (absolutePath) {
          openWorkspaceFile(absolutePath);
          return;
        }
      }

      onNavigate?.("agent", {
        projectId: targetProjectId,
        contentId: targetContentId,
        lockTheme: true,
        ...(preferredTarget === "project_file" && relativePath
          ? {
              initialProjectFileOpenTarget: {
                relativePath,
                requestKey: Date.now(),
              },
            }
          : {}),
      });
    },
    [onNavigate, openWorkspaceFile, projectId, projectRootPath],
  );

  const openMessageAttachmentPreview = useCallback(
    (
      target: Extract<MessagePreviewTarget, { kind: "message_attachment" }>,
      message: Message,
    ) => {
      const attachment = target.attachment;
      const sourceRef =
        attachment.sourcePath?.trim() ||
        attachment.sourceUri?.trim() ||
        `${message.id}:attachment:${target.index}`;
      const sourceUri = attachment.sourceUri?.trim();
      const canUseSourceUriAsPreview =
        Boolean(sourceUri) &&
        (/^(data|https?|file|asset):/u.test(sourceUri || "") ||
          sourceUri?.startsWith("//"));
      const previewUrl =
        attachment.previewUrl?.trim() ||
        (canUseSourceUriAsPreview ? sourceUri : undefined) ||
        (attachment.data.trim()
          ? `data:${attachment.mediaType || "image/png"};base64,${attachment.data.trim()}`
          : undefined);
      const sourcePath = attachment.sourcePath?.trim() || sourceRef;
      const projection = createPreviewArtifact({
        source: "session_file",
        sourceRef,
        path: sourcePath,
        title: `attachment-${target.index + 1}`,
        content: "",
        isBinary: true,
        mimeType: attachment.mediaType,
        previewUrl,
        meta: {
          openedFrom: "message-attachment",
          messageId: message.id,
          attachmentIndex: target.index,
        },
      });
      upsertGeneralArtifact(projection.artifact);
      handleWorkspaceArtifactClick(projection.artifact);
      requestCanvasWorkbenchPreviewOpen({
        filePath: sourcePath,
        selectionKey: `artifact:${projection.artifact.id}`,
      });
    },
    [
      handleWorkspaceArtifactClick,
      requestCanvasWorkbenchPreviewOpen,
      upsertGeneralArtifact,
    ],
  );

  const { openMediaReferencePreview, openMediaReferencePreviewPage } =
    useWorkspaceMediaReferencePreviewRuntime({
      artifacts,
      handleWorkspaceArtifactClick,
      requestCanvasWorkbenchPreviewOpen,
      threadId,
      setCanvasWorkbenchLayoutMode,
      setLayoutMode,
      t,
      upsertGeneralArtifact,
    });

  const renderMediaReferencePaginationActions = useCallback(
    (artifact: Artifact) => {
      const pageRequest = resolveMediaReferencePreviewPageRequest(
        artifact,
        messages,
      );
      if (!pageRequest) {
        return null;
      }

      return (
        <MediaReferencePreviewPaginationActions
          artifact={artifact}
          onOpenPage={(page) => {
            void openMediaReferencePreviewPage(
              pageRequest.target,
              pageRequest.message,
              page,
            );
          }}
        />
      );
    },
    [messages, openMediaReferencePreviewPage],
  );

  const renderArtifactWorkbenchToolbarActions = useCallback(
    (params: { artifact: Artifact; document: ArtifactDocumentV1 | null }) => {
      const baseActions = renderBaseArtifactWorkbenchToolbarActions(params);
      const paginationActions = renderMediaReferencePaginationActions(
        params.artifact,
      );
      if (!baseActions && !paginationActions) {
        return null;
      }
      return (
        <>
          {baseActions}
          {paginationActions}
        </>
      );
    },
    [
      renderBaseArtifactWorkbenchToolbarActions,
      renderMediaReferencePaginationActions,
    ],
  );

  const handleOpenUrlPreview = useCallback(
    (item: SearchResultPreviewItem) => {
      const url = item.url.trim();
      if (!url) {
        return;
      }
      void requestWorkspaceRightSurface({
        surfaceKind: "browser",
        origin: "user",
        priority: "foreground",
        reason: "open_url_preview",
        sessionId: threadId ?? null,
        workspaceId: projectId ?? null,
        candidateId: item.id,
        metadata: {
          browser: {
            launchUrl: url,
            title: item.title.trim() || null,
          },
        },
      }).catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "无法打开浏览器工作区，请稍后重试。",
        );
      });
    },
    [projectId, threadId],
  );

  const handleOpenMessagePreview = useCallback(
    (target: MessagePreviewTarget, message: Message) => {
      if (target.kind === "image_workbench") {
        updateCurrentImageWorkbenchState((current) =>
          resolveImageWorkbenchStateForPreviewSelection({
            current,
            messages,
            preview: target.preview,
            selection: target.selection,
          }),
        );
        openCanvasForReason("user_open_message_preview", setLayoutMode);
        return;
      }

      if (target.kind === "message_attachment") {
        openMessageAttachmentPreview(target, message);
        return;
      }

      if (target.kind === "media_reference") {
        void openMediaReferencePreview(target, message);
        return;
      }

      if (target.preview.kind === "video_generate") {
        const preview = target.preview;
        const initialState = createInitialVideoState(preview.prompt);
        setCanvasState({
          ...initialState,
          providerId: preview.providerId?.trim() || "",
          model: preview.model?.trim() || "",
          duration: preview.durationSeconds || initialState.duration,
          aspectRatio: normalizeVideoAspectRatio(preview.aspectRatio),
          resolution: normalizeVideoResolution(preview.resolution),
          status: resolveVideoCanvasStatusFromPreview(target),
          selectedTaskId: preview.taskId,
          videoUrl: preview.videoUrl || undefined,
          errorMessage:
            preview.status === "failed" || preview.status === "cancelled"
              ? preview.statusMessage?.trim() || "视频任务未成功完成"
              : undefined,
        });
        openCanvasForReason("user_open_message_preview", setLayoutMode);
        return;
      }

      const matchedArtifact = resolveTaskPreviewArtifact(message, target);
      if (matchedArtifact) {
        handleWorkspaceArtifactClick(matchedArtifact);
        return;
      }

      const normalizedArtifactPath = normalizeArtifactProtocolPath(
        target.preview.artifactPath || null,
      );
      if (normalizedArtifactPath) {
        const matchedTaskFile = taskFiles.find((file) =>
          doesWorkspaceFileCandidateMatch(file.name, normalizedArtifactPath),
        );
        if (matchedTaskFile?.content?.trim()) {
          handleWorkspaceFileClick(
            matchedTaskFile.name,
            matchedTaskFile.content,
          );
          return;
        }
      }

      toast.info("当前任务产物还未同步完成，请稍后再试");
    },
    [
      handleWorkspaceArtifactClick,
      handleWorkspaceFileClick,
      messages,
      openMediaReferencePreview,
      openMessageAttachmentPreview,
      setCanvasState,
      setLayoutMode,
      taskFiles,
      updateCurrentImageWorkbenchState,
    ],
  );

  const handleOpenArtifactFromTimeline = useCallback(
    (target: ArtifactTimelineOpenTarget) => {
      void (async () => {
        const sourcePath = resolveAbsoluteWorkspacePath(
          projectRootPath,
          target.filePath,
        );
        if (sourcePath) {
          const projection = createPreviewArtifact({
            source: "artifact",
            sourceRef: target.timelineItemId,
            path: sourcePath,
          });
          if (
            target.openMode === "file_preview" ||
            projection.renderMode === "document_pages" ||
            projection.renderMode === "workbook" ||
            projection.renderMode === "presentation"
          ) {
            clearFocusedArtifactBlock();
            setHarnessPanelVisible(false);
            setExpertInfoPanelCollapsed(true);
            openWorkspaceFile(sourcePath);
            return;
          }
        }
        let content = target.content;
        if (!content.trim()) {
          const absolutePath = resolveAbsoluteWorkspacePath(
            projectRootPath,
            target.filePath,
          );
          if (absolutePath) {
            const preview = await handleHarnessLoadFilePreview(absolutePath);
            if (preview.error) {
              toast.error(`打开产物失败: ${preview.error}`);
              return;
            }
            if (preview.isBinary) {
              toast.info("该产物是二进制格式，暂不支持在工作台预览");
              return;
            }
            content =
              typeof preview.content === "string" ? preview.content : "";
          }
        }

        handleWorkspaceFileClick(target.filePath, content);

        const normalizedBlockId = target.blockId?.trim();
        if (!normalizedBlockId) {
          return;
        }

        focusArtifactBlock(normalizedBlockId);
      })();
    },
    [
      clearFocusedArtifactBlock,
      focusArtifactBlock,
      handleHarnessLoadFilePreview,
      handleWorkspaceFileClick,
      openWorkspaceFile,
      projectRootPath,
      setExpertInfoPanelCollapsed,
      setHarnessPanelVisible,
    ],
  );

  const {
    handleOpenServiceSkillResultFile,
    preferredServiceSkillResultFileTarget,
  } = useWorkspaceServiceSkillResultFileRuntime({
    currentTurnId,
    effectiveThreadItems,
    handleWorkspaceFileClick,
    openWorkspaceFile,
    projectRootPath,
    taskFiles,
  });

  useEffect(() => {
    const relativePath = initialProjectFileOpenTarget?.relativePath?.trim();
    if (!relativePath) {
      handledInitialProjectFileOpenSignatureRef.current = "";
      return;
    }

    if (contentId && isInitialContentLoading) {
      return;
    }

    if (!projectRootPath && !isAbsoluteWorkspacePath(relativePath)) {
      return;
    }

    const absolutePath = resolveAbsoluteWorkspacePath(
      projectRootPath,
      relativePath,
    );
    if (!absolutePath) {
      return;
    }

    const signature = JSON.stringify({
      projectId: projectId ?? "",
      contentId: contentId ?? "",
      relativePath,
      requestKey: initialProjectFileOpenTarget?.requestKey ?? 0,
    });
    if (handledInitialProjectFileOpenSignatureRef.current === signature) {
      return;
    }
    handledInitialProjectFileOpenSignatureRef.current = signature;

    openWorkspaceFile(absolutePath);
  }, [
    contentId,
    initialProjectFileOpenTarget,
    isInitialContentLoading,
    openWorkspaceFile,
    projectRootPath,
    projectId,
  ]);

  return {
    bindArticleEditorRightSurface,
    bindRightSurfacePendingActions,
    handleArtifactClick,
    handleCodeBlockClick,
    handleFileClick,
    handleHarnessLoadFilePreview,
    handleOpenArtifactFromTimeline,
    handleOpenMessagePreview,
    handleOpenSavedSiteContent,
    handleOpenServiceSkillResultFile,
    handleOpenUrlPreview,
    handleSaveArtifactDocument,
    handleWorkspaceArtifactClick,
    handleWorkspaceFileClick,
    openWorkspaceArtifactInWorkbench,
    preferredServiceSkillResultFileTarget,
    renderArtifactWorkbenchToolbarActions,
    shouldCollapseCodeBlockInChat,
    shouldCollapseCodeBlocks,
  };
}
