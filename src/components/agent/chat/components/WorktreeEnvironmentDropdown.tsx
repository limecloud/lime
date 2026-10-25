import { useEffect, useState } from "react";
import { ChevronDown, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LocalEnvironmentMenuContent } from "./LocalEnvironmentMenuContent";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { useLocalEnvironmentSelection } from "@/hooks/useLocalEnvironmentSelection";
import { areLocalEnvironmentPathsEqual } from "@/lib/localEnvironmentSelection";
import { SettingsTabs } from "@/types/settings";

/** Desktop environment picker; selection authority remains in the Host atom. */
export function WorktreeEnvironmentDropdown({
  workspaceRoot,
  disabled = false,
}: {
  workspaceRoot: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("agent");
  const navigate = useAppNavigationRequest();
  const selection = useLocalEnvironmentSelection({
    workspaceRoot,
    selectDefaultEnvironment: false,
  });
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [workspaceRoot, disabled]);
  const selectedPath =
    selection.repairConfigPath ?? selection.resolvedConfigPath;
  const selected = selectedPath
    ? selection.environments.find((entry) =>
        areLocalEnvironmentPathsEqual(entry.configPath, selectedPath),
      )
    : null;
  const label = selection.isLoading
    ? t("composer.worktreeEnvironment.loading")
    : selected?.type === "error"
      ? t("composer.worktreeEnvironment.needsAttention")
      : selected?.type === "success"
        ? selected.environment.name
        : selection.savedConfigPath != null && selectedPath != null
          ? t("composer.worktreeEnvironment.unavailableSelection")
          : t("lime.environmentSelector.noEnvironment");
  const openSettings = () => {
    navigate?.("settings", {
      tab: SettingsTabs.LocalEnvironments,
      localEnvironmentFocus: {
        workspaceRoot,
        ...(selection.repairConfigPath
          ? { configPath: selection.repairConfigPath }
          : {}),
        requestKey: Date.now(),
      },
    });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-7 max-w-[180px] min-w-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label={t("composer.worktreeEnvironment.tooltip")}
          data-testid="worktree-environment-trigger"
          data-composer-navigation-target="environment"
        >
          <SquareTerminal
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate">{label}</span>
          {selection.isLoading ? null : (
            <ChevronDown
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-64 rounded-xl p-1 text-[13px]"
        aria-label={t("composer.worktreeEnvironment.title")}
        data-testid="worktree-environment-menu"
      >
        <LocalEnvironmentMenuContent
          key={workspaceRoot}
          workspaceRoot={workspaceRoot}
          selection={selection}
          disabled={disabled}
          onClose={() => setOpen(false)}
          onOpenSettings={navigate ? openSettings : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
