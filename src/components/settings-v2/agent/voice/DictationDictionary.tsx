import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MAX_DICTATION_DICTIONARY_ENTRIES,
  normalizeDictationDictionary,
} from "@/lib/dictationDictionary";
import { SettingsAction, SettingsRow } from "../../SettingsPrimitives";

interface DictionaryRow {
  id: number;
  text: string;
}

function equalEntries(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length && left.every((text, i) => text === right[i])
  );
}

const EXAMPLE_ENTRIES = [
  "Jane Doe",
  "Acme Widget",
  "checkout-form.tsx",
  "useCartState",
];

export function DictationDictionary({
  value,
  disabled,
  cleanupEnabled,
  onSave,
}: {
  value: readonly string[];
  disabled: boolean;
  cleanupEnabled: boolean;
  onSave: (entries: string[]) => Promise<boolean>;
}) {
  const { t } = useTranslation("settings");
  const nextId = useRef(0);
  const makeRows = useCallback(
    (entries: readonly string[]) =>
      (entries.length ? entries : [""]).map((text) => ({
        id: nextId.current++,
        text,
      })),
    [],
  );
  const [rows, setRows] = useState(() => makeRows(value));
  const rowsRef = useRef(rows);
  const confirmed = useRef(normalizeDictationDictionary(value));
  const received = useRef(normalizeDictationDictionary(value));
  const revision = useRef(0);
  const dirty = useRef(false);
  const pending = useRef(false);
  const requested = useRef(false);
  const mounted = useRef(true);
  const skipBlur = useRef(false);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const onSaveRef = useRef(onSave);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // 自己的串行写入期间允许继续编辑；其它配置写入期间互斥。
  const blocked = disabled && !saving;

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const entries = normalizeDictationDictionary(value);
    if (equalEntries(entries, received.current)) return;
    received.current = entries;
    if (pending.current || equalEntries(entries, confirmed.current)) return;
    confirmed.current = entries;
    if (!dirty.current) {
      const next = makeRows(entries);
      rowsRef.current = next;
      setRows(next);
    }
  }, [value, makeRows]);
  useLayoutEffect(() => {
    if (focusId === null) return;
    inputs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const changeRows = (next: DictionaryRow[]) => {
    revision.current += 1;
    dirty.current = true;
    rowsRef.current = next;
    setRows(next);
  };

  const commit = async () => {
    if (blocked || !mounted.current) return;
    requested.current = true;
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      while (requested.current && mounted.current) {
        requested.current = false;
        const entries = normalizeDictationDictionary(
          rowsRef.current.map((row) => row.text),
        );
        const savedRevision = revision.current;
        if (!equalEntries(entries, confirmed.current)) {
          let success = false;
          try {
            success = await onSaveRef.current(entries);
          } catch {
            /* 草稿保留供重试。 */
          }
          if (!mounted.current) return;
          if (!success) {
            setFailed(true);
            return;
          }
          confirmed.current = entries;
        }
        setFailed(false);
        if (savedRevision === revision.current) {
          dirty.current = false;
          // 清理空行，保留正在编辑的行及其 identity 和焦点。
          const trimmed = rowsRef.current.map((row) => ({
            ...row,
            text: row.text.trim(),
          }));
          const retained = trimmed.filter(
            (row) =>
              row.text.length > 0 ||
              inputs.current.get(row.id) === document.activeElement,
          );
          const next = retained.length ? retained : [trimmed[0]];
          rowsRef.current = next;
          setRows(next);
        }
      }
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const insert = (index: number) => {
    if (blocked || rowsRef.current.length >= MAX_DICTATION_DICTIONARY_ENTRIES)
      return;
    skipBlur.current = [...inputs.current.values()].includes(
      document.activeElement as HTMLInputElement,
    );
    const entry = { id: nextId.current++, text: "" };
    const next = [...rowsRef.current];
    next.splice(index, 0, entry);
    changeRows(next);
    setFocusId(entry.id);
  };

  const remove = (row: DictionaryRow, index: number) => {
    const hadFocus = inputs.current
      .get(row.id)
      ?.parentElement?.contains(document.activeElement);
    let next = rowsRef.current.filter((entry) => entry.id !== row.id);
    if (!next.length) next = makeRows([]);
    changeRows(next);
    if (hadFocus) setFocusId(next[Math.min(index, next.length - 1)].id);
    void commit();
  };

  return (
    <>
      <SettingsRow
        targetId="voice-dictionary"
        label={t("settings.voice.dictionary.label")}
        description={t("settings.voice.dictionary.description")}
      >
        <SettingsAction
          type="button"
          disabled={blocked || rows.length >= MAX_DICTATION_DICTIONARY_ENTRIES}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insert(rowsRef.current.length)}
        >
          <Plus aria-hidden="true" />
          {t("settings.voice.dictionary.addEntry")}
        </SettingsAction>
      </SettingsRow>
      <div
        role="group"
        aria-labelledby="voice-dictionary-label"
        aria-busy={saving}
        className="space-y-2 py-3"
      >
        {rows.map((row, index) => (
          <div key={row.id} className="flex min-w-0 items-center gap-2">
            <input
              ref={(element) => {
                if (element) inputs.current.set(row.id, element);
                else inputs.current.delete(row.id);
              }}
              type="text"
              placeholder={EXAMPLE_ENTRIES[index] ?? EXAMPLE_ENTRIES[0]}
              value={row.text}
              disabled={blocked}
              aria-label={t("settings.voice.dictionary.entryLabel", {
                index: index + 1,
              })}
              className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-[13px] text-foreground outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              onChange={(event) =>
                changeRows(
                  rowsRef.current.map((entry) =>
                    entry.id === row.id
                      ? { ...entry, text: event.target.value }
                      : entry,
                  ),
                )
              }
              onBlur={() => {
                if (skipBlur.current) {
                  skipBlur.current = false;
                  return;
                }
                void commit();
              }}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return;
                event.preventDefault();
                insert(index + 1);
              }}
            />
            <SettingsAction
              type="button"
              aria-label={t("settings.voice.dictionary.removeEntry", {
                index: index + 1,
              })}
              disabled={blocked || (rows.length === 1 && row.text.length === 0)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => remove(row, index)}
            >
              <Trash2 aria-hidden="true" />
            </SettingsAction>
          </div>
        ))}
        {!cleanupEnabled ? (
          <p className="text-[12px] leading-4 text-muted-foreground">
            {t("settings.voice.dictionary.cleanupDisabled")}
          </p>
        ) : null}
        {rows.length >= MAX_DICTATION_DICTIONARY_ENTRIES ? (
          <p className="text-[12px] leading-4 text-muted-foreground">
            {t("settings.voice.dictionary.limit", {
              count: MAX_DICTATION_DICTIONARY_ENTRIES,
            })}
          </p>
        ) : null}
        {failed ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 text-[12px] text-destructive"
          >
            <span>{t("settings.voice.dictionary.saveError")}</span>
            <SettingsAction
              type="button"
              disabled={blocked || saving}
              onClick={() => void commit()}
            >
              {t("settings.voice.page.retry")}
            </SettingsAction>
          </div>
        ) : null}
      </div>
    </>
  );
}
