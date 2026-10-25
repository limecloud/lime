import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createInitialCanvasState,
  createInitialDocumentState,
  type CanvasStateUnion,
} from "@/components/workspace/canvas/canvasUtils";
import {
  getContent,
  getGeneralWorkbenchDocumentState,
  getProject,
  type Project,
} from "@/lib/api/project";
import { getProjectMemory, type ProjectMemory } from "@/lib/api/projectMemory";
import { logAgentDebug } from "@/lib/agentDebug";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import type { LayoutMode, ThemeType } from "@/lib/workspace/workbenchContract";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";
import {
  normalizeInitialTheme,
  projectTypeToTheme,
} from "../agentChatWorkspaceShared";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import {
  applyBackendGeneralWorkbenchDocumentState,
  isCorruptedGeneralWorkbenchDocumentContent,
  readPersistedGeneralWorkbenchDocument,
  serializeCanvasStateForSync,
} from "./generalWorkbenchHelpers";
import { SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS } from "./agentChatWorkspaceHelpers";

interface UseWorkspaceProjectContentRuntimeParams {
  projectId?: string | null;
  contentId?: string | null;
  externalProjectId?: string | null;
  lockTheme: boolean;
  initialTheme?: string;
  normalizedEntryTheme: ThemeType;
  shouldBootstrapCanvasOnEntry: boolean;
  shouldDeferWorkspaceAuxiliaryLoads: boolean;
  shouldPreserveEntryThemeOnHome: boolean;
  deferredWorkspaceAuxiliaryLoadMs?: number;
  resetProjectSelection: () => void;
  setActiveTheme: Dispatch<SetStateAction<string>>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
}

