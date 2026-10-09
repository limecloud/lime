import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  LAST_PROJECT_ID_KEY,
  loadPersistedProjectId,
} from "@/components/agent/chat/hooks/agentProjectStorage";
import { resolveWorkspaceAgentPreferences } from "@/components/agent/chat/hooks/agentChatStorage";
import { Button } from "@/components/ui/button";
import { isAppServerBridgeAvailable } from "@/lib/api/appServerBridgeAvailability";
import {
  scheduledTasksApi,
  subscribeScheduledTaskNotifications,
  type ScheduledTask,
  type ScheduledTaskRunSummary,
  type ScheduledTaskSummary,
} from "@/lib/api/scheduledTasks";
import type { Page, PageParams, ScheduledTasksPageParams } from "@/types/page";
import { ScheduledTaskDetails } from "./ScheduledTaskDetails";
import { ScheduledTaskDialog } from "./ScheduledTaskDialog";
import { ScheduledTaskList } from "./ScheduledTaskList";
import {
  buildScheduledTaskCreateRequest,
  buildScheduledTaskUpdateRequest,
  defaultScheduledTaskForm,
  filterScheduledTasks,
  isScheduledTaskModelRoute,
  scheduledTaskToForm,
  validateScheduledTaskForm,
  type ScheduledTaskFilter,
  type ScheduledTaskFormState,
} from "./scheduledTaskViewModel";

interface ScheduledTasksPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  pageParams?: ScheduledTasksPageParams;
}

type EditorMode = "create" | "edit" | null;

