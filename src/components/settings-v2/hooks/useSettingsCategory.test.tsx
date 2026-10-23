import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";
import { settingsSections } from "../sections";
import { useSettingsCategory, type CategoryGroup } from "./useSettingsCategory";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderHookProbe(onGroups: (groups: CategoryGroup[]) => void) {
  function Probe() {
    onGroups(useSettingsCategory());
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Probe />);
  });

  mounted.push({ container, root });
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  await changeLimeLocale("en-US");
});

afterEach(async () => {
  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }

  await changeLimeLocale("zh-CN");
});

describe("useSettingsCategory", () => {
  it("智能体导航应包含技能设置", () => {
    let groups: CategoryGroup[] = [];

    renderHookProbe((nextGroups) => {
      groups = nextGroups;
    });

    const agentGroup = groups.find(
      (group) => group.key === SettingsGroupKey.Integrations,
    );
    const skillsItem = agentGroup?.items.find(
      (item) => item.key === SettingsTabs.Skills,
    );

    expect(skillsItem?.label).toBe("Skills");
    expect(skillsItem?.label).not.toContain("settings.tab.skills");
  });

  it("系统导航应只保留开发者与实验功能合并入口", () => {
    let groups: CategoryGroup[] = [];

    renderHookProbe((nextGroups) => {
      groups = nextGroups;
    });

    const systemGroup = groups.find(
      (group) => group.key === SettingsGroupKey.Coding,
    );
    const systemKeys = systemGroup?.items.map((item) => item.key) ?? [];
    const developerItem = systemGroup?.items.find(
      (item) => item.key === SettingsTabs.Developer,
    );

    expect(systemGroup?.title).toBe("Coding");
    expect(systemKeys).toContain(SettingsTabs.Developer);
    expect(systemKeys).toContain(SettingsTabs.ExecutionPolicy);
    expect(systemKeys).not.toContain(SettingsTabs.Experimental);
    expect(
      systemGroup?.items.find(
        (item) => item.key === SettingsTabs.ExecutionPolicy,
      )?.label,
    ).toBe("Execution Policy");
    expect(developerItem?.label).toBe("Developer & Labs");
    expect(developerItem?.label).not.toBe("开发者与实验功能");
    expect(developerItem?.label).not.toContain("settings.tab.developerLab");
    expect(developerItem?.experimental).toBe(true);
  });

  it("通用导航应包含已归档对话入口", () => {
    let groups: CategoryGroup[] = [];

    renderHookProbe((nextGroups) => {
      groups = nextGroups;
    });

    const generalGroup = groups.find(
      (group) => group.key === SettingsGroupKey.Personal,
    );
    const archivedItem = generalGroup?.items.find(
      (item) => item.key === SettingsTabs.ArchivedConversations,
    );

    expect(generalGroup?.title).toBe("Personal");
    expect(archivedItem?.label).toBe("Archived chats");
    const generalKeys = generalGroup?.items.map((item) => item.key) ?? [];

    expect(generalKeys).toContain(SettingsTabs.Appearance);
    expect(generalKeys).toContain(SettingsTabs.Memory);
    expect(generalKeys).toContain(SettingsTabs.ArchivedConversations);
  });
});

describe("current settings navigation translations", () => {
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 下全部 current 章节应继续显示既有翻译",
    async (locale) => {
      await changeLimeLocale(locale);
      let groups: CategoryGroup[] = [];
      renderHookProbe((nextGroups) => {
        groups = nextGroups;
      });
      const items = groups.flatMap((group) => group.items);
      expect(groups).toHaveLength(3);
      expect(items).toHaveLength(settingsSections.length);
      expect(new Set(items.map((item) => item.key)).size).toBe(
        settingsSections.length,
      );
      expect(items.map((item) => item.key)).toEqual(
        expect.arrayContaining([
          SettingsTabs.Browser,
          SettingsTabs.KeyboardShortcuts,
          SettingsTabs.Git,
          SettingsTabs.Worktrees,
        ]),
      );
      for (const group of groups) {
        expect(group.items.map((item) => item.key)).toEqual(
          settingsSections
            .filter((section) => section.group === group.key)
            .map((section) => section.key),
        );
        expect(group.title.trim()).not.toBe("");
        expect(group.title).not.toContain("settings.group.");
        for (const item of group.items) {
          expect(item.label.trim()).not.toBe("");
          expect(item.label).not.toMatch(/^settings\./);
        }
      }
    },
  );
});
