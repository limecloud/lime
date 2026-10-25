import type { TFunction } from "i18next";
import type { SettingsTabs } from "@/types/settings";
import type { CategoryGroup } from "./hooks/useSettingsCategory";
import { settingsSearchDocuments } from "./settingsSearchDocuments";
import {
  resolveHotkeyPlatform,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";

export interface SettingsSearchResult {
  section: SettingsTabs;
  label: string;
  panelLabel: string;
  targetId?: string;
}

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim();

export function isSettingsSearchTarget(
  section: SettingsTabs,
  targetId: string,
  platform = resolveHotkeyPlatform(globalThis.navigator),
): boolean {
  return Boolean(
    getSettingsSearchDocument(section, targetId, platform),
  );
}

export function getSettingsSearchDocument(
  section: SettingsTabs,
  targetId: string | undefined,
  platform = resolveHotkeyPlatform(globalThis.navigator),
) {
  return settingsSearchDocuments.find(
    (document) =>
      document.section === section &&
      document.targetId === targetId &&
      document.excludePlatform !== platform &&
      (!document.platform || document.platform === platform),
  );
}

export function searchSettings(
  query: string,
  groups: CategoryGroup[],
  t: TFunction<"settings", undefined>,
  platform: HotkeyPlatform = resolveHotkeyPlatform(globalThis.navigator),
): SettingsSearchResult[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const matches = (value: string) => {
    const text = normalize(value);
    return terms.every((term) => text.includes(term));
  };
  const results: Array<SettingsSearchResult & { score: number }> = [];
  for (const group of groups) {
    for (const item of group.items) {
      const panel = { section: item.key, panelLabel: item.label };
      if (matches(item.label) || matches(group.title)) {
        results.push({ ...panel, label: item.label, score: 3 });
        continue;
      }
      let best: (SettingsSearchResult & { score: number }) | undefined;
      for (const document of settingsSearchDocuments) {
        if (
          document.section !== item.key ||
          document.excludePlatform === platform ||
          (document.platform && document.platform !== platform)
        )
          continue;
        const label = t(document.labelKey);
        const text = [
          item.label,
          label,
          ...document.termKeys.map((key) => t(key)),
        ].join(" ");
        if (!matches(text)) continue;
        const score = matches(label) ? 2 : 1;
        if (!best || score > best.score) {
          best = { ...panel, label, targetId: document.targetId, score };
        }
      }
      if (best) results.push(best);
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...result }) => result);
}
