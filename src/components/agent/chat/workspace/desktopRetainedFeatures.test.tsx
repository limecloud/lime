import { existsSync, readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppSidebarAppearancePopover } from "@/components/app-sidebar/AppSidebarAppearancePopover";
import { EmptyStateHero } from "../components/EmptyStateHero";

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

  it("首页和 Composer 仍引用 Banner、Hero、主题、多模态和多模型入口", () => {
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

    expect(layout).toContain("EmptyStateHero");
    expect(scene).toContain('data-testid="workspace-entry-banner"');
    expect(scene).toContain("entryBannerMessage");
    expect(sidebar).toContain("AppSidebarAppearancePopover");
    expect(home).toContain("pendingImages");
    expect(composer).toContain("InputbarModelExtra");
    expect(composer).toContain("onAddFiles");
  });

  it("应渲染首页 Hero 和主题控件", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <>
          <EmptyStateHero
            eyebrow="创作"
            slogan="青柠一下，灵感即来"
            description="说一句目标，Lime 就接着帮你做。"
          />
          <AppSidebarAppearancePopover
            themeMode="system"
            colorSchemeId="dream-blossom"
            themeOptions={[
              {
                id: "system",
                label: "跟随系统",
                description: "使用系统外观",
              },
            ]}
            colorSchemes={[]}
            copy={{
              entryLabel: "主题",
              titleLabel: "外观",
              summaryLabel: "当前主题",
              themeGroupLabel: "模式",
              colorSchemeGroupLabel: "配色",
              randomColorSchemeLabel: "随机",
              randomColorSchemeAriaLabel: "随机配色",
              randomColorSchemeTitle: "换一套配色",
              formatThemeSwitchAria: (label) => label,
              formatColorSchemeSwitchAria: (label) => label,
            }}
            onThemeModeChange={() => undefined}
            onColorSchemeChange={() => undefined}
            onRandomColorScheme={() => undefined}
          />
        </>,
      );
    });

    expect(
      container.querySelector('[data-testid="empty-state-hero-eyebrow-badge"]')
        ?.textContent,
    ).toBe("创作");
    expect(
      container.querySelector('[data-testid="app-sidebar-appearance-popover"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("跟随系统");

    act(() => root.unmount());
  });
});
