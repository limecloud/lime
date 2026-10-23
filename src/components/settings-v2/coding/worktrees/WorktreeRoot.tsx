import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsAction, SettingsRow } from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";

export function WorktreeRoot({
  saved,
  saving,
  save,
}: {
  saved: string;
  saving: boolean;
  save: (value: string) => Promise<boolean>;
}) {
  const { t } = useTranslation("settings");
  const [value, setValue] = useState(saved);
  const [failed, setFailed] = useState(false);
  const baseline = useRef(saved);
  const pending = useRef(false);
  useEffect(() => {
    const previous = baseline.current;
    setValue((current) => (current === previous ? saved : current));
    baseline.current = saved;
  }, [saved]);
  useSettingsDraft({ dirty: value !== saved, saving });
  const flush = async () => {
    if (saving || pending.current) return;
    const next = value.trim();
    if (next === saved) {
      setValue(next);
      setFailed(false);
      return;
    }
    pending.current = true;
    try {
      const success = await save(next);
      setFailed(!success);
      if (success) setValue(next);
    } finally {
      pending.current = false;
    }
  };
  return (
    <SettingsRow
      targetId="worktrees-root"
      label={t("settings.worktrees.root")}
      description={t("settings.worktrees.rootDescription")}
    >
      <div className="flex min-w-0 flex-col items-end gap-2">
        <input
          id="worktrees-root-input"
          aria-labelledby="worktrees-root-label"
          aria-describedby="worktrees-root-description"
          aria-invalid={failed}
          className="h-8 w-72 max-w-full rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          value={value}
          disabled={saving}
          onChange={(event) => {
            setValue(event.target.value);
            setFailed(false);
          }}
          onBlur={() => void flush()}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              event.stopPropagation();
              void flush();
            }
          }}
        />
        {failed ? (
          <div
            role="alert"
            className="flex items-center gap-2 text-[12px] text-[color:var(--lime-danger)]"
          >
            {t("settings.worktrees.rootSaveFailed")}
            <SettingsAction disabled={saving} onClick={() => void flush()}>
              {t("settings.worktrees.retry")}
            </SettingsAction>
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}
