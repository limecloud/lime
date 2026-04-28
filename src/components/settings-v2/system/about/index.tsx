import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  checkForUpdates,
  downloadUpdate,
  type DownloadUpdateResult,
  type VersionInfo,
} from "@/lib/api/appUpdate";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";
import { cn } from "@/lib/utils";

const FALLBACK_RELEASES_URL = "https://github.com/limecloud/lime/releases";
const FRIENDLY_UPDATE_ERROR = "暂时无法检查更新，请稍后再试。";
const FRIENDLY_DOWNLOAD_ERROR = "暂时无法自动安装更新，请使用网页下载最新版。";
const PRIMARY_ACTION_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-full border border-slate-900 bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-slate-950/10 transition hover:bg-slate-800 disabled:opacity-50";
const SECONDARY_ACTION_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50";

export function AboutSection() {
  const { t } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    current: "",
    latest: undefined,
    hasUpdate: false,
    downloadUrl: undefined,
    error: undefined,
  });
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] =
    useState<DownloadUpdateResult | null>(null);
  const manualDownloadUrl =
    versionInfo.releaseNotesUrl || FALLBACK_RELEASES_URL;
  const isWindows =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

  useEffect(() => {
    const loadCurrentVersion = async () => {
      try {
        const result = await checkForUpdates();
        if (result.error) {
          console.warn(
            "Update check returned a diagnostic error:",
            result.error,
          );
        }
        setVersionInfo({
          ...result,
          downloadUrl: result.downloadUrl || FALLBACK_RELEASES_URL,
        });
      } catch (error) {
        console.error("Failed to load version:", error);
        setVersionInfo((prev) => ({
          ...prev,
          downloadUrl: prev.downloadUrl || FALLBACK_RELEASES_URL,
        }));
      }
    };

    void loadCurrentVersion();
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setDownloadResult(null);
    try {
      const result = await checkForUpdates();
      if (result.error) {
        console.warn("Update check returned a diagnostic error:", result.error);
      }
      setVersionInfo({
        ...result,
        downloadUrl: result.downloadUrl || FALLBACK_RELEASES_URL,
      });
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo((prev) => ({
        ...prev,
        error: FRIENDLY_UPDATE_ERROR,
        downloadUrl: prev.downloadUrl || FALLBACK_RELEASES_URL,
      }));
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setDownloading(true);
    setDownloadResult(null);
    try {
      const result = await downloadUpdate();
      setDownloadResult(result);

      if (result.success) {
        setTimeout(() => {
          setDownloadResult({
            ...result,
            message: t(
              "更新已安装，应用将自动重启以完成升级",
              "更新已安装，应用将自动重启以完成升级",
            ),
          });
        }, 1000);
      } else {
        console.error("Download failed:", result.message);
        setDownloadResult({
          ...result,
          message: t(FRIENDLY_DOWNLOAD_ERROR, FRIENDLY_DOWNLOAD_ERROR),
        });
      }
    } catch (error) {
      console.error("Failed to download update:", error);
      setDownloadResult({
        success: false,
        message: t(FRIENDLY_DOWNLOAD_ERROR, FRIENDLY_DOWNLOAD_ERROR),
        filePath: undefined,
      });
    } finally {
      setDownloading(false);
    }
  };

  const versionLabel = t("Version {{version}} ({{build}})", {
    version: versionInfo.current || t("读取中", "读取中"),
    build: versionInfo.current || t("读取中", "读取中"),
    defaultValue: "Version {{version}} ({{build}})",
  });

  const updateStatus = useMemo(() => {
    if (versionInfo.hasUpdate) {
      return {
        label: t("可更新到 {{version}}", {
          version: versionInfo.latest ?? "",
          defaultValue: "可更新到 {{version}}",
        }),
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }

    if (versionInfo.error) {
      return {
        label: t(FRIENDLY_UPDATE_ERROR, FRIENDLY_UPDATE_ERROR),
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    }

    if (versionInfo.latest) {
      return {
        label: t("当前已是最新版本", "当前已是最新版本"),
        className: "border-slate-200 bg-slate-100 text-slate-600",
      };
    }

    return {
      label: t("可手动检查更新", "可手动检查更新"),
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }, [t, versionInfo.error, versionInfo.hasUpdate, versionInfo.latest]);

  return (
    <div className="pb-8">
      <section className="mx-auto max-w-[560px] rounded-[28px] border border-slate-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-slate-950/5">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[24px] border border-slate-200 bg-slate-50 shadow-sm shadow-slate-950/5">
          <img
            src={LIME_BRAND_LOGO_SRC}
            alt={LIME_BRAND_NAME}
            className="h-16 w-16 object-contain"
          />
        </div>

        <h2 className="mt-6 text-[28px] font-semibold tracking-tight text-slate-950">
          {LIME_BRAND_NAME}
        </h2>
        <p className="mt-3 text-base text-slate-700">{versionLabel}</p>
        <p className="mt-2 text-sm text-slate-500">
          {t("Copyright © 2026 {{brand}}", {
            brand: LIME_BRAND_NAME,
            defaultValue: "Copyright © 2026 {{brand}}",
          })}
        </p>

        <div className="mt-5 flex justify-center">
          <span
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium",
              updateStatus.className,
            )}
          >
            {updateStatus.label}
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={checking || downloading}
            className={SECONDARY_ACTION_BUTTON_CLASS}
          >
            <RefreshCw className={cn("h-4 w-4", checking && "animate-spin")} />
            {t("检查更新", "检查更新")}
          </button>

          {versionInfo.hasUpdate ? (
            <>
              <button
                type="button"
                onClick={() => void handleDownloadUpdate()}
                disabled={downloading}
                className={PRIMARY_ACTION_BUTTON_CLASS}
              >
                <RefreshCw
                  className={cn("h-4 w-4", downloading && "animate-spin")}
                />
                {downloading
                  ? t("下载中...", "下载中...")
                  : t("下载更新", "下载更新")}
              </button>
              <a
                href={manualDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={SECONDARY_ACTION_BUTTON_CLASS}
              >
                <ExternalLink className="h-4 w-4" />
                {t("网页下载", "网页下载")}
              </a>
            </>
          ) : null}
        </div>

        {isWindows ? (
          <p className="mx-auto mt-4 max-w-[420px] text-xs leading-5 text-slate-500">
            {t(
              "Windows 仅提供单一 setup 安装包；需要手动升级或重装时，可直接使用网页下载页中的最新版。",
              "Windows 仅提供单一 setup 安装包；需要手动升级或重装时，可直接使用网页下载页中的最新版。",
            )}
          </p>
        ) : null}

        {downloadResult ? (
          <div
            className={cn(
              "mt-5 rounded-[20px] border p-4 text-left text-sm shadow-sm shadow-slate-950/5",
              downloadResult.success
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{downloadResult.message}</p>
                {!downloadResult.success ? (
                  <a
                    href={manualDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 underline hover:no-underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("前往网页下载", "前往网页下载")}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
