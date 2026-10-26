import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";
import { settingsSections } from "../sections";
import { useSettingsCategory, type CategoryGroup } from "./useSettingsCategory";

const runtime = vi.hoisted(() => ({ oemAvailable: false }));
vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: () => (runtime.oemAvailable ? {} : null),
}));

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
  runtime.oemAvailable = false;
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
  it("集成导航应包含插件设置", () => {
    let groups: CategoryGroup[] = [];

    renderHookProbe((nextGroups) => {
      groups = nextGroups;
    });

    const agentGroup = groups.find(
      (group) => group.key === SettingsGroupKey.Integrations,
    );
    const skillsItem = agentGroup?.items.find(
      (item) => item.key === SettingsTabs.Plugins,
    );

    expect(skillsItem?.label).toBe("Plugins");
    expect(skillsItem?.label).not.toContain("settings.desktop.plugins");
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
    expect(generalKeys).toContain(SettingsTabs.Configuration);
    expect(
      generalGroup?.items.find(
        (item) => item.key === SettingsTabs.Configuration,
      )?.label,
    ).toBe("Configuration");
    expect(generalKeys).toContain(SettingsTabs.Memory);
    expect(generalKeys).toContain(SettingsTabs.ArchivedConversations);
  });
});

describe("current settings navigation translations", () => {
  const locales = [
    ["zh-CN", "已归档的聊天"],
    ["zh-TW", "已封存的聊天"],
    ["en-US", "Archived chats"],
    ["ja-JP", "アーカイブ済みのチャット"],
    ["ko-KR", "보관된 채팅"],
  ] as const;
  it.each(
    locales.flatMap(([locale, archivedLabel]) =>
      [false, true].map((oemAvailable) => ({
        locale,
        archivedLabel,
        oemAvailable,
      })),
    ),
  )(
    "$locale 下可用章节应显示翻译（OEM=$oemAvailable）",
    async ({ locale, archivedLabel, oemAvailable }) => {
      runtime.oemAvailable = oemAvailable;
      await changeLimeLocale(locale);
      let groups: CategoryGroup[] = [];
      renderHookProbe((nextGroups) => {
        groups = nextGroups;
      });
      const items = groups.flatMap((group) => group.items);
      const availableSections = settingsSections.filter(
        (section) => oemAvailable || section.key !== SettingsTabs.Profile,
      );
      expect(groups).toHaveLength(4);
      expect(items.at(-1)?.key).toBe(SettingsTabs.About);
      expect(
        items.find((item) => item.key === SettingsTabs.ArchivedConversations)
          ?.label,
      ).toBe(archivedLabel);
      expect(items.some((item) => item.key === SettingsTabs.Profile)).toBe(
        oemAvailable,
      );
      expect(items).toHaveLength(availableSections.length);
      expect(new Set(items.map((item) => item.key)).size).toBe(
        availableSections.length,
      );
      expect(items.map((item) => item.key)).toEqual(
        expect.arrayContaining([
          SettingsTabs.Browser,
          SettingsTabs.KeyboardShortcuts,
          SettingsTabs.Git,
          SettingsTabs.Hooks,
          SettingsTabs.Worktrees,
        ]),
      );
      for (const group of groups) {
        expect(group.items.map((item) => item.key)).toEqual(
          availableSections
            .filter((section) => section.group === group.key)
            .map((section) => section.key),
        );
        if (group.key) expect(group.title.trim()).not.toBe("");
        else expect(group.title).toBe("");
        expect(group.title).not.toContain("settings.group.");
        for (const item of group.items) {
          expect(item.label.trim()).not.toBe("");
          expect(item.label).not.toMatch(/^settings\./);
        }
      }
    },
  );
});
