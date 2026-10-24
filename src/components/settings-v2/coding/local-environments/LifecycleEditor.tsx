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
}: {
  type: "setup" | "cleanup";
  draft: LocalEnvironmentDraft;
  disabled: boolean;
  onChange: (draft: LocalEnvironmentDraft) => void;
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
        <span>
          <span className="sr-only" id={`${id}-label`}>
            {t("settings.localEnvironments.scriptPlatform", { script: label })}
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
      }
    >
      <p
        id={`${id}-description`}
        className="mb-3 text-[12px] text-muted-foreground"
      >
        {t(`settings.localEnvironments.${type}Description`)}
      </p>
      <textarea
        aria-label={`${label} · ${t(`settings.localEnvironments.platform.${platform}`)}`}
        aria-describedby={`${id}-description`}
        className={`${environmentInputClass} min-h-32 resize-y font-mono`}
        spellCheck={false}
        value={value}
        placeholder={platform !== "default" ? draft[`${type}Script`] : ""}
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
