import type { Skill } from "@/lib/api/skills";
import type { SkillCatalogSceneEntry } from "@/lib/api/skillCatalog";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { CuratedTaskTemplateItem } from "../utils/curatedTaskTemplates";
import type { SlashEntryUsageRecord } from "../skill-selection/slashEntryUsage";
import {
  HOME_CATEGORY_LABELS,
  HOME_CATEGORY_ORDER,
  HOME_STARTER_CHIPS,
} from "./homeSurfaceCopy";
import {
  fromCuratedTaskTemplate,
  fromInstalledSkill,
  fromSceneAppEntry,
  fromServiceSkill,
  fromSkillCatalogSceneEntry,
} from "./homeSkillSurfaceAdapters";
import type {
  HomeSkillCategory,
  HomeSkillSection,
  HomeSkillSurfaceItem,
} from "./homeSurfaceTypes";

interface BuildHomeSkillSurfaceInput {
  curatedTasks: CuratedTaskTemplateItem[];
  serviceSkills?: ServiceSkillHomeItem[];
  catalogSceneEntries?: SkillCatalogSceneEntry[];
  installedSkills?: Skill[];
  sceneApps?: SceneAppEntryCardItem[];
  slashEntryUsage?: SlashEntryUsageRecord[];
}

function compareHomeItems(
  left: HomeSkillSurfaceItem,
  right: HomeSkillSurfaceItem,
): number {
  if (left.isRecent !== right.isRecent) {
    return left.isRecent ? -1 : 1;
  }

  if (left.usedAt !== right.usedAt) {
    return (right.usedAt ?? 0) - (left.usedAt ?? 0);
  }

  if (left.isRecommended !== right.isRecommended) {
    return left.isRecommended ? -1 : 1;
  }

  return left.title.localeCompare(right.title, "zh-CN");
}

function getUsageByKind(
  records: SlashEntryUsageRecord[] | undefined,
  kind: SlashEntryUsageRecord["kind"],
): Map<string, SlashEntryUsageRecord> {
  return new Map(
    (records ?? [])
      .filter((record) => record.kind === kind)
      .map((record) => [record.entryId, record] as const),
  );
}

function uniqueItems(items: HomeSkillSurfaceItem[]): HomeSkillSurfaceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    // 同一任务可能同时来自 curated task 和 service skill，首页只保留一个入口。
    const key = item.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildHomeSkillItems({
  curatedTasks,
  serviceSkills = [],
  catalogSceneEntries = [],
  installedSkills = [],
  sceneApps = [],
  slashEntryUsage = [],
}: BuildHomeSkillSurfaceInput): HomeSkillSurfaceItem[] {
  const installedUsage = getUsageByKind(slashEntryUsage, "skill");
  const sceneUsage = getUsageByKind(slashEntryUsage, "scene");

  return uniqueItems([
    ...curatedTasks.map(fromCuratedTaskTemplate),
    ...catalogSceneEntries.map((entry) =>
      fromSkillCatalogSceneEntry(entry, sceneUsage.get(entry.id)),
    ),
    ...serviceSkills.map((skill) =>
      fromServiceSkill(
        skill,
        sceneUsage.get(skill.sceneBinding?.sceneKey ?? "") ??
          sceneUsage.get(skill.id),
      ),
    ),
    ...installedSkills.map((skill) =>
      fromInstalledSkill(skill, installedUsage.get(skill.key)),
    ),
    ...sceneApps.map((item) =>
      fromSceneAppEntry(item, sceneUsage.get(item.id)),
    ),
  ]).sort(compareHomeItems);
}

export function buildHomeSkillSections(
  items: HomeSkillSurfaceItem[],
): HomeSkillSection[] {
  const recentItems = items
    .filter((item) => item.isRecent)
    .sort(compareHomeItems)
    .slice(0, 6);

  return HOME_CATEGORY_ORDER.map((category) => {
    const sectionItems =
      category === "recent"
        ? recentItems
        : items
            .filter((item) => item.category === category)
            .sort(compareHomeItems)
            .slice(0, 8);

    return {
      id: category,
      title: HOME_CATEGORY_LABELS[category],
      items: sectionItems,
    };
  }).filter((section) => section.items.length > 0);
}

export function buildHomeGalleryItems(
  items: HomeSkillSurfaceItem[],
  category: HomeSkillCategory | "all" = "all",
): HomeSkillSurfaceItem[] {
  return items
    .filter((item) => category === "all" || item.category === category)
    .sort(compareHomeItems)
    .slice(0, 12);
}

export function buildHomeStarterChips() {
  return HOME_STARTER_CHIPS;
}
