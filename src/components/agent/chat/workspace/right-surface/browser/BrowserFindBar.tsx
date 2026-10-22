import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  findInBrowserTab,
  stopFindInBrowserTab,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import {
  browserIconButton,
  type BrowserTranslate,
  type RunBrowserOperation,
} from "./BrowserNavigationBar";

export function BrowserFindBar({
  selected,
  translate,
  run,
  onClose,
}: {
  selected: BrowserTabState;
  translate: BrowserTranslate;
  run: RunBrowserOperation;
  onClose: () => void;
}) {
  const [value, setValue] = useState(selected.find?.text ?? "");
  const tabId = selected.tabId;
  useEffect(
    () => () => {
      void run(() => stopFindInBrowserTab(tabId));
    },
    [run, tabId],
  );
  const find = (text: string, forward: boolean, findNext: boolean) => {
    if (text) {
      void run(() => findInBrowserTab({ tabId, text, forward, findNext }));
    } else {
      void run(() => stopFindInBrowserTab(tabId));
    }
  };
  const result = selected.find?.text === value ? selected.find : null;

  return (
    <form
      className="flex h-9 shrink-0 items-center gap-1 border-b border-[color:var(--lime-surface-border)] px-2"
      onSubmit={(event) => event.preventDefault()}
    >
      <Search className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
      <input
        aria-label={translate("agentChat.browserWorkspace.findInput")}
        autoFocus
        className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
        data-testid="browser-workspace-find-input"
        onChange={(event) => {
          const text = event.target.value;
          setValue(text);
          if (!(event.nativeEvent as InputEvent).isComposing)
            find(text, true, false);
        }}
        onCompositionEnd={(event) =>
          find(event.currentTarget.value, true, false)
        }
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            find(value, !event.shiftKey, true);
          }
        }}
        placeholder={translate("agentChat.browserWorkspace.findPlaceholder")}
        value={value}
      />
      <span
        aria-live="polite"
        className="min-w-10 text-center text-[11px] text-[color:var(--lime-text-muted)]"
      >
        {translate("agentChat.browserWorkspace.findMatchCount", {
          active: result?.activeMatchOrdinal ?? 0,
          total: result?.matches ?? 0,
        })}
      </span>
      {(
        [
          ["findPrevious", ChevronUp, () => find(value, false, true)],
          ["findNext", ChevronDown, () => find(value, true, true)],
          ["closeFind", X, onClose],
        ] as const
      ).map(([key, Icon, onClick]) => (
        <button
          aria-label={translate(`agentChat.browserWorkspace.${key}`)}
          className={browserIconButton}
          key={key}
          onClick={onClick}
          title={translate(`agentChat.browserWorkspace.${key}`)}
          type="button"
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </form>
  );
}
