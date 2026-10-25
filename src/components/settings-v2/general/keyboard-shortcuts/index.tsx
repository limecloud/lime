import { useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  getRegisteredCommands,
  subscribeCommands,
} from "@/lib/commands/registry";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import {
  bindingIdentity,
  bindingMatchesPrefix,
  bindingsConflict,
} from "@/lib/commands/bindings";
import {
  resetCommandBindings,
  updateCommandBinding,
} from "@/lib/commands/preferences";
import type { RegisteredCommand } from "@/lib/commands/registry";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import { effectiveDesktopPreferences } from "@/lib/api/desktopPreferences";
import type { ExternalBrowserLinkShortcut } from "@/lib/api/appConfigTypes";
import {
  SettingsGroup,
  SettingsAction,
  SettingsEmptyState,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsValueMenu,
} from "../../SettingsPrimitives";
import { CommandRow } from "./CommandRow";
import { ShortcutSearch } from "./ShortcutSearch";
import { ResetShortcutsDialog } from "./ResetShortcutsDialog";

export function KeyboardShortcutsSettings() {
  const { t } = useTranslation("settings");
  const { t: navigation } = useTranslation("navigation");
  const { configured, error, pending, refresh, save } = useDesktopPreferences();
  const [query, setQuery] = useState("");
  const [byKeys, setByKeys] = useState(false);
  const [changing, setChanging] = useState(false);
  const mutationPending = useRef(false);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [resetOpen, setResetOpen] = useState(false);
  const commands = useSyncExternalStore(
    subscribeCommands,
    getRegisteredCommands,
    getRegisteredCommands,
  );
  const platform = resolveHotkeyPlatform(
    typeof navigator === "undefined" ? undefined : navigator,
  );
  const primary = platform === "mac" ? "⌘" : "Ctrl";
  const alt = platform === "mac" ? "⌥" : "Alt";
  const click = t("settings.keyboardShortcuts.click");
  const options: { value: ExternalBrowserLinkShortcut; label: string }[] = [
    { value: "unassigned", label: t("settings.keyboardShortcuts.unassigned") },
    { value: "primary", label: `${primary}+${click}` },
    { value: "alt", label: `${alt}+${click}` },
    {
      value: "primary-shift",
      label: `${platform === "mac" ? "⇧⌘" : "Ctrl+Shift"}+${click}`,
    },
  ];
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  const matches = (text: string) =>
    text.normalize("NFKC").toLocaleLowerCase().includes(needle);
  const title = t("settings.keyboardShortcuts.externalLink");
  const description = t("settings.keyboardShortcuts.externalLinkDescription");
  const filtered = commands.filter((command) =>
    byKeys && query
      ? command.bindings.some((binding) =>
          bindingMatchesPrefix(binding, query, platform),
        )
      : matches(
          `${command.id} ${navigation(command.titleKey)} ${command.descriptionKey ? navigation(command.descriptionKey) : ""}`,
        ),
  );
  const showExternal = !byKeys && matches(`${title} ${description}`);
  const disabled = !configured || pending || changing;
  const hasCustom =
    Object.keys(configured?.["keyboard-shortcuts"] ?? {}).length > 0 ||
    (configured?.["external-browser-link-shortcut"] ?? "primary") !== "primary";
  const mutate = async (id: string, action: () => Promise<unknown>) => {
    if (mutationPending.current || !configured || pending) return false;
    mutationPending.current = true;
    setChanging(true);
    setRowError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch {
      await refresh();
      setRowError({ id, text: t("settings.keyboardShortcuts.saveError") });
      return false;
    } finally {
      mutationPending.current = false;
      setChanging(false);
    }
  };
  const changeBinding = async (
    command: RegisteredCommand,
    bindings: string[] | null,
  ) => {
    if (disabled || mutationPending.current) return false;
    const next = bindings ?? [...command.defaultBindings];
    const ids = next.map((binding) => bindingIdentity(binding, platform));
    const conflict = getRegisteredCommands().find(
      (other) =>
        other.id !== command.id &&
        other.bindings.some((binding) =>
          next.some((candidate) =>
            bindingsConflict(binding, candidate, platform),
          ),
        ),
    );
    if (
      conflict ||
      next.some((binding, index) =>
        next
          .slice(index + 1)
          .some((other) => bindingsConflict(binding, other, platform)),
      ) ||
      ids.some((id) => id === null)
    ) {
      setRowError({
        id: command.id,
        text: t("settings.keyboardShortcuts.conflict", {
          title: navigation((conflict ?? command).titleKey),
        }),
      });
      return false;
    }
    if (
      bindings !== null &&
      JSON.stringify(ids) ===
        JSON.stringify(
          command.bindings.map((binding) => bindingIdentity(binding, platform)),
        )
    ) {
      setRowError(null);
      return true;
    }
    return mutate(command.id, () => updateCommandBinding(command.id, bindings));
  };
  return (
    <SettingsPageBody aria-busy={pending || changing}>
      <SettingsPageHeader
        title={t("settings.tab.keyboardShortcuts")}
        actions={
          hasCustom ? (
            <SettingsAction
              type="button"
              disabled={disabled}
              onClick={() => {
                setRowError(null);
                setResetOpen(true);
              }}
            >
              {t("settings.keyboardShortcuts.resetAll")}
            </SettingsAction>
          ) : null
        }
      />
      <ShortcutSearch
        query={query}
        onQueryChange={setQuery}
        byKeys={byKeys}
        onModeChange={setByKeys}
        platform={platform}
        bindings={commands.flatMap((command) => command.bindings)}
      />
      {error ? (
        <div role="alert" className="text-sm text-destructive">
          {t(
            error === "save"
              ? "settings.keyboardShortcuts.saveError"
              : "settings.browser.error.load",
          )}
          {error === "load" ? (
            <button
              type="button"
              onClick={() => void refresh()}
              className="ml-3"
            >
              {t("settings.browser.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <SettingsGroup>
        {filtered.map((command) => (
          <CommandRow
            key={command.id}
            command={command}
            platform={platform}
            disabled={disabled}
            error={rowError?.id === command.id ? rowError.text : undefined}
            onUpdate={(bindings) => changeBinding(command, bindings)}
            onCancelCapture={() =>
              setRowError((current) =>
                current?.id === command.id ? null : current,
              )
            }
          />
        ))}
        {showExternal ? (
          <SettingsRow
            label={title}
            description={description}
            targetId="keyboard-external-browser-link"
          >
            <SettingsValueMenu
              targetId="keyboard-external-browser-link"
              described
              value={
                effectiveDesktopPreferences(configured ?? undefined)[
                  "external-browser-link-shortcut"
                ]
              }
              disabled={disabled}
              options={options}
              onChange={(value) =>
                void save("external-browser-link-shortcut", value)
              }
            />
          </SettingsRow>
        ) : null}
        {!filtered.length && !showExternal ? (
          <SettingsEmptyState>
            {t("settings.keyboardShortcuts.noMatches")}
          </SettingsEmptyState>
        ) : null}
      </SettingsGroup>
      <ResetShortcutsDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        pending={changing}
        error={rowError?.id === "__all__" ? rowError.text : null}
        onConfirm={() =>
          void mutate("__all__", resetCommandBindings).then((saved) => {
            if (saved) setResetOpen(false);
          })
        }
      />
    </SettingsPageBody>
  );
}
