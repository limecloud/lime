import React from "react";
import type { ThreadGoal } from "@limecloud/app-server-client";
import { ChevronDown, Code2, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { revealPathInFinder } from "@/lib/api/fileSystem";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import {
  checkoutProjectGitBranch,
  createProjectGitWorktree,
  createProjectGitBranch,
  readProjectGitDiff,
  readProjectGitStatus,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";
import { ensureProjectWorkspace } from "@/lib/api/project";
import { cn } from "@/lib/utils";
import { agentText } from "./harnessPanelText";
import type { AgentSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import type {
  AgentRuntimeThreadReadModel,
  AgentTodoItem,
} from "@/lib/api/agentRuntime/sessionTypes";
import type { CanonicalChildThreadSummary } from "../projection/canonicalChildThreadSummary";
import type {
  ActionRequired,
  AgentThreadItem,
  ConfirmResponse,
  Message,
} from "../types";
import type { GeneralWorkbenchTaskRailContextInput } from "./generalWorkbenchTaskRailViewModel";
import type { SidebarActivityLog } from "./generalWorkbenchWorkflowData";
import type { GeneralWorkbenchWorkflowStepInput } from "./generalWorkbenchWorkflowPanelViewModel";
import type { GeneralWorkbenchCreationTaskEvent } from "./generalWorkbenchWorkflowData";
import { TaskCenterEnvironmentPanel } from "./TaskCenterEnvironmentPanel";
import { useThreadEnvironmentLifecycleStatus } from "../hooks/useThreadEnvironmentLifecycleStatus";
import { TaskCenterLocationPanel } from "./TaskCenterLocationPanel";
import { markProjectOpened } from "../hooks/agentProjectStorage";
import { hydrateAgentPlanState } from "../utils/planState";

interface TaskCenterUtilityToolbarProps {
  projectRootPath?: string | null;
  onProjectChange?: (projectId: string | null) => void;
  taskRail?: {
    sessionId?: string | null;
    workflowSteps: GeneralWorkbenchWorkflowStepInput[];
    messages: Message[];
    activityLogs?: SidebarActivityLog[];
    creationTaskEvents?: GeneralWorkbenchCreationTaskEvent[];
    pendingActions?: readonly ActionRequired[];
    submittedActionsInFlight?: readonly ActionRequired[];
    threadItems?: readonly AgentThreadItem[];
    todoItems?: readonly AgentTodoItem[];
    threadGoal?: ThreadGoal | null;
    threadRead?: AgentRuntimeThreadReadModel | null;
    executionRuntime?: AgentSessionExecutionRuntime | null;
    canonicalChildren?: CanonicalChildThreadSummary[];
    context?: GeneralWorkbenchTaskRailContextInput;
    providerType?: string | null;
    model?: string | null;
    accessMode?: GeneralWorkbenchTaskRailContextInput["accessMode"];
    reasoningEffort?: string | null;
    workspaceRootPath?: string | null;
    onOpenOutput?: (path: string) => void | Promise<void>;
    onRespondToAction?: (response: ConfirmResponse) => void | Promise<void>;
  };
  placement?: "task-strip" | "workbench-header";
  sidePanelLauncher?: React.ReactNode;
}

const taskCenterToolButtonClassName =
  "inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-[12px] border border-[color:var(--lime-chrome-border)] bg-[color:var(--lime-surface)] px-2 leading-none text-[color:var(--lime-chrome-text)] shadow-none transition-[background-color,color] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)]";

const taskCenterIconOnlyButtonClassName =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[12px] border border-transparent bg-transparent leading-none text-[color:var(--lime-chrome-muted)] shadow-none transition-[background-color,color] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)] disabled:cursor-not-allowed disabled:opacity-50";

const taskCenterToolGroupClassName =
  "inline-flex max-w-full shrink-0 items-center gap-1 overflow-visible";

function VisualStudioCodeIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded-[5px] bg-[#f5fbff] text-[#0a84ff]",
        className,
      )}
    >
      <Code2 className="h-3 w-3" strokeWidth={2.3} />
    </span>
  );
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveWorktreeName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1)?.trim() || "";
}