export function useWorkspaceProjectContentRuntime({
  projectId,
  contentId,
  externalProjectId,
  lockTheme,
  initialTheme,
  normalizedEntryTheme,
  shouldBootstrapCanvasOnEntry,
  shouldDeferWorkspaceAuxiliaryLoads,
  shouldPreserveEntryThemeOnHome,
  deferredWorkspaceAuxiliaryLoadMs,
  resetProjectSelection,
  setActiveTheme,
  setLayoutMode,
}: UseWorkspaceProjectContentRuntimeParams) {
  const [project, setProject] = useState<Project | null>(null);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(
    null,
  );
  const [isInitialContentLoading, setIsInitialContentLoading] = useState(
    shouldBootstrapCanvasOnEntry,
  );
  const [initialContentLoadError, setInitialContentLoadError] = useState<
    string | null
  >(null);
  const [canvasState, setCanvasState] = useState<CanvasStateUnion | null>(
    () => {
      if (!shouldBootstrapCanvasOnEntry) {
        return null;
      }

      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    },
  );
  const [documentVersionStatusMap, setDocumentVersionStatusMap] = useState<
    Record<string, TopicBranchStatus>
  >({});
  const contentMetadataRef = useRef<Record<string, unknown>>({});
  const persistedWorkbenchSnapshotRef = useRef("");
  const lastCanvasSyncRequestRef = useRef<{
    contentId: string;
    body: string;
  } | null>(null);

  useEffect(() => {
    persistedWorkbenchSnapshotRef.current = "";
    contentMetadataRef.current = {};
    lastCanvasSyncRequestRef.current = null;
    if (!contentId) {
      setDocumentVersionStatusMap({});
    }
  }, [contentId]);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      const startedAt = Date.now();
      logAgentDebug("LocalConversationPage", "loadData.start", {
        contentId: contentId ?? null,
        lockTheme,
        projectId: projectId ?? null,
      });

      if (contentId) {
        setIsInitialContentLoading(true);
        setInitialContentLoadError(null);
      } else {
        setIsInitialContentLoading(false);
        setInitialContentLoadError(null);
      }

      if (!projectId) {
        if (cancelled) {
          return;
        }
        logAgentDebug("LocalConversationPage", "loadData.noProject", {
          contentId: contentId ?? null,
          durationMs: Date.now() - startedAt,
        });
        setProject(null);
        setProjectMemory(null);
        setIsInitialContentLoading(false);
        return;
      }

      try {
        const loadedProject = await getProject(projectId);
        if (!loadedProject) {
          if (cancelled) {
            return;
          }
          logAgentDebug(
            "LocalConversationPage",
            "loadData.projectMissing",
            {
              contentId: contentId ?? null,
              durationMs: Date.now() - startedAt,
              projectId,
            },
            { level: "warn" },
          );
          setProject(null);
          setProjectMemory(null);
          if (!externalProjectId) {
            resetProjectSelection();
          }
          if (contentId) {
            setInitialContentLoadError("当前项目不存在或已被删除");
          }
          return;
        }

        if (cancelled) {
          return;
        }

        setProject(loadedProject);
        const theme = projectTypeToTheme(loadedProject.workspaceType);
        logAgentDebug("LocalConversationPage", "loadData.projectLoaded", {
          durationMs: Date.now() - startedAt,
          projectId: loadedProject.id,
          theme,
          workspaceType: loadedProject.workspaceType,
        });
        if (!shouldPreserveEntryThemeOnHome && (!lockTheme || !initialTheme)) {
          setActiveTheme(theme);
        }

        if (!shouldDeferWorkspaceAuxiliaryLoads) {
          const memory = await getProjectMemory(projectId);
          if (cancelled) {
            return;
          }
          setProjectMemory(memory);
          logAgentDebug("LocalConversationPage", "loadData.memoryLoaded", {
            charactersCount: memory?.characters?.length ?? 0,
            durationMs: Date.now() - startedAt,
            hasOutline: Boolean(memory?.outline?.length),
            projectId,
          });
        } else {
          setProjectMemory(null);
          logAgentDebug("LocalConversationPage", "loadData.memoryDeferred", {
            durationMs: Date.now() - startedAt,
            projectId,
          });
        }

        if (!contentId) {
          logAgentDebug("LocalConversationPage", "loadData.projectOnlyComplete", {
            durationMs: Date.now() - startedAt,
            projectId,
          });
          return;
        }

        const content = await getContent(contentId);
        if (cancelled) {
          return;
        }

        if (!content) {
          logAgentDebug(
            "LocalConversationPage",
            "loadData.contentMissing",
            {
              contentId,
              durationMs: Date.now() - startedAt,
              projectId,
            },
            { level: "warn" },
          );
          setInitialContentLoadError("文稿不存在或读取失败");
          return;
        }

        logAgentDebug("LocalConversationPage", "loadData.contentLoaded", {
          bodyLength: content.body?.length ?? 0,
          contentId: content.id,
          durationMs: Date.now() - startedAt,
          projectId,
        });

        contentMetadataRef.current = content.metadata || {};
        const canvasTheme = (
          lockTheme && initialTheme
            ? normalizeInitialTheme(initialTheme)
            : theme
        ) as ThemeType;
        const rawBody = content.body || "";
        const sanitizedBody = isCorruptedGeneralWorkbenchDocumentContent(
          rawBody,
        )
          ? ""
          : rawBody;

        if (rawBody && sanitizedBody !== rawBody) {
          setInitialContentLoadError(
            "当前文稿未生成有效主稿，请重新生成或稍后重试",
          );
        } else {
          setInitialContentLoadError(null);
        }

        let initialState =
          createInitialCanvasState(canvasTheme, sanitizedBody) ||
          createInitialDocumentState(sanitizedBody);

        if (initialState.type === "document") {
          const backendDocumentState = await getGeneralWorkbenchDocumentState(
            content.id,
          ).catch((error) => {
            console.warn(
              "[LocalConversationPage] 读取工作区文稿版本状态失败，降级为 metadata 解析:",
              error,
            );
            logAgentDebug(
              "LocalConversationPage",
              "loadData.documentStateError",
              {
                contentId: content.id,
                durationMs: Date.now() - startedAt,
                error,
              },
              { level: "warn" },
            );
            return null;
          });
          logAgentDebug("LocalConversationPage", "loadData.documentStateLoaded", {
            contentId: content.id,
            durationMs: Date.now() - startedAt,
            hasBackendDocumentState: Boolean(backendDocumentState),
          });
          const backendApplied = backendDocumentState
            ? applyBackendGeneralWorkbenchDocumentState(
                initialState,
                backendDocumentState,
                sanitizedBody,
              )
            : null;

          if (backendApplied) {
            initialState = backendApplied.state;
            setDocumentVersionStatusMap(backendApplied.statusMap);
          } else {
            const persisted = readPersistedGeneralWorkbenchDocument(
              content.metadata,
            );
            if (persisted) {
              const restoredVersions = persisted.versions.map((version) =>
                version.id === persisted.currentVersionId
                  ? { ...version, content: sanitizedBody || version.content }
                  : version,
              );
              const currentVersion =
                restoredVersions.find(
                  (version) => version.id === persisted.currentVersionId,
                ) || restoredVersions[restoredVersions.length - 1];
              initialState = {
                ...initialState,
                versions: restoredVersions,
                currentVersionId: currentVersion.id,
                content: currentVersion.content,
              };
              setDocumentVersionStatusMap(persisted.versionStatusMap);
            } else {
              setDocumentVersionStatusMap({});
            }
          }
        } else {
          setDocumentVersionStatusMap({});
        }

        lastCanvasSyncRequestRef.current = {
          contentId: content.id,
          body: serializeCanvasStateForSync(initialState),
        };
        setCanvasState(initialState);
        setLayoutMode("canvas");
        logAgentDebug("LocalConversationPage", "loadData.complete", {
          contentId: content.id,
          durationMs: Date.now() - startedAt,
          initialStateType: initialState.type,
          projectId,
        });
      } catch (error) {
        console.error("[LocalConversationPage] 加载项目或文稿失败:", error);
        logAgentDebug(
          "LocalConversationPage",
          "loadData.error",
          {
            contentId: contentId ?? null,
            durationMs: Date.now() - startedAt,
            error,
            projectId: projectId ?? null,
          },
          { level: "error" },
        );
        if (!cancelled && contentId) {
          setInitialContentLoadError("文稿加载失败，请稍后重试");
        }
      } finally {
        if (!cancelled) {
          setIsInitialContentLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [
    contentId,
    externalProjectId,
    initialTheme,
    lockTheme,
    projectId,
    resetProjectSelection,
    setActiveTheme,
    setLayoutMode,
    shouldDeferWorkspaceAuxiliaryLoads,
    shouldPreserveEntryThemeOnHome,
  ]);

  useEffect(() => {
    if (!shouldDeferWorkspaceAuxiliaryLoads) {
      return;
    }

    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      setProjectMemory(null);
      return;
    }

    let cancelled = false;
    const cancelDeferredLoad = scheduleMinimumDelayIdleTask(
      () => {
        const startedAt = Date.now();
        logAgentDebug("LocalConversationPage", "loadDeferredMemory.start", {
          projectId: normalizedProjectId,
        });
        void getProjectMemory(normalizedProjectId)
          .then((memory) => {
            if (cancelled) {
              return;
            }
            setProjectMemory(memory);
            logAgentDebug("LocalConversationPage", "loadDeferredMemory.success", {
              charactersCount: memory?.characters?.length ?? 0,
              durationMs: Date.now() - startedAt,
              hasOutline: Boolean(memory?.outline?.length),
              projectId: normalizedProjectId,
            });
          })
          .catch((error) => {
            if (cancelled) {
              return;
            }
            console.warn("[LocalConversationPage] 延后加载项目 Memory 失败:", error);
            logAgentDebug(
              "LocalConversationPage",
              "loadDeferredMemory.error",
              {
                durationMs: Date.now() - startedAt,
                error,
                projectId: normalizedProjectId,
              },
              { level: "warn" },
            );
          });
      },
      {
        minimumDelayMs:
          deferredWorkspaceAuxiliaryLoadMs ??
          SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
        idleTimeoutMs: 1_500,
      },
    );

    return () => {
      cancelled = true;
      cancelDeferredLoad();
    };
  }, [
    deferredWorkspaceAuxiliaryLoadMs,
    projectId,
    shouldDeferWorkspaceAuxiliaryLoads,
  ]);

  useEffect(() => {
    if (!shouldBootstrapCanvasOnEntry) {
      return;
    }

    setLayoutMode("canvas");
    setCanvasState((previous) => {
      if (previous) {
        return previous;
      }

      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    });
  }, [normalizedEntryTheme, setLayoutMode, shouldBootstrapCanvasOnEntry]);

  return {
    project,
    setProject,
    projectMemory,
    setProjectMemory,
    isInitialContentLoading,
    initialContentLoadError,
    canvasState,
    setCanvasState,
    documentVersionStatusMap,
    setDocumentVersionStatusMap,
    contentMetadataRef,
    persistedWorkbenchSnapshotRef,
    lastCanvasSyncRequestRef,
  };
}
