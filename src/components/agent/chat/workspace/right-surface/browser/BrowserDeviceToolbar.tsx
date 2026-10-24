import { useLayoutEffect, useRef, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BrowserTabState } from "@/lib/api/browserTab";
import { browserDevicePresets } from "@/lib/browserDevicePresets";
import {
  browserPageZoomFromRendered,
  renderedBrowserZoom,
} from "@/lib/browserZoom";
import {
  browserIconButton,
  type RunBrowserOperation,
} from "./BrowserNavigationBar";
import { browserDevicePreset, rotateBrowserDevice } from "./browserDeviceModel";
import { BrowserDeviceDimension } from "./BrowserDeviceDimension";
import { useBrowserDeviceControls } from "./useBrowserDeviceControls";

export function BrowserDeviceToolbar({
  selected,
  active = true,
  run,
}: {
  selected: BrowserTabState;
  active?: boolean;
  run: RunBrowserOperation;
}) {
  const { t } = useTranslation("agent");
  const device = selected.device!;
  const { pending, changeDevice, changeZoom, identity } =
    useBrowserDeviceControls(selected, active, run);
  const [draftRevision, setDraftRevision] = useState(0);
  const toolbarRef = useRef<HTMLFieldSetElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(Infinity);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setToolbarWidth(toolbar.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    measure();
    return () => observer.disconnect();
  }, []);
  const scale = selected.deviceViewport?.scale ?? device.scale;
  const zoom = renderedBrowserZoom(selected.zoomFactor ?? 1, scale);
  const zoomOptions = Array.from(
    new Set([50, 75, 100, 125, 150, 200, zoom]),
  ).sort((a, b) => a - b);
  const clearDrafts = () => setDraftRevision((value) => value + 1);
  const compact = toolbarWidth < 600;
  return (
    <fieldset
      ref={toolbarRef}
      disabled={!active}
      className="flex min-h-9 min-w-0 shrink-0 items-center gap-1 border-b border-border bg-[color:var(--lime-surface-muted)] px-2 py-1"
      data-testid="browser-device-toolbar"
      role="toolbar"
      aria-label={t("browserChrome.device")}
      aria-busy={pending}
    >
      <label
        htmlFor="browser-device-preset"
        className={
          toolbarWidth < 460
            ? "sr-only"
            : "min-w-0 max-w-28 shrink truncate text-sm font-medium"
        }
      >
        {t("browserChrome.dimensions")}
      </label>
      <select
        id="browser-device-preset"
        aria-label={t("browserChrome.device")}
        className={`h-7 min-w-[100px] truncate rounded-md border border-transparent bg-transparent px-1 text-sm font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${compact ? "w-[100px] max-w-[100px]" : "max-w-44"}`}
        value={browserDevicePreset(device)}
        onChange={(event) => {
          const preset = browserDevicePresets.find(
            (value) => value.id === event.currentTarget.value,
          );
          if (!preset) return;
          clearDrafts();
          changeDevice(
            (current) =>
              preset.id === "responsive"
                ? { ...current, presetId: preset.id }
                : {
                    ...current,
                    presetId: preset.id,
                    width: preset.width,
                    height: preset.height,
                  },
            true,
          );
          event.currentTarget.blur();
        }}
      >
        {browserDevicePresets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {t(preset.label)}
          </option>
        ))}
      </select>
      <div
        className="flex shrink-0 items-center gap-1"
        key={`${identity}:${active}:${draftRevision}`}
      >
        <BrowserDeviceDimension
          dimension="width"
          value={device.width}
          label={t("browserChrome.width")}
          onChange={(width) =>
            changeDevice((current) => ({
              ...current,
              presetId: "responsive",
              width,
            }))
          }
        />
        <span aria-hidden className="text-sm text-muted-foreground">
          ×
        </span>
        <BrowserDeviceDimension
          dimension="height"
          value={device.height}
          label={t("browserChrome.height")}
          onChange={(height) =>
            changeDevice((current) => ({
              ...current,
              presetId: "responsive",
              height,
            }))
          }
        />
      </div>
      <button
        className={`${browserIconButton} size-7 shrink-0`}
        type="button"
        title={t("browserChrome.rotate")}
        aria-label={t("browserChrome.rotate")}
        onClick={(event) => {
          clearDrafts();
          changeDevice(rotateBrowserDevice);
          event.currentTarget.blur();
        }}
      >
        <RotateCw className="size-4" />
      </button>
      {!compact ? (
        <select
          aria-label={t("browserChrome.zoom")}
          className="h-7 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-sm font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          value={zoom}
          onChange={(event) => {
            changeZoom(
              browserPageZoomFromRendered(
                Number(event.currentTarget.value),
                scale,
              ),
            );
            event.currentTarget.blur();
          }}
        >
          {zoomOptions.map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
      ) : null}
      <button
        className={`${browserIconButton} ms-auto size-7 shrink-0`}
        type="button"
        title={t("browserChrome.closeDevice")}
        aria-label={t("browserChrome.closeDevice")}
        onClick={(event) => {
          changeDevice(() => null);
          event.currentTarget.blur();
        }}
      >
        <X className="size-4" />
      </button>
    </fieldset>
  );
}
