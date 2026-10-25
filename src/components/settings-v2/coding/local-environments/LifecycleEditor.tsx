import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  environmentPlatforms,
  type EnvironmentScriptPlatform,
  type LocalEnvironmentDraft,
} from "@/lib/localEnvironments";
import { SettingsSection, SettingsValueMenu } from "../../SettingsPrimitives";

export const environmentInputClass =
  "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function LifecycleEditor({
  type,
  draft,
  disabled,
  onChange,
  simpleSetup = false,
}: {
  type: "setup" | "cleanup";
  draft: LocalEnvironmentDraft;
  disabled: boolean;
  onChange: (draft: LocalEnvironmentDraft) => void;
  simpleSetup?: boolean;
}) {
  const { t } = useTranslation("settings");
  const id = useId();
  const [platform, setPlatform] =
    useState<EnvironmentScriptPlatform>("default");
  const label = t(`settings.localEnvironments.${type}`);
  const value =
    platform === "default"
      ? draft[`${type}Script`]
      : draft[`${type}PlatformScripts`][platform];
  return (
    <SettingsSection
      title={label}
      actions={
        !simpleSetup ? (
          <span>
            <span className="sr-only" id={`${id}-label`}>
              {t("settings.localEnvironments.scriptPlatform", {
                script: label,
              })}
            </span>
            <SettingsValueMenu
              targetId={id}
              value={platform}
              options={["default" as const, ...environmentPlatforms].map(
                (value) => ({
                  value,
                  label: t(`settings.localEnvironments.platform.${value}`),
                }),
              )}
              onChange={setPlatform}
              disabled={disabled}
            />
          </span>
        ) : undefined
      }
    >
      {!simpleSetup ? (
        <p
          id={`${id}-description`}
          className="mb-3 text-[12px] text-muted-foreground"
        >
          {t(`settings.localEnvironments.${type}Description`)}
        </p>
      ) : null}
      <textarea
        aria-label={
          simpleSetup
            ? label
            : `${label} · ${t(`settings.localEnvironments.platform.${platform}`)}`
        }
        aria-describedby={simpleSetup ? undefined : `${id}-description`}
        rows={6}
        className={`${environmentInputClass} min-h-32 resize-y font-mono`}
        spellCheck={false}
        value={value}
        placeholder={
          simpleSetup
            ? t("settings.localEnvironments.simpleSetupPlaceholder")
            : platform !== "default"
              ? draft[`${type}Script`]
              : ""
        }
        disabled={disabled}
        onChange={(event) =>
          onChange(
            platform === "default"
              ? { ...draft, [`${type}Script`]: event.target.value }
              : {
                  ...draft,
                  [`${type}PlatformScripts`]: {
                    ...draft[`${type}PlatformScripts`],
                    [platform]: event.target.value,
                  },
                },
          )
        }
      />
      {platform !== "default" && !value && draft[`${type}Script`] ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {t("settings.localEnvironments.usesDefault")}
        </p>
      ) : null}
    </SettingsSection>
  );
}
