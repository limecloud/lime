import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, History, LoaderCircle, Search } from "lucide-react";
import { normalizeBrowserAddress } from "./browserWorkspaceModel";
import type { BrowserTranslate } from "./BrowserNavigationBar";
import { useBrowserAddressSuggestions } from "./useBrowserAddressSuggestions";

export function BrowserNewTabAddress({
  sourceTabId,
  active,
  draft,
  onDraftChange,
  onOpenAddress,
  translate,
}: {
  sourceTabId: string;
  active: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onOpenAddress: (sourceTabId: string, url: string) => Promise<void>;
  translate: BrowserTranslate;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const alive = useRef(false);
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const suggestions = useBrowserAddressSuggestions({
    value: draft,
    active: active && focused && !pending,
    ownerKey: sourceTabId,
    input,
    onChange: onDraftChange,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      composing.current = false;
      return;
    }
    input.current?.focus();
    const focusAddress = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", focusAddress);
    return () => window.removeEventListener("keydown", focusAddress);
  }, [active]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await openAddress(suggestions.submitValue);
  };
  const openAddress = async (address: string) => {
    if (!active || submitting.current || composing.current) return;
    let url: string;
    try {
      url = normalizeBrowserAddress(address);
    } catch {
      setFailed(true);
      return;
    }
    if (!url) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
    suggestions.dismiss();
    try {
      await onOpenAddress(sourceTabId, url);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      submitting.current = false;
      if (alive.current) setPending(false);
    }
  };

  return (
    <div
      className="mx-auto w-full max-w-xl"
      data-testid="browser-new-tab-address-bar"
    >
      <form
        onSubmit={(event) => void submit(event)}
        aria-busy={pending}
        className="flex h-8 items-center gap-2 rounded-lg bg-[color:var(--lime-chrome-tab-hover)] px-3 text-[color:var(--lime-text-muted)] focus-within:ring-1 focus-within:ring-[color:var(--lime-surface-border)]"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          ref={input}
          type="text"
          value={draft}
          disabled={!active}
          readOnly={pending}
          aria-label={translate("agentChat.browserWorkspace.address")}
          aria-invalid={failed}
          aria-describedby={
            failed ? `browser-new-tab-error-${sourceTabId}` : undefined
          }
          placeholder={translate(
            "agentChat.browserWorkspace.addressPlaceholder",
          )}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={suggestions.entries.length > 0}
          aria-controls={suggestions.entries.length ? listId : undefined}
          aria-activedescendant={
            suggestions.selection >= 0 && suggestions.entries.length
              ? `${listId}-${suggestions.selection}`
              : undefined
          }
          aria-haspopup="listbox"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="url"
          data-testid="browser-new-tab-address"
          onChange={(event) => {
            suggestions.edit(event.target.value);
            setFailed(false);
          }}
          onCompositionStart={() => {
            composing.current = true;
            suggestions.compositionStart();
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            suggestions.compositionEnd(event.currentTarget.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            suggestions.dismiss();
          }}
          onKeyDown={(event) => {
            if (suggestions.keyDown(event)) return;
            if (
              event.key === "Enter" &&
              (composing.current ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229)
            )
              event.preventDefault();
            if (
              event.key === "Escape" &&
              !composing.current &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.stopPropagation();
              onDraftChange("");
              setFailed(false);
              event.currentTarget.blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-[color:var(--lime-text)] outline-none placeholder:text-[color:var(--lime-text-muted)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!active || pending || !draft.trim()}
          aria-label={translate(
            pending
              ? "agentChat.browserWorkspace.loading"
              : "agentChat.browserWorkspace.address",
          )}
          className="rounded p-1 hover:bg-[color:var(--lime-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
          data-testid="browser-new-tab-open"
        >
          {pending ? (
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ArrowRight className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </form>
      {suggestions.entries.length ? (
        <div
          id={listId}
          role="listbox"
          aria-label={translate("browserChrome.addressSuggestions")}
          className="mt-1 overflow-hidden rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 shadow-md"
        >
          {suggestions.entries.map((entry, index) => (
            <button
              key={entry.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={suggestions.selection === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void openAddress(entry.url)}
              className={`flex h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[color:var(--lime-chrome-tab-hover)] ${suggestions.selection === index ? "bg-[color:var(--lime-chrome-tab-hover)]" : ""}`}
            >
              <History
                className="size-3.5 shrink-0 text-[color:var(--lime-text-muted)]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-[color:var(--lime-text-strong)]">
                  {entry.title || entry.url}
                </span>
                <span
                  className="block truncate text-[11px] text-[color:var(--lime-text-muted)]"
                  dir="ltr"
                >
                  {entry.url}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {failed ? (
        <p
          role="alert"
          id={`browser-new-tab-error-${sourceTabId}`}
          className="mt-2 text-xs text-destructive"
        >
          {translate("agentChat.browserWorkspace.loadFailedTitle")}
        </p>
      ) : null}
    </div>
  );
}
