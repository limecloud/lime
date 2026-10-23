import { useEffect } from "react";
import { Download, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  consumeVoiceModelSettingsFocusRequest,
  VOICE_MODEL_SETTINGS_SECTION_ID,
} from "@/lib/voiceModelSettingsNavigation";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import { useVoiceModel } from "./useVoiceModel";
import {
  formatBytes,
  getVoiceModelDisplayName,
  getVoiceModelDownloadPercent,
  getVoiceModelInstallStatusText,
} from "./voiceModelPresentation";

export function VoiceModelSection({
  showMessage,
  onCapabilityChange,
}: {
  showMessage: (type: "success" | "error", text: string) => void;
  onCapabilityChange: () => void;
}) {
  const { t } = useTranslation("settings");
  const m = useVoiceModel(showMessage, onCapabilityChange);
  const entry = m.primaryVoiceModel;
  const installed = m.voiceModelState?.installed;
  const busy = m.voiceModelAction !== null;
  const percent = getVoiceModelDownloadPercent(m.voiceModelDownloadProgress);
  useEffect(() => {
    if (m.loading || !consumeVoiceModelSettingsFocusRequest()) return;
    const target = document.getElementById(VOICE_MODEL_SETTINGS_SECTION_ID);
    target?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  }, [m.loading]);
  return (
    <SettingsSection
      id={VOICE_MODEL_SETTINGS_SECTION_ID}
      tabIndex={-1}
      className="scroll-mt-6 outline-none"
      title={t("settings.voice.model.title")}
    >
      <SettingsGroup>
        {m.loading ? (
          <p role="status" className="py-3 text-[12px] text-muted-foreground">
            {t("settings.voice.page.loading")}
          </p>
        ) : m.loadError ? (
          <SettingsRow label={t("settings.voice.message.loadFailed")}>
            <SettingsAction type="button" onClick={() => void m.reload()}>
              {t("settings.voice.page.retry")}
            </SettingsAction>
          </SettingsRow>
        ) : !entry ? (
          <p className="py-3 text-[12px] text-muted-foreground">
            {t("settings.voice.model.emptyCatalog")}
          </p>
        ) : (
          <>
            <SettingsRow
              label={
                <>
                  {getVoiceModelDisplayName(entry)}{" "}
                  <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                    {t("settings.voice.model.badge.local")}
                  </span>
                </>
              }
              description={
                <>
                  <p>
                    {entry.description ||
                      t("settings.voice.model.senseVoice.fallbackDescription")}
                  </p>
                  <p>
                    {getVoiceModelInstallStatusText(
                      t,
                      entry,
                      m.voiceModelState,
                      m.voiceModelAction,
                      m.voiceModelDownloadProgress,
                    )}
                  </p>
                  {!installed &&
                  (!entry.download_url?.trim() ||
                    !entry.vad_download_url?.trim()) ? (
                    <p role="alert">
                      {t("settings.voice.model.assetBaseMissing")}
                    </p>
                  ) : null}
                  {m.voiceModelState?.default_credential_id ? (
                    <p>{t("settings.voice.model.badge.defaultAsr")}</p>
                  ) : null}
                </>
              }
            >
              {installed ? (
                <>
                  <SettingsAction
                    type="button"
                    onClick={() => void m.handleSetDefaultVoiceModel()}
                    disabled={
                      busy || Boolean(m.voiceModelState?.default_credential_id)
                    }
                  >
                    {t("settings.voice.model.action.setDefault")}
                  </SettingsAction>
                  <SettingsAction
                    type="button"
                    onClick={() => void m.handleDeleteVoiceModel()}
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" />
                    {t("settings.voice.model.action.delete")}
                  </SettingsAction>
                </>
              ) : (
                <SettingsAction
                  type="button"
                  onClick={() => void m.handleDownloadVoiceModel()}
                  disabled={
                    busy ||
                    !entry.download_url?.trim() ||
                    !entry.vad_download_url?.trim()
                  }
                >
                  {m.voiceModelAction === "download" ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  {t(
                    m.voiceModelAction === "download"
                      ? "settings.voice.model.action.downloading"
                      : "settings.voice.model.action.download",
                  )}
                </SettingsAction>
              )}
            </SettingsRow>
            {m.voiceModelAction === "download" ? (
              <div
                role="progressbar"
                aria-label={t("settings.voice.model.progressAria")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="py-3 text-[12px] text-muted-foreground"
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span>{percent}%</span>
              </div>
            ) : null}
            <details className="py-3 text-[13px]">
              <summary className="cursor-pointer rounded font-medium outline-offset-4">
                {t("settings.voice.model.test.title")}
              </summary>
              <div className="space-y-3 pt-3">
                <p className="text-[12px] text-muted-foreground">
                  {[entry.runtime, entry.version, entry.languages.join(" / ")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="break-all text-[12px] text-muted-foreground">
                  {installed
                    ? m.voiceModelState?.install_dir
                    : t("settings.voice.model.install.onDemand")}
                </p>
                {installed ? (
                  <p className="text-[12px] text-muted-foreground">
                    {t("settings.voice.model.install.installedSize", {
                      size: formatBytes(
                        m.voiceModelState?.installed_bytes ?? 0,
                      ),
                    })}
                  </p>
                ) : null}
                <p className="text-[12px] text-muted-foreground">
                  {t("settings.voice.model.test.description")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <SettingsAction
                    type="button"
                    onClick={() => void m.handleSelectVoiceModelTestFile()}
                    disabled={!installed || busy}
                  >
                    <FolderOpen aria-hidden="true" />
                    {t("settings.voice.model.test.selectWav")}
                  </SettingsAction>
                  <input
                    aria-label={t("settings.voice.model.test.pathAria")}
                    className="min-h-7 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-offset-2"
                    value={m.voiceModelTestPath}
                    onChange={(event) =>
                      m.setVoiceModelTestPath(event.target.value)
                    }
                    placeholder={t("settings.voice.model.test.pathPlaceholder")}
                    disabled={!installed || busy}
                  />
                  <SettingsAction
                    type="button"
                    onClick={() => void m.handleTestVoiceModel()}
                    disabled={
                      !installed || busy || !m.voiceModelTestPath.trim()
                    }
                  >
                    {t(
                      m.voiceModelAction === "test"
                        ? "settings.voice.model.test.testing"
                        : "settings.voice.model.test.action",
                    )}
                  </SettingsAction>
                </div>
                {!installed ? (
                  <p className="text-[12px] text-muted-foreground">
                    {t("settings.voice.model.test.needsInstall")}
                  </p>
                ) : null}
                {m.voiceModelTestError ? (
                  <p role="alert" className="text-[12px] text-destructive">
                    {m.voiceModelTestError}
                  </p>
                ) : null}
                {m.voiceModelTestResult ? (
                  <div role="status" className="space-y-2 text-[12px]">
                    <p className="text-muted-foreground">
                      {t("settings.voice.model.test.completedBadge")} ·{" "}
                      {t("settings.voice.model.test.resultMeta", {
                        duration: t(
                          "settings.voice.model.test.durationSeconds",
                          {
                            seconds:
                              m.voiceModelTestResult.duration_secs.toFixed(2),
                          },
                        ),
                        language:
                          m.voiceModelTestResult.language ||
                          t("settings.voice.model.test.languageAuto"),
                        sampleRate: m.voiceModelTestResult.sample_rate,
                      })}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {m.voiceModelTestResult.text ||
                        t("settings.voice.model.test.emptyText")}
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          </>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