function summarizeGitPatch(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function useProjectGitStatus(rootPath?: string | null) {
  const normalizedRootPath = rootPath?.trim() || null;
  const [status, setStatus] = React.useState<ProjectGitStatus | null>(null);
  const [changeSummary, setChangeSummary] = React.useState<{
    additions: number;
    deletions: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    if (!normalizedRootPath) {
      setStatus(null);
      setChangeSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setChangeSummary(null);
    try {
      const nextStatus = await readProjectGitStatus(normalizedRootPath);
      if (requestId === requestIdRef.current) {
        setStatus(nextStatus);
      }
    } catch (readError) {
      if (requestId === requestIdRef.current) {
        setStatus(null);
        setError(extractErrorMessage(readError));
      }
    }
    try {
      const diff = await readProjectGitDiff(normalizedRootPath);
      if (requestId === requestIdRef.current) {
        setChangeSummary(summarizeGitPatch(diff.patch));
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setChangeSummary(null);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [normalizedRootPath]);

  React.useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { status, changeSummary, loading, error, refresh };
}

export function TaskCenterUtilityToolbar({
  projectRootPath,
  onProjectChange,
  taskRail,
  placement = "task-strip",
  sidePanelLauncher,
}: TaskCenterUtilityToolbarProps) {
  const { t } = useTranslation("agent");
  const normalizedProjectRootPath = projectRootPath?.trim() || null;
  const [environmentVisited, setEnvironmentVisited] = React.useState(false);
  const [environmentOpen, setEnvironmentOpen] = React.useState(false);
  const environmentLifecycle = useThreadEnvironmentLifecycleStatus({
    threadId: taskRail?.threadRead?.thread_id ?? taskRail?.sessionId,
    threadRead: taskRail?.threadRead,
  });
  const autoRevealedPlanKeyRef = React.useRef<string | null>(null);
  const { status, changeSummary, loading, error, refresh } =
    useProjectGitStatus(environmentVisited ? normalizedProjectRootPath : null);
  const isWorkbenchHeaderPlacement = placement === "workbench-header";
  const toolGroupClassName = cn(taskCenterToolGroupClassName, "flex-nowrap");

  const handleOpenLocalLocation = React.useCallback(async () => {
    if (!normalizedProjectRootPath) {
      toast.error(
        agentText(
          "agentChat.navbar.appSwitcher.toast.noProjectRoot",
          "当前项目缺少本地目录",
        ),
      );
      return;
    }

    try {
      await revealPathInFinder(normalizedProjectRootPath);
    } catch (openError) {
      toast.error(
        agentText(
          "agentChat.navbar.appSwitcher.toast.openFailed",
          "打开项目失败：{{message}}",
          { message: extractErrorMessage(openError) },
        ),
      );
    }
  }, [normalizedProjectRootPath]);

  const handleOpenCodexWeb = React.useCallback(async () => {
    try {
      await openExternalUrlWithSystemBrowser("https://chatgpt.com/codex");
    } catch (openError) {
      toast.error(
        agentText(
          "agentChat.navbar.appSwitcher.toast.codexWebFailed",
          "打开 Codex web 失败：{{message}}",
          { message: extractErrorMessage(openError) },
        ),
      );
    }
  }, []);

  const handleCreateWorktree = React.useCallback(async () => {
    if (!normalizedProjectRootPath || !onProjectChange) {
      return;
    }
    try {
      const worktree = await createProjectGitWorktree(
        normalizedProjectRootPath,
        undefined,
        status?.currentBranch ?? undefined,
      );
      const project = await ensureProjectWorkspace({
        name: resolveWorktreeName(worktree.worktreePath) || "Worktree",
        rootPath: worktree.worktreePath,
        workspaceType: "general",
      });
      markProjectOpened(project.id);
      onProjectChange(project.id);
      toast.success(
        agentText(
          "agentChat.navbar.appSwitcher.worktreeCreated",
          "工作树已创建",
        ),
      );
    } catch (createError) {
      toast.error(
        agentText(
          "agentChat.navbar.appSwitcher.worktreeCreateFailed",
          "创建工作树失败：{{message}}",
          { message: extractErrorMessage(createError) },
        ),
      );
    }
  }, [normalizedProjectRootPath, onProjectChange, status?.currentBranch]);

  const branchLabel =
    status?.currentBranch?.trim() ||
    agentText("agentChat.navbar.environment.branchFallback", "无分支");
  const changeCount = status?.hasGitRepository
    ? status.uncommittedFileCount
    : 0;
  const handleCheckoutBranch = React.useCallback(
    async (branch: string) => {
      if (!normalizedProjectRootPath || !status?.hasGitRepository) {
        return;
      }
      try {
        await checkoutProjectGitBranch(normalizedProjectRootPath, branch);
        await refresh();
      } catch (checkoutError) {
        toast.error(
          agentText(
            "agentChat.navbar.environment.branchSwitchFailed",
            "切换分支失败：{{message}}",
            { message: extractErrorMessage(checkoutError) },
          ),
        );
      }
    },
    [normalizedProjectRootPath, refresh, status?.hasGitRepository],
  );
  const handleCreateBranch = React.useCallback(
    async (branch: string) => {
      if (!normalizedProjectRootPath || !status?.hasGitRepository) {
        return;
      }
      try {
        await createProjectGitBranch(normalizedProjectRootPath, branch);
        await refresh();
      } catch (createError) {
        toast.error(
          agentText(
            "agentChat.navbar.environment.branchCreateFailed",
            "创建分支失败：{{message}}",
            { message: extractErrorMessage(createError) },
          ),
        );
      }
    },
    [normalizedProjectRootPath, refresh, status?.hasGitRepository],
  );
  const environmentStatusLabel = loading
    ? agentText("agentChat.navbar.environment.loading", "读取中")
    : error
      ? agentText("agentChat.navbar.environment.failed", "读取失败")
      : !normalizedProjectRootPath
        ? agentText(
            "agentChat.navbar.environment.noProjectRoot",
            "未选择项目目录",
          )
        : status?.hasGitRepository
          ? agentText(
              "agentChat.navbar.environment.uncommittedFiles",
              "{{count}} 个文件",
              { count: changeCount },
            )
          : agentText("agentChat.navbar.environment.noGit", "非 Git 项目");
  const taskRailTranslate = React.useCallback(
    (key: string, options?: Record<string, unknown>) =>
      (
        t as (nextKey: string, nextOptions?: Record<string, unknown>) => unknown
      )(key, options),
    [t],
  );
  React.useEffect(() => {
    if (environmentOpen) {
      return;
    }
    const todoPlanKey = (taskRail?.todoItems ?? [])
      .filter((item) => item.content.trim().length > 0)
      .map((item) => `${item.content.trim()}\u0000${item.status ?? ""}`)
      .join("\u0001");
    const revisionId = taskRail?.threadItems?.length
      ? hydrateAgentPlanState({ threadItems: taskRail.threadItems }).revisionId
      : null;
    const planKey = todoPlanKey
      ? `todo:${todoPlanKey}`
      : revisionId
        ? `revision:${revisionId}`
        : null;
    if (!planKey || autoRevealedPlanKeyRef.current === planKey) {
      return;
    }
    autoRevealedPlanKeyRef.current = planKey;
    setEnvironmentOpen(true);
    setEnvironmentVisited(true);
  }, [environmentOpen, taskRail?.threadItems, taskRail?.todoItems]);
  return (
    <div
      className={cn(
        "ml-auto flex min-w-0 items-center justify-end gap-x-2 gap-y-1 overflow-visible",
        isWorkbenchHeaderPlacement
          ? "min-h-8 shrink-0 flex-nowrap"
          : "min-h-9 shrink-0 flex-nowrap",
      )}
      data-testid="task-center-utility-toolbar"
      data-placement={placement}
    >
      <div
        className={toolGroupClassName}
        data-testid="task-center-tool-group-app"
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(taskCenterToolButtonClassName, "gap-1.5")}
              aria-label={agentText(
                "agentChat.navbar.appSwitcher.open",
                "打开应用切换",
              )}
              title={agentText(
                "agentChat.navbar.appSwitcher.open",
                "打开应用切换",
              )}
              data-testid="task-center-app-switcher-trigger"
            >
              <VisualStudioCodeIcon />
              <span>
                {agentText("agentChat.navbar.appSwitcher.open", "打开位置")}
              </span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <TaskCenterLocationPanel
            canOpenLocal={Boolean(normalizedProjectRootPath)}
            onOpenLocal={() => void handleOpenLocalLocation()}
            onOpenCodexWeb={() => void handleOpenCodexWeb()}
            canCreateWorktree={Boolean(
              normalizedProjectRootPath && onProjectChange,
            )}
            onCreateWorktree={() => void handleCreateWorktree()}
            translate={taskRailTranslate}
          />
        </Popover>
      </div>

      <div
        className={toolGroupClassName}
        data-testid="task-center-tool-group-environment"
      >
        <Popover
          open={environmentOpen}
          onOpenChange={(open) => {
            setEnvironmentOpen(open);
            if (open) {
              setEnvironmentVisited(true);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(taskCenterIconOnlyButtonClassName, "relative")}
              aria-label={agentText(
                "agentChat.navbar.environment.open",
                "打开环境信息",
              )}
              title={agentText(
                "agentChat.navbar.environment.open",
                "打开环境信息",
              )}
              data-testid="task-center-environment-trigger"
              data-environment-lifecycle={
                environmentLifecycle.some(
                  (environment) => environment.status === "disconnected",
                )
                  ? "disconnected"
                  : environmentLifecycle.some(
                        (environment) => environment.status === "pending",
                      )
                    ? "pending"
                    : environmentLifecycle.length > 0
                      ? "connected"
                      : "local"
              }
            >
              <SlidersHorizontal className="h-4 w-4" />
              {environmentLifecycle.length > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-[color:var(--lime-surface)]",
                    environmentLifecycle.some(
                      (environment) => environment.status === "disconnected",
                    )
                      ? "bg-rose-500"
                      : environmentLifecycle.some(
                            (environment) => environment.status === "pending",
                          )
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                />
              ) : null}
            </Button>
          </PopoverTrigger>
          <TaskCenterEnvironmentPanel
            normalizedProjectRootPath={normalizedProjectRootPath}
            status={status}
            environmentStatusLabel={environmentStatusLabel}
            lifecycleStatuses={environmentLifecycle}
            changeSummary={changeSummary}
            branchLabel={branchLabel}
            changeCount={changeCount}
            onCheckoutBranch={handleCheckoutBranch}
            onCreateBranch={handleCreateBranch}
            translate={taskRailTranslate}
          />
        </Popover>
      </div>

      {sidePanelLauncher}
    </div>
  );
}
