import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

function sourceOf(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

describe("Codex alignment kept product surfaces", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("不恢复已退出的首页任务树、抽屉和专用状态 owner", () => {
    const base = "src/components/agent/chat/";
    const retired = [
      "skill-selection/runtimeInputCapabilityCatalog.ts",
      "utils/browserWorkbenchCommand.ts",
      "utils/competitorWorkbenchCommand.ts",
      "utils/coverWorkbenchCommand.ts",
      "utils/deepSearchWorkbenchCommand.ts",
      "utils/fileReadWorkbenchCommand.ts",
      "utils/pdfWorkbenchCommand.ts",
      "utils/posterWorkbenchCommand.ts",
      "utils/reportWorkbenchCommand.ts",
      "utils/searchWorkbenchCommand.ts",
      "utils/siteSearchWorkbenchCommand.ts",
      "utils/videoWorkbenchCommand.ts",
      "workspace/commands/dispatchBodyBuilders.ts",
      "workspace/commands/intentHelpers.ts",
      "workspace/commands/mentionCommandUtils.ts",
      "workspace/commands/serviceSkillMatch.ts",
      "workspace/commands/skillInstallHelpers.ts",
      "workspace/commands/skillLaunchContextBuilders.ts",
      "workspace/commands/skillLaunchResolvers.ts",
      "utils/mentionCommandReplayText.ts",
      "workspace/browserControlLaunch.ts",
      "components/EmptyStateHero.tsx",
      "home/HomeAmbientSuggestionsContent.tsx",
      "home/HomeSuggestionList.tsx",
      "home/HomeGuideCards.tsx",
      "home/HomeMoreSkillsDrawer.tsx",
      "home/HomeSceneSkillManagerDialog.tsx",
      "home/buildHomeSkillSurface.ts",
      "home/homeSkillSurfaceAdapters.ts",
      "home/homeSurfaceTypes.ts",
      "utils/contextualRecommendations.ts",
      "service-skills/homeEntrySkills.ts",
      "components/useHomeSkillSurface.ts",
      "components/useEmptyStateHomeActions.ts",
      "components/EmptyStateQuickActions.tsx",
      "components/constants.tsx",
      "workspace/useWorkspaceHomeRecoveryRuntime.ts",
      "workspace/useTaskCenterConversationNavigationRuntime.ts",
    ];
    expect(retired.filter((file) => existsSync(base + file))).toEqual([]);
  });

  it("保留多模态和多模型，删除创作 Banner 与自定义皮肤", () => {
    const layout = sourceOf(
      "src/components/agent/chat/components/EmptyStateLayout.tsx",
    );
    const home = sourceOf(
      "src/components/agent/chat/components/EmptyState.tsx",
    );
    const scene = sourceOf(
      "src/components/agent/chat/workspace/WorkspaceConversationScene.tsx",
    );
    const composer = sourceOf(
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
    );
    const sidebar = sourceOf("src/components/AppSidebar.tsx");

    expect(layout).not.toContain("EmptyStateHero");
    expect(
      existsSync("src/components/agent/chat/components/EmptyStateHero.tsx"),
    ).toBe(false);
    expect(scene).toContain('data-testid="workspace-entry-banner"');
    expect(scene).toContain("entryBannerMessage");
    expect(sidebar).not.toContain("AppSidebarAppearancePopover");
    expect(home).toContain("pendingImages");
    expect(composer).toContain("InputbarModelExtra");
    expect(composer).toContain("onAddFiles");
  });
});
