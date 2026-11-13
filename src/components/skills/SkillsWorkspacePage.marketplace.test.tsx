import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/api/skills";
import {
  createDefaultLocalSkills,
  findButtonIn,
  findMarketplaceCard,
  mocks,
  renderPage,
  useSkillsWorkspacePageTestLifecycle,
} from "./SkillsWorkspacePage.testFixtures";



async function clickInstalledMarketplaceAction(
  card: Element | null,
  label: string,
): Promise<void> {
  const trigger = card?.querySelector<HTMLButtonElement>(
    '[data-testid="skills-marketplace-actions"]',
  );
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.click();
    await Promise.resolve();
  });
  const item = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    )].find((element) => element.textContent?.trim() === label);
    expect(found).toBeTruthy();
    return found!;
  });
  await act(async () => {
    item.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SkillsWorkspacePage marketplace", () => {
  useSkillsWorkspacePageTestLifecycle();

  it("技能广场点击未安装官方技能应安装标准包并刷新本地列表", async () => {
    const { container } = renderPage({ initialView: "store" });
    const card = findMarketplaceCard(container, "数据分析");
    mocks.installOfficialMarketplaceSkill.mockResolvedValueOnce({
      directory: "analysis-official",
      inspection: {
        content: "# Analysis",
        metadata: {},
        allowedTools: [],
        resourceSummary: {
          hasScripts: false,
          hasReferences: true,
          hasAssets: false,
        },
        standardCompliance: {
          isStandard: true,
          validationErrors: [],
          deprecatedFields: [],
        },
      },
    });
    mocks.refreshLocalSkills.mockImplementationOnce(() => {
      mocks.localSkills = [
        ...createDefaultLocalSkills(),
        {
          key: "local:analysis-official",
          name: "数据分析",
          description: "整理数据、提炼结论，并输出可继续追问的分析摘要。",
          directory: "analysis-official",
          installed: true,
          sourceKind: "other",
          catalogSource: "user",
        } as Skill,
      ];
      return Promise.resolve();
    });

    await act(async () => {
      findButtonIn(card!, "安装")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.installOfficialMarketplaceSkill).toHaveBeenCalledWith(
      "analysis",
      "lime",
      undefined,
    );
    expect(mocks.refreshLocalSkills).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已安装「数据分析」");
    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("数据分析");
    expect(container.textContent).toContain("已安装");
  });

  it("技能广场点击详情应打开当前技能的 SKILL.md 内容", async () => {
    const { container } = renderPage({ initialView: "store" });
    const card = findMarketplaceCard(container, "数据分析");

    expect(
      container.querySelector('[data-testid="skills-marketplace-detail"]'),
    ).toBeNull();

    await act(async () => {
      card
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="skills-marketplace-open"]',
        )
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const detail = container.querySelector(
      '[data-testid="skills-marketplace-detail"]',
    );
    expect(detail).toBeTruthy();
    expect(mocks.getOfficialSkillMarketplaceBundle).toHaveBeenCalledWith(
      "analysis",
      undefined,
    );
    expect(detail?.textContent).toContain("数据分析");
    expect(detail?.textContent).toContain("以下内容来自该技能的 SKILL.md 原文");
    expect(detail?.textContent).toContain("Deep Research");
    expect(detail?.textContent).toContain("Core Purpose");
    expect(detail?.textContent).toContain("Decision Tree");
    expect(detail?.querySelector("strong")?.textContent).toBe(
      "citation-backed",
    );
    expect(detail?.querySelector("code")?.textContent).toBe("SKILL.md");
    expect(detail?.querySelector("blockquote")?.textContent).toContain(
      "CRITICAL - Phase 0 is mandatory.",
    );
    expect(detail?.querySelector("table")?.textContent).toContain("Scope");
    expect(detail?.querySelector("pre")?.textContent).toContain(
      "Request received",
    );
  });

  it("已安装的官方技能点击使用应回首页输入框预选本地 Skill", async () => {
    mocks.localSkills = [
      ...createDefaultLocalSkills(),
      {
        key: "local:analysis",
        name: "数据分析",
        description: "已安装的数据分析技能",
        directory: "analysis",
        installed: true,
        sourceKind: "other",
        catalogSource: "user",
      },
    ] as Skill[];
    const { container, onNavigate } = renderPage({ initialView: "store" });
    const card = findMarketplaceCard(container, "数据分析");

    await clickInstalledMarketplaceAction(card, "使用");

    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        theme: "general",
        preferHomeForInitialInputCapability: true,
        initialInputCapability: {
          skill: expect.objectContaining({
            key: "local:analysis",
            name: "数据分析",
          }),
          requestKey: expect.any(Number),
        },
      }),
      ),
    );
  });

  it("已安装的官方技能点击卸载应走结构化卸载", async () => {
    mocks.localSkills = [
      ...createDefaultLocalSkills(),
      {
        key: "local:analysis",
        name: "数据分析",
        description: "已安装的数据分析技能",
        directory: "analysis",
        installed: true,
        sourceKind: "other",
        catalogSource: "user",
      },
    ] as Skill[];
    const { container, onNavigate } = renderPage({ initialView: "store" });
    const card = findMarketplaceCard(container, "数据分析");

    await clickInstalledMarketplaceAction(card, "卸载");

    await vi.waitFor(() =>
      expect(mocks.uninstallLocalSkill).toHaveBeenCalledWith("analysis"),
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("官方技能市场不可用时应回退显示本地可用技能", () => {
    mocks.officialMarketplaceSkills = [];
    mocks.officialMarketplaceError = "network unavailable";
    const { container, onNavigate } = renderPage({ initialView: "store" });
    const card = findMarketplaceCard(container, "深度研究");

    expect(container.textContent).toContain(
      "官方技能市场暂时不可用，已先显示本地可用技能。",
    );
    expect(card).toBeTruthy();

    act(() => {
      findButtonIn(card!, "打开")?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        theme: "general",
        initialPendingServiceSkillLaunch: expect.objectContaining({
          skillId: "service-skill-research",
          requestKey: expect.any(Number),
        }),
      }),
    );
  });
});
