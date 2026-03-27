import { useCallback, useEffect, useRef } from "react";
import { resolveFilePath as resolveSessionFilePath } from "@/lib/api/session-files";
import { listMaterials, uploadMaterial } from "@/lib/api/materials";
import { setStoredResourceProjectId } from "@/lib/resourceProjectSelection";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import {
  buildGeneralChatResourceDescription,
  buildGeneralChatResourceHash,
  buildGeneralChatResourceTags,
  extractGeneralChatResourceHash,
  inferGeneralChatResourceMaterialType,
} from "../utils/generalResourceSync";
import {
  extractFileNameFromPath,
  resolveAbsoluteWorkspacePath,
} from "./workspacePath";

interface UseWorkspaceGeneralResourceSyncParams {
  activeTheme: string;
  projectId?: string | null;
  sessionId?: string | null;
  projectRootPath?: string | null;
}

export interface GeneralArtifactSyncResult {
  status:
    | "uploaded"
    | "duplicate"
    | "inactive"
    | "missing_project"
    | "unsupported"
    | "missing_file"
    | "error";
  projectId?: string;
  filePath?: string;
  materialId?: string;
  errorMessage?: string;
}

export function useWorkspaceGeneralResourceSync({
  activeTheme,
  projectId,
  sessionId,
  projectRootPath,
}: UseWorkspaceGeneralResourceSyncParams) {
  const generalResourceHashesRef = useRef<Map<string, Set<string>>>(new Map());
  const generalResourceSyncInFlightRef = useRef<Set<string>>(new Set());

  const syncResourceProjectSelection = useCallback(
    (targetProjectId: string | null | undefined) => {
      const normalizedProjectId = normalizeProjectId(targetProjectId);
      if (!normalizedProjectId) {
        return;
      }

      setStoredResourceProjectId(normalizedProjectId, {
        source: "general-chat",
        emitEvent: true,
      });
    },
    [],
  );

  const ensureGeneralResourceHashes = useCallback(
    async (targetProjectId: string) => {
      const existingHashes =
        generalResourceHashesRef.current.get(targetProjectId);
      if (existingHashes) {
        return existingHashes;
      }

      const nextHashes = new Set<string>();

      try {
        const materials = await listMaterials(targetProjectId);
        materials.forEach((material) => {
          const hash = extractGeneralChatResourceHash(material);
          if (hash) {
            nextHashes.add(hash);
          }
        });
      } catch (error) {
        console.warn("[AgentChatPage] 读取资源去重缓存失败:", error);
      }

      generalResourceHashesRef.current.set(targetProjectId, nextHashes);
      return nextHashes;
    },
    [],
  );

  const resolveGeneralArtifactSyncPath = useCallback(
    async (rawFilePath: string): Promise<string | null> => {
      const normalizedFilePath = rawFilePath.trim();
      if (!normalizedFilePath) {
        return null;
      }

      if (
        normalizedFilePath.startsWith("/") ||
        normalizedFilePath.startsWith("~/") ||
        normalizedFilePath.startsWith("\\\\") ||
        /^[A-Za-z]:[\\/]/.test(normalizedFilePath)
      ) {
        return normalizedFilePath;
      }

      if (sessionId) {
        try {
          return await resolveSessionFilePath(sessionId, normalizedFilePath);
        } catch (error) {
          console.warn("[AgentChatPage] 解析会话文件路径失败:", error);
        }
      }

      return (
        resolveAbsoluteWorkspacePath(projectRootPath, normalizedFilePath) ||
        null
      );
    },
    [projectRootPath, sessionId],
  );

  const syncGeneralArtifactToResource = useCallback(
    async (input: { rawFilePath: string; preferredName?: string }) => {
      if (activeTheme !== "general") {
        return {
          status: "inactive",
        } satisfies GeneralArtifactSyncResult;
      }

      const normalizedProjectId = normalizeProjectId(projectId);
      const normalizedRawFilePath = input.rawFilePath.trim();
      if (!normalizedProjectId || !normalizedRawFilePath) {
        return {
          status: "missing_project",
        } satisfies GeneralArtifactSyncResult;
      }

      const materialType = inferGeneralChatResourceMaterialType(
        normalizedRawFilePath,
      );
      if (!materialType) {
        return {
          status: "unsupported",
          projectId: normalizedProjectId,
        } satisfies GeneralArtifactSyncResult;
      }

      const resolvedFilePath = await resolveGeneralArtifactSyncPath(
        normalizedRawFilePath,
      );
      const normalizedResolvedFilePath = resolvedFilePath?.trim();
      if (!normalizedResolvedFilePath) {
        return {
          status: "missing_file",
          projectId: normalizedProjectId,
        } satisfies GeneralArtifactSyncResult;
      }

      const pathHash = buildGeneralChatResourceHash(normalizedResolvedFilePath);
      const dedupeKey = `${normalizedProjectId}:${pathHash}`;
      if (generalResourceSyncInFlightRef.current.has(dedupeKey)) {
        syncResourceProjectSelection(normalizedProjectId);
        return {
          status: "duplicate",
          projectId: normalizedProjectId,
          filePath: normalizedResolvedFilePath,
        } satisfies GeneralArtifactSyncResult;
      }

      const knownHashes =
        await ensureGeneralResourceHashes(normalizedProjectId);
      if (knownHashes.has(pathHash)) {
        syncResourceProjectSelection(normalizedProjectId);
        return {
          status: "duplicate",
          projectId: normalizedProjectId,
          filePath: normalizedResolvedFilePath,
        } satisfies GeneralArtifactSyncResult;
      }

      generalResourceSyncInFlightRef.current.add(dedupeKey);
      try {
        const material = await uploadMaterial({
          projectId: normalizedProjectId,
          name:
            input.preferredName?.trim() ||
            extractFileNameFromPath(normalizedResolvedFilePath),
          type: materialType,
          filePath: normalizedResolvedFilePath,
          tags: buildGeneralChatResourceTags(
            normalizedResolvedFilePath,
            sessionId,
          ),
          description: buildGeneralChatResourceDescription(sessionId),
        });

        knownHashes.add(pathHash);
        syncResourceProjectSelection(normalizedProjectId);
        return {
          status: "uploaded",
          projectId: normalizedProjectId,
          filePath: normalizedResolvedFilePath,
          materialId: material.id,
        } satisfies GeneralArtifactSyncResult;
      } catch (error) {
        console.warn("[AgentChatPage] 自动补录资源失败:", error);
        return {
          status: "error",
          projectId: normalizedProjectId,
          filePath: normalizedResolvedFilePath,
          errorMessage: error instanceof Error ? error.message : String(error),
        } satisfies GeneralArtifactSyncResult;
      } finally {
        generalResourceSyncInFlightRef.current.delete(dedupeKey);
      }
    },
    [
      activeTheme,
      ensureGeneralResourceHashes,
      projectId,
      resolveGeneralArtifactSyncPath,
      sessionId,
      syncResourceProjectSelection,
    ],
  );

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    syncResourceProjectSelection(projectId);
  }, [activeTheme, projectId, syncResourceProjectSelection]);

  return {
    syncGeneralArtifactToResource,
  };
}
