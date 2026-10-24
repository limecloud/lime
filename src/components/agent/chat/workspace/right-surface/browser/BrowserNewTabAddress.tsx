import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { normalizeBrowserAddress } from "./browserWorkspaceModel";
import type { BrowserTranslate } from "./BrowserNavigationBar";

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
    if (!active || submitting.current || composing.current) return;
    let url: string;
    try {
      url = normalizeBrowserAddress(draft);
    } catch {
      setFailed(true);
      return;
    }
    if (!url) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
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
          autoCapitalize="off"
          spellCheck={false}
          inputMode="url"
          data-testid="browser-new-tab-address"
          onChange={(event) => {
            onDraftChange(event.target.value);
            setFailed(false);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
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
