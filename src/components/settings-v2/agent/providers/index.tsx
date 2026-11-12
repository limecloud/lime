import { useTranslation } from "react-i18next";
import { ApiKeyProviderSection } from "@/components/api-key-provider";
import type { ProviderSettingsFocusContext, SettingsProviderView } from "@/types/page";
import { SettingsPageBody, SettingsPageHeader } from "../../SettingsPrimitives";

export interface ProviderSettingsProps {
  initialView?: SettingsProviderView;
  initialFocus?: ProviderSettingsFocusContext | null;
}

export function ProviderSettings({ initialFocus }: ProviderSettingsProps) {
  const { t } = useTranslation("settings");
  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.tab.providers")} />
      <ApiKeyProviderSection className="min-h-[520px] flex-1" initialFocus={initialFocus} />
    </SettingsPageBody>
  );
}
