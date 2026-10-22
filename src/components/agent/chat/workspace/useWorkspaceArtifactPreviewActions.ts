import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  hasAgentRuntimeArtifactPreviewScope,
  readAgentRuntimeArtifactPreviewContent,
} from "@/lib/api/agentRuntime/appServerArtifactClient";
import { readFilePreview } from "@/lib/api/fileBrowser";
import type { SessionFile } from "@/lib/api/session-files";
import type { Artifact } from "@/lib/artifact/types";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { TaskFile } from "../components/TaskFiles";
import type { HarnessFilePreviewResult } from "../components/HarnessStatusPanel";
import { useArtifactAutoPreviewSync } from "../hooks/useArtifactAutoPreviewSync";
import { resolveDefaultArtifactViewMode } from "../utils/messageArtifacts";
import { openCanvasForReason } from "./canvasOpenPolicy";
import type { ApplyArtifactViewMode } from "./useWorkspaceArtifactViewModeControl";
import { doesWorkspaceFileCandidateMatch } from "./workspaceFilePathMatch";
import { extractFileNameFromPath } from "./workspacePath";
import { useWorkspaceFileOpen } from "./useWorkspaceFileOpen";
import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function resolveArtifactSelectionFilePath(artifact: Artifact): string | null {
  return (
    readNonEmptyString(artifact.meta.filePath) ??
    readNonEmptyString(artifact.meta.sourcePath) ??
    readNonEmptyString(artifact.title)
  );
}

function shouldUseProjectedPreviewArtifact(artifact: Artifact): boolean {
  if (artifact.meta.previewArtifact !== true) {
    return false;
  }

  const source =
    typeof artifact.meta.source === "string" ? artifact.meta.source : "";
  const contentKind =
    typeof artifact.meta.contentKind === "string"
      ? artifact.meta.contentKind
      : "";
  const renderMode =
    typeof artifact.meta.renderMode === "string"
      ? artifact.meta.renderMode
      : "";
  return (
    source === "url" ||
    source === "database_record" ||
    source === "app" ||
    contentKind === "app_shell" ||
    renderMode === "document_pages" ||
    renderMode === "workbook" ||
    renderMode === "presentation" ||
    renderMode === "media" ||
    renderMode === "system_open" ||
    renderMode === "unsupported"
  );
}

function shouldRequestCanvasDocumentSelection(artifact: Artifact): boolean {
  return !shouldUseProjectedPreviewArtifact(artifact);
}

interface UseWorkspaceArtifactPreviewActionsParams {
  activeTheme: string;
  layoutMode: LayoutMode;
  isGeneralCanvasOpen: boolean;
  artifacts: Artifact[];
  currentCanvasArtifact: Artifact | null;
  taskFiles: TaskFile[];
  sessionFiles: SessionFile[];
  threadId?: string | null;
  sessionId?: string | null;
  projectRootPath?: string | null;
  openWorkspaceFile: (path: string) => void;
  readSessionFile: (fileName: string) => Promise<string | null>;
  onRequestCanvasPreviewOpen?: (request: {
    filePath?: string | null;
    selectionKey?: string | null;
  }) => void;
  upsertGeneralArtifact: (artifact: Artifact) => void;
  setSelectedArtifactId: (artifactId: string | null) => void;
  setArtifactViewMode: ApplyArtifactViewMode;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setGeneralCanvasState: Dispatch<SetStateAction<GeneralCanvasState>>;
}

interface WorkspaceArtifactPreviewActionsResult {
  handleHarnessLoadFilePreview: (
    path: string,
    artifact?: Artifact,
  ) => Promise<HarnessFilePreviewResult>;
  openArtifactInWorkbench: (artifact: Artifact) => Promise<void>;
  handleArtifactClick: (artifact: Artifact) => void;
  handleFileClick: (fileName: string, content: string) => void;
  handleCodeBlockClick: (language: string, code: string) => void;
  shouldCollapseCodeBlocks: boolean;
  shouldCollapseCodeBlockInChat: (language: string, code: string) => boolean;
}

