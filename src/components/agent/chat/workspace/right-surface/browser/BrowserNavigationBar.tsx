import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight, Globe2, Lock, RotateCw, X } from "lucide-react";
import {
  goBackBrowserTab,
  goForwardBrowserTab,
  focusBrowserTabPage,
  navigateBrowserTab,
  reloadBrowserTab,
  stopBrowserTab,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import {
  normalizeBrowserAddress,
  resolveBrowserAddressValue,
} from "./browserWorkspaceModel";
import { useBrowserPreferences } from "@/hooks/useBrowserPreferences";
import { useBrowserAddressSuggestions } from "./useBrowserAddressSuggestions";
import { useBrowserAddressMenu } from "./useBrowserAddressMenu";

export type BrowserTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;
export type RunBrowserOperation = (
  operation: () => Promise<BrowserTabState>,
  isValid?: () => boolean,
) => Promise<void>;
export const browserIconButton =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--lime-text-muted)] transition hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)] disabled:pointer-events-none disabled:opacity-35";

export function BrowserNavigationBar({
  selected,
  translate,
  run,
  actions,
  annotationAction,
  addressFocusRequest = 0,
  active = true,
}: {
  selected: BrowserTabState | null;
  translate: BrowserTranslate;
  run: RunBrowserOperation;
  actions?: ReactNode;
  annotationAction?: ReactNode;
  addressFocusRequest?: number;
  active?: boolean;
}) {
  const url = selected ? resolveBrowserAddressValue(selected.url) : "";
  const settings = useBrowserPreferences();
  const [focused, setFocused] = useState(false);
  const [address, setAddress] = useState(url);
  const composing = useRef(false);
  const edited = useRef(false);
  const pendingTabs = useRef(new Set<string>());
  const addressRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const focusGeneration = useRef(0);
  const identity = selected
    ? JSON.stringify([
        selected.browserSessionId,
        selected.threadId,
        selected.tabId,
        selected.viewId,
        selected.webContentsId,
      ])
    : null;
  const previous = useRef({ identity, url });
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const suggestions = useBrowserAddressSuggestions({
    value: address,
    active: active && focused && Boolean(selected),
    ownerKey: identity,
    input: addressRef,
    onChange: setAddress,
  });
  useBrowserAddressMenu({
    selected,
    input: addressRef,
    entries: suggestions.entries,
    selection: suggestions.selection,
    onSelect: (value) => openAddress(value),
    onDismiss: suggestions.dismiss,
  });
  useEffect(() => {
    if (!active) addressRef.current?.blur();
  }, [active]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const changedOwner = previous.current.identity !== identity;
    if (changedOwner) focusGeneration.current += 1;
    if (!changedOwner && previous.current.url === url) return;
    previous.current = { identity, url };
    const cancelEditing = changedOwner || (focused && edited.current);
    edited.current = false;
    composing.current = false;
    setAddress(url);
    if (cancelEditing) {
      setFocused(false);
      addressRef.current?.blur();
    }
  }, [identity, url, focused]);
  useLayoutEffect(() => {
    if (focused) addressRef.current?.select();
  }, [focused]);
  useEffect(() => {
    if (addressFocusRequest > 0) {
      addressRef.current?.focus();
      addressRef.current?.select();
    }
  }, [addressFocusRequest]);
  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    openAddress(suggestions.submitValue);
  };
  const openAddress = (draft: string) => {
    if (
      !selected ||
      !active ||
      composing.current ||
      !draft.trim() ||
      pendingTabs.current.has(selected.tabId)
    )
      return;
    const tab = selected;
    pendingTabs.current.add(tab.tabId);
    void run(async () => {
      const target = normalizeBrowserAddress(draft);
      if (!target) return tab;
      suggestions.dismiss();
      addressRef.current?.blur();
      setAddress(target);
      const generation = focusGeneration.current;
      const state = await (target === normalizeBrowserAddress(tab.url)
        ? reloadBrowserTab(tab.tabId)
        : navigateBrowserTab(tab.tabId, target));
      const input = addressRef.current;
      if (
        mounted.current &&
        currentIdentity.current === identity &&
        focusGeneration.current === generation &&
        input &&
        input.ownerDocument.activeElement === input.ownerDocument.body
      )
        return focusBrowserTabPage(tab);
      return state;
    }).finally(() => pendingTabs.current.delete(tab.tabId));
  };
  const iconButton = browserIconButton;
  let displayedAddress = address;
  if (!focused && !settings?.show_full_url && selected) {
    try {
      displayedAddress = new URL(selected.url).host;
    } catch {
      /* Keep the actual URL on invalid input. */
    }
  }
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[color:var(--lime-surface-border)] px-2">
      <button
        aria-label={translate("agentChat.browserWorkspace.back")}
        className={iconButton}
        data-testid="browser-workspace-back"
        disabled={!selected?.canGoBack}
        onClick={() =>
          selected && void run(() => goBackBrowserTab(selected.tabId))
        }
        title={translate("agentChat.browserWorkspace.back")}
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button
        aria-label={translate("agentChat.browserWorkspace.forward")}
        className={iconButton}
        data-testid="browser-workspace-forward"
        disabled={!selected?.canGoForward}
        onClick={() =>
          selected && void run(() => goForwardBrowserTab(selected.tabId))
        }
        title={translate("agentChat.browserWorkspace.forward")}
        type="button"
      >
        <ArrowRight className="h-4 w-4" />
      </button>
      <button
        aria-label={translate(
          selected?.isLoading
            ? "agentChat.browserWorkspace.stop"
            : "agentChat.browserWorkspace.refresh",
        )}
        className={iconButton}
        data-testid="browser-workspace-refresh"
        disabled={!selected}
        onClick={() =>
          selected &&
          void run(() =>
            selected.isLoading
              ? stopBrowserTab(selected.tabId)
              : reloadBrowserTab(selected.tabId),
          )
        }
        title={translate(
          selected?.isLoading
            ? "agentChat.browserWorkspace.stop"
            : "agentChat.browserWorkspace.refresh",
        )}
        type="button"
      >
        {selected?.isLoading ? (
          <X className="h-4 w-4" />
        ) : (
          <RotateCw className="h-4 w-4" />
        )}
      </button>
      {annotationAction}
      <form
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-muted)] px-2 focus-within:border-[color:var(--lime-accent)]"
        onSubmit={submitAddress}
      >
        {selected?.url.startsWith("https://") ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        ) : (
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
        )}
        <input
          ref={addressRef}
          aria-label={translate("agentChat.browserWorkspace.address")}
          className={`min-w-0 flex-1 bg-transparent text-xs text-[color:var(--lime-text-strong)] outline-none ${focused ? "text-left" : "text-center"}`}
          data-testid="browser-workspace-address"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={suggestions.entries.length > 0}
          aria-haspopup="listbox"
          dir="ltr"
          disabled={!selected || !active}
          onBlur={() => {
            edited.current = false;
            composing.current = false;
            setAddress(url);
            setFocused(false);
            suggestions.dismiss();
          }}
          onChange={(event) => {
            edited.current = true;
            suggestions.edit(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
            suggestions.compositionStart();
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            suggestions.compositionEnd(event.currentTarget.value);
          }}
          onFocus={(event) => {
            focusGeneration.current += 1;
            edited.current = false;
            composing.current = false;
            setFocused(true);
            setAddress(url);
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              composing.current
            ) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (suggestions.keyDown(event)) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setAddress(url);
              event.currentTarget.blur();
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text) return;
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            const value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
            input.value = value;
            const caret = start + text.length;
            input.setSelectionRange(caret, caret);
            edited.current = true;
            suggestions.edit(value, false);
          }}
          spellCheck={false}
          placeholder={translate(
            "agentChat.browserWorkspace.addressPlaceholder",
          )}
          value={displayedAddress}
        />
      </form>
      {actions}
    </div>
  );
}
