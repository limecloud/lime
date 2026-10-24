import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Settings2,
  SquareTerminal,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { useLocalEnvironmentSelection } from "@/hooks/useLocalEnvironmentSelection";
import { areLocalEnvironmentPathsEqual } from "@/lib/localEnvironmentSelection";
import { SettingsTabs } from "@/types/settings";

const itemClass = "gap-2 rounded-md px-2 py-1.5 text-[13px]";

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
  const titleId = useId();
  const selection = useLocalEnvironmentSelection({
    workspaceRoot,
    selectDefaultEnvironment: false,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const generation = useRef(0);
  const request = useRef<object | null>(null);
  const retry = useRef<(() => Promise<boolean>) | null>(null);
  useEffect(() => {
    generation.current += 1;
    request.current = null;
    retry.current = null;
    setOpen(false);
    setQuery("");
    setPending(false);
    setMutationError(false);
    return () => {
      generation.current += 1;
    };
  }, [workspaceRoot]);
  useEffect(() => {
    if (selection.ready && !selection.error) {
      setMutationError(false);
      retry.current = null;
    }
  }, [selection.ready, selection.error]);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled]);
  const busy = pending || selection.updating;
  const canSelect =
    !disabled && selection.ready && !selection.isLoading && !busy;
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
          : t("codex.environmentSelector.noEnvironment");
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setQuery("");
  };
  const update = async (action: () => Promise<boolean>) => {
    if (!canSelect || request.current) return;
    const token = {},
      epoch = generation.current;
    request.current = token;
    retry.current = action;
    setPending(true);
    setMutationError(false);
    try {
      const applied = await action();
      if (generation.current !== epoch || request.current !== token) return;
      if (applied) changeOpen(false);
      else setMutationError(true);
    } catch {
      if (generation.current === epoch && request.current === token)
        setMutationError(true);
    } finally {
      if (generation.current === epoch && request.current === token) {
        request.current = null;
        setPending(false);
      }
    }
  };
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
    changeOpen(false);
  };
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const successful = selection.environments.filter(
    (entry) => entry.type === "success",
  );
  const allDamaged =
    !selection.isLoading &&
    !selection.error &&
    selection.environments.length > 0 &&
    successful.length === 0;
  const environmentOption = (
    entry: (typeof successful)[number],
    isDefault: boolean,
  ) => (
    <CommandItem
      key={entry.configPath}
      value={entry.configPath}
      className={itemClass}
      disabled={!canSelect}
      onSelect={() =>
        void update(() => selection.updateSelection(entry.configPath))
      }
      data-config-path={entry.configPath}
      aria-current={
        selection.resolvedConfigPath &&
        areLocalEnvironmentPathsEqual(
          entry.configPath,
          selection.resolvedConfigPath,
        )
          ? "true"
          : undefined
      }
    >
      {isDefault ? (
        <Star
          aria-label={t("composer.worktreeEnvironment.default")}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{entry.environment.name}</span>
      {selection.resolvedConfigPath &&
      areLocalEnvironmentPathsEqual(
        entry.configPath,
        selection.resolvedConfigPath,
      ) ? (
        <Check aria-hidden className="size-3.5 shrink-0" />
      ) : null}
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={changeOpen}>
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
        aria-labelledby={titleId}
        data-testid="worktree-environment-menu"
      >
        <div id={titleId} className="px-2 py-1.5 font-medium">
          {t("composer.worktreeEnvironment.title")}
        </div>
        <Command
          shouldFilter={false}
          label={t("composer.worktreeEnvironment.title")}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("composer.worktreeEnvironment.search")}
            aria-label={t("composer.worktreeEnvironment.search")}
            className="h-8 py-1 text-[13px]"
          />
          <CommandList
            className="max-h-[220px]"
            aria-busy={selection.isLoading || busy}
          >
            {selection.savedConfigPath !== undefined ? (
              <CommandItem
                value="reset-selection"
                className={itemClass}
                disabled={!canSelect}
                onSelect={() => void update(selection.resetSelection)}
              >
                {t("composer.worktreeEnvironment.reset")}
              </CommandItem>
            ) : null}
            {!selection.isLoading && !selection.error ? (
              <CommandItem
                value="no-environment"
                className={itemClass}
                disabled={!canSelect}
                onSelect={() =>
                  void update(() => selection.updateSelection(null))
                }
              >
                <span className="min-w-0 flex-1">
                  {t("composer.worktreeEnvironment.noEnvironmentOption")}
                </span>
                {!selection.resolvedConfigPath &&
                !selection.repairConfigPath ? (
                  <Check aria-hidden className="size-3.5" />
                ) : null}
              </CommandItem>
            ) : null}
            {selection.defaultEnvironment &&
            matches(selection.defaultEnvironment.environment.name)
              ? environmentOption(selection.defaultEnvironment, true)
              : null}
            {selection.isLoading ? (
              <div
                role="status"
                className="flex items-center gap-2 px-2 py-3 text-muted-foreground"
              >
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                {t("composer.worktreeEnvironment.loading")}
              </div>
            ) : null}
            {mutationError ? (
              <div role="alert" className="px-2 py-2 text-destructive">
                {t("composer.worktreeEnvironment.saveFailed")}
              </div>
            ) : selection.error ? (
              <div role="alert" className="px-2 py-2 text-destructive">
                {t("composer.worktreeEnvironment.error")}
              </div>
            ) : null}
            {mutationError || selection.error ? (
              <CommandItem
                value="retry-environments"
                className={itemClass}
                disabled={busy}
                onSelect={() => {
                  if (
                    mutationError &&
                    retry.current &&
                    selection.ready &&
                    !selection.isLoading
                  )
                    void update(retry.current);
                  else selection.reload();
                }}
              >
                {t("composer.worktreeEnvironment.retry")}
              </CommandItem>
            ) : null}
            {!selection.isLoading && !selection.error
              ? selection.availableEnvironments
                  .filter((entry) => matches(entry.environment.name))
                  .map((entry) => environmentOption(entry, false))
              : null}
            {allDamaged ? (
              <div role="alert" className="px-2 py-2 text-destructive">
                {t("composer.worktreeEnvironment.needsAttention")}
              </div>
            ) : null}
            <CommandItem
              value="environment-settings"
              className={itemClass}
              disabled={!navigate || busy}
              onSelect={openSettings}
            >
              <Settings2 aria-hidden className="size-3.5 shrink-0" />
              {t(
                selection.repairConfigPath
                  ? "composer.worktreeEnvironment.repair"
                  : selection.environments.length === 0 &&
                      !selection.isLoading &&
                      !selection.error
                    ? "composer.worktreeEnvironment.setUpProject"
                    : "composer.worktreeEnvironment.settings",
              )}
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
