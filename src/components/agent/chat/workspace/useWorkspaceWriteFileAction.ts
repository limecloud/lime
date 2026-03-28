import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createInitialDocumentState } from "@/components/content-creator/canvas/document";
import type { CanvasStateUnion } from "@/components/content-creator/canvas/canvasUtils";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import { resolveSocialMediaArtifactDescriptor } from "@/components/content-creator/utils/socialMediaHarness";
import { createInitialMusicState } from "@/components/content-creator/canvas/music/types";
import { parseLyrics } from "@/components/content-creator/canvas/music/utils/lyricsParser";
import type { ThemeType, LayoutMode } from "@/components/content-creator/types";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
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
import {
  MAX_PERSISTED_DOCUMENT_VERSIONS,
  isThemeWorkbenchPrimaryDocumentArtifact,
  resolveTaskFileType,
} from "./themeWorkbenchHelpers";
import type { GeneralArtifactSyncResult } from "./useWorkspaceGeneralResourceSync";

const shouldLogWorkspaceWriteInfo = import.meta.env.MODE !== "test";

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
  isContentCreationMode: boolean;
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
  saveSessionFile: (fileName: string, content: string) => Promise<unknown>;
  syncGeneralArtifactToResource: (input: {
    rawFilePath: string;
    preferredName?: string;
  }) => Promise<GeneralArtifactSyncResult>;
  upsertGeneralArtifact: (artifact: Artifact) => void;
  setSelectedArtifactId: (artifactId: string | null) => void;
  setArtifactViewMode: Dispatch<SetStateAction<"source" | "preview">>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  completeStep: (payload: {
    aiOutput: { fileName: string; preview: string };
  }) => void;
  setTaskFiles: Dispatch<SetStateAction<TaskFile[]>>;
  setSelectedFileId: (fileId: string) => void;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  upsertNovelCanvasState: (
    previous: CanvasStateUnion | null,
    content: string,
  ) => CanvasStateUnion;
}

