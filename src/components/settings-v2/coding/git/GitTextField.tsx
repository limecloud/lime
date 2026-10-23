import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";

export function GitTextField({
  targetId,
  label,
  description,
  placeholder,
  savedValue,
  multiline = false,
  save,
}: {
  targetId: string;
  label: string;
  description: string;
  placeholder?: string;
  savedValue: string;
  multiline?: boolean;
  save: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const [value, setValue] = useState(savedValue);
  const [status, setStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error"
  >("idle");
  const current = useRef({
    value: savedValue,
    saved: savedValue,
    inFlight: false,
    flushAgain: false,
    failed: false,
  });
  const alive = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  const flushRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const draft = current.current;
    if (!draft.inFlight && draft.value === draft.saved) {
      draft.value = savedValue;
      setValue(savedValue);
    }
    draft.saved = savedValue;
  }, [savedValue]);
  const flush = useCallback(async () => {
    const draft = current.current;
    if (draft.inFlight) {
      draft.flushAgain = true;
      return;
    }
    if (draft.value === draft.saved) {
      if (alive.current) setStatus("idle");
      return;
    }
    const submitted = draft.value;
    draft.inFlight = true;
    draft.failed = false;
    draft.flushAgain = false;
    if (alive.current) setStatus("saving");
    try {
      await save(submitted);
      draft.saved = submitted;
      if (alive.current) {
        setStatus(draft.value === submitted ? "saved" : "dirty");
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          if (alive.current)
            setStatus((status) => (status === "saved" ? "idle" : status));
        }, 3000);
      }
    } catch {
      draft.failed = true;
      if (alive.current) setStatus("error");
      draft.flushAgain = false;
    } finally {
      draft.inFlight = false;
      if (draft.flushAgain) void flushRef.current();
    }
  }, [save]);
  flushRef.current = flush;
  useEffect(() => {
    const draft = current.current;
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(savedTimer.current);
      if (!draft.failed) void flushRef.current();
    };
  }, []);
  useEffect(() => {
    if (!multiline || current.current.value === current.current.saved) return;
    const timer = setTimeout(() => void flushRef.current(), 3000);
    return () => clearTimeout(timer);
  }, [value, multiline]);
  useSettingsDraft({
    dirty: status === "error",
    saving: current.current.inFlight,
  });
  const inputProps = {
    id: `${targetId}-input`,
    value,
    "aria-label": label,
    "aria-describedby": `${targetId}-description`,
    "aria-invalid": status === "error",
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      current.current.value = event.target.value;
      current.current.failed = false;
      setValue(event.target.value);
      setStatus(
        event.target.value === current.current.saved ? "idle" : "dirty",
      );
    },
    onKeyDown: (
      event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (
        !event.nativeEvent.isComposing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        event.stopPropagation();
        void flush();
      }
    },
  };
  const state = (
    <>
      {status === "error" ? (
        <span
          role="alert"
          className="text-[12px] text-[color:var(--lime-danger)]"
        >
          {t("settings.git.saveFailed")}
        </span>
      ) : null}
      {status === "saved" ? (
        <span role="status" className="text-[12px] text-muted-foreground">
          {t("settings.git.saved")}
        </span>
      ) : null}
      {status === "dirty" || status === "error" || status === "saving" ? (
        <SettingsAction
          type="button"
          disabled={status === "saving"}
          onClick={() => void flush()}
        >
          {t(status === "saving" ? "settings.git.saving" : "settings.git.save")}
        </SettingsAction>
      ) : null}
    </>
  );
  if (!multiline)
    return (
      <SettingsRow targetId={targetId} label={label} description={description}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            {...inputProps}
            disabled={status === "saving"}
            maxLength={128}
            onBlur={() => void flush()}
            placeholder={placeholder}
            className="h-8 w-56 max-w-full rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
          {status === "error" ? state : null}
        </div>
      </SettingsRow>
    );
  return (
    <SettingsSection
      title={label}
      actions={state}
      id={targetId}
      data-settings-search-target={targetId}
      tabIndex={-1}
    >
      <p
        id={`${targetId}-description`}
        className="mb-3 text-[12px] leading-4 text-muted-foreground"
      >
        {description}
      </p>
      <textarea
        {...inputProps}
        rows={6}
        placeholder={placeholder}
        className="block min-h-36 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] leading-5 outline-none focus:ring-2 focus:ring-ring"
      />
    </SettingsSection>
  );
}
