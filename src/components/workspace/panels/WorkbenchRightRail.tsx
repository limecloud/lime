import { ContentReviewPanel } from "@/lib/workspace/workbenchCanvas";
import { CollapsedRail, NonCreateRail } from "./workbenchRightRailCompactRails";
import { WorkbenchRightRailExpandedPanel } from "./WorkbenchRightRailExpandedPanel";
import { WorkbenchRightRailThemeSkillsView } from "./WorkbenchRightRailThemeSkillsView";
import {
  resolveCapabilitySections,
  resolveRailHeading,
  resolveRailSubheading,
} from "./workbenchRightRailCapabilityConfig";
import { useWorkbenchRightRailDisplayState } from "./useWorkbenchRightRailDisplayState";
import type { WorkbenchRightRailProps } from "./workbenchRightRailContracts";

export function WorkbenchRightRail({
  shouldRender,
  isCreateWorkspaceView,
  projectId,
  contentId,
  theme,
  creationMode = "guided",
  creationType,
  onBackToCreateView,
  onCreateContentFromPrompt,
}: WorkbenchRightRailProps) {
  const {
    clearThemeSkillsRailState,
    collapsed,
    contentReviewRailState,
    handleExpand,
    handleExpandToAction,
    handleExpandedActionConsumed,
    pendingExpandedActionKey,
    setCollapsed,
    themeSkillsRailState,
    triggerSkill,
  } = useWorkbenchRightRailDisplayState({
    shouldRender,
    isCreateWorkspaceView,
  });

  const capabilitySections = resolveCapabilitySections(
    theme,
    creationMode,
    creationType,
  );
  const railHeading = resolveRailHeading(theme, creationMode, creationType);
  const railSubheading = resolveRailSubheading(
    theme,
    creationMode,
    creationType,
  );

  if (!shouldRender) {
    return null;
  }

  if (contentReviewRailState) {
    return <ContentReviewPanel open={true} {...contentReviewRailState} />;
  }

  if (themeSkillsRailState) {
    return (
      <WorkbenchRightRailThemeSkillsView
        themeSkillsRailState={themeSkillsRailState}
        onTriggerSkill={triggerSkill}
        onRequestCollapse={() => clearThemeSkillsRailState()}
      />
    );
  }

  if (!isCreateWorkspaceView) {
    return <NonCreateRail onBackToCreateView={onBackToCreateView} />;
  }

  return collapsed ? (
    <CollapsedRail
      sections={capabilitySections}
      onExpand={handleExpand}
      onExpandToAction={handleExpandToAction}
    />
  ) : (
    <WorkbenchRightRailExpandedPanel
      sections={capabilitySections}
      heading={railHeading}
      subheading={railSubheading}
      theme={theme}
      onCollapse={() => setCollapsed(true)}
      projectId={projectId}
      contentId={contentId}
      onCreateContentFromPrompt={onCreateContentFromPrompt}
      initialExpandedActionKey={pendingExpandedActionKey}
      onInitialExpandedActionConsumed={handleExpandedActionConsumed}
    />
  );
}

export default WorkbenchRightRail;