export function useWorkspaceArtifactPreviewActions({
  activeTheme,
  layoutMode,
  isGeneralCanvasOpen,
  artifacts,
  currentCanvasArtifact,
  taskFiles,
  sessionFiles,
  threadId,
  sessionId,
  projectRootPath,
  openWorkspaceFile,
  readSessionFile,
  onRequestCanvasPreviewOpen,
  upsertGeneralArtifact,
  setSelectedArtifactId,
  setArtifactViewMode,
  setLayoutMode,
  setGeneralCanvasState,
}: UseWorkspaceArtifactPreviewActionsParams): WorkspaceArtifactPreviewActionsResult {
  const { t } = useTranslation("agent");
  const handleHarnessLoadFilePreview = useCallback(
    async (
      path: string,
      artifact?: Artifact,
    ): Promise<HarnessFilePreviewResult> => {
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

      if (
        artifact &&
        hasAgentRuntimeArtifactPreviewScope(artifact, normalizedPath)
      ) {
        try {
          const appServerContent = await readAgentRuntimeArtifactPreviewContent(
            artifact,
            normalizedPath,
          );
          if (!appServerContent) {
            return createFallbackResult({
              error: "App Server artifact 内容不可用",
            });
          }

          return createFallbackResult(
            omitUndefined({
              artifactId: appServerContent.artifactId,
              artifactRef: appServerContent.artifactRef,
              path: appServerContent.filePath || normalizedPath,
              content: appServerContent.content,
              metadata: appServerContent.metadata,
              size: appServerContent.content.length,
              title: appServerContent.title,
            }),
          );
        } catch (error) {
          return createFallbackResult({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const matchedTaskFile = taskFiles.find((file) =>
        doesWorkspaceFileCandidateMatch(file.name, normalizedPath),
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
        doesWorkspaceFileCandidateMatch(file.name, normalizedPath),
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

  useArtifactAutoPreviewSync({
    enabled: activeTheme === "general",
    artifact: currentCanvasArtifact,
    loadPreview: handleHarnessLoadFilePreview,
    onSyncArtifact: upsertGeneralArtifact,
  });

  const openArtifactInWorkbench = useCallback(
    async (artifact: Artifact) => {
      if (activeTheme === "general") {
        setGeneralCanvasState((previous) =>
          previous.isOpen || previous.content.trim() || previous.filename
            ? {
                ...previous,
                isOpen: false,
                contentType: "empty",
                content: "",
                filename: undefined,
                sourcePath: undefined,
                isEditing: false,
              }
            : previous,
        );
      }

      let nextArtifact = artifact;
      const artifactPath = resolveArtifactProtocolFilePath(artifact);
      const shouldLoadPreview =
        artifact.content.length === 0 &&
        artifactPath &&
        !shouldUseProjectedPreviewArtifact(artifact);

      if (shouldLoadPreview) {
        const preview = await handleHarnessLoadFilePreview(
          artifactPath,
          artifact,
        );
        if (preview.error) {
          toast.error(
            t("agentChat.workspace.artifactPreview.toast.readFailed", {
              error: preview.error,
            }),
          );
        } else if (preview.isBinary) {
          toast.info(
            t("agentChat.workspace.artifactPreview.toast.binaryUnsupported"),
          );
        } else if (typeof preview.content === "string") {
          nextArtifact = {
            ...artifact,
            content: preview.content,
            meta: {
              ...artifact.meta,
              filePath: preview.path || artifactPath,
              filename:
                artifact.meta.filename ||
                extractFileNameFromPath(preview.path || artifactPath),
            },
            updatedAt: Date.now(),
          };
        }
      }

      if (activeTheme === "general") {
        upsertGeneralArtifact(nextArtifact);
      }

      setSelectedArtifactId(nextArtifact.id);
      onRequestCanvasPreviewOpen?.({
        filePath: shouldRequestCanvasDocumentSelection(nextArtifact)
          ? resolveArtifactSelectionFilePath(nextArtifact)
          : null,
        selectionKey: `artifact:${nextArtifact.id}`,
      });
      setArtifactViewMode(
        resolveDefaultArtifactViewMode(nextArtifact, {
          preferSourceWhenStreaming: true,
        }),
        { artifactId: nextArtifact.id },
      );
      openCanvasForReason("user_open_artifact", setLayoutMode);
    },
    [
      activeTheme,
      handleHarnessLoadFilePreview,
      onRequestCanvasPreviewOpen,
      setArtifactViewMode,
      setGeneralCanvasState,
      setLayoutMode,
      setSelectedArtifactId,
      t,
      upsertGeneralArtifact,
    ],
  );

  const handleArtifactClick = useCallback(
    (artifact: Artifact) => {
      void openArtifactInWorkbench(artifact);
    },
    [openArtifactInWorkbench],
  );

  const findArtifactForCodeBlock = useCallback(
    (code: string) => {
      const normalizedCode = code.replace(/\r\n/g, "\n").trimEnd();
      if (!normalizedCode) {
        return undefined;
      }

      return artifacts.find((artifact) => {
        if (typeof artifact.content !== "string") {
          return false;
        }
        return (
          artifact.content.replace(/\r\n/g, "\n").trimEnd() === normalizedCode
        );
      });
    },
    [artifacts],
  );

  const handleFileClick = useWorkspaceFileOpen({
    threadId,
    sessionId,
    projectRootPath,
    sessionFiles,
    taskFiles,
    openWorkspaceFile,
  });

  const handleCodeBlockClick = useCallback(
    (language: string, code: string) => {
      console.log("[AgentChatPage] 代码块点击:", language);

      const matchingArtifact = findArtifactForCodeBlock(code);
      if (!matchingArtifact) {
        console.warn(
          "[AgentChatPage] 代码块未匹配到 artifact，保持内联渲染:",
          language,
        );
        return;
      }

      console.log("[AgentChatPage] 找到匹配的 artifact:", matchingArtifact.id);
      void openArtifactInWorkbench(matchingArtifact);
    },
    [findArtifactForCodeBlock, openArtifactInWorkbench],
  );

  const shouldCollapseCodeBlocks = useMemo(() => {
    if (activeTheme !== "general") {
      return false;
    }
    if (layoutMode === "chat") {
      return false;
    }
    return artifacts.length > 0 || isGeneralCanvasOpen;
  }, [activeTheme, artifacts.length, isGeneralCanvasOpen, layoutMode]);

  const shouldCollapseCodeBlockInChat = useCallback(
    (language: string, code: string) => {
      if (!shouldCollapseCodeBlocks) {
        return false;
      }

      const normalizedLanguage = language.trim().toLowerCase();
      if (
        ["", "text", "plaintext", "plain", "txt", "markdown", "md"].includes(
          normalizedLanguage,
        )
      ) {
        return false;
      }

      return Boolean(findArtifactForCodeBlock(code));
    },
    [findArtifactForCodeBlock, shouldCollapseCodeBlocks],
  );

  return {
    handleHarnessLoadFilePreview,
    openArtifactInWorkbench,
    handleArtifactClick,
    handleFileClick,
    handleCodeBlockClick,
    shouldCollapseCodeBlocks,
    shouldCollapseCodeBlockInChat,
  };
}
