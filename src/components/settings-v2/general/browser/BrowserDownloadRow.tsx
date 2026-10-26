import { Download, FolderOpen, Pause, Play, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BrowserDownloadEntry } from "@/lib/api/browserDownloads";
import type { BrowserDownloadAction } from "@/lib/api/browserDownloadsTypes";
import { isFinishedDownload } from "./browserDownloadsView";

const actionLabels = {
  pause: "browserDownloads.pause",
  resume: "browserDownloads.resume",
  cancel: "browserDownloads.cancel",
  open: "browserDownloads.open",
  reveal: "browserDownloads.reveal",
  remove: "browserDownloads.remove",
} as const satisfies Record<BrowserDownloadAction, string>;

function formatBytes(bytes: number, locale: string): string {
  const units = [
    "byte",
    "kilobyte",
    "megabyte",
    "gigabyte",
    "terabyte",
  ] as const;
  let size = Math.max(0, bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit > 0 ? 1 : 0,
  }).format(size);
}

export function BrowserDownloadRow({
  entry,
  busy,
  disabled,
  onAction,
}: {
  entry: BrowserDownloadEntry;
  busy: boolean;
  disabled: boolean;
  onAction: (action: BrowserDownloadAction) => void;
}) {
  const { t, i18n } = useTranslation("settings");
  const missing = entry.state === "completed" && !entry.fileExists;
  const canOpen = entry.state === "completed" && entry.fileExists;
  const progress =
    entry.totalBytes && entry.totalBytes > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((entry.receivedBytes / entry.totalBytes) * 100),
          ),
        )
      : null;
  const action = (name: BrowserDownloadAction, Icon: typeof Pause) => (
    <button
      key={name}
      type="button"
      className="pointer-events-auto rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
      aria-label={t(actionLabels[name], { filename: entry.filename })}
      title={t(actionLabels[name], { filename: entry.filename })}
      disabled={disabled}
      onClick={() => onAction(name)}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  );
  return (
    <li
      className="relative flex items-start gap-3 rounded-lg py-3"
      data-download-id={entry.id}
      data-download-state={entry.state}
      aria-busy={busy}
    >
      {canOpen ? (
        <button
          type="button"
          aria-label={t("browserDownloads.open", { filename: entry.filename })}
          title={entry.filename}
          disabled={disabled}
          className="absolute inset-0 z-0 rounded-lg bg-transparent enabled:cursor-pointer enabled:hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => onAction("open")}
        />
      ) : null}
      <Download
        aria-hidden="true"
        className="pointer-events-none relative mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="pointer-events-none relative min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2 text-sm">
          <span
            title={entry.filename}
            className={`truncate ${missing ? "text-muted-foreground line-through" : ""}`}
          >
            {entry.filename}
          </span>
          {missing ? (
            <span className="shrink-0 text-muted-foreground">
              {t("browserDownloads.missing")}
            </span>
          ) : null}
        </div>
        {entry.state !== "completed" ? (
          <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{t(`browserDownloads.state.${entry.state}`)}</span>
            <span>
              {entry.totalBytes === null
                ? t("browserDownloads.received", {
                    received: formatBytes(entry.receivedBytes, i18n.language),
                  })
                : t("browserDownloads.progress", {
                    received: formatBytes(entry.receivedBytes, i18n.language),
                    total: formatBytes(entry.totalBytes, i18n.language),
                  })}
            </span>
          </p>
        ) : null}
        {!isFinishedDownload(entry) && progress !== null ? (
          <progress
            className="mt-1 h-1 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
            value={progress}
            max={100}
            aria-label={t("browserDownloads.progressLabel", {
              filename: entry.filename,
            })}
          >
            {progress}%
          </progress>
        ) : null}
      </div>
      <div className="pointer-events-none relative flex shrink-0 flex-wrap items-center justify-end gap-1">
        <time
          dateTime={new Date(entry.startedAt).toISOString()}
          className="mr-1 text-xs text-muted-foreground"
        >
          {new Intl.DateTimeFormat(i18n.language, {
            hour: "numeric",
            minute: "2-digit",
          }).format(entry.startedAt)}
        </time>
        {entry.canPause ? action("pause", Pause) : null}
        {entry.canResume ? action("resume", Play) : null}
        {entry.canCancel ? action("cancel", X) : null}
        {canOpen ? action("reveal", FolderOpen) : null}
        {isFinishedDownload(entry) ? action("remove", Trash2) : null}
      </div>
    </li>
  );
}
