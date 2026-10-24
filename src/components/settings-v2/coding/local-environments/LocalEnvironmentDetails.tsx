import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalEnvironment } from "../../../../../packages/app-server-client/src/protocol";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  createLocalEnvironmentDraft,
  effectiveEnvironmentScript,
  environmentPlatforms,
  type EnvironmentScriptPlatform,
} from "@/lib/localEnvironments";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsValueMenu,
} from "../../SettingsPrimitives";

const codeClass =
  "max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[13px]";

function LifecycleSummary({
  type,
  environment,
}: {
  type: "setup" | "cleanup";
  environment: LocalEnvironment;
}) {
  const { t } = useTranslation("settings");
  const id = useId();
  const [platform, setPlatform] =
    useState<EnvironmentScriptPlatform>("default");
  const draft = createLocalEnvironmentDraft(environment);
  const script = effectiveEnvironmentScript(draft, type, platform);
  const label = t(`settings.localEnvironments.${type}`);
  return (
    <SettingsSection
      title={label}
      actions={
        <span>
          <span className="sr-only" id={`${id}-label`}>
            {t("settings.localEnvironments.scriptPlatform", { script: label })}
          </span>
          <SettingsValueMenu
            targetId={id}
            value={platform}
            disabled={false}
            options={["default" as const, ...environmentPlatforms].map(
              (value) => ({
                value,
                label: t(`settings.localEnvironments.platform.${value}`),
              }),
            )}
            onChange={setPlatform}
          />
        </span>
      }
    >
      <p className="mb-3 text-[12px] text-muted-foreground">
        {t(`settings.localEnvironments.${type}Description`)}
      </p>
      {platform !== "default" &&
      !draft[`${type}PlatformScripts`][platform] &&
      script ? (
        <p className="mb-2 text-[12px] text-muted-foreground">
          {t("settings.localEnvironments.usesDefault")}
        </p>
      ) : null}
      {script ? (
        <pre className={codeClass}>
          <code>{script}</code>
        </pre>
      ) : (
        <p className="text-muted-foreground">
          {t("settings.localEnvironments.noScript")}
        </p>
      )}
    </SettingsSection>
  );
}

export function LocalEnvironmentDetails({
  configPath,
  onBack,
  onEdit,
}: {
  configPath: string;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation("settings");
  const [environment, setEnvironment] = useState<LocalEnvironment | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"load" | "invalid" | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setEnvironment(null);
    void localEnvironments
      .readConfig(configPath)
      .then((result) => {
        if (!current) return;
        setExists(result.exists);
        if (result.environment?.type === "error") setError("invalid");
        else setEnvironment(result.environment?.environment ?? null);
      })
      .catch(() => {
        if (current) setError("load");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [configPath, reload]);
  return (
    <SettingsPageBody
      data-testid="local-environment-details"
      aria-busy={loading}
    >
      <SettingsPageHeader
        title={environment?.name || t("settings.localEnvironments.title")}
        actions={
          <div className="flex gap-2">
            <SettingsAction onClick={onBack}>
              {t("settings.localEnvironments.back")}
            </SettingsAction>
            <SettingsAction
              disabled={loading || error === "load"}
              onClick={onEdit}
            >
              {t(
                exists
                  ? "settings.localEnvironments.edit"
                  : "settings.localEnvironments.create",
              )}
            </SettingsAction>
          </div>
        }
      />
      <p className="break-all text-[12px] text-muted-foreground">
        {configPath}
      </p>
      {loading ? (
        <p role="status">{t("settings.localEnvironments.loading")}</p>
      ) : null}
      {error ? (
        <div role="alert" className="text-destructive">
          <p>{t(`settings.localEnvironments.error.${error}`)}</p>
          <SettingsAction onClick={() => setReload((value) => value + 1)}>
            {t("settings.localEnvironments.reload")}
          </SettingsAction>
        </div>
      ) : null}
      {!loading && !error && !environment ? (
        <p>{t("settings.localEnvironments.noEnvironments")}</p>
      ) : null}
      {environment ? (
        <>
          <LifecycleSummary type="setup" environment={environment} />
          <LifecycleSummary type="cleanup" environment={environment} />
          <SettingsSection title={t("settings.localEnvironments.actions")}>
            <p className="mb-3 text-[12px] text-muted-foreground">
              {t("settings.localEnvironments.actionsDescription")}
            </p>
            <SettingsGroup>
              {(environment.actions ?? []).map((action, index) => (
                <SettingsRow
                  key={index}
                  label={action.name}
                  description={t(
                    `settings.localEnvironments.platform.${action.platform ?? "all"}`,
                  )}
                >
                  <details className="min-w-0 max-w-full">
                    <summary className="cursor-pointer text-[12px] text-muted-foreground">
                      {t("settings.localEnvironments.command")}
                    </summary>
                    <pre className={`${codeClass} mt-2`}>
                      <code>{action.command}</code>
                    </pre>
                  </details>
                </SettingsRow>
              ))}
              {!environment.actions?.length ? (
                <SettingsRow
                  label={t("settings.localEnvironments.noActions")}
                />
              ) : null}
            </SettingsGroup>
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageBody>
  );
}
