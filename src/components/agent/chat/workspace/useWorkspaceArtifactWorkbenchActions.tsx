import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import {
  resolveArtifactWorkbenchJsonFilename,
  resolveArtifactWorkbenchMarkdownFilename,
  serializeArtifactDocumentToMarkdown,
  updateArtifactDocumentStatus,
} from "./artifactWorkbenchActions";
import { ArtifactWorkbenchToolbarActions } from "./ArtifactWorkbenchToolbarActions";
import type { GeneralArtifactSyncResult } from "./useWorkspaceGeneralResourceSync";

function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function resolveResourceSyncFeedback(result: GeneralArtifactSyncResult): {
  kind: "success" | "error";
  message: string;
} {
  switch (result.status) {
    case "uploaded":
      return {
        kind: "success",
        message: "已保存到项目资源",
      };
    case "duplicate":
      return {
        kind: "success",
        message: "项目资源中已存在该交付物",
      };
    case "missing_project":
      return {
        kind: "error",
        message: "请先选择项目后再保存到项目资源",
      };
    case "unsupported":
      return {
        kind: "error",
        message: "当前交付物暂不支持保存到项目资源",
      };
    case "missing_file":
      return {
        kind: "error",
        message: "当前交付物还没有可复用的落盘文件",
      };
    case "inactive":
      return {
        kind: "error",
        message: "当前主题暂未接入项目资源复用",
      };
    case "error":
    default:
      return {
        kind: "error",
        message: result.errorMessage || "保存到项目资源失败",
      };
  }
}

export interface ArtifactWorkbenchToolbarActionState {
  showSaveToProject: boolean;
  saveToProjectDisabled: boolean;
  isSavingToProject: boolean;
  onSaveToProject: () => Promise<void>;
  onExportJson: () => Promise<void>;
  onExportMarkdown: () => Promise<void>;
  showArchiveToggle: boolean;
  isUpdatingArchive: boolean;
  archiveLabel: string;
  onToggleArchive: () => Promise<void>;
}

interface UseWorkspaceArtifactWorkbenchActionsParams {
  activeTheme: string;
  projectId?: string | null;
  syncGeneralArtifactToResource: (input: {
    rawFilePath: string;
    preferredName?: string;
  }) => Promise<GeneralArtifactSyncResult>;
  onSaveArtifactDocument?: (
    artifact: Artifact,
    document: ArtifactDocumentV1,
  ) => Promise<void> | void;
}

export function useWorkspaceArtifactWorkbenchActions({
  activeTheme,
  projectId,
  syncGeneralArtifactToResource,
  onSaveArtifactDocument,
}: UseWorkspaceArtifactWorkbenchActionsParams) {
  const [savingResourceArtifactId, setSavingResourceArtifactId] = useState<
    string | null
  >(null);
  const [updatingArchiveArtifactId, setUpdatingArchiveArtifactId] = useState<
    string | null
  >(null);

  const handleExportJson = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      downloadText(
        JSON.stringify(document, null, 2),
        resolveArtifactWorkbenchJsonFilename(artifact, document),
        "application/json;charset=utf-8",
      );
      toast.success("已导出 Artifact JSON");
    },
    [],
  );

  const handleExportMarkdown = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      downloadText(
        serializeArtifactDocumentToMarkdown(document),
        resolveArtifactWorkbenchMarkdownFilename(artifact, document),
        "text/markdown;charset=utf-8",
      );
      toast.success("已导出 Markdown");
    },
    [],
  );

  const handleSaveToProject = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      const rawFilePath = resolveArtifactProtocolFilePath(artifact);
      setSavingResourceArtifactId(artifact.id);

      try {
        const result = await syncGeneralArtifactToResource({
          rawFilePath,
          preferredName: document.title || artifact.title,
        });
        const feedback = resolveResourceSyncFeedback(result);
        if (feedback.kind === "success") {
          toast.success(feedback.message);
        } else {
          toast.error(feedback.message);
        }
      } finally {
        setSavingResourceArtifactId((current) =>
          current === artifact.id ? null : current,
        );
      }
    },
    [syncGeneralArtifactToResource],
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

      const normalizedProjectId = projectId?.trim() || "";
      return {
        showSaveToProject: activeTheme === "general",
        saveToProjectDisabled:
          activeTheme !== "general" ||
          !normalizedProjectId ||
          savingResourceArtifactId === artifact.id,
        isSavingToProject: savingResourceArtifactId === artifact.id,
        onSaveToProject: () => handleSaveToProject(artifact, document),
        onExportJson: () => handleExportJson(artifact, document),
        onExportMarkdown: () => handleExportMarkdown(artifact, document),
        showArchiveToggle: Boolean(onSaveArtifactDocument),
        isUpdatingArchive: updatingArchiveArtifactId === artifact.id,
        archiveLabel: document.status === "archived" ? "取消归档" : "归档",
        onToggleArchive: () => handleToggleArchive(artifact, document),
      };
    },
    [
      activeTheme,
      handleExportJson,
      handleExportMarkdown,
      handleSaveToProject,
      handleToggleArchive,
      onSaveArtifactDocument,
      projectId,
      savingResourceArtifactId,
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
