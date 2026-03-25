import { AutomationSettings } from "@/components/settings-v2/system/automation";
import type { AutomationPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";

interface AutomationPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  pageParams?: AutomationPageParams;
}

export function AutomationPage({
  onNavigate,
  pageParams,
}: AutomationPageProps) {
  return (
    <div className="flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto w-full max-w-[1440px]">
        <AutomationSettings
          mode="workspace"
          initialSelectedJobId={pageParams?.selectedJobId}
          initialWorkspaceTab={pageParams?.workspaceTab}
          onOpenSettings={() =>
            onNavigate?.("settings", { tab: SettingsTabs.Automation })
          }
        />
      </div>
    </div>
  );
}
