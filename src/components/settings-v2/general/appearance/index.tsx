import { AppearanceSettingsView } from "./AppearanceSettingsView";
import { useAppearanceSettings } from "./useAppearanceSettings";

export function AppearanceSettings() {
  return <AppearanceSettingsView {...useAppearanceSettings()} />;
}