export function useWorkspaceWriteFileAction({
  activeTheme,
  artifacts,
  contentId,
  currentGateKey,
  currentStepIndex,
  isContentCreationMode,
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
  completeStep,
  setTaskFiles,
  setSelectedFileId,
  setCanvasState,
  upsertNovelCanvasState,
}: UseWorkspaceWriteFileActionParams) {
  return useCallback(
    (content: string, fileName: string, context?: WriteArtifactContext) => {
      logWorkspaceWriteInfo(
        "[AgentChatPage] 收到文件写入:",
        fileName,
        content.length,
        "字符",
      );

      if (activeTheme === "general") {
        const existingArtifact = artifacts.find((artifact) => {
          if (context?.artifactId && artifact.id === context.artifactId) {
            return true;
          }

          if (context?.artifact?.id && artifact.id === context.artifact.id) {
            return true;
          }

          return resolveArtifactProtocolFilePath(artifact) === fileName;
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
          void saveSessionFile(fileName, nextContent)
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
        setSelectedArtifactId(nextArtifact.id);
        setArtifactViewMode(resolveDefaultArtifactViewMode(nextArtifact));
        setLayoutMode("chat-canvas");
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
      const socialArtifact =
        mappedTheme === "social-media"
          ? resolveSocialMediaArtifactDescriptor({
              fileName,
              gateKey: socialGateKey,
              runTitle: activeRunDescription,
            })
          : null;
      const isPrimaryArtifact =
        !isThemeWorkbench || isThemeWorkbenchPrimaryDocumentArtifact(fileName);
      const shouldApplyToMainDocument =
        nextFileType === "document" &&
        isPrimaryArtifact &&
        (!isThemeWorkbench || currentGateKey !== "topic_select");
      const effectiveDocumentVersionId =
        activeRunVersionId ||
        ((isThemeWorkbench || mappedTheme === "social-media") &&
        shouldApplyToMainDocument
          ? `artifact:${fileName}`
          : null);
      const effectiveVersionDescription =
        socialArtifact?.versionLabel || activeRunDescription;
      const baseVersionMetadata =
        socialArtifact && shouldApplyToMainDocument
          ? {
              artifactId: socialArtifact.artifactId,
              artifactType: socialArtifact.artifactType,
              stage: socialArtifact.stage,
              platform: socialArtifact.platform,
              sourceFileName: fileName,
              runId: activeRunVersionId || undefined,
              correlationId:
                effectiveDocumentVersionId || activeRunVersionId || undefined,
            }
          : undefined;
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

      void saveSessionFile(fileName, content).catch((error) => {
        console.error("[AgentChatPage] 持久化文件失败:", error);
      });

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
        logWorkspaceWriteInfo("[AgentChatPage] 主题工作台非成文阶段，跳过主稿写入:", {
          gate: currentGateKey,
          fileName,
          isPrimaryArtifact,
        });
      }

      const fileToStepMap = getFileToStepMap(mappedTheme);
      const stepIndex = fileToStepMap[fileName];
      if (
        stepIndex !== undefined &&
        stepIndex === currentStepIndex &&
        isContentCreationMode
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

      if (socialArtifact && hasTaskFileChanged) {
        activityLogger.log({
          eventType: existingTaskFile ? "file_update" : "file_create",
          status: "success",
          title: `${existingTaskFile ? "更新" : "生成"}${socialArtifact.versionLabel}`,
          description: fileName,
          workspaceId: projectId || undefined,
          sessionId: sessionId || undefined,
          source: "aster-chat",
          correlationId:
            effectiveDocumentVersionId || activeRunVersionId || fileName,
          metadata: {
            ...baseVersionMetadata,
            stageLabel: socialArtifact.stageLabel,
            isAuxiliary: socialArtifact.isAuxiliary,
          },
        });

        const stageLogKey = `${
          effectiveDocumentVersionId || socialArtifact.artifactId
        }:${socialArtifact.stage}`;
        if (
          !socialArtifact.isAuxiliary &&
          socialStageLogRef.current[stageLogKey] !== socialArtifact.stage
        ) {
          socialStageLogRef.current[stageLogKey] = socialArtifact.stage;
          activityLogger.log({
            eventType: "step_complete",
            status: "success",
            title: socialArtifact.stageLabel,
            description: `${socialArtifact.versionLabel}已进入版本链`,
            workspaceId: projectId || undefined,
            sessionId: sessionId || undefined,
            source: "aster-chat",
            correlationId:
              effectiveDocumentVersionId || activeRunVersionId || fileName,
            metadata: {
              ...baseVersionMetadata,
              stageLabel: socialArtifact.stageLabel,
            },
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
            logWorkspaceWriteInfo("[AgentChatPage] 文件内容相同，跳过:", fileName);
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
            metadata: socialArtifact
              ? {
                  ...(existing.metadata || {}),
                  ...baseVersionMetadata,
                  stageLabel: socialArtifact.stageLabel,
                  versionLabel: socialArtifact.versionLabel,
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
          metadata: socialArtifact
            ? {
                ...baseVersionMetadata,
                stageLabel: socialArtifact.stageLabel,
                versionLabel: socialArtifact.versionLabel,
              }
            : undefined,
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

        if (mappedTheme === "poster") {
          return previous;
        }

        if (mappedTheme === "music") {
          const sections = parseLyrics(content);
          if (!previous || previous.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            const titleMatch = content.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            logWorkspaceWriteInfo("[AgentChatPage] 创建新音乐状态");
            return musicState;
          }
          return {
            ...previous,
            sections,
          };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(previous, content);
        }

        if (!previous || previous.type !== "document") {
          logWorkspaceWriteInfo("[AgentChatPage] 创建新文档状态");
          const initialDocumentState = createInitialDocumentState(content);
          if (!effectiveDocumentVersionId) {
            if (!socialArtifact) {
              return initialDocumentState;
            }
            return {
              ...initialDocumentState,
              platform:
                socialArtifact.platform || initialDocumentState.platform,
              versions: initialDocumentState.versions.map((version) => ({
                ...version,
                description: effectiveVersionDescription,
                metadata: baseVersionMetadata,
              })),
            };
          }
          if (!isThemeWorkbench && mappedTheme !== "social-media") {
            return initialDocumentState;
          }
          return {
            ...initialDocumentState,
            platform: socialArtifact?.platform || initialDocumentState.platform,
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
              platform: socialArtifact?.platform || previous.platform,
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
            platform: socialArtifact?.platform || previous.platform,
            versions: nextVersions,
            currentVersionId: effectiveDocumentVersionId,
          };
        }

        logWorkspaceWriteInfo("[AgentChatPage] 更新现有文档状态");
        return {
          ...previous,
          content,
          platform: socialArtifact?.platform || previous.platform,
        };
      });

      setLayoutMode("chat-canvas");
    },
    [
      activeTheme,
      artifacts,
      completeStep,
      contentId,
      currentGateKey,
      currentStepIndex,
      isContentCreationMode,
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
      syncGeneralArtifactToResource,
      taskFilesRef,
      themeWorkbenchActiveQueueItem,
      upsertGeneralArtifact,
      upsertNovelCanvasState,
    ],
  );
}
