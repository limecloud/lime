import type { TFunction } from "i18next";
import type {
  VoiceModelCatalogEntry,
  VoiceModelDownloadProgressEvent,
  VoiceModelInstallState,
} from "@/lib/api/voiceModels";
export type VoiceModelAction = "download" | "delete" | "default" | "test";
type VoiceSettingsTranslate = TFunction<"settings", undefined>;

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  const mb = value / 1024 / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(0)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function getVoiceModelDisplayName(
  entry: VoiceModelCatalogEntry,
): string {
  return entry.name.replace(/\s+INT8$/i, "").trim() || entry.name;
}

export function getVoiceModelInstallStatusText(
  t: VoiceSettingsTranslate,
  entry: VoiceModelCatalogEntry,
  state: VoiceModelInstallState | null,
  action: VoiceModelAction | null,
  progress?: VoiceModelDownloadProgressEvent | null,
): string {
  if (action === "download") {
    return (
      progress?.message || t("settings.voice.model.status.prepareDownload")
    );
  }

  const modelSize = entry.size_bytes
    ? t("settings.voice.model.status.approxSize", {
        size: formatBytes(entry.size_bytes),
      })
    : t("settings.voice.model.status.sizePending");

  if (state?.installed) {
    return t("settings.voice.model.status.installed", {
      size: modelSize,
    });
  }

  return t("settings.voice.model.status.notInstalled", {
    size: modelSize,
  });
}

export function getVoiceModelDownloadPercent(
  progress?: VoiceModelDownloadProgressEvent | null,
): number {
  if (!progress || !Number.isFinite(progress.overall_progress)) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round(progress.overall_progress * 100)),
  );
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}
