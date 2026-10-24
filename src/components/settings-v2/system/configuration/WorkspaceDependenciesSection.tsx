import { Download, RotateCcw, Stethoscope, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isInstallActive } from "@/lib/api/primaryRuntime";
import type { AppConfigSnapshot } from "@/lib/api/appConfig";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import { useWorkspaceDependencies } from "./useWorkspaceDependencies";

const KEY = "settings.agent.dependencies";
const TARGET = "configuration-workspace-dependencies";

export function WorkspaceDependenciesSection({ snapshot }: { snapshot: AppConfigSnapshot | null }) {
  const { t } = useTranslation("settings");
  const state = useWorkspaceDependencies(snapshot);
  const data = state.diagnostics;
  const update = data?.update;
  const installing = isInstallActive(update);
  const busy = state.pending !== null;
  const unavailable = !data?.supported || state.loading || state.readError;
  const progress = update?.totalBytes
    ? Math.min(
        100,
        Math.floor((update.downloadedBytes / update.totalBytes) * 100),
      )
    : null;
  return (
    <SettingsSection
      title={t(`${KEY}.title`)}
      data-testid="workspace-dependencies"
    >
      <SettingsGroup>
        <SettingsRow
          targetId={TARGET}
          label={t(`${KEY}.enabled.label`)}
          description={
            <>
              {t(`${KEY}.enabled.description`)}
              {state.readonly ? (
                <div>{t("settings.configuration.readonly")}</div>
              ) : null}
            </>
          }
        >
          <SettingsSwitch
            checked={data?.enabled ?? false}
            disabled={unavailable || busy || state.readonly}
            aria-labelledby={`${TARGET}-label`}
            aria-describedby={`${TARGET}-description`}
            onCheckedChange={(value) => void state.change(value)}
          />
        </SettingsRow>
        <SettingsRow
          label={t(`${KEY}.diagnose.label`)}
          description={t(`${KEY}.diagnose.description`)}
        >
          <SettingsAction
            type="button"
            disabled={unavailable || busy || installing}
            aria-busy={state.pending === "diagnose"}
            onClick={() => void state.diagnose()}
          >
            <Stethoscope aria-hidden="true" />
            {t(`${KEY}.diagnose.button`)}
          </SettingsAction>
        </SettingsRow>
        <SettingsRow
          label={t(`${KEY}.reset.label`)}
          description={t(`${KEY}.reset.description`)}
        >
          <SettingsAction
            type="button"
            $tone="danger"
            disabled={unavailable || busy || (!installing && !data?.enabled)}
            aria-busy={
              state.pending === "install" || state.pending === "cancel"
            }
            onClick={() =>
              void (installing ? state.cancel() : state.reinstall())
            }
          >
            {installing ? (
              <X aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            {t(`${KEY}.${installing ? "cancel" : "reset"}.button`)}
          </SettingsAction>
        </SettingsRow>
      </SettingsGroup>
      <div
        className="space-y-1 text-[12px] leading-[18px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-x-1">
          {installing ? (
            <Download aria-hidden="true" className="mr-1 size-3" />
          ) : null}
          {t(`${KEY}.bundleVersion.label`)}{" "}
          {state.loading
            ? t(`${KEY}.bundleVersion.loading`)
            : installing && update
              ? `${t(`${KEY}.phases.${update.phase}`)}${progress === null ? "" : ` ${progress}%`}`
              : (data?.bundleVersion ?? t(`${KEY}.bundleVersion.notInstalled`))}
        </div>
        {installing && progress !== null ? (
          <progress
            className="h-1 w-full accent-foreground"
            value={progress}
            max={100}
            aria-label={t(`${KEY}.progress`)}
          />
        ) : null}
        {data && !data.supported ? <div>{t(`${KEY}.unsupported`)}</div> : null}
        {update && ["canceled", "error"].includes(update.phase) ? (
          <div>{t(`${KEY}.phases.${update.phase}`)}</div>
        ) : null}
        {data?.problems.length ? (
          <div>{t(`${KEY}.bundleVersion.problemDescription`)}</div>
        ) : null}
        {state.diagnosed !== null ? (
          <div>
            {t(`${KEY}.diagnose.${state.diagnosed ? "ok" : "problem"}`)}
          </div>
        ) : null}
      </div>
      {state.readError || state.error ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-[13px] text-destructive"
        >
          {t(`${KEY}.${state.readError ? "loadError" : `${state.error}Error`}`)}
          <SettingsAction
            type="button"
            disabled={busy}
            onClick={() => void state.retry()}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
    </SettingsSection>
  );
}
