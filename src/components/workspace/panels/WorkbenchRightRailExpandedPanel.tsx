import type { WorkbenchRightRailProps } from "./workbenchRightRailContracts";
import { WorkbenchRightRailActionSections } from "./workbenchRightRailActionSections";
import {
  WorkbenchRightRailCollapseBar,
  WorkbenchRightRailHeadingCard,
} from "./workbenchRightRailExpandedChrome";
import { useWorkbenchRightRailCapabilityController } from "./useWorkbenchRightRailCapabilityController";
import type { WorkbenchRightRailCapabilitySection } from "./workbenchRightRailTypes";
import type { WorkspaceTheme } from "@/types/page";

export function WorkbenchRightRailExpandedPanel({
  onCollapse,
  projectId,
  contentId,
  onCreateContentFromPrompt,
  initialExpandedActionKey,
  onInitialExpandedActionConsumed,
  sections,
  heading,
  subheading,
  theme,
}: {
  onCollapse: () => void;
  projectId?: string | null;
  contentId?: string | null;
  onCreateContentFromPrompt?: WorkbenchRightRailProps["onCreateContentFromPrompt"];
  initialExpandedActionKey?: string | null;
  onInitialExpandedActionConsumed?: () => void;
  sections: WorkbenchRightRailCapabilitySection[];
  heading?: string | null;
  subheading?: string | null;
  theme?: WorkspaceTheme;
}) {
  const controller = useWorkbenchRightRailCapabilityController({
    projectId,
    contentId,
    initialExpandedActionKey,
    onInitialExpandedActionConsumed,
    onCreateContentFromPrompt,
  });

  return (
    <aside
      className="flex w-[320px] min-w-[320px] flex-col border-l bg-background/95"
      data-testid="workbench-right-rail-expanded"
    >
      <WorkbenchRightRailCollapseBar onCollapse={onCollapse} />

      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-3 py-3">
        <WorkbenchRightRailHeadingCard
          eyebrow={theme === "video" ? "视频助手" : undefined}
          heading={heading}
          subheading={subheading}
        />
        <WorkbenchRightRailActionSections
          sections={sections}
          controller={controller}
          theme={theme}
        />
      </div>
    </aside>
  );
}
