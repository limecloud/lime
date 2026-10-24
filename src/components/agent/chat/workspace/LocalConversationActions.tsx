import { useState } from "react";
import { Bug, FlaskConical, Play, Settings2, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Root as DropdownMenu,
  Content as DropdownMenuContent,
  Item as DropdownMenuItem,
  Label as DropdownMenuLabel,
  Separator as DropdownMenuSeparator,
  Trigger as DropdownMenuTrigger,
  Portal as DropdownMenuPortal,
} from "@radix-ui/react-dropdown-menu";
import type { ProjectGitStatus } from "@/lib/api/projectGit";
import { useLocalConversationEnvironment } from "./useLocalConversationEnvironment";
import {
  availableEnvironmentActions,
  environmentActionCwd,
  environmentActionPlatform,
  type TerminalAction,
} from "./localConversationActionHelpers";

const icons = { tool: Wrench, run: Play, debug: Bug, test: FlaskConical };
const buttonClass =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)] disabled:opacity-50";
const itemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";

/** Desktop Actions adaptation; execution remains in the current terminal/command owner. */
export function LocalConversationActions({
  workspaceRoot,
  status,
  loading,
  failed,
  onRefresh,
  onRunAction,
  onConfigureActions,
}: {
  workspaceRoot: string;
  status: ProjectGitStatus | null;
  loading: boolean;
  failed: boolean;
  onRefresh: () => void;
  onRunAction: (action: TerminalAction) => void;
  onConfigureActions?: (configPath: string | null) => void;
}) {
  const { t } = useTranslation("agent");
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const environment = useLocalConversationEnvironment({
    workspaceRoot,
    status,
    loading,
    failed,
    refresh,
  });
  const actions = availableEnvironmentActions(
    environment.environment?.environment.actions ?? [],
    environmentActionPlatform(navigator.userAgent),
  );
  const run = (index: number) => {
    const action = actions[index];
    if (
      !action ||
      environment.loading ||
      environment.error ||
      !environment.environment
    )
      return;
    setOpen(false);
    onRunAction({
      title: action.name,
      command: action.command,
      cwd: environmentActionCwd({
        workspaceRoot,
        repoRoot: status?.repositoryRoot,
        relativePath: environment.environment.cwdRelativeToGitRoot,
      }),
    });
  };
  const openSettings = () => {
    setOpen(false);
    onConfigureActions?.(environment.configPath);
  };
  const PrimaryIcon = icons[actions[0]?.icon ?? "tool"];
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setRefresh((value) => value + 1);
            environment.reload();
            onRefresh();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={buttonClass}
            aria-label={t("agentChat.localEnvironmentActions.title")}
            title={t("agentChat.localEnvironmentActions.title")}
            data-testid="local-conversation-actions"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            sideOffset={5}
            className="z-50 w-64 max-w-[calc(100vw-16px)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-[12px] font-normal text-muted-foreground">
              {t("agentChat.localEnvironmentActions.title")}
            </DropdownMenuLabel>
            {environment.loading ? (
              <DropdownMenuItem className={itemClass} disabled>
                {t("composer.worktreeEnvironment.loading")}
              </DropdownMenuItem>
            ) : environment.error ? (
              <DropdownMenuItem
                className={itemClass}
                onSelect={() => {
                  environment.reload();
                  onRefresh();
                  setRefresh((value) => value + 1);
                }}
              >
                {t("composer.worktreeEnvironment.error")} ·{" "}
                {t("composer.worktreeEnvironment.retry")}
              </DropdownMenuItem>
            ) : actions.length ? (
              actions.map((action, index) => {
                const Icon = icons[action.icon ?? "tool"];
                return (
                  <DropdownMenuItem
                    key={`${index}:${action.name}`}
                    className={itemClass}
                    onSelect={() => run(index)}
                    data-testid="local-conversation-action"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="truncate">{action.name}</span>
                  </DropdownMenuItem>
                );
              })
            ) : (
              <DropdownMenuItem className={itemClass} disabled>
                {t("agentChat.localEnvironmentActions.empty")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="my-1 h-px bg-border" />
            <DropdownMenuItem
              className={itemClass}
              disabled={!onConfigureActions}
              onSelect={openSettings}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              {t("agentChat.localEnvironmentActions.configure")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      {actions[0] && !environment.loading && !environment.error ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={t("agentChat.localEnvironmentActions.run", {
            name: actions[0].name,
          })}
          title={t("agentChat.localEnvironmentActions.run", {
            name: actions[0].name,
          })}
          onClick={() => run(0)}
          data-testid="local-conversation-primary-action"
        >
          <PrimaryIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
