import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getRegisteredCommands,
  runCommand,
  subscribeCommands,
  type RegisteredCommand,
} from "@/lib/commands/registry";
import { keyboardShortcutSections } from "@/lib/commands/keyboard-shortcut-command-order";
import {
  formatShortcutStrokes,
  formatShortcutTokens,
  resolveHotkeyPlatform,
} from "@/lib/hotkeys/platform";
import { cn } from "@/lib/utils";

const NO_MATCH = -1;

function matchesQuery(
  command: RegisteredCommand,
  query: string,
  translate: (key: string) => string,
) {
  if (!query) {
    return true;
  }
  const description = command.descriptionKey
    ? translate(command.descriptionKey)
    : "";
  return [command.id, translate(command.titleKey), description]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function ShortcutHint({
  binding,
  platform,
}: {
  binding: string;
  platform: ReturnType<typeof resolveHotkeyPlatform>;
}) {
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      aria-label={formatShortcutTokens(binding, platform).join(" ")}
    >
      {formatShortcutStrokes(binding, platform).map((stroke, strokeIndex) => (
        <span key={strokeIndex} className="flex items-center gap-0.5">
          {stroke.map((token, tokenIndex) => (
            <kbd
              key={tokenIndex}
              className="min-w-4 rounded border border-border bg-muted px-1 py-0.5 text-center font-sans text-[11px] leading-4 text-muted-foreground"
            >
              {token}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

export function CommandMenu({
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const executingRef = useRef(false);
  const listId = `${useId().replace(/:/g, "")}-list`;
  const platform = resolveHotkeyPlatform(
    typeof navigator === "undefined" ? undefined : navigator,
  );
  const needle = query.trim().toLocaleLowerCase();
  const filtered = commands.filter((command) =>
    matchesQuery(command, needle, t),
  );
  const groups = keyboardShortcutSections
    .map((section) => ({
      section,
      commands: filtered.filter((command) => command.section === section),
    }))
    .filter((group) => group.commands.length > 0);
  const ordered = groups.flatMap((group) => group.commands);
  const foundIndex = ordered.findIndex((command) => command.id === activeId);
  const activeIndex = foundIndex === NO_MATCH ? 0 : foundIndex;
  const activeCommand = ordered[activeIndex];

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeCommand?.id]);

  const execute = (command: RegisteredCommand | undefined) => {
    if (!command || executingRef.current) {
      return;
    }
    executingRef.current = true;
    onOpenChange(false);
    runCommand(command.id);
  };

  const move = (index: number) => {
    if (ordered.length === 0) {
      return;
    }
    const next = (index + ordered.length) % ordered.length;
    setActiveId(ordered[next].id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(activeIndex - 1);
        break;
      case "Enter":
        event.preventDefault();
        execute(activeCommand);
        break;
      case "Escape":
        // 自动聚焦可能早于 Radix 注册最高层，已处理的 Escape 不重复关闭。
        if (!event.defaultPrevented) {
          event.preventDefault();
          onOpenChange(false);
        }
        break;
      default:
        break;
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  let optionIndex = -1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30" />
        <Dialog.Content
          data-command-menu
          data-testid="command-menu"
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18%] z-[60] flex max-h-[min(560px,calc(100dvh-96px))] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          onKeyDown={handleKeyDown}
        >
          <Dialog.Title className="sr-only">
            {t("commandMenu.title")}
          </Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <input
              ref={inputRef}
              data-command-menu-input
              data-testid="command-menu-input"
              aria-label={t("commandMenu.placeholder")}
              placeholder={t("commandMenu.placeholder")}
              value={query}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                activeCommand ? optionId(activeIndex) : undefined
              }
              aria-autocomplete="list"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveId(null);
              }}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={t("commandMenu.title")}
            data-command-menu-list
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {ordered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("commandMenu.empty")}
              </p>
            ) : (
              groups.map((group) => {
                const sectionId = `${listId}-section-${group.section}`;
                return (
                  <section
                    key={group.section}
                    role="group"
                    aria-labelledby={sectionId}
                    className="pb-1"
                  >
                    <div
                      id={sectionId}
                      className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground"
                    >
                      {t(`commands.sections.${group.section}`)}
                    </div>
                    {group.commands.map((command) => {
                      optionIndex += 1;
                      const index = optionIndex;
                      const active = index === activeIndex;
                      return (
                        <div
                          key={command.id}
                          ref={active ? selectedRef : undefined}
                          id={optionId(index)}
                          role="option"
                          aria-selected={active}
                          data-command-id={command.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => {
                            if (!active) setActiveId(command.id);
                          }}
                          onClick={() => execute(command)}
                          className={cn(
                            "flex min-h-10 cursor-default select-none items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-sm",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-popover-foreground",
                          )}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">
                              {t(command.titleKey)}
                            </span>
                            {command.descriptionKey ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {t(command.descriptionKey)}
                              </span>
                            ) : null}
                          </span>
                          {command.bindings.length > 0 ? (
                            <span className="flex shrink-0 items-center gap-2">
                              {command.bindings.map((binding) => (
                                <ShortcutHint
                                  key={binding}
                                  binding={binding}
                                  platform={platform}
                                />
                              ))}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </section>
                );
              })
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="min-w-4 rounded border border-border bg-muted px-1 text-center font-sans">
                ↑
              </kbd>
              <kbd className="min-w-4 rounded border border-border bg-muted px-1 text-center font-sans">
                ↓
              </kbd>
              {t("commandMenu.hint.navigate")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="min-w-4 rounded border border-border bg-muted px-1 text-center font-sans">
                ↵
              </kbd>
              {t("commandMenu.hint.run")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1 text-center font-sans">
                {formatShortcutTokens("Escape", platform)[0]}
              </kbd>
              {t("commandMenu.hint.close")}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
