import { AutomationSettings } from "@/components/settings-v2/system/automation";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";

interface AutomationPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export function AutomationPage({ onNavigate }: AutomationPageProps) {
  return (
    <div className="flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto w-full max-w-[1440px]">
        <AutomationSettings
          mode="workspace"
          onOpenSettings={() =>
            onNavigate?.("settings", { tab: SettingsTabs.Automation })
          }
        />
      </div>
    </div>
  );
}
