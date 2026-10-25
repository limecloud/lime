import { useRef } from "react";
import { Keyboard, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { bindingMatchesPrefix, captureBinding } from "@/lib/commands/bindings";
import {
  formatShortcutTokens,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";

export function ShortcutSearch({
  query,
  onQueryChange,
  byKeys,
  onModeChange,
  platform,
  bindings,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  byKeys: boolean;
  onModeChange: (value: boolean) => void;
  platform: HotkeyPlatform;
  bindings: readonly string[];
}) {
  const { t } = useTranslation("settings");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 focus-within:ring-1 focus-within:ring-ring">
      <Search
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={input}
        type="search"
        data-shortcut-capture
        readOnly={byKeys}
        value={
          byKeys && query
            ? formatShortcutTokens(query, platform).join(" ")
            : query
        }
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label={t(
          byKeys
            ? "settings.keyboardShortcuts.captureSearch"
            : "settings.keyboardShortcuts.search",
        )}
        placeholder={t(
          byKeys
            ? "settings.keyboardShortcuts.pressToSearch"
            : "settings.keyboardShortcuts.search",
        )}
        className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        onKeyDown={(event) => {
          if (event.key === "Tab") return;
          event.stopPropagation();
          if (
            event.key === "Escape" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey
          ) {
            event.preventDefault();
            onQueryChange("");
            onModeChange(false);
            return;
          }
          if (!byKeys) return;
          event.preventDefault();
          if (
            event.repeat ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          const binding = captureBinding(event);
          if (binding) {
            const sequence = query ? `${query} ${binding}` : binding;
            onQueryChange(
              bindings.some((candidate) =>
                bindingMatchesPrefix(candidate, sequence, platform),
              )
                ? sequence
                : binding,
            );
          }
        }}
      />
      <button
        type="button"
        aria-label={t("settings.keyboardShortcuts.searchByKeys")}
        aria-pressed={byKeys}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent aria-pressed:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onQueryChange("");
          onModeChange(!byKeys);
          input.current?.focus();
        }}
      >
        <Keyboard className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
