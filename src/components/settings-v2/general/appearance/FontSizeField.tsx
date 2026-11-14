import { useEffect, useState } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";

const Field = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  input {
    width: 64px;
    height: 28px;
    border: 1px solid var(--lime-surface-border, hsl(var(--border)));
    border-radius: 8px;
    padding: 3px 8px;
    background: var(--lime-settings-surface, hsl(var(--background)));
    color: var(--lime-text-strong, hsl(var(--foreground)));
    font-size: 13px;
    line-height: 20px;
    font-variant-numeric: tabular-nums;
    text-align: end;
    outline: none;
  }
  input:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
  .font-size-unit {
    color: var(--lime-text-muted, hsl(var(--muted-foreground)));
    font-size: 12px;
    line-height: 16px;
  }
`;

export function FontSizeField({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation("settings");
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next >= min && next <= max) {
      if (next !== value) onChange(next);
      setDraft(String(next));
      return;
    }
    setDraft(String(value));
  };

  return (
    <Field>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
      <span className="font-size-unit" aria-hidden="true">
        {t("settings.appearance.fontSizeUnit")}
      </span>
    </Field>
  );
}
