import { useRef, useState, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getRegisteredCommands,
  subscribeCommands,
} from "@/lib/commands/registry";
import { keyboardShortcutSections } from "@/lib/commands/keyboard-shortcut-command-order";
import {
  formatShortcutTokens,
  formatShortcutStrokes,
  resolveHotkeyPlatform,
} from "@/lib/hotkeys/platform";

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useTranslation("navigation");
  const commands = useSyncExternalStore(
    subscribeCommands,
    getRegisteredCommands,
    getRegisteredCommands,
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const platform = resolveHotkeyPlatform(
    typeof navigator === "undefined" ? undefined : navigator,
  );
  const needle = query.trim().toLocaleLowerCase();
  const matches = commands.filter((command) =>
    [
      command.id,
      t(command.titleKey),
      command.descriptionKey ? t(command.descriptionKey) : "",
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30" />
        <Dialog.Content
          data-keyboard-shortcuts-dialog
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[60] flex max-h-[min(760px,calc(100dvh-48px))] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
          onKeyDown={(event) => {
            // 自动聚焦可能早于 Radix 注册最高层，已处理的 Escape 不重复关闭。
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              onOpenChange(false);
            }
          }}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className="flex items-center justify-between px-6 pb-4 pt-5">
            <Dialog.Title className="text-lg font-semibold">
              {t("help.keyboardShortcuts")}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t("help.close")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <label className="mx-6 mb-3 flex items-center gap-2 rounded-lg border border-border px-3">
            <Search
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <input
              ref={searchRef}
              aria-label={t("help.searchShortcuts")}
              placeholder={t("help.searchShortcuts")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <div
            className="min-h-48 overflow-y-auto px-6 pb-6"
            data-testid="keyboard-shortcuts-list"
          >
            {matches.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t(needle ? "help.noMatches" : "help.noShortcuts")}
              </p>
            ) : (
              keyboardShortcutSections.map((section) => {
                const group = matches.filter(
                  (command) => command.section === section,
                );
                if (group.length === 0) return null;
                return (
                  <section
                    key={section}
                    aria-label={t(`commands.sections.${section}`)}
                    className="mt-4"
                  >
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                      {t(`commands.sections.${section}`)}
                    </h3>
                    <ul>
                      {group.map((command) => (
                        <li
                          key={command.id}
                          data-command-id={command.id}
                          className="flex min-h-10 items-center justify-between gap-6 border-b border-border/50 py-2 text-sm last:border-0"
                        >
                          <div>
                            <div>{t(command.titleKey)}</div>
                            {command.descriptionKey ? (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {t(command.descriptionKey)}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-3">
                            {command.bindings.map((binding) => (
                              <span
                                key={binding}
                                className="flex items-center gap-3"
                                aria-label={formatShortcutTokens(
                                  binding,
                                  platform,
                                ).join(" ")}
                              >
                                {formatShortcutStrokes(binding, platform).map(
                                  (stroke, index) => (
                                    <span
                                      key={index}
                                      data-shortcut-stroke
                                      className="flex items-center gap-1"
                                    >
                                      {stroke.map((token, keyIndex) => (
                                        <kbd
                                          key={keyIndex}
                                          className="min-w-5 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-sans text-xs"
                                        >
                                          {token}
                                        </kbd>
                                      ))}
                                    </span>
                                  ),
                                )}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default KeyboardShortcutsDialog;
