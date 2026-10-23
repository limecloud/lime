import { useTranslation } from "react-i18next";
import { ModelSelector } from "@/components/input-kit";
import { modelSupportsTaskFamily } from "@/lib/model/inferModelCapabilities";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import type { useVoiceSettings } from "./useVoiceSettings";
import { DictationDictionary } from "./DictationDictionary";
import { DictationHistory } from "./DictationHistory";

export function VoiceProcessingSettings({
  settings: s,
  capabilityRevision,
}: {
  settings: ReturnType<typeof useVoiceSettings>;
  capabilityRevision: number;
}) {
  const { t } = useTranslation("settings");
  const disabled = !s.voiceConfig || s.saving;
  return (
    <SettingsSection title={t("settings.voice.page.dictation")}>
      <div className="space-y-4">
        <SettingsGroup>
          <SettingsRow
            targetId="voice-sounds"
            label={t("settings.voice.sounds.label")}
            description={t("settings.voice.sounds.description")}
          >
            <SettingsSwitch
              checked={s.voiceConfig?.sound_enabled ?? true}
              onCheckedChange={s.handleSoundsEnabledChange}
              disabled={disabled}
              aria-label={t("settings.voice.sounds.toggleAria")}
            />
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.voice.processing.model.label")}
            description={
              <>
                {s.llmModelHint}
                {s.polishProviderWarning || s.polishModelWarning ? (
                  <p className="text-destructive">
                    {s.polishProviderWarning ?? s.polishModelWarning}
                  </p>
                ) : null}
              </>
            }
          >
            <ModelSelector
              providerType={s.voiceConfig?.processor.polish_provider ?? ""}
              setProviderType={s.handlePolishProviderChange}
              model={s.voiceConfig?.processor.polish_model ?? ""}
              setModel={s.handlePolishModelChange}
              providerFilter={() => true}
              modelFilter={(model) =>
                modelSupportsTaskFamily(model, "chat") ||
                modelSupportsTaskFamily(model, "reasoning")
              }
              emptyStateTitle={t("settings.voice.processing.model.emptyTitle")}
              emptyStateDescription={s.llmModelHint}
              disabled={disabled}
              allowAutoProvider
              allowAutoModel
              suppressAutoSelection
              placeholderLabel={t("settings.mediaGeneration.selector.auto")}
              popoverSide="bottom"
            />
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <DictationHistory capabilityRevision={capabilityRevision} />
        </SettingsGroup>
        <SettingsGroup>
          <DictationDictionary
            value={s.voiceConfig?.dictation_dictionary ?? []}
            disabled={disabled}
            cleanupEnabled={Boolean(
              s.voiceConfig?.processor.polish_enabled &&
              s.voiceConfig.processor.default_instruction_id !== "raw",
            )}
            onSave={s.handleDictionarySave}
          />
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