export function ScheduledTasksPage({
  onNavigate,
  pageParams,
}: ScheduledTasksPageProps) {
  const { t, i18n } = useTranslation("workspace");
  const [tasks, setTasks] = useState<ScheduledTaskSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    pageParams?.selectedTaskId ?? null,
  );
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const selectedIdRef = useRef(selectedId);
  const [runs, setRuns] = useState<ScheduledTaskRunSummary[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ScheduledTaskFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [form, setForm] = useState<ScheduledTaskFormState>(() =>
    defaultScheduledTaskForm(),
  );
  const currentProjectId =
    pageParams?.projectId?.trim() ||
    loadPersistedProjectId(LAST_PROJECT_ID_KEY) ||
    "";

  const filteredTasks = useMemo(
    () => filterScheduledTasks(tasks, query, filter),
    [filter, query, tasks],
  );

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await scheduledTasksApi.list({ limit: 200 });
      setTasks(response.items);
      setSelectedId((current) => {
        if (current && response.items.some((item) => item.id === current)) {
          return current;
        }
        return null;
      });
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTask = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      setLoadingRuns(true);
      try {
        const [task, history] = await Promise.all([
          scheduledTasksApi.read(id),
          scheduledTasksApi.listRuns(id),
        ]);
        if (!task) {
          throw new Error(t("scheduledTasks.error.notFound"));
        }
        setSelectedTask(task);
        setRuns(history);
      } catch (error) {
        toast.error(
          t("scheduledTasks.error.detail", { message: errorMessage(error) }),
        );
        setSelectedTask(null);
        setRuns([]);
      } finally {
        setLoadingDetail(false);
        setLoadingRuns(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTask(null);
      setRuns([]);
      return;
    }
    void loadTask(selectedId);
  }, [loadTask, selectedId]);

  useEffect(() => {
    let disposed = false;
    let refreshQueued = false;
    const detailTaskIds = new Set<string>();

    const queueRefresh = (taskId: string, includeDetail: boolean) => {
      if (includeDetail) {
        detailTaskIds.add(taskId);
      }
      if (refreshQueued) {
        return;
      }
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        if (disposed) {
          return;
        }
        const selectedTaskId = selectedIdRef.current;
        const shouldLoadDetail = Boolean(
          selectedTaskId && detailTaskIds.has(selectedTaskId),
        );
        detailTaskIds.clear();
        void Promise.all([
          loadTasks(),
          ...(selectedTaskId && shouldLoadDetail
            ? [loadTask(selectedTaskId)]
            : []),
        ]);
      });
    };

    const unsubscribe = subscribeScheduledTaskNotifications(
      {
        onChanged: ({ change, taskId }) => {
          if (change === "deleted" && selectedIdRef.current === taskId) {
            selectedIdRef.current = null;
            setSelectedId(null);
            setSelectedTask(null);
            setRuns([]);
            queueRefresh(taskId, false);
            return;
          }
          queueRefresh(taskId, selectedIdRef.current === taskId);
        },
        onRunUpdated: ({ taskId }) => {
          queueRefresh(taskId, selectedIdRef.current === taskId);
        },
      },
      { isBridgeAvailable: isAppServerBridgeAvailable },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [loadTask, loadTasks]);

  const startCreate = useCallback(
    (preset?: "daily" | "weekly" | "monitor") => {
      const next = defaultScheduledTaskForm();
      const currentModel = resolveWorkspaceAgentPreferences(currentProjectId);
      if (currentModel.providerType.trim() && currentModel.model.trim()) {
        next.modelProviderId = currentModel.providerType.trim();
        next.modelId = currentModel.model.trim();
      }
      if (preset === "daily") {
        next.title = t("scheduledTasks.template.daily.title");
        next.prompt = t("scheduledTasks.template.daily.prompt");
        next.scheduleType = "weekdays";
        next.time = "08:30";
      } else if (preset === "weekly") {
        next.title = t("scheduledTasks.template.weekly.title");
        next.prompt = t("scheduledTasks.template.weekly.prompt");
        next.scheduleType = "weekly";
        next.days = ["FR"];
        next.time = "16:00";
      } else if (preset === "monitor") {
        next.title = t("scheduledTasks.template.monitor.title");
        next.prompt = t("scheduledTasks.template.monitor.prompt");
        next.scheduleType = "hourly";
        next.intervalHours = 4;
        next.time = "00:00";
      }
      next.projectId = currentProjectId;
      next.sourceThreadId = pageParams?.threadId ?? "";
      setForm(next);
      setEditorMode("create");
    },
    [currentProjectId, pageParams?.threadId, t],
  );

  const startEdit = useCallback(() => {
    if (!selectedTask) return;
    setForm(scheduledTaskFormWithCurrentModel(selectedTask, currentProjectId));
    setEditorMode("edit");
  }, [currentProjectId, selectedTask]);

  const createWithLime = useCallback(() => {
    onNavigate?.("agent", {
      agentEntry: "claw",
      projectId: pageParams?.projectId,
      initialUserPrompt: t("scheduledTasks.createWithLime.prompt"),
      initialSessionName: t("scheduledTasks.createWithLime.sessionName"),
      entryBannerMessage: t("scheduledTasks.createWithLime.banner"),
      autoRunInitialPromptOnMount: false,
    });
  }, [onNavigate, pageParams?.projectId, t]);

  const saveTask = useCallback(
    async (nextForm: ScheduledTaskFormState = form) => {
      const normalizedForm = nextForm.title.trim()
        ? nextForm
        : {
            ...nextForm,
            title:
              nextForm.prompt.trim().split(/\r?\n/, 1)[0]?.slice(0, 80) ||
              nextForm.title,
          };
      const errors = validateScheduledTaskForm(normalizedForm);
      if (Object.keys(errors).length) {
        toast.error(t("scheduledTasks.editor.validation.fix"));
        return;
      }
      setBusyAction("save");
      try {
        const task =
          editorMode === "edit" && selectedTask
            ? await scheduledTasksApi.update(
                selectedTask.id,
                buildScheduledTaskUpdateRequest(
                  normalizedForm,
                  selectedTask.updatedAt,
                ),
              )
            : await scheduledTasksApi.create(
                buildScheduledTaskCreateRequest(normalizedForm),
              );
        setEditorMode(null);
        setSelectedId(task.id);
        setSelectedTask(task);
        toast.success(
          t(
            editorMode === "edit"
              ? "scheduledTasks.toast.updated"
              : "scheduledTasks.toast.created",
          ),
        );
        await loadTasks();
        await loadTask(task.id);
      } catch (error) {
        toast.error(
          t("scheduledTasks.error.save", { message: errorMessage(error) }),
        );
      } finally {
        setBusyAction(null);
      }
    },
    [editorMode, form, loadTask, loadTasks, selectedTask, t],
  );

  const toggleEnabled = useCallback(async () => {
    if (!selectedTask) return;
    setBusyAction("toggle");
    try {
      const task = await scheduledTasksApi.setEnabled(
        selectedTask.id,
        !selectedTask.enabled,
      );
      setSelectedTask(task);
      await loadTasks();
    } catch (error) {
      toast.error(
        t("scheduledTasks.error.toggle", { message: errorMessage(error) }),
      );
    } finally {
      setBusyAction(null);
    }
  }, [loadTasks, selectedTask, t]);

  const runNow = useCallback(async () => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    setBusyAction("run");
    try {
      if (!isScheduledTaskModelRoute(selectedTask.execution.modelId)) {
        const migratedForm = scheduledTaskFormWithCurrentModel(
          selectedTask,
          currentProjectId,
        );
        if (migratedForm.modelId && migratedForm.modelProviderId) {
          const migratedTask = await scheduledTasksApi.update(
            taskId,
            buildScheduledTaskUpdateRequest(
              migratedForm,
              selectedTask.updatedAt,
            ),
          );
          setSelectedTask(migratedTask);
        }
      }
      await scheduledTasksApi.startRun(taskId);
      toast.success(t("scheduledTasks.toast.runStarted"));
    } catch (error) {
      toast.error(
        t("scheduledTasks.error.run", { message: errorMessage(error) }),
      );
    } finally {
      await Promise.all([loadTask(taskId), loadTasks()]);
      setBusyAction(null);
    }
  }, [currentProjectId, loadTask, loadTasks, selectedTask, t]);

  const removeTask = useCallback(async () => {
    const confirmationKey = hasActiveRun(selectedTask, runs)
      ? "scheduledTasks.confirm.deleteRunning"
      : "scheduledTasks.confirm.delete";
    if (
      !selectedTask ||
      !window.confirm(t(confirmationKey, { title: selectedTask.title }))
    ) {
      return;
    }
    setBusyAction("delete");
    try {
      await scheduledTasksApi.remove(selectedTask.id);
      setSelectedId(null);
      setSelectedTask(null);
      toast.success(t("scheduledTasks.toast.deleted"));
      await loadTasks();
    } catch (error) {
      toast.error(
        t("scheduledTasks.error.delete", { message: errorMessage(error) }),
      );
    } finally {
      setBusyAction(null);
    }
  }, [loadTasks, runs, selectedTask, t]);

  const openRun = useCallback(
    (run: ScheduledTaskRunSummary) => {
      if (!run.sessionId) return;
      onNavigate?.("agent", {
        agentEntry: "claw",
        projectId: selectedTask?.execution.projectId ?? undefined,
        initialSessionId: run.sessionId,
        initialSessionName: selectedTask?.title,
      });
    },
    [onNavigate, selectedTask],
  );

  return (
    <div className="lime-workbench-theme-scope flex h-full min-h-0 flex-1 flex-col bg-white">
      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <CalendarClock className="h-9 w-9 text-rose-500" />
          <h2 className="mt-4 text-base font-semibold text-slate-950">
            {t("scheduledTasks.error.loadTitle")}
          </h2>
          <p className="mt-1 max-w-md text-sm text-slate-600">{loadError}</p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => void loadTasks()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("scheduledTasks.action.retry")}
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className={selectedId || editorMode ? "hidden md:flex" : "flex"}>
            <ScheduledTaskList
              tasks={filteredTasks}
              selectedId={selectedId}
              query={query}
              filter={filter}
              locale={i18n.language}
              loading={loading}
              t={t}
              onQueryChange={setQuery}
              onFilterChange={setFilter}
              onSelect={(id) => {
                setEditorMode(null);
                setSelectedId(id);
              }}
              onCreate={() => startCreate()}
              onCreateWithLime={createWithLime}
            />
          </div>
          <main
            className={
              selectedId
                ? "min-h-0 flex-1"
                : "hidden min-h-0 flex-1 md:block"
            }
          >
            {loadingDetail && selectedId ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                {t("scheduledTasks.details.loading")}
              </div>
            ) : selectedTask ? (
              <ScheduledTaskDetails
                task={selectedTask}
                runs={runs}
                loadingRuns={loadingRuns}
                busyAction={busyAction}
                locale={i18n.language}
                t={t}
                onBack={() => setSelectedId(null)}
                onClose={() => setSelectedId(null)}
                onEdit={startEdit}
                onToggleEnabled={() => void toggleEnabled()}
                onRun={() => void runNow()}
                onDelete={() => void removeTask()}
                onOpenRun={openRun}
              />
            ) : (
              <EmptyWorkbench t={t} onCreate={startCreate} />
            )}
          </main>
        </div>
      )}
      <ScheduledTaskDialog
        open={editorMode !== null}
        mode={editorMode ?? "create"}
        initialForm={editorMode ? form : null}
        saving={busyAction === "save"}
        onOpenChange={(open) => {
          if (!open) {
            setEditorMode(null);
          }
        }}
        onSubmit={async (nextForm) => {
          setForm(nextForm);
          await saveTask(nextForm);
        }}
      />
    </div>
  );
}

