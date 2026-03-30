import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { createInitialDocumentState } from "@/components/content-creator/canvas/document";
import type { CanvasStateUnion } from "@/components/content-creator/canvas/canvasUtils";
import { createInitialMusicState } from "@/components/content-creator/canvas/music/types";
import { parseLyrics } from "@/components/content-creator/canvas/music/utils/lyricsParser";
import type { LayoutMode, ThemeType } from "@/components/content-creator/types";
import { readFilePreview } from "@/lib/api/fileBrowser";
import type { SessionFile } from "@/lib/api/session-files";
import type { Artifact } from "@/lib/artifact/types";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { TaskFile } from "../components/TaskFiles";
import type { HarnessFilePreviewResult } from "../components/HarnessStatusPanel";
import { useArtifactAutoPreviewSync } from "../hooks/useArtifactAutoPreviewSync";
import {
  buildArtifactFromWrite,
  resolveDefaultArtifactViewMode,
} from "../utils/messageArtifacts";
import type { ApplyArtifactViewMode } from "./useWorkspaceArtifactViewModeControl";
import {
  isRenderableTaskFile,
  looksLikeSocialPublishPayload,
  resolveTaskFileType,
} from "./themeWorkbenchHelpers";
import { extractFileNameFromPath } from "./workspacePath";

