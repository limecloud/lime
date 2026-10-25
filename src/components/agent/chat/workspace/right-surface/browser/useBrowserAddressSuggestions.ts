import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  listBrowserHistory,
  listenBrowserHistoryChanged,
  type BrowserHistoryEntry,
} from "@/lib/api/browserHistory";

const EMPTY_ENTRIES: BrowserHistoryEntry[] = [];

function completionFor(value: string, url: string): string | null {
  if (!value || value.trim() !== value || /\s/u.test(value)) return null;
  const candidate = /^https?:\/\//iu.test(value)
    ? url
    : url.replace(/^https?:\/\//iu, "");
  return candidate.toLocaleLowerCase().startsWith(value.toLocaleLowerCase()) &&
    candidate.length > value.length
    ? value + candidate.slice(value.length)
    : null;
}

/** Presentation only: history and navigation remain owned by the current native browser. */
export function useBrowserAddressSuggestions({
  value,
  active,
  ownerKey,
  input,
  onChange,
}: {
  value: string;
  active: boolean;
  ownerKey: string | null;
  input: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState<{
    owner: string | null;
    text: string;
  } | null>(null);
  const [result, setResult] = useState<{
    query: typeof query;
    entries: BrowserHistoryEntry[];
  }>({ query: null, entries: [] });
  const [selection, setSelection] = useState(-1);
  const [revision, setRevision] = useState(0);
  const current = useRef({ value, active, ownerKey, onChange });
  current.current = { value, active, ownerKey, onChange };
  const allowCompletion = useRef(false);
  const composing = useRef(false);
  const suppressNext = useRef(false);
  const previousOwner = useRef(ownerKey);
  const caret = useRef<{ value: string; start: number } | null>(null);
  const inlineTarget = useRef<{ value: string; url: string } | null>(null);
  const entries =
    active &&
    query?.owner === ownerKey &&
    result.query === query &&
    (value === query?.text ||
      value === inlineTarget.current?.value ||
      value === result.entries[selection]?.url)
      ? result.entries
      : EMPTY_ENTRIES;

  useLayoutEffect(() => {
    if (previousOwner.current !== ownerKey) {
      previousOwner.current = ownerKey;
      setQuery(null);
      setSelection(-1);
      caret.current = null;
      composing.current = false;
      inlineTarget.current = null;
    }
  }, [ownerKey]);
  useLayoutEffect(() => {
    const pending = caret.current;
    if (pending && pending.value === value && input.current?.value === value) {
      input.current.setSelectionRange(pending.start, value.length);
      caret.current = null;
    }
  }, [input, value]);
  useEffect(() => {
    if (!active) {
      setQuery(null);
      setSelection(-1);
      caret.current = null;
      composing.current = false;
    }
  }, [active, ownerKey]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listenBrowserHistoryChanged(() => {
      if (!disposed) {
        allowCompletion.current = false;
        setResult({ query: null, entries: EMPTY_ENTRIES });
        setSelection(-1);
        setRevision((count) => count + 1);
      }
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [active, ownerKey]);
  useEffect(() => {
    if (
      !active ||
      !query ||
      query.owner !== ownerKey ||
      query.text.length > 256
    )
      return;
    let disposed = false;
    void listBrowserHistory({ query: query.text, limit: 50 })
      .then((page) => {
        if (
          disposed ||
          !current.current.active ||
          current.current.ownerKey !== query.owner
        )
          return;
        const entries = [...page.entries]
          .sort(
            (a, b) =>
              Number(Boolean(completionFor(query.text, b.url))) -
                Number(Boolean(completionFor(query.text, a.url))) ||
              b.visitCount - a.visitCount ||
              b.lastVisitedAt - a.lastVisitedAt,
          )
          .slice(0, 8);
        setResult({ query, entries });
        setSelection(-1);
        const element = input.current;
        const completed =
          entries[0] && completionFor(query.text, entries[0].url);
        if (
          completed &&
          allowCompletion.current &&
          !composing.current &&
          element &&
          element.ownerDocument.activeElement === element &&
          element.value === query.text &&
          element.selectionStart === query.text.length &&
          element.selectionEnd === query.text.length
        ) {
          caret.current = { value: completed, start: query.text.length };
          inlineTarget.current = { value: completed, url: entries[0].url };
          setSelection(0);
          current.current.onChange(completed);
        }
      })
      .catch(() => {
        if (!disposed) {
          setResult({ query, entries: [] });
          setSelection(-1);
        }
      });
    return () => {
      disposed = true;
    };
  }, [active, input, ownerKey, query, revision]);

  const dismiss = () => {
    setQuery(null);
    setSelection(-1);
    caret.current = null;
    inlineTarget.current = null;
    allowCompletion.current = false;
  };
  const edit = (text: string, complete = true) => {
    allowCompletion.current =
      complete && !composing.current && !suppressNext.current;
    suppressNext.current = false;
    caret.current = null;
    inlineTarget.current = null;
    onChange(text);
    setSelection(-1);
    setQuery(composing.current ? null : { owner: ownerKey, text });
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return false;
    if (
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      allowCompletion.current = false;
      suppressNext.current = true;
      setSelection(-1);
    }
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      entries.length
    ) {
      event.preventDefault();
      const next =
        (selection +
          (event.key === "ArrowDown" ? 1 : -1) +
          entries.length +
          1) %
        (entries.length + 1);
      const index = next === entries.length ? -1 : next;
      const text = index < 0 ? query!.text : entries[index].url;
      allowCompletion.current = false;
      caret.current = { value: text, start: text.length };
      setSelection(index);
      onChange(text);
      return true;
    }
    if (event.key === "Tab") dismiss();
    return false;
  };
  return {
    entries,
    selection,
    edit,
    dismiss,
    keyDown,
    submitValue:
      selection >= 0 && entries[selection]
        ? entries[selection].url
        : inlineTarget.current?.value === value
          ? inlineTarget.current.url
          : value,
    compositionStart: () => {
      composing.current = true;
      dismiss();
    },
    compositionEnd: (text: string) => {
      composing.current = false;
      edit(text, false);
    },
  };
}
