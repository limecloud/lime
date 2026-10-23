import { useTranslation } from "react-i18next";
import { ModelSelector } from "@/components/input-kit";
import {
  getTtsModelsForProvider,
  hasMediaGenerationPreferenceOverride,
  isTtsProvider,
} from "@/lib/mediaGeneration";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import type { useVoiceSettings } from "./useVoiceSettings";

export function VoiceServiceSettings({
  settings: s,
}: {
  settings: ReturnType<typeof useVoiceSettings>;
}) {
  const { t } = useTranslation("settings");
  const disabled = !s.config || s.saving;
  return (
    <SettingsSection
      title={t("settings.voice.media.title")}
      actions={
        <SettingsAction
          type="button"
          onClick={s.handleResetPreference}
          disabled={
            disabled ||
            !hasMediaGenerationPreferenceOverride(s.globalVoicePreference)
          }
        >
          {t("settings.voice.media.action.reset")}
        </SettingsAction>
      }
    >
      <SettingsGroup>
        <SettingsRow
          label={t("settings.voice.media.selector.label")}
          description={s.providerHint}
        >
          <ModelSelector
            providerType={s.globalVoicePreference.preferredProviderId ?? ""}
            setProviderType={s.handleMediaProviderChange}
            model={s.globalVoicePreference.preferredModelId ?? ""}
            setModel={s.handleMediaModelChange}
            setProviderAndModel={s.handleMediaProviderAndModelChange}
            providerFilter={(provider) =>
              isTtsProvider(provider.providerId ?? provider.key, provider.type)
            }
            modelFilter={(model, provider) =>
              getTtsModelsForProvider(provider.models).includes(model.id)
            }
            emptyStateTitle={t("settings.voice.media.emptyTitle")}
            emptyStateDescription={s.providerHint}
            disabled={disabled}
            allowAutoProvider
            allowAutoModel
            suppressAutoSelection
            placeholderLabel={t("settings.mediaGeneration.selector.auto")}
            popoverSide="bottom"
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.voice.media.fallback.title")}
          description={t("settings.voice.media.fallback.description")}
        >
          <SettingsSwitch
            checked={s.globalVoicePreference.allowFallback ?? true}
            onCheckedChange={s.handleFallbackChange}
            disabled={disabled}
            aria-label={t("settings.voice.media.fallback.title")}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
