import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Palette, Brain, ShieldCheck } from "lucide-react";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";

const mockUseSettingsCategory = vi.fn();

vi.mock("../hooks/useSettingsCategory", () => ({
  useSettingsCategory: () => mockUseSettingsCategory(),
}));

import { SettingsHomePage } from "./index";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mounted: RenderResult[] = [];

function renderPage(
  onTabChange = vi.fn(),
  onTabPrefetch?: (tab: SettingsTabs) => void,
  onOpenCompanion?: () => void,
  onNavigate?: (page: string, params?: unknown) => void,
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SettingsHomePage
        onTabChange={onTabChange}
        onTabPrefetch={onTabPrefetch}
        onOpenCompanion={onOpenCompanion}
        onNavigate={onNavigate as any}
      />,
    );
  });

  const rendered = { container, root };
  mounted.push(rendered);
  return rendered;
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseSettingsCategory.mockReturnValue([
    {
      key: SettingsGroupKey.Overview,
      title: "概览",
      items: [
        {
          key: SettingsTabs.Home,
          label: "设置首页",
          icon: Palette,
        },
      ],
    },
    {
      key: SettingsGroupKey.General,
      title: "通用",
      items: [
        {
          key: SettingsTabs.Appearance,
          label: "外观",
          icon: Palette,
        },
      ],
    },
    {
      key: SettingsGroupKey.Agent,
      title: "智能体",
      items: [
        {
          key: SettingsTabs.Providers,
          label: "AI 服务商",
          icon: Brain,
        },
      ],
    },
    {
      key: SettingsGroupKey.System,
      title: "系统",
      items: [
        {
          key: SettingsTabs.ChromeRelay,
          label: "连接器",
          icon: ShieldCheck,
        },
      ],
    },
  ]);
});

afterEach(() => {
  mockUseSettingsCategory.mockReset();

  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }
    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
});

describe("SettingsHomePage", () => {
  it("应渲染设置首页总览与分组入口", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";

    expect(text).toContain("设置首页");
    expect(text).toContain("快速进入常用设置并查看各分组入口。");
    expect(text).toContain("常用入口");
    expect(text).toContain("通用");
    expect(text).toContain("智能体");
    expect(text).toContain("系统");
    expect(text).toContain("外观");
    expect(text).toContain("AI 服务商");
    expect(text).not.toContain("SETTINGS OVERVIEW");
    expect(text).not.toContain("安全与性能");
    expect(text).not.toContain("权限、稳定性与运行开关");
  });

  it("点击常用入口时应触发 tab 切换", () => {
    const onTabChange = vi.fn();
    const { container } = renderPage(onTabChange);
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("外观"),
    );

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onTabChange).toHaveBeenCalledWith(SettingsTabs.Appearance);
  });

  it("悬停常用入口时应触发对应 tab 预取", () => {
    const onTabPrefetch = vi.fn();
    const { container } = renderPage(vi.fn(), onTabPrefetch);
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("外观"),
    );

    act(() => {
      button?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(onTabPrefetch).toHaveBeenCalledWith(SettingsTabs.Appearance);
  });

  it("点击桌宠入口时应打开桌宠管理页", () => {
    const onOpenCompanion = vi.fn();
    const { container } = renderPage(vi.fn(), undefined, onOpenCompanion);
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("桌宠"),
    );

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenCompanion).toHaveBeenCalledTimes(1);
  });

  it("应展示当前入口卡并支持跳到当前落点", () => {
    const onTabChange = vi.fn();
    const onNavigate = vi.fn();
    const { container } = renderPage(
      onTabChange,
      undefined,
      undefined,
      onNavigate,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("当前入口");
    expect(text).toContain("全部做法");
    expect(text).toContain("持续流程");
    expect(text).toContain("消息渠道");
    expect(text).toContain("项目资料");

    const openAutomationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes("打开持续流程"));
    const openChannelsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes("打开消息渠道"));
    const openSkillsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes("去我的方法"));
    const openResourcesButton = Array.from(
      container.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes("打开项目资料"));

    act(() => {
      openAutomationButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      openChannelsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      openSkillsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      openResourcesButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onTabChange).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("skills");
    expect(onNavigate).toHaveBeenCalledWith("automation");
    expect(onNavigate).toHaveBeenCalledWith("channels");
    expect(onNavigate).toHaveBeenCalledWith("resources");
  });

  it("应把首页说明和常用入口说明收进 tips", async () => {
    renderPage();

    expect(getBodyText()).not.toContain(
      "快速进入常用设置并查看各分组入口，减少在多层菜单之间来回寻找。",
    );

    const heroTip = await hoverTip("设置首页说明");
    expect(getBodyText()).toContain(
      "快速进入常用设置并查看各分组入口，减少在多层菜单之间来回寻找。",
    );
    await leaveTip(heroTip);

    const cardTip = await hoverTip("外观说明");
    expect(getBodyText()).toContain("主题、语言与提示音效");
    await leaveTip(cardTip);
  });
});
