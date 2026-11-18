/**
 * 将 current 设置章节投影为已翻译的分组导航。
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { SettingsGroupKey, type SettingsTabs } from "@/types/settings";
import { isSettingsSection, settingsSections } from "../sections";

export interface CategoryItem {
  key: SettingsTabs;
  label: string;
  icon: LucideIcon;
}

export interface CategoryGroup {
  key: SettingsGroupKey | null;
  title: string;
  items: CategoryItem[];
}

export function useSettingsCategory(): CategoryGroup[] {
  const { t } = useTranslation("settings");
  return useMemo(() => {
    const groups = new Map<SettingsGroupKey | null, CategoryGroup>();
    for (const section of settingsSections) {
      if (!isSettingsSection(section.key) || section.group === null) continue;
      let group = groups.get(section.group);
      if (!group) {
        group = {
          key: section.group,
          title:
            section.group && section.group !== SettingsGroupKey.Configuration
              ? t(`settings.group.${section.group}`)
              : "",
          items: [],
        };
        groups.set(section.group, group);
      }
      group.items.push({
        key: section.key,
        label: t(section.labelKey),
        icon: section.icon,
      });
    }
    return [...groups.values()];
  }, [t]);
}
