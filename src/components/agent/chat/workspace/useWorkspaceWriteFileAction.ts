import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";
import type { ThemeType, LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  areArtifactProtocolPathsEquivalent,
  isArtifactProtocolImagePath,
  resolveArtifactProtocolFilePath,
} from "@/lib/artifact-protocol";
import type { TaskFile } from "../components/TaskFiles";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";
import type { WriteArtifactContext } from "../types";
import type { Artifact } from "@/lib/artifact/types";
import { getContent, updateContent } from "@/lib/api/project";
import { getFileToStepMap } from "../utils/workflowMapping";
import {
  buildArtifactFromWrite,
  resolveDefaultArtifactViewMode,
} from "../utils/messageArtifacts";
import { shouldKeepGeneralArtifactInBackground } from "./generalArtifactAutoSelection";
import {
  MAX_PERSISTED_DOCUMENT_VERSIONS,
  isGeneralWorkbenchPrimaryDocumentArtifact,
  resolveTaskFileType,
} from "./generalWorkbenchHelpers";
import type { GeneralArtifactSyncResult } from "./useWorkspaceGeneralResourceSync";
import type { ApplyArtifactViewMode } from "./useWorkspaceArtifactViewModeControl";

const shouldLogWorkspaceWriteInfo = import.meta.env.MODE !== "test";

function shouldAutoOpenCanvasForActiveWrite(
  status: Artifact["status"] | undefined,
  writePhase: unknown,
): boolean {
  return (
    status === "streaming" ||
    writePhase === "preparing" ||
    writePhase === "streaming"
  );
}

function shouldSkipGeneralArtifactWrite(params: {
  fileName: string;
  content: string;
  context?: WriteArtifactContext;
}): boolean {
  return (
    params.content.length === 0 &&
    isArtifactProtocolImagePath(params.fileName) &&
    (params.context?.source === "tool_result" ||
      params.context?.source === "artifact_snapshot")
  );
}

function isContentPostDocumentFile(
  fileName: string,
  fileType: string,
): boolean {
  return fileType === "document" && /^content-posts\/.+\.md$/i.test(fileName);
}

function resolveThemeWorkbenchDocumentStage(
  gateKey?: string,
): string | undefined {
  if (gateKey === "write_mode") {
    return "drafting";
  }
  if (gateKey === "publish_confirm") {
    return "publishing";
  }
  if (gateKey === "topic_select") {
    return "topic_selection";
  }
  return undefined;
}

function resolveThemeWorkbenchVersionLabel(params: {
  fileName: string;
  fileType: string;
  gateKey?: string;
  fallbackLabel: string;
}): string {
  if (isContentPostDocumentFile(params.fileName, params.fileType)) {
    if (params.gateKey === "publish_confirm") {
      return "发布终稿";
    }
    if (params.gateKey === "topic_select") {
      return "选题草案";
    }
    return "社媒初稿";
  }

  return params.fallbackLabel;
}