function buildCanvasStateFromContent(params: {
  previous: CanvasStateUnion | null;
  mappedTheme: ThemeType;
  content: string;
  upsertNovelCanvasState: (
    previous: CanvasStateUnion | null,
    content: string,
  ) => CanvasStateUnion;
}): CanvasStateUnion {
  const { previous, mappedTheme, content, upsertNovelCanvasState } = params;

  if (mappedTheme === "music") {
    const sections = parseLyrics(content);
    if (!previous || previous.type !== "music") {
      const musicState = createInitialMusicState();
      musicState.sections = sections;
      const titleMatch = content.match(/^#\s*(.+)$/m);
      if (titleMatch) {
        musicState.spec.title = titleMatch[1].trim();
      }
      return musicState;
    }
    return { ...previous, sections };
  }

  if (mappedTheme === "novel") {
    return upsertNovelCanvasState(previous, content);
  }

  if (!previous || previous.type !== "document") {
    return createInitialDocumentState(content);
  }

  return {
    ...previous,
    content,
  };
}

interface UseWorkspaceArtifactPreviewActionsParams {
  activeTheme: string;
  mappedTheme: ThemeType;
  layoutMode: LayoutMode;
  isThemeWorkbench: boolean;
  isGeneralCanvasOpen: boolean;
  artifacts: Artifact[];
  currentCanvasArtifact: Artifact | null;
  taskFiles: TaskFile[];
  sessionFiles: SessionFile[];
  readSessionFile: (fileName: string) => Promise<string | null>;
  suppressBrowserAssistCanvasAutoOpen: () => void;
  onOpenBrowserRuntimeForArtifact?: (artifact: Artifact) => void;
  upsertGeneralArtifact: (artifact: Artifact) => void;
  setSelectedArtifactId: (artifactId: string | null) => void;
  setArtifactViewMode: ApplyArtifactViewMode;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setTaskFiles: Dispatch<SetStateAction<TaskFile[]>>;
  setSelectedFileId: (fileId: string) => void;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  upsertNovelCanvasState: (
    previous: CanvasStateUnion | null,
    content: string,
  ) => CanvasStateUnion;
}

interface WorkspaceArtifactPreviewActionsResult {
  handleHarnessLoadFilePreview: (
    path: string,
  ) => Promise<HarnessFilePreviewResult>;
  handleArtifactClick: (artifact: Artifact) => void;
  handleFileClick: (fileName: string, content: string) => void;
  handleCodeBlockClick: (language: string, code: string) => void;
  shouldCollapseCodeBlocks: boolean;
  shouldCollapseCodeBlockInChat: (language: string, code: string) => boolean;
  handleTaskFileClick: (file: TaskFile) => void;
}

export function useWorkspaceArtifactPreviewActions({
  activeTheme,
  mappedTheme,
  layoutMode,
  isThemeWorkbench,
  isGeneralCanvasOpen,
  artifacts,
  currentCanvasArtifact,
  taskFiles,
  sessionFiles,
  readSessionFile,
  suppressBrowserAssistCanvasAutoOpen,
  onOpenBrowserRuntimeForArtifact,
  upsertGeneralArtifact,
  setSelectedArtifactId,
  setArtifactViewMode,
  setLayoutMode,
  setTaskFiles,
  setSelectedFileId,
  setCanvasState,
  upsertNovelCanvasState,
}: UseWorkspaceArtifactPreviewActionsParams): WorkspaceArtifactPreviewActionsResult {
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

  useArtifactAutoPreviewSync({
    enabled: activeTheme === "general",
    artifact: currentCanvasArtifact,
    loadPreview: handleHarnessLoadFilePreview,
    onSyncArtifact: upsertGeneralArtifact,
  });

  const openArtifactInWorkbench = useCallback(
    async (artifact: Artifact) => {
      if (artifact.type === "browser_assist") {
        onOpenBrowserRuntimeForArtifact?.(artifact);
        if (!onOpenBrowserRuntimeForArtifact) {
          toast.info("浏览器协助已迁移到浏览器工作台");
        }
        return;
      }

      if (activeTheme === "general") {
        suppressBrowserAssistCanvasAutoOpen();
      }

      let nextArtifact = artifact;
      const artifactPath = resolveArtifactProtocolFilePath(artifact);
      const shouldLoadPreview = artifact.content.length === 0 && artifactPath;

      if (shouldLoadPreview) {
        const preview = await handleHarnessLoadFilePreview(artifactPath);
        if (preview.error) {
          toast.error(`读取产物失败: ${preview.error}`);
        } else if (preview.isBinary) {
          toast.info("该产物为二进制文件，暂不支持在工作台预览");
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
          upsertGeneralArtifact(nextArtifact);
        }
      }

      setSelectedArtifactId(nextArtifact.id);
      setArtifactViewMode(
        resolveDefaultArtifactViewMode(nextArtifact, {
          preferSourceWhenStreaming: true,
        }),
        { artifactId: nextArtifact.id },
      );
      setLayoutMode("chat-canvas");
    },
    [
      activeTheme,
      handleHarnessLoadFilePreview,
      onOpenBrowserRuntimeForArtifact,
      setArtifactViewMode,
      setLayoutMode,
      setSelectedArtifactId,
      suppressBrowserAssistCanvasAutoOpen,
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

  const applyContentToCanvas = useCallback(
    (content: string) => {
      setCanvasState((previous) =>
        buildCanvasStateFromContent({
          previous,
          mappedTheme,
          content,
          upsertNovelCanvasState,
        }),
      );
      setLayoutMode("chat-canvas");
    },
    [mappedTheme, setCanvasState, setLayoutMode, upsertNovelCanvasState],
  );

  const handleFileClick = useCallback(
    (fileName: string, content: string) => {
      if (activeTheme === "general") {
        const matchingArtifact = artifacts.find((artifact) => {
          const artifactPath = resolveArtifactProtocolFilePath(artifact);
          return (
            artifactPath === fileName ||
            artifact.title === extractFileNameFromPath(fileName) ||
            (content.trim().length > 0 && artifact.content === content)
          );
        });
        const nextArtifact =
          matchingArtifact ||
          buildArtifactFromWrite({
            filePath: fileName,
            content,
            context: {
              source: "message_content",
              status: content.length > 0 ? "complete" : "pending",
              metadata: {
                persistOutsideMessages: true,
              },
            },
          });

        if (!matchingArtifact) {
          upsertGeneralArtifact(nextArtifact);
        }

        void openArtifactInWorkbench(nextArtifact);
        return;
      }

      const nextFileType = resolveTaskFileType(fileName, content);
      setTaskFiles((previous) => {
        const existingFile = previous.find((file) => file.name === fileName);
        if (existingFile) {
          setSelectedFileId(existingFile.id);
          return previous;
        }

        const nextFile: TaskFile = {
          id: crypto.randomUUID(),
          name: fileName,
          type: nextFileType,
          content,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSelectedFileId(nextFile.id);
        return [...previous, nextFile];
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

      applyContentToCanvas(content);
    },
    [
      activeTheme,
      applyContentToCanvas,
      artifacts,
      isThemeWorkbench,
      openArtifactInWorkbench,
      setSelectedFileId,
      setTaskFiles,
      upsertGeneralArtifact,
    ],
  );

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

      applyContentToCanvas(file.content ?? "");
    },
    [applyContentToCanvas, isThemeWorkbench, setSelectedFileId],
  );

  return {
    handleHarnessLoadFilePreview,
    handleArtifactClick,
    handleFileClick,
    handleCodeBlockClick,
    shouldCollapseCodeBlocks,
    shouldCollapseCodeBlockInChat,
    handleTaskFileClick,
  };
}
