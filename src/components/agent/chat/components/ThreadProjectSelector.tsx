import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useThreadProjectDirectory } from "../hooks/useThreadProjectDirectory";

interface ThreadProjectSelectorProps {
  threadId?: string | null;
  workspaceName?: string | null;
  workspaceRootPath?: string | null;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
}


function ThreadProjectFolderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0"
      focusable="false"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.59668 2.19995C5.95191 2.20003 6.29915 2.30563 6.59473 2.50269L7.92285 3.38745C8.06511 3.48229 8.23235 3.53288 8.40332 3.53296H12.2002C13.452 3.53306 14.4668 4.54876 14.4668 5.80054V11.4666C14.4668 12.7551 13.4222 13.8003 12.1338 13.8005H3.86621C2.57776 13.8003 1.5332 12.7551 1.5332 11.4666V4.53296C1.53345 3.24466 2.57791 2.2002 3.86621 2.19995H5.59668ZM13.5332 7.80054H2.4668V11.4666C2.4668 12.2396 3.09322 12.8667 3.86621 12.8669H12.1338C12.9068 12.8667 13.5332 12.2396 13.5332 11.4666V7.80054ZM2.4668 6.86694H13.5332V5.80054C13.5332 5.06422 12.9365 4.46666 12.2002 4.46655H8.40332C8.04816 4.46648 7.70081 4.36177 7.40527 4.16479L6.07715 3.27905C5.93489 3.18421 5.76765 3.13362 5.59668 3.13354H3.86621C3.09338 3.13379 2.46704 3.76012 2.4668 4.53296V6.86694Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ThreadProjectSelector({
  threadId,
  workspaceName,
  workspaceRootPath,
  compact = false,
  iconOnly = false,
  className,
}: ThreadProjectSelectorProps) {
  const { t } = useTranslation("agent");
  const [open, setOpen] = useState(false);
  const directory = useThreadProjectDirectory({ threadId });
  const selectedProject = useMemo(
    () =>
      directory.projects.find(
        (project) => project.id === directory.projectId,
      ) ?? null,
    [directory.projectId, directory.projects],
  );
  const hasWorkspaceRoot = Boolean(workspaceRootPath?.trim());
  const currentLabel = selectedProject?.name
    ? selectedProject.name
    : directory.projectId
      ? t("agentChat.threadProjectSelector.assigned", "已归入项目")
      : t("agentChat.threadProjectSelector.unassigned", "未归入项目");
  const buttonLabel = t(
    "agentChat.threadProjectSelector.open",
    "对话项目：{{project}}",
    { project: currentLabel },
  );
  const errorLabel = t(
    "agentChat.threadProjectSelector.loadFailed",
    "项目目录暂时不可用",
  );

  if (!threadId?.trim()) {
    return null;
  }

  const runAction = (action: () => Promise<void>) => {
    void action().catch(() => undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            iconOnly
              ? "h-7 w-7 shrink-0 rounded-[10px] border border-transparent p-0 text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]"
              : "h-8 min-w-0 max-w-[220px] shrink-0 gap-1.5 rounded-[14px] border border-transparent px-2.5 text-xs font-medium text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text)]",
            compact && !iconOnly && "max-w-[180px]",
            className,
          )}
          aria-label={buttonLabel}
          title={buttonLabel}
          data-testid="thread-project-selector"
          data-thread-project-id={directory.projectId ?? ""}
          disabled={directory.mutating}
        >
          <ThreadProjectFolderIcon />
          {iconOnly ? null : (
            <>
              <span className="min-w-0 truncate">{currentLabel}</span>
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={iconOnly ? "start" : "end"}
        side="bottom"
        sideOffset={8}
        className="w-[min(320px,calc(100vw-24px))] p-2"
        data-testid="thread-project-directory"
      >
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--lime-text-strong)]">
              {t("agentChat.threadProjectSelector.title", "对话项目")}
            </p>
            <p className="truncate text-[11px] text-[color:var(--lime-text-muted)]">
              {t(
                "agentChat.threadProjectSelector.subtitle",
                "当前对话的项目归属",
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-[10px] text-[color:var(--lime-text-muted)]"
            onClick={() => runAction(directory.refresh)}
            aria-label={t(
              "agentChat.threadProjectSelector.refresh",
              "刷新项目目录",
            )}
            title={t("agentChat.threadProjectSelector.refresh", "刷新项目目录")}
            disabled={directory.loading || directory.mutating}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", directory.loading && "animate-spin")}
            />
          </Button>
        </div>

        {directory.error ? (
          <div className="mx-1 mb-2 flex items-center justify-between gap-2 rounded-[10px] border border-[color:var(--lime-danger-border)] bg-[color:var(--lime-danger-surface)] px-2.5 py-2 text-xs text-[color:var(--lime-danger)]">
            <span>{errorLabel}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 rounded-[8px] px-2 text-xs"
              onClick={() => runAction(directory.refresh)}
              disabled={directory.loading || directory.mutating}
            >
              {t("agentChat.threadProjectSelector.retry", "重试")}
            </Button>
          </div>
        ) : null}

        <div className="max-h-[280px] space-y-1 overflow-y-auto">
          <ProjectOption
            active={!directory.projectId}
            disabled={directory.mutating}
            projectId=""
            label={t("agentChat.threadProjectSelector.noProject", "不归入项目")}
            onClick={() =>
              runAction(async () => {
                await directory.assign(null);
                setOpen(false);
              })
            }
          />
          {directory.projects.map((project) => (
            <ProjectOption
              key={project.id}
              active={project.id === directory.projectId}
              disabled={directory.mutating}
              projectId={project.id}
              label={project.name}
              path={project.roots[0]?.path}
              onClick={() =>
                runAction(async () => {
                  await directory.assign(project.id);
                  setOpen(false);
                })
              }
            />
          ))}
        </div>

        {!directory.loading && directory.projects.length === 0 ? (
          <p className="px-2 py-3 text-xs text-[color:var(--lime-text-muted)]">
            {t("agentChat.threadProjectSelector.empty", "项目目录为空")}
          </p>
        ) : null}

        {hasWorkspaceRoot ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-8 w-full justify-start gap-1.5 rounded-[10px] text-xs"
            onClick={() =>
              runAction(async () => {
                await directory.createAndAssign({
                  name:
                    workspaceName?.trim() ||
                    workspaceRootPath
                      ?.split(/[\\/]+/)
                      .filter(Boolean)
                      .at(-1) ||
                    "当前文件夹",
                  rootPath: workspaceRootPath!.trim(),
                });
                setOpen(false);
              })
            }
            disabled={directory.mutating}
            data-testid="thread-project-create-from-workspace"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t(
              "agentChat.threadProjectSelector.createFromWorkspace",
              "将当前文件夹加入项目",
            )}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ProjectOption({
  active,
  disabled,
  label,
  path,
  projectId,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  path?: string;
  projectId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-10 w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-sm text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onClick}
      disabled={disabled}
      data-project-id={projectId}
    >
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {path ? (
          <span className="block truncate text-[11px] text-[color:var(--lime-text-muted)]">
            {path}
          </span>
        ) : null}
      </span>
    </button>
  );
}