function mergePersistedTaskFileMetadata(
  baseMetadata?: Record<string, unknown>,
  runtimeMetadata?: WriteArtifactContext["metadata"],
): Record<string, unknown> | undefined {
  const nextMetadata = {
    ...(baseMetadata || {}),
    ...(runtimeMetadata || {}),
  };

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function logWorkspaceWriteInfo(...args: Parameters<typeof console.log>) {
  if (!shouldLogWorkspaceWriteInfo) {
    return;
  }
  console.log(...args);
}

interface ThemeWorkbenchActiveQueueSummary {
  run_id?: string | null;
  title?: string | null;
  status?: string | null;
}

interface UseWorkspaceWriteFileActionParams {
  activeTheme: string;
  artifacts: Artifact[];
  contentId?: string | null;
  currentGateKey: string;
  currentStepIndex: number;
  isSpecializedThemeMode: boolean;
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  projectId?: string | null;
  sessionId?: string | null;
  themeWorkbenchActiveQueueItem: ThemeWorkbenchActiveQueueSummary | null;
  taskFilesRef: MutableRefObject<TaskFile[]>;
  socialStageLogRef: MutableRefObject<Record<string, string>>;
  setDocumentVersionStatusMap: Dispatch<
    SetStateAction<Record<string, TopicBranchStatus>>
  >;
  saveSessionFile: (
    fileName: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => Promise<unknown>;
  syncGeneralArtifactToResource: (input: {
    rawFilePath: string;
    preferredName?: string;
  }) => Promise<GeneralArtifactSyncResult>;
  upsertGeneralArtifact: (artifact: Artifact) => void;
  setSelectedArtifactId: (artifactId: string | null) => void;
  setArtifactViewMode: ApplyArtifactViewMode;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  suppressCanvasAutoOpen: boolean;
  completeStep: (payload: {
    aiOutput: { fileName: string; preview: string };
  }) => void;
  setTaskFiles: Dispatch<SetStateAction<TaskFile[]>>;
  setSelectedFileId: (fileId: string) => void;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
}

export function useWorkspaceWriteFileAction({
  activeTheme,
  artifacts,
  contentId,
  currentGateKey,
  currentStepIndex,
  isSpecializedThemeMode,
  isThemeWorkbench,
  mappedTheme,
  projectId,
  sessionId,
  themeWorkbenchActiveQueueItem,
  taskFilesRef,
  socialStageLogRef,
  setDocumentVersionStatusMap,
  saveSessionFile,
  syncGeneralArtifactToResource,
  upsertGeneralArtifact,
  setSelectedArtifactId,
  setArtifactViewMode,
  setLayoutMode,
  suppressCanvasAutoOpen,
  completeStep,
  setTaskFiles,
  setSelectedFileId,
  setCanvasState,
}: UseWorkspaceWriteFileActionParams) {
  return useCallback(
    (content: string, fileName: string, context?: WriteArtifactContext) => {
      logWorkspaceWriteInfo(
        "[AgentChatPage] 收到文件写入:",
        fileName,
        content.length,
        "字符",
      );
      const shouldAutoOpenCanvas =
        !suppressCanvasAutoOpen &&
        shouldAutoOpenCanvasForActiveWrite(
          context?.status,
          context?.metadata?.writePhase,
        );

      if (activeTheme === "general" && !isThemeWorkbench) {
        const existingArtifact = artifacts.find((artifact) => {
          if (context?.artifactId && artifact.id === context.artifactId) {
            return true;
          }

          if (context?.artifact?.id && artifact.id === context.artifact.id) {
            return true;
          }

          return areArtifactProtocolPathsEquivalent(
            resolveArtifactProtocolFilePath(artifact),
            fileName,
          );
        });
        const nextContent =
          content.length > 0
            ? content
            : context?.artifact?.content || existingArtifact?.content || "";
        const nextArtifact = context?.artifact
          ? {
              ...(existingArtifact || {}),
              ...context.artifact,
              content: nextContent,
              status:
                context.status ||
                context.artifact.status ||
                existingArtifact?.status ||
                "pending",
              meta: {
                ...(existingArtifact?.meta || {}),
                ...context.artifact.meta,
                ...(context.metadata || {}),
              },
              updatedAt: Date.now(),
            }
          : buildArtifactFromWrite({
              filePath: fileName,
              content: nextContent,
              context: {
                ...context,
                artifact: existingArtifact,
                status:
                  context?.status ||
                  (nextContent.length > 0 ? "complete" : "pending"),
              },
            });
        const shouldKeepInBackground = shouldKeepGeneralArtifactInBackground(
          nextArtifact,
          context,
        );

        if (
          shouldSkipGeneralArtifactWrite({
            fileName,
            content: nextContent,
            context,
          })
        ) {
          return;
        }

        const syncResource = () => {
          if (nextArtifact.status !== "complete") {
            return;
          }

          void syncGeneralArtifactToResource({
            rawFilePath: resolveArtifactProtocolFilePath(nextArtifact),
            preferredName: nextArtifact.title,
          });
        };

        if (nextContent.length > 0) {
          void saveSessionFile(fileName, nextContent, nextArtifact.meta)
            .then(() => {
              syncResource();
            })
            .catch((error) => {
              console.error("[AgentChatPage] 持久化 artifact 失败:", error);
              syncResource();
            });
        } else {
          syncResource();
        }

        upsertGeneralArtifact(nextArtifact);
        if (!shouldKeepInBackground) {
          setSelectedArtifactId(nextArtifact.id);
          setArtifactViewMode(
            resolveDefaultArtifactViewMode(nextArtifact, {
              preferSourceWhenStreaming: true,
            }),
            { artifactId: nextArtifact.id },
          );
          if (
            !suppressCanvasAutoOpen &&
            shouldAutoOpenCanvasForActiveWrite(
              nextArtifact.status,
              nextArtifact.meta.writePhase,
            )
          ) {
            setLayoutMode("chat-canvas");
          }
        }
        return;
      }

      const now = Date.now();
      const nextFileType = resolveTaskFileType(fileName, content);
      const activeQueueItem = themeWorkbenchActiveQueueItem;
      const activeRunVersionId = activeQueueItem?.run_id?.trim() || null;
      const activeRunDescription =
        activeQueueItem?.title?.trim() || `产物更新 - ${fileName}`;
      const socialGateKey =
        currentGateKey === "idle" ||
        currentGateKey === "topic_select" ||
        currentGateKey === "write_mode" ||
        currentGateKey === "publish_confirm"
          ? currentGateKey
          : undefined;
      const isPrimaryArtifact =
        !isThemeWorkbench ||
        isGeneralWorkbenchPrimaryDocumentArtifact(fileName);
      const shouldApplyToMainDocument =
        nextFileType === "document" &&
        isPrimaryArtifact &&
        (!isThemeWorkbench || currentGateKey !== "topic_select");
      const effectiveDocumentVersionId =
        activeRunVersionId ||
        (isThemeWorkbench && shouldApplyToMainDocument
          ? `artifact:${fileName}`
          : null);
      const effectiveVersionDescription = resolveThemeWorkbenchVersionLabel({
        fileName,
        fileType: nextFileType,
        gateKey: socialGateKey,
        fallbackLabel: activeRunDescription,
      });
      const themeWorkbenchDocumentStage =
        resolveThemeWorkbenchDocumentStage(socialGateKey);
      const baseVersionMetadata = shouldApplyToMainDocument
        ? {
            sourceFileName: fileName,
            gateKey: socialGateKey,
            runId: activeRunVersionId || undefined,
            correlationId:
              effectiveDocumentVersionId || activeRunVersionId || undefined,
            artifactType: isContentPostDocumentFile(fileName, nextFileType)
              ? "draft"
              : undefined,
            stage: themeWorkbenchDocumentStage,
            versionLabel: effectiveVersionDescription,
          }
        : undefined;
      const persistedTaskFileMetadata = mergePersistedTaskFileMetadata(
        baseVersionMetadata,
        context?.metadata,
      );
      const existingTaskFile = taskFilesRef.current.find(
        (file) => file.name === fileName,
      );
      const hasTaskFileChanged = existingTaskFile?.content !== content;

      if (isThemeWorkbench && effectiveDocumentVersionId) {
        const nextStatus: TopicBranchStatus =
          activeQueueItem?.status === "running" ? "in_progress" : "pending";
        setDocumentVersionStatusMap((previous) => {
          if (previous[effectiveDocumentVersionId] === nextStatus) {
            return previous;
          }
          return {
            ...previous,
            [effectiveDocumentVersionId]: nextStatus,
          };
        });
      }

      void saveSessionFile(fileName, content, persistedTaskFileMetadata).catch(
        (error) => {
          console.error("[AgentChatPage] 持久化文件失败:", error);
        },
      );

      if (contentId && shouldApplyToMainDocument) {
        void getContent(contentId)
          .then((existingContent) => {
            if (!existingContent) {
              console.warn(
                "[AgentChatPage] contentId 对应的内容不存在，跳过同步:",
                contentId,
              );
              return;
            }

            void updateContent(contentId, {
              body: content,
            }).catch((error) => {
              console.error("[AgentChatPage] 同步内容到项目失败:", error);
            });
          })
          .catch((error) => {
            console.error("[AgentChatPage] 检查内容存在性失败:", error);
          });
      } else if (isThemeWorkbench && !shouldApplyToMainDocument) {
        logWorkspaceWriteInfo(
          "[AgentChatPage] 工作区编排非成文阶段，跳过主稿写入:",
          {
            gate: currentGateKey,
            fileName,
            isPrimaryArtifact,
          },
        );
      }

      const fileToStepMap = getFileToStepMap(mappedTheme);
      const stepIndex = fileToStepMap[fileName];
      if (
        stepIndex !== undefined &&
        stepIndex === currentStepIndex &&
        isSpecializedThemeMode
      ) {
        logWorkspaceWriteInfo(
          "[AgentChatPage] 推进工作流步骤:",
          stepIndex,
          "->",
          stepIndex + 1,
        );
        completeStep({
          aiOutput: { fileName, preview: content.slice(0, 100) },
        });
      }

      if (baseVersionMetadata && hasTaskFileChanged) {
        const stageLogKey = effectiveDocumentVersionId || fileName;
        activityLogger.log({
          eventType: existingTaskFile ? "file_update" : "file_create",
          status: "success",
          title: `${existingTaskFile ? "更新" : "生成"}${effectiveVersionDescription}`,
          description: fileName,
          workspaceId: projectId || undefined,
          sessionId: sessionId || undefined,
          source: "aster-chat",
          correlationId:
            effectiveDocumentVersionId || activeRunVersionId || fileName,
          metadata: baseVersionMetadata,
        });

        if (
          socialStageLogRef.current[stageLogKey] !== effectiveVersionDescription
        ) {
          socialStageLogRef.current[stageLogKey] = effectiveVersionDescription;
          activityLogger.log({
            eventType: "step_complete",
            status: "success",
            title: effectiveVersionDescription,
            description: `${fileName} 已进入当前版本链`,
            workspaceId: projectId || undefined,
            sessionId: sessionId || undefined,
            source: "aster-chat",
            correlationId:
              effectiveDocumentVersionId || activeRunVersionId || fileName,
            metadata: baseVersionMetadata,
          });
        }
      }

      setTaskFiles((previous) => {
        const existingIndex = previous.findIndex(
          (file) => file.name === fileName,
        );

        if (existingIndex >= 0) {
          const existing = previous[existingIndex];

          if (existing.content === content) {
            logWorkspaceWriteInfo(
              "[AgentChatPage] 文件内容相同，跳过:",
              fileName,
            );
            setSelectedFileId(existing.id);
            return previous;
          }

          logWorkspaceWriteInfo("[AgentChatPage] 更新文件:", fileName);
          const nextFiles = [...previous];
          nextFiles[existingIndex] = {
            ...existing,
            type: nextFileType,
            content,
            updatedAt: now,
            metadata: persistedTaskFileMetadata
              ? {
                  ...(existing.metadata || {}),
                  ...persistedTaskFileMetadata,
                }
              : existing.metadata,
          };
          setSelectedFileId(existing.id);
          return nextFiles;
        }

        logWorkspaceWriteInfo("[AgentChatPage] 创建新文件:", fileName);
        const newFile: TaskFile = {
          id: crypto.randomUUID(),
          name: fileName,
          type: nextFileType,
          content,
          version: 1,
          createdAt: now,
          updatedAt: now,
          metadata: persistedTaskFileMetadata,
        };
        setSelectedFileId(newFile.id);
        return [...previous, newFile];
      });

      if (!shouldApplyToMainDocument) {
        return;
      }

      setCanvasState((previous) => {
        logWorkspaceWriteInfo("[AgentChatPage] 更新画布状态:", {
          prevType: previous?.type,
          mappedTheme,
          contentLength: content.length,
        });

        if (!previous || previous.type !== "document") {
          logWorkspaceWriteInfo("[AgentChatPage] 创建新文档状态");
          const initialDocumentState = createInitialDocumentState(content);
          if (!effectiveDocumentVersionId) {
            return initialDocumentState;
          }
          if (!isThemeWorkbench) {
            return initialDocumentState;
          }
          return {
            ...initialDocumentState,
            versions: [
              {
                id: effectiveDocumentVersionId,
                content,
                createdAt: now,
                description: effectiveVersionDescription,
                metadata: baseVersionMetadata,
              },
            ],
            currentVersionId: effectiveDocumentVersionId,
            content,
          };
        }

        if (effectiveDocumentVersionId) {
          const existingIndex = previous.versions.findIndex(
            (version) => version.id === effectiveDocumentVersionId,
          );

          if (existingIndex >= 0) {
            const nextVersions = [...previous.versions];
            const currentVersion = nextVersions[existingIndex];
            nextVersions[existingIndex] = {
              ...currentVersion,
              content,
              description:
                currentVersion.description || effectiveVersionDescription,
              metadata: {
                ...(currentVersion.metadata || {}),
                ...(baseVersionMetadata || {}),
              },
            };
            return {
              ...previous,
              content,
              versions: nextVersions,
              currentVersionId: effectiveDocumentVersionId,
            };
          }

          const parentVersion =
            previous.versions.find(
              (version) => version.id === previous.currentVersionId,
            ) || previous.versions[previous.versions.length - 1];
          const nextVersions = [
            ...previous.versions,
            {
              id: effectiveDocumentVersionId,
              content,
              createdAt: now,
              description: effectiveVersionDescription,
              metadata: {
                ...(baseVersionMetadata || {}),
                parentVersionId:
                  parentVersion &&
                  parentVersion.id !== effectiveDocumentVersionId
                    ? parentVersion.id
                    : undefined,
                parentArtifactId: parentVersion?.metadata?.artifactId,
              },
            },
          ].slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);

          return {
            ...previous,
            content,
            versions: nextVersions,
            currentVersionId: effectiveDocumentVersionId,
          };
        }

        logWorkspaceWriteInfo("[AgentChatPage] 更新现有文档状态");
        return {
          ...previous,
          content,
        };
      });

      if (shouldAutoOpenCanvas) {
        setLayoutMode("chat-canvas");
      }
    },
    [
      activeTheme,
      artifacts,
      completeStep,
      contentId,
      currentGateKey,
      currentStepIndex,
      isSpecializedThemeMode,
      isThemeWorkbench,
      mappedTheme,
      projectId,
      saveSessionFile,
      sessionId,
      setArtifactViewMode,
      setCanvasState,
      setDocumentVersionStatusMap,
      setLayoutMode,
      setSelectedArtifactId,
      setSelectedFileId,
      setTaskFiles,
      socialStageLogRef,
      suppressCanvasAutoOpen,
      syncGeneralArtifactToResource,
      taskFilesRef,
      themeWorkbenchActiveQueueItem,
      upsertGeneralArtifact,
    ],
  );
}
