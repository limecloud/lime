import { useCallback, useState } from "react";
import { requestChatHostSavePath } from "../host/chatHostCapabilities";
import { toast } from "sonner";
import { saveExportedDocument } from "@/lib/api/document-export";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import {
  resolveArtifactWorkbenchHtmlFilename,
  resolveArtifactWorkbenchJsonFilename,
  resolveArtifactWorkbenchMarkdownFilename,
  serializeArtifactDocumentToHtml,
  serializeArtifactDocumentToMarkdown,
  updateArtifactDocumentStatus,
} from "./artifactWorkbenchActions";
import { ArtifactWorkbenchToolbarActions } from "./ArtifactWorkbenchToolbarActions";

function ensureFileExtension(filePath: string, extension: string) {
  const normalizedExtension = extension.startsWith(".")
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;

  if (filePath.toLowerCase().endsWith(normalizedExtension)) {
    return filePath;
  }

  return `${filePath}${normalizedExtension}`;
}

async function exportArtifactWorkbenchFile(params: {
  defaultFilename: string;
  extension: string;
  dialogTitle: string;
  content: string;
  successMessage: string;
  filterName: string;
  filterExtensions: string[];
}) {
  let selectedPath: string | null;
  try {
    selectedPath = await requestChatHostSavePath({
      title: params.dialogTitle,
      defaultPath: params.defaultFilename,
      filters: [
        {
          name: params.filterName,
          extensions: params.filterExtensions,
        },
      ],
    });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "无法打开文件保存对话框",
    );
    return false;
  }

  if (!selectedPath) {
    return false;
  }

  try {
    await saveExportedDocument(
      ensureFileExtension(selectedPath, params.extension),
      params.content,
    );
    toast.success(params.successMessage);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "保存导出文件失败");
    return false;
  }
}

export interface ArtifactWorkbenchToolbarActionState {
  onExportJson: () => Promise<void>;
  onExportHtml: () => Promise<void>;
  onExportMarkdown: () => Promise<void>;
  showArchiveToggle: boolean;
  isUpdatingArchive: boolean;
  archiveLabel: string;
  onToggleArchive: () => Promise<void>;
}

interface UseWorkspaceArtifactWorkbenchActionsParams {
  onSaveArtifactDocument?: (
    artifact: Artifact,
    document: ArtifactDocumentV1,
  ) => Promise<void> | void;
}

export function useWorkspaceArtifactWorkbenchActions({
  onSaveArtifactDocument,
}: UseWorkspaceArtifactWorkbenchActionsParams) {
  const [updatingArchiveArtifactId, setUpdatingArchiveArtifactId] = useState<
    string | null
  >(null);

  const handleExportJson = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      await exportArtifactWorkbenchFile({
        defaultFilename: resolveArtifactWorkbenchJsonFilename(
          artifact,
          document,
        ),
        extension: "artifact.json",
        dialogTitle: "导出 Artifact JSON",
        content: JSON.stringify(document, null, 2),
        successMessage: "已导出 Artifact JSON",
        filterName: "Artifact JSON",
        filterExtensions: ["json"],
      });
    },
    [],
  );

  const handleExportHtml = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      await exportArtifactWorkbenchFile({
        defaultFilename: resolveArtifactWorkbenchHtmlFilename(
          artifact,
          document,
        ),
        extension: "html",
        dialogTitle: "导出 HTML",
        content: serializeArtifactDocumentToHtml(document),
        successMessage: "已导出 HTML",
        filterName: "HTML",
        filterExtensions: ["html"],
      });
    },
    [],
  );

  const handleExportMarkdown = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      await exportArtifactWorkbenchFile({
        defaultFilename: resolveArtifactWorkbenchMarkdownFilename(
          artifact,
          document,
        ),
        extension: "md",
        dialogTitle: "导出 Markdown",
        content: serializeArtifactDocumentToMarkdown(document),
        successMessage: "已导出 Markdown",
        filterName: "Markdown",
        filterExtensions: ["md"],
      });
    },
    [],
  );

  const handleToggleArchive = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      if (!onSaveArtifactDocument) {
        toast.error("当前交付物暂不支持归档");
        return;
      }

      const nextStatus = document.status === "archived" ? "ready" : "archived";
      setUpdatingArchiveArtifactId(artifact.id);

      try {
        await onSaveArtifactDocument(
          artifact,
          updateArtifactDocumentStatus(document, nextStatus),
        );
        toast.success(
          nextStatus === "archived" ? "已归档当前交付物" : "已恢复当前交付物",
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "更新归档状态失败",
        );
      } finally {
        setUpdatingArchiveArtifactId((current) =>
          current === artifact.id ? null : current,
        );
      }
    },
    [onSaveArtifactDocument],
  );

  const getToolbarActionState = useCallback(
    (
      artifact: Artifact,
      document: ArtifactDocumentV1 | null,
    ): ArtifactWorkbenchToolbarActionState | null => {
      if (!document) {
        return null;
      }

      return {
        onExportJson: () => handleExportJson(artifact, document),
        onExportHtml: () => handleExportHtml(artifact, document),
        onExportMarkdown: () => handleExportMarkdown(artifact, document),
        showArchiveToggle: Boolean(onSaveArtifactDocument),
        isUpdatingArchive: updatingArchiveArtifactId === artifact.id,
        archiveLabel: document.status === "archived" ? "取消归档" : "归档",
        onToggleArchive: () => handleToggleArchive(artifact, document),
      };
    },
    [
      handleExportHtml,
      handleExportJson,
      handleExportMarkdown,
      handleToggleArchive,
      onSaveArtifactDocument,
      updatingArchiveArtifactId,
    ],
  );

  const renderToolbarActions = useCallback(
    (params: { artifact: Artifact; document: ArtifactDocumentV1 | null }) => {
      const state = getToolbarActionState(params.artifact, params.document);
      if (!state) {
        return null;
      }

      return <ArtifactWorkbenchToolbarActions {...state} />;
    },
    [getToolbarActionState],
  );

  return {
    getToolbarActionState,
    renderToolbarActions,
  };
}
