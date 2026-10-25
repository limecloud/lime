import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Plus,
  Play,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Root as DropdownMenu,
  Content as DropdownMenuContent,
  Item as DropdownMenuItem,
  Label as DropdownMenuLabel,
  Separator as DropdownMenuSeparator,
  Trigger as DropdownMenuTrigger,
  Portal as DropdownMenuPortal,
  Sub as DropdownMenuSub,
  SubTrigger as DropdownMenuSubTrigger,
  SubContent as DropdownMenuSubContent,
} from "@radix-ui/react-dropdown-menu";
import { LocalEnvironmentMenuContent } from "../components/LocalEnvironmentMenuContent";
import type { ProjectGitStatus } from "@/lib/api/projectGit";
import { useLocalEnvironmentRecentActions } from "@/hooks/useLocalEnvironmentRecentActions";
import { useLocalConversationEnvironment } from "./useLocalConversationEnvironment";
import { nextEnvironmentConfigPath } from "@/lib/localEnvironments";
import { EnvironmentActionIcon } from "./EnvironmentActionIcon";
import { LocalEnvironmentActionDialog } from "./LocalEnvironmentActionDialog";
import { LocalEnvironmentSetupDialog } from "./LocalEnvironmentSetupDialog";
import {
  availableEnvironmentActions,
  environmentActionCwd,
  environmentActionPlatform,
  orderEnvironmentActions,
  type TerminalAction,
} from "./localConversationActionHelpers";

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
  const [dialog, setDialog] = useState<"action" | "setup" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const environmentMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setDialog(null);
  }, [workspaceRoot]);
  const environment = useLocalConversationEnvironment({
    workspaceRoot,
    status,
    loading,
    failed,
    refresh,
  });
  const cwd = environmentActionCwd({
    workspaceRoot,
    repoRoot: status?.repositoryRoot,
    relativePath: environment.environment?.cwdRelativeToGitRoot,
  });
  const { recentNames, recordAction } = useLocalEnvironmentRecentActions(
    environment.environment ? cwd || environment.configPath : null,
  );
  const actions = orderEnvironmentActions(
    availableEnvironmentActions(
      environment.environment?.environment.actions ?? [],
      environmentActionPlatform(navigator.userAgent),
    ).map((action, configIndex) => ({ ...action, configIndex })),
    recentNames,
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
    void recordAction(action.name);
    onRunAction({
      title: action.name,
      command: action.command,
      cwd,
    });
  };
  const openSettings = () => {
    setOpen(false);
    setDialog(null);
    onConfigureActions?.(environment.configPath);
  };
  const refreshEnvironment = () => {
    setRefresh((value) => value + 1);
    environment.reload();
    onRefresh();
  };
  const restoreFocus = () => trigger.current?.focus();
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
            ref={trigger}
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
                return (
                  <DropdownMenuItem
                    key={`${action.configIndex}:${action.name}`}
                    className={itemClass}
                    onSelect={() => run(index)}
                    data-testid="local-conversation-action"
                  >
                    <EnvironmentActionIcon icon={action.icon} />
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
            {!environment.loading && !environment.error ? (
              <DropdownMenuItem
                className={itemClass}
                data-testid="local-conversation-add-action"
                onSelect={() => {
                  setOpen(false);
                  setDialog(environment.environment ? "action" : "setup");
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t(
                  environment.environment
                    ? "agentChat.localEnvironmentActions.add"
                    : "agentChat.localEnvironmentActions.setup",
                )}
              </DropdownMenuItem>
            ) : null}
            {environment.canChangeEnvironment ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className={itemClass}
                  data-testid="local-conversation-change-environment"
                  onPointerLeave={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      environmentMenu.current?.contains(event.relatedTarget)
                    )
                      event.preventDefault();
                  }}
                >
                  <SquareTerminal className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1">
                    {t("agentChat.localEnvironmentActions.changeEnvironment")}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent
                    ref={environmentMenu}
                    sideOffset={4}
                    className="z-50 w-64 max-w-[calc(100vw-16px)] rounded-xl border bg-popover p-1 text-[13px] text-popover-foreground shadow-md outline-none"
                    data-testid="local-conversation-environment-menu"
                  >
                    <LocalEnvironmentMenuContent
                      workspaceRoot={workspaceRoot}
                      selection={{
                        ...environment.selection,
                        updateSelection: async (configPath) => {
                          const applied =
                            await environment.selection.updateSelection(
                              configPath,
                            );
                          if (applied) onRefresh();
                          return applied;
                        },
                      }}
                      onClose={() => setOpen(false)}
                      onOpenSettings={
                        onConfigureActions ? openSettings : undefined
                      }
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuItem
              className={itemClass}
              disabled={!onConfigureActions}
              onSelect={openSettings}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              {t("agentChat.localEnvironmentActions.environmentSettings")}
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
          <EnvironmentActionIcon icon={actions[0].icon} />
        </button>
      ) : null}
      {dialog === "action" && environment.configPath ? (
        <LocalEnvironmentActionDialog
          key={`${workspaceRoot}:${environment.configPath}`}
          configPath={environment.configPath}
          workspaceRoot={workspaceRoot}
          onClose={() => setDialog(null)}
          onOpenSettings={onConfigureActions ? openSettings : undefined}
          restoreFocus={restoreFocus}
          onSaved={(action) => {
            setDialog(null);
            refreshEnvironment();
            void recordAction(action.name);
            onRunAction({ title: action.name, command: action.command, cwd });
          }}
        />
      ) : null}
      {dialog === "setup" ? (
        <LocalEnvironmentSetupDialog
          key={workspaceRoot}
          configPath={nextEnvironmentConfigPath(
            environment.selection.environments ?? [],
            workspaceRoot,
          )}
          workspaceRoot={workspaceRoot}
          selectEnvironment={environment.selection.updateSelection}
          onClose={() => setDialog(null)}
          restoreFocus={restoreFocus}
          onSaved={(draft) => {
            setDialog(null);
            refreshEnvironment();
            if (draft.setupScript.trim())
              onRunAction({
                title: t(
                  "agentChat.localEnvironmentActions.setupTerminalTitle",
                ),
                command: draft.setupScript,
                cwd: workspaceRoot,
              });
          }}
        />
      ) : null}
    </>
  );
}
