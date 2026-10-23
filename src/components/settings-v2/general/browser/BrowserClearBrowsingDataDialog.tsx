import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Cookie,
  Download,
  FileInput,
  History,
  Image,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  BROWSER_DATA_TIME_RANGES,
  BROWSER_DATA_TYPES,
  type BrowserDataType,
} from "@/lib/api/browserDataTypes";
import type { useBrowserClearBrowsingData } from "./useBrowserClearBrowsingData";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";

const icons = {
  history: History,
  siteData: Cookie,
  cache: Image,
  downloads: Download,
  formData: FileInput,
  siteSettings: Settings2,
};
type Controller = ReturnType<typeof useBrowserClearBrowsingData>;

export function BrowserClearBrowsingDataDialog({
  controller: c,
}: {
  controller: Controller;
}) {
  const { t, i18n } = useTranslation("settings");
  const firstRangeRef = useRef<HTMLButtonElement>(null);
  const description = (type: BrowserDataType): string => {
    const summary = c.summary;
    if (type === "formData" || type === "siteSettings")
      return t(`browserData.description.${type}`);
    if (!summary) return "";
    if (type === "history") {
      const { firstSite, siteCount } = summary.history;
      if (!siteCount) return t("browserData.summary.historyEmpty");
      return siteCount === 1
        ? t("browserData.summary.historyOne", { site: firstSite })
        : t("browserData.summary.historyMany", {
            site: firstSite,
            count: siteCount - 1,
          });
    }
    if (type === "siteData")
      return summary.siteData
        ? t("browserData.summary.siteData", {
            count: summary.siteData.siteCount,
          })
        : "";
    if (type === "downloads")
      return summary.downloads
        ? t("browserData.summary.downloads", { count: summary.downloads.count })
        : "";
    return summary.cache
      ? t("browserData.summary.cache", {
          size: formatCacheSize(
            summary.cache.sizeBytes,
            i18n.resolvedLanguage ?? i18n.language,
          ),
        })
      : "";
  };
  const error =
    c.error?.kind === "unsupported"
      ? t("browserData.error.unsupported", {
          types: c.error.dataTypes
            .map((type) => t(`browserData.type.${type}`))
            .join(t("browserData.listSeparator")),
        })
      : c.error
        ? t(`browserData.error.${c.error.kind}`)
        : null;
  return (
    <Dialog.Root
      open={Boolean(c.settings)}
      onOpenChange={(open) => {
        if (!open) c.close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          data-testid="browser-clear-browsing-data-dialog"
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstRangeRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            c.triggerRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (c.clearing) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (c.clearing) event.preventDefault();
          }}
        >
          <form
            aria-busy={c.clearing}
            onSubmit={(event) => {
              event.preventDefault();
              void c.clear();
            }}
          >
            <Dialog.Title className="text-lg font-semibold">
              {t("browserData.title")}
            </Dialog.Title>
            <div
              role="group"
              aria-label={t("browserData.timeRange")}
              className="my-5 flex gap-2 overflow-x-auto pb-1"
            >
              {BROWSER_DATA_TIME_RANGES.map((range, index) => (
                <button
                  key={range}
                  ref={index === 0 ? firstRangeRef : undefined}
                  type="button"
                  aria-pressed={c.timeRange === range}
                  disabled={c.clearing}
                  className={cn(
                    BROWSER_SETTINGS_BUTTON,
                    "whitespace-nowrap border border-border bg-background",
                    c.timeRange === range
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "hover:bg-accent",
                  )}
                  onClick={() => c.changeTimeRange(range)}
                >
                  {t(`browserData.range.${range}`)}
                </button>
              ))}
            </div>
            <div className="divide-y divide-border">
              {BROWSER_DATA_TYPES.map((type) => {
                const Icon = icons[type];
                const id = `browser-clear-browsing-data-${type}`;
                const disabled =
                  c.clearing || !c.settings?.dataRemovalPermitted[type];
                const detail = description(type);
                return (
                  <label
                    key={type}
                    htmlFor={id}
                    className={`flex items-center gap-3 py-4 ${disabled ? "opacity-50" : "cursor-pointer"}`}
                  >
                    <Icon
                      className="size-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        id={`${id}-label`}
                        className="block text-sm font-medium"
                      >
                        {t(`browserData.type.${type}`)}
                      </span>
                      {detail ? (
                        <span
                          id={`${id}-description`}
                          className="mt-1 block text-xs text-muted-foreground"
                        >
                          {detail}
                        </span>
                      ) : null}
                    </span>
                    <Checkbox
                      id={id}
                      checked={c.selected.includes(type)}
                      disabled={disabled}
                      aria-labelledby={`${id}-label`}
                      aria-describedby={
                        detail ? `${id}-description` : undefined
                      }
                      onCheckedChange={() => c.toggle(type)}
                    />
                  </label>
                );
              })}
            </div>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className={cn(
                  BROWSER_SETTINGS_BUTTON,
                  "border border-border bg-background hover:bg-accent",
                )}
                disabled={c.clearing}
                onClick={c.close}
              >
                {t("browserData.cancel")}
              </button>
              <button
                type="submit"
                className={cn(
                  BROWSER_SETTINGS_BUTTON,
                  "border border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                )}
                disabled={c.clearing || !c.selected.length}
              >
                {t(c.clearing ? "browserData.deleting" : "browserData.delete")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatCacheSize(bytes: number, locale: string): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[index],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(size);
}
