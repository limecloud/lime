import {
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { readFilePreview } from "@/lib/api/fileBrowser";
import {
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
} from "@/lib/api/mediaTasks";
import { safeListen } from "@/lib/api/bridgeEvents";
import {
  hasDesktopHostInvokeCapability,
  hasDesktopHostRuntimeMarkers,
} from "@/lib/desktop-runtime";
import { logAgentDebug } from "@/lib/agentDebug";
import { resolveAbsoluteWorkspacePath } from "./workspacePath";
import { buildImageTaskLookupRequest } from "./imageTaskLocator";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { Message } from "../types";
import type { SessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import { syncDocumentInlineImageTask } from "./workspaceDocumentInlineImageTaskSync";
import {
  collectSeedImageTasks,
  resolvePendingImageCommandRecoverySignature,
  shouldProbeWorkspaceImageTaskCatalog,
  type SeedImageTaskRecord,
} from "./imageTaskPreviewRuntimeGuards";
import { asRecord, readString } from "./imageTaskPreviewRuntimePayload";
import {
  buildImageTaskSnapshotFromArtifactOutput,
  buildParsedImageTaskSnapshot,
} from "./imageTaskPreviewRuntimeSnapshot";
import {
  finalizePreviewMessages,
  upsertPreviewMessage,
} from "./imageTaskPreviewRuntimeMessages";
import {
  mergeImageTaskSnapshot,
  syncMessagesWithImageWorkbenchState,
} from "./imageTaskPreviewRuntimeState";
import {
  collectImageTaskCandidatePaths,
  isImageWorkbenchTaskSatisfiedByCache,
  matchesRuntimeEventContext,
  normalizeTaskFamily,
  shouldPreferLoadedImageTaskSnapshot,
  shouldRestoreImageTaskRecord,
  shouldRestoreLoadedImageTaskSnapshot,
  type LoadedImageTaskSnapshot,
  type RestoredImageTaskSnapshot,
  type TrackedImageTask,
} from "./imageTaskPreviewRuntimeRecovery";
import { syncWorkspaceArticleInlineImageTaskMessageArtifacts } from "./workspaceArticleInlineImageTaskSync";
import {
  buildPendingImageTaskRecordFromEvent,
  buildPendingImageTaskSnapshotFromEvent,
  type CreationTaskSubmittedPayload,
} from "./imageTaskPreviewRuntimeEvents";

export { shouldEnableWorkspaceImageTaskPreviewRuntime } from "./imageTaskPreviewRuntimeGuards";

const IMAGE_TASK_EVENT_NAME = "lime://creation_task_submitted";
const IMAGE_TASK_FILE_PREVIEW_MAX_SIZE = 256 * 1024;
const IMAGE_TASK_POLL_INTERVAL_MS = 1500;
const IMAGE_TASK_RESTORE_LIMIT = 8;
const EMPTY_MESSAGES: Message[] = [];

interface UseWorkspaceImageTaskPreviewRuntimeParams {
  enabled?: boolean;
  sessionId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  projectRootPath?: string | null;
  restoreFromWorkspace?: boolean;
  messages?: Message[];
  documentMarkdowns?: readonly (string | null | undefined)[];
  currentImageWorkbenchState?: SessionImageWorkbenchState;
  canvasState: CanvasStateUnion | null;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
  updateCurrentImageWorkbenchState: (
    updater: (
      current: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState,
  ) => void;
}

interface ImageTaskPreviewRuntimeContext {
  sessionId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  projectRootPath?: string | null;
  messages?: Message[];
  documentMarkdowns?: readonly (string | null | undefined)[];
  currentImageWorkbenchState?: SessionImageWorkbenchState;
  canvasState: CanvasStateUnion | null;
}

function hasDocumentInlineCachedSeedTask(params: {
  imageWorkbenchState?: SessionImageWorkbenchState;
  taskSeeds: readonly SeedImageTaskRecord[];
}): boolean {
  const seedTaskIds = new Set(
    params.taskSeeds.map((task) => task.taskId).filter(Boolean),
  );
  if (seedTaskIds.size === 0) {
    return false;
  }

  return (params.imageWorkbenchState?.tasks || []).some((task) => {
    if (!seedTaskIds.has(task.id)) {
      return false;
    }
    const applyTarget = task.applyTarget;
    return (
      applyTarget?.kind === "canvas-insert" &&
      applyTarget.canvasType === "document"
    );
  });
}

function normalizeCachedTaskRecordStatus(
  status: SessionImageWorkbenchState["tasks"][number]["status"],
): string {
  switch (status) {
    case "complete":
      return "completed";
    case "partial":
      return "partial";
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function syncMessagesWithCachedDocumentInlineSeedTasks(params: {
  messages: readonly Message[];
  imageWorkbenchState?: SessionImageWorkbenchState;
  taskSeeds: readonly SeedImageTaskRecord[];
}): Message[] {
  const imageWorkbenchState = params.imageWorkbenchState;
  if (!imageWorkbenchState) {
    return params.messages as Message[];
  }

  const seedTaskIds = new Set(params.taskSeeds.map((task) => task.taskId));
  return imageWorkbenchState.tasks.reduce((messages, task) => {
    if (!seedTaskIds.has(task.id)) {
      return messages;
    }
    const applyTarget = task.applyTarget;
    if (
      applyTarget?.kind !== "canvas-insert" ||
      applyTarget.canvasType !== "document"
    ) {
      return messages;
    }
    const outputs = imageWorkbenchState.outputs.filter(
      (output) => output.taskId === task.id,
    );
    if (outputs.length === 0) {
      return messages;
    }
    return syncWorkspaceArticleInlineImageTaskMessageArtifacts(messages, {
      taskId: task.id,
      taskRecord: {
        status: normalizeCachedTaskRecordStatus(task.status),
        payload: {
          usage: "document-inline",
          prompt: task.prompt,
          anchor_section_title: applyTarget.sectionTitle ?? undefined,
          anchor_text: applyTarget.anchorText ?? undefined,
        },
        relationships: {
          slot_id: applyTarget.slotId ?? undefined,
        },
      },
      outputs: outputs.map((output) => ({
        url: output.url,
        prompt: output.prompt,
        slotId: output.slotId,
        slotPrompt: output.slotPrompt,
      })),
    });
  }, params.messages as Message[]);
}

export function useWorkspaceImageTaskPreviewRuntime({
  enabled = true,
  sessionId,
  projectId,
  contentId,
  projectRootPath,
  restoreFromWorkspace = true,
  messages,
  documentMarkdowns,
  currentImageWorkbenchState,
  canvasState,
  setCanvasState,
  setChatMessages,
  updateCurrentImageWorkbenchState,
}: UseWorkspaceImageTaskPreviewRuntimeParams) {
  const effectiveMessages = messages ?? EMPTY_MESSAGES;
  const trackedTasksRef = useRef<Map<string, TrackedImageTask>>(new Map());
  const restoredSeedTaskIdsRef = useRef<Set<string>>(new Set());
  const restoreSeedMessagesRef = useRef<
    ((seedMessages?: Message[]) => void) | null
  >(null);
  const runtimeContextRef = useRef<ImageTaskPreviewRuntimeContext>({
    sessionId,
    projectId,
    contentId,
    projectRootPath,
    messages: effectiveMessages,
    documentMarkdowns,
    currentImageWorkbenchState,
    canvasState,
  });
  const documentMarkdownRecoverySignature = (documentMarkdowns || [])
    .map((markdown) => markdown?.trim() || "")
    .filter(Boolean)
    .join("\n---lime-document-image-task-recovery---\n");

  runtimeContextRef.current = {
    sessionId,
    projectId,
    contentId,
    projectRootPath,
    messages: effectiveMessages,
    documentMarkdowns,
    currentImageWorkbenchState,
    canvasState,
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const finalizedMessages = finalizePreviewMessages(
      effectiveMessages,
      effectiveMessages,
    );
    if (finalizedMessages === effectiveMessages) {
      return;
    }

    setChatMessages((previous) => finalizePreviewMessages(previous, previous));
  }, [effectiveMessages, enabled, setChatMessages]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const nextMessages = syncMessagesWithImageWorkbenchState({
      messages: effectiveMessages,
      imageWorkbenchState: currentImageWorkbenchState,
      projectId,
      contentId,
      allowAppendCachedPreviewMessages: restoreFromWorkspace,
    });
    if (nextMessages === effectiveMessages) {
      return;
    }

    setChatMessages((previous) => {
      return syncMessagesWithImageWorkbenchState({
        messages: previous,
        imageWorkbenchState: currentImageWorkbenchState,
        projectId,
        contentId,
        allowAppendCachedPreviewMessages: restoreFromWorkspace,
      });
    });
  }, [
    contentId,
    currentImageWorkbenchState,
    effectiveMessages,
    enabled,
    projectId,
    restoreFromWorkspace,
    setChatMessages,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    restoreSeedMessagesRef.current?.(messages);
  }, [enabled, messages, projectRootPath, sessionId]);

  useEffect(() => {
    if (!enabled) {
      const trackedTasks = trackedTasksRef.current;
      trackedTasks.forEach((trackedTask) => {
        if (trackedTask.timerId !== null) {
          window.clearTimeout(trackedTask.timerId);
        }
      });
      trackedTasks.clear();
      restoredSeedTaskIdsRef.current.clear();
      restoreSeedMessagesRef.current = null;
      return;
    }

    const hasInvokeCapability = hasDesktopHostInvokeCapability();
    const hasRuntimeMarkers = hasDesktopHostRuntimeMarkers();
    const shouldProbeWorkspaceCatalog = shouldProbeWorkspaceImageTaskCatalog({
      messages: runtimeContextRef.current.messages,
      imageWorkbenchState: runtimeContextRef.current.currentImageWorkbenchState,
      canvasState: runtimeContextRef.current.canvasState,
      documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
    });
    const shouldRestoreWorkspaceTaskCatalog =
      restoreFromWorkspace &&
      (hasInvokeCapability || hasRuntimeMarkers) &&
      shouldProbeWorkspaceCatalog;
    logAgentDebug(
      "ImageTaskPreviewRuntime",
      "workspaceCatalog.restoreState",
      {
        documentMarkdownCount:
          runtimeContextRef.current.documentMarkdowns?.length ?? 0,
        enabled,
        hasInvokeCapability,
        hasProjectRootPath: Boolean(
          runtimeContextRef.current.projectRootPath?.trim(),
        ),
        hasRuntimeMarkers,
        restoreFromWorkspace,
        sessionId: runtimeContextRef.current.sessionId || null,
        shouldProbeWorkspaceCatalog,
        shouldRestoreWorkspaceTaskCatalog,
      },
      { level: "debug", throttleMs: 1000 },
    );

    const trackedTasks = trackedTasksRef.current;
    const restoredSeedTaskIds = restoredSeedTaskIdsRef.current;
    trackedTasks.forEach((trackedTask) => {
      if (trackedTask.timerId !== null) {
        window.clearTimeout(trackedTask.timerId);
      }
    });
    trackedTasks.clear();

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let lastPendingImageCommandRecoverySignature = "";
    let workspaceCatalogRestoreInFlight = false;
    let pendingWorkspaceCatalogRestoreAfterInFlight = false;
    let pendingWorkspaceCatalogRestoreAllowsFileScanFallback = false;

    const hasUnrestoredSeedImageTasks = (seedMessages?: Message[]): boolean =>
      collectSeedImageTasks(
        seedMessages || runtimeContextRef.current.messages,
      ).some((task) => {
        if (restoredSeedTaskIds.has(task.taskId)) {
          return false;
        }
        return !isImageWorkbenchTaskSatisfiedByCache({
          imageWorkbenchState:
            runtimeContextRef.current.currentImageWorkbenchState,
          taskId: task.taskId,
          documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
        });
      });

    const loadTaskSnapshotFromArtifactApi = async (params: {
      taskId: string;
      taskFilePath?: string | null;
      artifactPath?: string | null;
    }): Promise<LoadedImageTaskSnapshot | null> => {
      const request = buildImageTaskLookupRequest({
        taskId: params.taskId,
        taskFilePath: params.taskFilePath,
        artifactPath: params.artifactPath,
        projectRootPath: runtimeContextRef.current.projectRootPath,
      });
      if (!request) {
        logAgentDebug(
          "ImageTaskPreviewRuntime",
          "artifactLookup.skipped",
          {
            reason: "missing_lookup_request",
            taskId: params.taskId,
            hasProjectRootPath: Boolean(
              runtimeContextRef.current.projectRootPath?.trim(),
            ),
            taskFilePath: params.taskFilePath || null,
            artifactPath: params.artifactPath || null,
          },
          { level: "warn", throttleMs: 1000 },
        );
        return null;
      }

      try {
        const artifact = await getMediaTaskArtifact(request);
        if (cancelled) {
          return null;
        }

        const taskRecord = asRecord(artifact.record);
        if (!taskRecord) {
          return null;
        }

        const snapshot = buildImageTaskSnapshotFromArtifactOutput({
          artifact,
          projectId: runtimeContextRef.current.projectId,
          contentId: runtimeContextRef.current.contentId,
          canvasState: runtimeContextRef.current.canvasState,
        });
        if (!snapshot) {
          logAgentDebug(
            "ImageTaskPreviewRuntime",
            "artifactLookup.noSnapshot",
            {
              taskId: params.taskId,
              normalizedStatus: artifact.normalized_status ?? null,
              status: artifact.status ?? null,
              taskRef: request.taskRef,
            },
            { level: "warn", throttleMs: 1000 },
          );
          return null;
        }

        logAgentDebug(
          "ImageTaskPreviewRuntime",
          "artifactLookup.success",
          {
            taskId: params.taskId,
            status: snapshot.task.status,
            previewStatus: snapshot.message.imageWorkbenchPreview?.status,
            outputCount: snapshot.outputs.length,
            terminal: snapshot.terminal,
            taskRef: request.taskRef,
          },
          { level: "debug", throttleMs: 1000 },
        );
        return {
          snapshot,
          taskRecord,
        };
      } catch (error) {
        logAgentDebug(
          "ImageTaskPreviewRuntime",
          "artifactLookup.failed",
          {
            taskId: params.taskId,
            taskRef: request.taskRef,
            error,
          },
          { level: "warn", throttleMs: 1000 },
        );
        return null;
      }
    };

    const applyLoadedTaskSnapshot = (params: LoadedImageTaskSnapshot) => {
      restoredSeedTaskIds.add(params.snapshot.taskId);
      logAgentDebug(
        "ImageTaskPreviewRuntime",
        "snapshot.apply",
        {
          taskId: params.snapshot.taskId,
          status: params.snapshot.task.status,
          previewStatus: params.snapshot.message.imageWorkbenchPreview?.status,
          outputCount: params.snapshot.outputs.length,
          terminal: params.snapshot.terminal,
        },
        { level: "debug", throttleMs: 1000 },
      );
      setChatMessages((previous) =>
        syncWorkspaceArticleInlineImageTaskMessageArtifacts(
          upsertPreviewMessage(previous, params.snapshot.message),
          {
            taskRecord: params.taskRecord,
            taskId: params.snapshot.taskId,
            outputs: params.snapshot.outputs,
          },
        ),
      );
      updateCurrentImageWorkbenchState((current) =>
        mergeImageTaskSnapshot(current, params.snapshot),
      );
      syncDocumentInlineImageTask({
        taskRecord: params.taskRecord,
        taskId: params.snapshot.taskId,
        outputs: params.snapshot.outputs,
        setCanvasState,
      });
    };

    const trackTaskForPolling = (params: {
      taskId: string;
      taskType?: string;
      absolutePath?: string;
      artifactPath?: string;
    }) => {
      const existing = trackedTasks.get(params.taskId);
      if (existing && existing.timerId !== null) {
        window.clearTimeout(existing.timerId);
      }
      trackedTasks.set(params.taskId, {
        taskId: params.taskId,
        taskType: params.taskType || existing?.taskType || "image_generate",
        taskFamily: "image",
        artifactPath: params.artifactPath || existing?.artifactPath || "",
        absolutePath: params.absolutePath || existing?.absolutePath || "",
        lookupTaskRef:
          params.absolutePath || existing?.lookupTaskRef || params.taskId,
        timerId: null,
        polling: false,
      });
    };

    const scheduleNextPoll = (taskId: string) => {
      const trackedTask = trackedTasks.get(taskId);
      if (!trackedTask || cancelled) {
        return;
      }
      if (trackedTask.timerId !== null) {
        window.clearTimeout(trackedTask.timerId);
      }
      trackedTask.timerId = window.setTimeout(() => {
        trackedTask.timerId = null;
        void syncTaskFile(taskId);
      }, IMAGE_TASK_POLL_INTERVAL_MS);
    };

    const syncTaskFile = async (taskId: string) => {
      const trackedTask = trackedTasks.get(taskId);
      if (!trackedTask || trackedTask.polling || cancelled) {
        return;
      }

      trackedTask.polling = true;

      try {
        let loadedSnapshot: LoadedImageTaskSnapshot | null = null;

        try {
          if (trackedTask.absolutePath) {
            const preview = await readFilePreview(
              trackedTask.absolutePath,
              IMAGE_TASK_FILE_PREVIEW_MAX_SIZE,
            );
            if (cancelled || !trackedTasks.has(taskId)) {
              return;
            }

            if (!preview.error && preview.content?.trim()) {
              const parsed = JSON.parse(preview.content) as Record<
                string,
                unknown
              >;
              const snapshot = buildParsedImageTaskSnapshot({
                taskRecord: parsed,
                taskId: trackedTask.taskId,
                taskType: trackedTask.taskType,
                projectId: runtimeContextRef.current.projectId,
                contentId: runtimeContextRef.current.contentId,
                taskFilePath: trackedTask.absolutePath,
                artifactPath: trackedTask.artifactPath,
                canvasState: runtimeContextRef.current.canvasState,
              });
              if (snapshot) {
                loadedSnapshot = {
                  snapshot,
                  taskRecord: parsed,
                };
              }
            }
          }
        } catch {
          loadedSnapshot = null;
        }

        const shouldProbeArtifactApi =
          !loadedSnapshot ||
          !loadedSnapshot.snapshot.terminal ||
          loadedSnapshot.snapshot.outputs.length === 0;

        if (shouldProbeArtifactApi) {
          const artifactSnapshot = await loadTaskSnapshotFromArtifactApi({
            taskId,
            taskFilePath: trackedTask.absolutePath || trackedTask.lookupTaskRef,
            artifactPath: trackedTask.artifactPath,
          });
          if (
            shouldPreferLoadedImageTaskSnapshot(
              loadedSnapshot,
              artifactSnapshot,
            )
          ) {
            loadedSnapshot = artifactSnapshot;
          }
        }
        if (!loadedSnapshot) {
          scheduleNextPoll(taskId);
          return;
        }

        trackedTask.lookupTaskRef =
          loadedSnapshot.snapshot.task.taskFilePath ||
          trackedTask.absolutePath ||
          trackedTask.lookupTaskRef;
        trackedTask.absolutePath =
          loadedSnapshot.snapshot.task.taskFilePath || trackedTask.absolutePath;
        trackedTask.artifactPath =
          loadedSnapshot.snapshot.task.artifactPath || trackedTask.artifactPath;
        applyLoadedTaskSnapshot(loadedSnapshot);

        if (loadedSnapshot.snapshot.terminal) {
          trackedTasks.delete(taskId);
          return;
        }

        scheduleNextPoll(taskId);
      } catch {
        scheduleNextPoll(taskId);
      } finally {
        const trackedTaskAfterSync = trackedTasks.get(taskId);
        if (trackedTaskAfterSync) {
          trackedTaskAfterSync.polling = false;
        }
      }
    };

    const restoreTrackedTasksFromWorkspace = async (
      options: { allowFileScanFallback?: boolean } = {},
    ): Promise<boolean> => {
      const currentProjectRootPath =
        runtimeContextRef.current.projectRootPath?.trim();
      if (!currentProjectRootPath || cancelled) {
        return false;
      }

      let restoredSnapshots: RestoredImageTaskSnapshot[] | null = null;
      let listedTaskCount = 0;
      let matchedTaskCount = 0;

      try {
        const artifactList = await listMediaTaskArtifacts({
          projectRootPath: currentProjectRootPath,
          taskFamily: "image",
          limit: IMAGE_TASK_RESTORE_LIMIT * 4,
        });
        if (cancelled) {
          return false;
        }

        listedTaskCount = artifactList.tasks.length;
        restoredSnapshots = artifactList.tasks.reduce<
          RestoredImageTaskSnapshot[]
        >((items, artifact) => {
          const taskRecord = asRecord(artifact.record);
          if (!taskRecord) {
            return items;
          }
          if (
            !shouldRestoreImageTaskRecord({
              taskRecord,
              sessionId: runtimeContextRef.current.sessionId,
              projectId: runtimeContextRef.current.projectId,
              contentId: runtimeContextRef.current.contentId,
              documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
            })
          ) {
            return items;
          }

          const taskFamily = normalizeTaskFamily(
            artifact.task_type,
            artifact.task_family,
          );
          if (taskFamily !== "image") {
            return items;
          }

          const snapshot = buildImageTaskSnapshotFromArtifactOutput({
            artifact,
            projectId: runtimeContextRef.current.projectId,
            contentId: runtimeContextRef.current.contentId,
            canvasState: runtimeContextRef.current.canvasState,
          });
          if (!snapshot) {
            return items;
          }

          matchedTaskCount += 1;
          items.push({
            snapshot,
            taskRecord,
            absolutePath: artifact.absolute_path,
            taskType: artifact.task_type,
            taskFamily,
          });
          return items;
        }, []);
      } catch {
        restoredSnapshots = null;
      }

      if (restoredSnapshots === null) {
        if (options.allowFileScanFallback === false) {
          return false;
        }
        const candidatePaths = await collectImageTaskCandidatePaths(
          currentProjectRootPath,
        );
        if (cancelled || candidatePaths.length === 0) {
          return false;
        }

        restoredSnapshots = [];
        const seenTaskIds = new Set<string>();

        for (const candidatePath of candidatePaths) {
          try {
            const preview = await readFilePreview(
              candidatePath,
              IMAGE_TASK_FILE_PREVIEW_MAX_SIZE,
            );
            if (cancelled || preview.error || !preview.content?.trim()) {
              continue;
            }

            const parsed = JSON.parse(preview.content) as Record<
              string,
              unknown
            >;
            if (
              !shouldRestoreImageTaskRecord({
                taskRecord: parsed,
                sessionId: runtimeContextRef.current.sessionId,
                projectId: runtimeContextRef.current.projectId,
                contentId: runtimeContextRef.current.contentId,
                documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
              })
            ) {
              continue;
            }

            const taskId = readString([parsed], ["task_id", "taskId"]);
            const taskType = readString([parsed], ["task_type", "taskType"]);
            const taskFamily = normalizeTaskFamily(
              taskType || "",
              readString([parsed], ["task_family", "taskFamily"]),
            );
            if (
              !taskId ||
              !taskType ||
              taskFamily !== "image" ||
              seenTaskIds.has(taskId)
            ) {
              continue;
            }

            const snapshot = buildParsedImageTaskSnapshot({
              taskRecord: parsed,
              taskId,
              taskType,
              projectId: runtimeContextRef.current.projectId,
              contentId: runtimeContextRef.current.contentId,
              taskFilePath: candidatePath,
              canvasState: runtimeContextRef.current.canvasState,
            });
            if (!snapshot) {
              continue;
            }

            seenTaskIds.add(taskId);
            restoredSnapshots.push({
              snapshot,
              taskRecord: parsed,
              absolutePath: candidatePath,
              taskType,
              taskFamily,
            });
          } catch {
            continue;
          }
        }
      }

      if (cancelled || restoredSnapshots.length === 0) {
        logAgentDebug(
          "ImageTaskPreviewRuntime",
          "workspaceCatalog.restoreEmpty",
          {
            listedTaskCount,
            matchedTaskCount,
            restoredSnapshotCount: restoredSnapshots?.length ?? 0,
          },
          { level: "debug", throttleMs: 1000 },
        );
        return false;
      }

      const selectedSnapshots = restoredSnapshots
        .sort(
          (left, right) => right.snapshot.updatedAt - left.snapshot.updatedAt,
        )
        .slice(0, IMAGE_TASK_RESTORE_LIMIT)
        .reverse();
      logAgentDebug(
        "ImageTaskPreviewRuntime",
        "workspaceCatalog.restoreSelected",
        {
          listedTaskCount,
          matchedTaskCount,
          restoredSnapshotCount: restoredSnapshots.length,
          selectedTaskIds: selectedSnapshots.map(
            (item) => item.snapshot.taskId,
          ),
        },
        { level: "debug", throttleMs: 1000 },
      );
      selectedSnapshots.forEach((item) => {
        restoredSeedTaskIds.add(item.snapshot.taskId);
      });

      setChatMessages((previous) =>
        selectedSnapshots.reduce((messages, item) => {
          const nextMessages = upsertPreviewMessage(
            messages,
            item.snapshot.message,
          );
          return syncWorkspaceArticleInlineImageTaskMessageArtifacts(
            nextMessages,
            {
              taskRecord: item.taskRecord,
              taskId: item.snapshot.taskId,
              outputs: item.snapshot.outputs,
            },
          );
        }, previous),
      );
      updateCurrentImageWorkbenchState((current) =>
        selectedSnapshots.reduce(
          (state, item) => mergeImageTaskSnapshot(state, item.snapshot),
          current,
        ),
      );
      selectedSnapshots.forEach((item) => {
        syncDocumentInlineImageTask({
          taskRecord: item.taskRecord,
          taskId: item.snapshot.taskId,
          outputs: item.snapshot.outputs,
          setCanvasState,
        });
      });

      for (const item of selectedSnapshots) {
        if (item.snapshot.terminal) {
          continue;
        }
        trackedTasks.set(item.snapshot.taskId, {
          taskId: item.snapshot.taskId,
          taskType: item.taskType,
          taskFamily: item.taskFamily,
          artifactPath: item.snapshot.task.artifactPath || "",
          absolutePath: item.snapshot.task.taskFilePath || item.absolutePath,
          lookupTaskRef:
            item.snapshot.task.taskFilePath ||
            item.absolutePath ||
            item.snapshot.taskId,
          timerId: null,
          polling: false,
        });
        scheduleNextPoll(item.snapshot.taskId);
      }
      return true;
    };

    const restoreTrackedTasksFromWorkspaceDeduped = async (
      options: { allowFileScanFallback?: boolean } = {},
    ) => {
      if (workspaceCatalogRestoreInFlight) {
        pendingWorkspaceCatalogRestoreAfterInFlight = true;
        pendingWorkspaceCatalogRestoreAllowsFileScanFallback =
          pendingWorkspaceCatalogRestoreAllowsFileScanFallback ||
          options.allowFileScanFallback !== false;
        return;
      }

      workspaceCatalogRestoreInFlight = true;
      let restoredAny = false;
      try {
        restoredAny = await restoreTrackedTasksFromWorkspace(options);
      } finally {
        workspaceCatalogRestoreInFlight = false;
        const pendingAllowsFileScanFallback =
          pendingWorkspaceCatalogRestoreAllowsFileScanFallback;
        const shouldRunPendingRestore =
          pendingWorkspaceCatalogRestoreAfterInFlight &&
          !cancelled &&
          !restoredAny &&
          hasUnrestoredSeedImageTasks();
        pendingWorkspaceCatalogRestoreAfterInFlight = false;
        pendingWorkspaceCatalogRestoreAllowsFileScanFallback = false;
        if (shouldRunPendingRestore) {
          void restoreTrackedTasksFromWorkspaceDeduped({
            allowFileScanFallback: pendingAllowsFileScanFallback,
          });
        }
      }
    };

    const restoreTrackedTasksFromMessages = async (
      seedMessages?: Message[],
    ): Promise<boolean> => {
      const taskSeeds = collectSeedImageTasks(
        seedMessages || runtimeContextRef.current.messages,
      ).filter((task) => !restoredSeedTaskIds.has(task.taskId));
      if (taskSeeds.length === 0 || cancelled) {
        return false;
      }
      logAgentDebug(
        "ImageTaskPreviewRuntime",
        "messageSeeds.discovered",
        {
          seedCount: taskSeeds.length,
          taskIds: taskSeeds.map((task) => task.taskId),
          hasProjectRootPath: Boolean(
            runtimeContextRef.current.projectRootPath?.trim(),
          ),
          sessionId: runtimeContextRef.current.sessionId || null,
        },
        { level: "debug", throttleMs: 1000 },
      );

      const unresolvedTaskSeeds = taskSeeds.filter(
        (task) =>
          !isImageWorkbenchTaskSatisfiedByCache({
            imageWorkbenchState:
              runtimeContextRef.current.currentImageWorkbenchState,
            taskId: task.taskId,
            documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
          }),
      );
      if (unresolvedTaskSeeds.length === 0) {
        taskSeeds.forEach((task) => {
          restoredSeedTaskIds.add(task.taskId);
        });
        const shouldContinueWorkspaceCatalogRestore =
          shouldRestoreWorkspaceTaskCatalog &&
          hasDocumentInlineCachedSeedTask({
            imageWorkbenchState:
              runtimeContextRef.current.currentImageWorkbenchState,
            taskSeeds,
          });
        if (shouldContinueWorkspaceCatalogRestore) {
          setChatMessages((previous) =>
            syncMessagesWithCachedDocumentInlineSeedTasks({
              messages: previous,
              imageWorkbenchState:
                runtimeContextRef.current.currentImageWorkbenchState,
              taskSeeds,
            }),
          );
        }
        logAgentDebug(
          "ImageTaskPreviewRuntime",
          "messageSeeds.cacheSatisfied",
          {
            seedCount: taskSeeds.length,
            taskIds: taskSeeds.map((task) => task.taskId),
            shouldContinueWorkspaceCatalogRestore,
          },
          { level: "debug", throttleMs: 1000 },
        );
        return !shouldContinueWorkspaceCatalogRestore;
      }

      const loadedSnapshots = await Promise.all(
        unresolvedTaskSeeds.map(async (task) => ({
          task,
          loaded: await loadTaskSnapshotFromArtifactApi({
            taskId: task.taskId,
            taskFilePath: task.taskFilePath,
            artifactPath: task.artifactPath,
          }),
        })),
      );
      if (cancelled) {
        return false;
      }

      const resolvedSnapshots = loadedSnapshots.filter(
        (
          item,
        ): item is {
          task: SeedImageTaskRecord;
          loaded: LoadedImageTaskSnapshot;
        } =>
          Boolean(item.loaded) &&
          shouldRestoreLoadedImageTaskSnapshot(
            item.loaded as LoadedImageTaskSnapshot,
          ),
      );
      if (resolvedSnapshots.length === 0) {
        logAgentDebug(
          "ImageTaskPreviewRuntime",
          "messageSeeds.unresolved",
          {
            seedCount: taskSeeds.length,
            unresolvedCount: unresolvedTaskSeeds.length,
            taskIds: unresolvedTaskSeeds.map((item) => item.taskId),
            hasProjectRootPath: Boolean(
              runtimeContextRef.current.projectRootPath?.trim(),
            ),
          },
          { level: "warn", throttleMs: 1000 },
        );
        return false;
      }

      resolvedSnapshots.forEach((item) => {
        restoredSeedTaskIds.add(item.task.taskId);
        applyLoadedTaskSnapshot(item.loaded);
        if (!item.loaded.snapshot.terminal) {
          trackTaskForPolling({
            taskId: item.task.taskId,
            absolutePath:
              item.loaded.snapshot.task.taskFilePath || item.task.taskFilePath,
            artifactPath:
              item.loaded.snapshot.task.artifactPath || item.task.artifactPath,
          });
          scheduleNextPoll(item.task.taskId);
        }
      });

      return resolvedSnapshots.length === unresolvedTaskSeeds.length;
    };

    const restorePendingImageTasksFromCurrentSession =
      async (): Promise<boolean> => {
        const recoverySignature = resolvePendingImageCommandRecoverySignature(
          runtimeContextRef.current.messages,
        );
        if (!recoverySignature || cancelled) {
          return false;
        }
        if (recoverySignature === lastPendingImageCommandRecoverySignature) {
          return false;
        }

        const currentProjectRootPath =
          runtimeContextRef.current.projectRootPath?.trim();
        if (!currentProjectRootPath) {
          return false;
        }

        lastPendingImageCommandRecoverySignature = recoverySignature;

        let artifactList: Awaited<
          ReturnType<typeof listMediaTaskArtifacts>
        > | null = null;
        try {
          artifactList = await listMediaTaskArtifacts({
            projectRootPath: currentProjectRootPath,
            taskFamily: "image",
            limit: IMAGE_TASK_RESTORE_LIMIT,
          });
        } catch {
          return false;
        }

        if (cancelled || !artifactList) {
          return false;
        }

        const selectedSnapshots = artifactList.tasks
          .reduce<RestoredImageTaskSnapshot[]>((items, artifact) => {
            const taskRecord = asRecord(artifact.record);
            if (!taskRecord) {
              return items;
            }
            if (
              !shouldRestoreImageTaskRecord({
                taskRecord,
                sessionId: runtimeContextRef.current.sessionId,
                projectId: runtimeContextRef.current.projectId,
                contentId: runtimeContextRef.current.contentId,
                documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
              })
            ) {
              return items;
            }

            const taskFamily = normalizeTaskFamily(
              artifact.task_type,
              artifact.task_family,
            );
            if (taskFamily !== "image") {
              return items;
            }

            const snapshot = buildImageTaskSnapshotFromArtifactOutput({
              artifact,
              projectId: runtimeContextRef.current.projectId,
              contentId: runtimeContextRef.current.contentId,
              canvasState: runtimeContextRef.current.canvasState,
            });
            if (!snapshot) {
              return items;
            }

            items.push({
              snapshot,
              taskRecord,
              absolutePath: artifact.absolute_path,
              taskType: artifact.task_type,
              taskFamily,
            });
            return items;
          }, [])
          .filter(
            (item) =>
              !isImageWorkbenchTaskSatisfiedByCache({
                imageWorkbenchState:
                  runtimeContextRef.current.currentImageWorkbenchState,
                taskId: item.snapshot.taskId,
                documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
              }),
          )
          .sort(
            (left, right) => right.snapshot.updatedAt - left.snapshot.updatedAt,
          )
          .slice(0, IMAGE_TASK_RESTORE_LIMIT)
          .reverse();

        if (selectedSnapshots.length === 0) {
          return false;
        }
        selectedSnapshots.forEach((item) => {
          restoredSeedTaskIds.add(item.snapshot.taskId);
        });

        setChatMessages((previous) =>
          selectedSnapshots.reduce((messages, item) => {
            const nextMessages = upsertPreviewMessage(
              messages,
              item.snapshot.message,
            );
            return syncWorkspaceArticleInlineImageTaskMessageArtifacts(
              nextMessages,
              {
                taskRecord: item.taskRecord,
                taskId: item.snapshot.taskId,
                outputs: item.snapshot.outputs,
              },
            );
          }, previous),
        );
        updateCurrentImageWorkbenchState((current) =>
          selectedSnapshots.reduce(
            (state, item) => mergeImageTaskSnapshot(state, item.snapshot),
            current,
          ),
        );
        selectedSnapshots.forEach((item) => {
          syncDocumentInlineImageTask({
            taskRecord: item.taskRecord,
            taskId: item.snapshot.taskId,
            outputs: item.snapshot.outputs,
            setCanvasState,
          });
        });

        for (const item of selectedSnapshots) {
          if (item.snapshot.terminal) {
            continue;
          }
          trackedTasks.set(item.snapshot.taskId, {
            taskId: item.snapshot.taskId,
            taskType: item.taskType,
            taskFamily: item.taskFamily,
            artifactPath: item.snapshot.task.artifactPath || "",
            absolutePath: item.snapshot.task.taskFilePath || item.absolutePath,
            lookupTaskRef:
              item.snapshot.task.taskFilePath ||
              item.absolutePath ||
              item.snapshot.taskId,
            timerId: null,
            polling: false,
          });
          scheduleNextPoll(item.snapshot.taskId);
        }

        return true;
      };

    restoreSeedMessagesRef.current = (seedMessages) => {
      if (!restoreFromWorkspace || cancelled) {
        return;
      }
      if (!hasUnrestoredSeedImageTasks(seedMessages)) {
        return;
      }
      void restoreTrackedTasksFromMessages(seedMessages).then(
        (restoredFromMessages) => {
          if (restoredFromMessages) {
            return;
          }
          if (shouldRestoreWorkspaceTaskCatalog) {
            void restoreTrackedTasksFromWorkspaceDeduped({
              allowFileScanFallback: false,
            });
          } else {
            void restorePendingImageTasksFromCurrentSession();
          }
        },
      );
    };

    safeListen<CreationTaskSubmittedPayload>(IMAGE_TASK_EVENT_NAME, (event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload || {};
      const taskId = payload.task_id?.trim();
      const taskType = payload.task_type?.trim();
      const taskFamily = normalizeTaskFamily(
        taskType || "",
        payload.task_family,
      );
      const matchesRuntimeContext = matchesRuntimeEventContext({
        payload,
        sessionId: runtimeContextRef.current.sessionId,
        projectId: runtimeContextRef.current.projectId,
        contentId: runtimeContextRef.current.contentId,
        documentMarkdowns: runtimeContextRef.current.documentMarkdowns,
      });
      if (!matchesRuntimeContext) {
        return;
      }
      const artifactPath =
        payload.path?.trim() || payload.absolute_path?.trim() || "";
      const absolutePath = resolveAbsoluteWorkspacePath(
        runtimeContextRef.current.projectRootPath,
        payload.absolute_path?.trim() || artifactPath,
      );
      const pendingSnapshot = buildPendingImageTaskSnapshotFromEvent({
        taskId,
        taskType,
        taskFamily,
        payload,
        projectId: runtimeContextRef.current.projectId,
        contentId: runtimeContextRef.current.contentId,
        absolutePath,
        artifactPath,
        canvasState: runtimeContextRef.current.canvasState,
      });
      if (pendingSnapshot && taskId && taskType) {
        setChatMessages((previous) =>
          upsertPreviewMessage(previous, pendingSnapshot.message, {
            runtimeTurnId: payload.turn_id,
          }),
        );
        updateCurrentImageWorkbenchState((current) =>
          mergeImageTaskSnapshot(current, pendingSnapshot),
        );
        syncDocumentInlineImageTask({
          taskRecord: buildPendingImageTaskRecordFromEvent({
            taskId,
            taskType,
            payload,
          }),
          taskId,
          outputs: pendingSnapshot.outputs,
          setCanvasState,
        });
      }

      if (!taskId || !taskType || taskFamily !== "image" || !absolutePath) {
        return;
      }

      const previousTracked = trackedTasks.get(taskId);
      if (previousTracked && previousTracked.timerId !== null) {
        window.clearTimeout(previousTracked.timerId);
      }
      trackedTasks.set(taskId, {
        taskId,
        taskType,
        taskFamily,
        artifactPath,
        absolutePath,
        lookupTaskRef: absolutePath,
        timerId: null,
        polling: false,
      });

      void syncTaskFile(taskId);
    })
      .then((dispose) => {
        if (cancelled) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("[LocalConversationPage] 监听图片任务事件失败:", error);
      });

    if (restoreFromWorkspace) {
      void restoreTrackedTasksFromMessages().then((restoredFromMessages) => {
        if (!restoredFromMessages) {
          if (shouldRestoreWorkspaceTaskCatalog) {
            void restoreTrackedTasksFromWorkspaceDeduped();
          } else {
            void restorePendingImageTasksFromCurrentSession();
          }
        }
      });
    }

    return () => {
      cancelled = true;
      restoreSeedMessagesRef.current = null;
      trackedTasks.forEach((trackedTask) => {
        if (trackedTask.timerId !== null) {
          window.clearTimeout(trackedTask.timerId);
        }
      });
      trackedTasks.clear();
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    enabled,
    documentMarkdownRecoverySignature,
    projectRootPath,
    restoreFromWorkspace,
    sessionId,
    setCanvasState,
    setChatMessages,
    updateCurrentImageWorkbenchState,
  ]);
}
