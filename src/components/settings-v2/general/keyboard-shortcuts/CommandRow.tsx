import { useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { captureBinding } from "@/lib/commands/bindings";
import type { RegisteredCommand } from "@/lib/commands/registry";
import {
  formatShortcutTokens,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";
import { SettingsAction, SettingsRow } from "../../SettingsPrimitives";

export function CommandRow({
  command,
  platform,
  disabled,
  error,
  onUpdate,
}: {
  command: RegisteredCommand;
  platform: HotkeyPlatform;
  disabled: boolean;
  error?: string;
  onUpdate: (bindings: string[] | null) => Promise<boolean>;
}) {
  const { t } = useTranslation("settings");
  const { t: navigation } = useTranslation("navigation");
  const [editing, setEditing] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const previousEditing = useRef<number | null>(null);
  const restoreFocus = useRef(false);
  const captureAfterMenu = useRef<number | null>(null);
  const title = navigation(command.titleKey);
  useEffect(() => {
    if (editing !== null) input.current?.focus();
    else if (previousEditing.current !== null && restoreFocus.current)
      controls.current
        ?.querySelector<HTMLButtonElement>("[data-binding-button]")
        ?.focus();
    previousEditing.current = editing;
  }, [editing]);
  const update = async (bindings: string[] | null) => {
    if (await onUpdate(bindings)) {
      restoreFocus.current = true;
      setEditing(null);
    } else input.current?.focus();
  };
  return (
    <SettingsRow
      data-command-id={command.id}
      label={title}
      description={
        <>
          {command.descriptionKey ? navigation(command.descriptionKey) : null}
          {error ? (
            <span role="alert" className="block text-destructive">
              {error}
            </span>
          ) : null}
        </>
      }
    >
      <div
        ref={controls}
        className="flex max-w-full flex-wrap items-center justify-end gap-1"
      >
        {editing !== null ? (
          <input
            ref={input}
            data-shortcut-capture
            aria-label={t("settings.keyboardShortcuts.capture", { title })}
            aria-invalid={Boolean(error)}
            aria-busy={disabled}
            placeholder={t("settings.keyboardShortcuts.pressKeys")}
            readOnly
            className="h-7 w-48 max-w-full rounded-md border border-ring bg-transparent px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onBlur={() => {
              if (!disabled) {
                restoreFocus.current = false;
                setEditing(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                restoreFocus.current = false;
                setEditing(null);
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              if (
                disabled ||
                event.repeat ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              )
                return;
              if (
                event.key === "Escape" &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey
              ) {
                restoreFocus.current = true;
                setEditing(null);
                return;
              }
              const binding = captureBinding(event);
              if (!binding) return;
              const bindings = [...command.bindings];
              bindings[editing] = binding;
              void update(bindings);
            }}
          />
        ) : (
          (command.bindings.length ? command.bindings : [null]).map(
            (binding, index) => (
              <button
                key={index}
                type="button"
                data-binding-button
                disabled={disabled}
                aria-label={t("settings.keyboardShortcuts.change", { title })}
                className="flex min-h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                onClick={() => setEditing(index)}
              >
                {binding
                  ? formatShortcutTokens(binding, platform).map((token, i) => (
                      <kbd key={i} className="font-sans font-normal">
                        {token}
                      </kbd>
                    ))
                  : t("settings.keyboardShortcuts.unassigned")}
                <Pencil className="ml-1 size-3" aria-hidden="true" />
              </button>
            ),
          )
        )}
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t("settings.keyboardShortcuts.actions", { title })}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={4}
              className="z-[70] min-w-40 rounded-xl border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg"
              onCloseAutoFocus={(event) => {
                if (captureAfterMenu.current !== null) {
                  event.preventDefault();
                  setEditing(captureAfterMenu.current);
                  captureAfterMenu.current = null;
                }
              }}
            >
              <Menu.Item
                className="cursor-default rounded-lg px-2 py-1.5 outline-none focus:bg-accent"
                onSelect={() => {
                  captureAfterMenu.current = command.bindings.length;
                }}
              >
                {t("settings.keyboardShortcuts.add")}
              </Menu.Item>
              <Menu.Item
                disabled={!command.bindings.length}
                className="cursor-default rounded-lg px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                onSelect={() => void update([])}
              >
                {t("settings.keyboardShortcuts.clear")}
              </Menu.Item>
              <Menu.Item
                disabled={!command.customized}
                className="cursor-default rounded-lg px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                onSelect={() => void update(null)}
              >
                {t("settings.keyboardShortcuts.restore")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        {editing !== null ? (
          <SettingsAction
            type="button"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              restoreFocus.current = true;
              setEditing(null);
            }}
          >
            {t("settings.keyboardShortcuts.cancel")}
          </SettingsAction>
        ) : null}
      </div>
    </SettingsRow>
  );
}
