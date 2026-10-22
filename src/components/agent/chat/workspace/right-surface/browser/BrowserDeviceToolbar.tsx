import { useEffect, useRef, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  setBrowserTabDevice,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import type { EmbeddedBrowserDeviceState } from "@/lib/api/embeddedBrowser";
import {
  browserIconButton,
  type RunBrowserOperation,
} from "./BrowserNavigationBar";

export function BrowserDeviceToolbar({
  selected,
  run,
}: {
  selected: BrowserTabState;
  run: RunBrowserOperation;
}) {
  const { t } = useTranslation("agent");
  const device = selected.device!;
  const [draft, setDraft] = useState(device);
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const { width, height, deviceScaleFactor, scale, mobile } = device;
  useEffect(() => {
    setDraft({ width, height, deviceScaleFactor, scale, mobile });
    setInvalid(false);
  }, [selected.tabId, width, height, deviceScaleFactor, scale, mobile]);
  const apply = async (next: EmbeddedBrowserDeviceState | null) => {
    if (pendingRef.current) return;
    if (
      next &&
      (!Number.isInteger(next.width) ||
        next.width < 100 ||
        next.width > 10000 ||
        !Number.isInteger(next.height) ||
        next.height < 100 ||
        next.height > 10000 ||
        !Number.isFinite(next.deviceScaleFactor) ||
        next.deviceScaleFactor < 0 ||
        next.deviceScaleFactor > 8 ||
        !Number.isFinite(next.scale) ||
        next.scale < 0.1 ||
        next.scale > 3)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    pendingRef.current = true;
    setPending(true);
    try {
      await run(() => setBrowserTabDevice(selected.tabId, next));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const input = (
    key: "width" | "height" | "deviceScaleFactor" | "scale",
    name: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <input
      aria-label={name}
      title={name}
      data-testid={`browser-device-${key}`}
      type="number"
      min={min}
      max={max}
      step={step}
      className="h-6 w-14 rounded border border-border bg-background px-1 text-center text-xs"
      value={Number.isNaN(draft[key]) ? "" : draft[key]}
      disabled={pending}
      onChange={(event) =>
        setDraft((value) => ({ ...value, [key]: event.target.valueAsNumber }))
      }
    />
  );
  return (
    <div
      className="shrink-0 border-b border-border bg-[color:var(--lime-surface-muted)] px-2 py-1"
      data-testid="browser-device-toolbar"
    >
      <form
        className="flex flex-wrap items-center justify-center gap-1 text-xs"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void apply(draft);
        }}
      >
        <select
          aria-label={t("browserChrome.device")}
          className="h-6 rounded bg-background px-1"
          disabled={pending}
          value="responsive"
          onChange={(event) => {
            const preset = event.target.value;
            if (preset === "phone")
              void apply({
                width: 390,
                height: 844,
                deviceScaleFactor: 3,
                scale: 0.5,
                mobile: true,
              });
            if (preset === "tablet")
              void apply({
                width: 820,
                height: 1180,
                deviceScaleFactor: 2,
                scale: 0.5,
                mobile: true,
              });
          }}
        >
          <option value="responsive">{t("browserChrome.responsive")}</option>
          <option value="phone">{t("browserChrome.phone")}</option>
          <option value="tablet">{t("browserChrome.tablet")}</option>
        </select>
        {input("width", t("browserChrome.width"), 100, 10000)}
        <span aria-hidden>×</span>
        {input("height", t("browserChrome.height"), 100, 10000)}
        <span title={t("browserChrome.dpr")}>
          {t("browserChrome.dprLabel")}
        </span>
        {input("deviceScaleFactor", t("browserChrome.dpr"), 0, 8, 0.1)}
        <select
          aria-label={t("browserChrome.scale")}
          className="h-6 rounded bg-background px-1"
          disabled={pending}
          value={draft.scale}
          onChange={(event) => {
            const scale = Number(event.target.value);
            setDraft((value) => ({ ...value, scale }));
            void apply({ ...draft, scale });
          }}
        >
          {[
            0.25,
            0.5,
            0.75,
            1,
            ...(![0.25, 0.5, 0.75, 1].includes(draft.scale)
              ? [draft.scale]
              : []),
          ].map((value) => (
            <option key={value} value={value}>
              {Math.round(value * 100)}%
            </option>
          ))}
        </select>
        <button
          className="h-6 rounded px-2 hover:bg-muted"
          type="submit"
          disabled={pending}
        >
          {t("browserChrome.apply")}
        </button>
        <button
          className={browserIconButton}
          type="button"
          title={t("browserChrome.rotate")}
          aria-label={t("browserChrome.rotate")}
          disabled={pending}
          onClick={() => {
            const next = { ...draft, width: draft.height, height: draft.width };
            setDraft(next);
            void apply(next);
          }}
        >
          <RotateCw className="size-3.5" />
        </button>
        <button
          className={browserIconButton}
          type="button"
          title={t("browserChrome.closeDevice")}
          aria-label={t("browserChrome.closeDevice")}
          disabled={pending}
          onClick={() => void apply(null)}
        >
          <X className="size-3.5" />
        </button>
      </form>
      {invalid ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("browserChrome.deviceError")}
        </p>
      ) : null}
    </div>
  );
}