function scheduledTaskFormWithCurrentModel(
  task: ScheduledTask,
  fallbackProjectId: string,
): ScheduledTaskFormState {
  const form = scheduledTaskToForm(task);
  if (isScheduledTaskModelRoute(task.execution.modelId)) {
    return form;
  }
  const projectId = task.execution.projectId?.trim() || fallbackProjectId;
  const currentModel = resolveWorkspaceAgentPreferences(projectId);
  if (currentModel.providerType.trim() && currentModel.model.trim()) {
    form.modelProviderId = currentModel.providerType.trim();
    form.modelId = currentModel.model.trim();
  }
  return form;
}

function EmptyWorkbench({
  t,
  onCreate,
}: {
  t: TFunction<"workspace">;
  onCreate: (preset?: "daily" | "weekly" | "monitor") => void;
}) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-md text-center">
        <CalendarClock className="mx-auto h-10 w-10 text-slate-400" />
        <h2 className="mt-4 text-base font-semibold text-slate-900">
          {t("scheduledTasks.empty.workbenchTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">
          {t("scheduledTasks.empty.workbenchDescription")}
        </p>
        <Button
          size="sm"
          className="mt-6 rounded-full bg-slate-900 px-4 text-xs hover:bg-slate-800"
          onClick={() => onCreate()}
        >
          {t("scheduledTasks.sidebar.newTask", "新建任务")}
        </Button>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasActiveRun(
  task: ScheduledTask | null,
  runs: ScheduledTaskRunSummary[],
): boolean {
  return [task?.lastRunSummary, ...runs].some(
    (run) => run?.status === "queued" || run?.status === "running",
  );
}
