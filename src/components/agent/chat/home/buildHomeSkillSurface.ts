import type { Skill } from "@/lib/api/skills";
import type {
  SkillCatalogEntry,
  SkillCatalogSceneEntry,
} from "@/lib/api/skillCatalog";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { CuratedTaskTemplateItem } from "../utils/curatedTaskTemplates";
import type { SlashEntryUsageRecord } from "../skill-selection/slashEntryUsage";
import {
  HOME_CATEGORY_LABELS,
  HOME_CATEGORY_ORDER,
  HOME_GUIDE_CARDS,
  HOME_INPUT_SUGGESTIONS,
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
  HomeGuideCard,
  HomeInputSuggestion,
  HomeSkillSection,
  HomeSkillSurfaceItem,
  HomeStarterChip,
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

function hasHomeScope(entry: SkillCatalogEntry): boolean {
  return (entry.surfaceScopes ?? []).includes("home");
}

function normalizeHomePresentationOrder(entry: SkillCatalogEntry): number {
  return entry.homePresentation?.order ?? Number.MAX_SAFE_INTEGER;
}

function compareHomePresentationEntries(
  left: SkillCatalogEntry,
  right: SkillCatalogEntry,
): number {
  const orderDelta =
    normalizeHomePresentationOrder(left) -
    normalizeHomePresentationOrder(right);
  if (orderDelta !== 0) {
    return orderDelta;
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function getSceneEntryPrompt(entry: SkillCatalogEntry): string {
  if (entry.kind !== "scene") {
    return "";
  }
  return (
    entry.templates?.[0]?.prompt?.trim() ||
    entry.placeholder?.trim() ||
    entry.summary.trim()
  );
}

function getHomePresentationPrompt(entry: SkillCatalogEntry): string {
  return (
    entry.homePresentation?.prompt?.trim() ||
    getSceneEntryPrompt(entry) ||
    entry.summary.trim()
  );
}

function buildHomeTestId(prefix: string, entry: SkillCatalogEntry): string {
  return `${prefix}-${entry.id.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function listHomePresentationEntries(
  entries: SkillCatalogEntry[] | undefined,
  slot: NonNullable<SkillCatalogEntry["homePresentation"]>["slot"],
): SkillCatalogEntry[] {
  return (entries ?? [])
    .filter(
      (entry) => hasHomeScope(entry) && entry.homePresentation?.slot === slot,
    )
    .sort(compareHomePresentationEntries);
}

export function buildHomeStarterChips(
  entries?: SkillCatalogEntry[],
): HomeStarterChip[] {
  const dynamicChips = listHomePresentationEntries(entries, "starter_chip").map(
    (entry) => {
      const presentation = entry.homePresentation;
      const groupKey = presentation?.groupKey?.trim();
      const prompt = getHomePresentationPrompt(entry);
      const isGuideHelp = groupKey === "guide_help";

      return {
        id: `home-starter-${entry.id}`,
        label: presentation?.label?.trim() || entry.title,
        launchKind: isGuideHelp ? "toggle_guide" : "prefill_prompt",
        primary:
          presentation?.order === 0 ||
          isGuideHelp ||
          presentation?.label === "引导帮助",
        prompt,
        groupKey,
        iconToken: presentation?.iconToken,
        testId: buildHomeTestId("home-starter", entry),
      } satisfies HomeStarterChip;
    },
  );

  if (dynamicChips.length === 0) {
    return HOME_STARTER_CHIPS;
  }

  return [
    ...dynamicChips,
    {
      id: "starter-more",
      label: "更多做法",
      launchKind: "open_drawer",
      testId: "home-more-skills-trigger",
    },
    {
      id: "starter-manager",
      label: "⚙",
      launchKind: "open_manager",
      testId: "home-skill-manager-trigger",
    },
  ];
}

export function buildHomeInputSuggestions(
  entries?: SkillCatalogEntry[],
): HomeInputSuggestion[] {
  const dynamicSuggestions = listHomePresentationEntries(
    entries,
    "input_suggestion",
  )
    .map((entry) => {
      const prompt = getHomePresentationPrompt(entry);
      const label = entry.homePresentation?.label?.trim() || entry.title;
      if (!prompt || !label) {
        return null;
      }

      const suggestion: HomeInputSuggestion = {
        id: entry.id,
        label,
        prompt,
        order: normalizeHomePresentationOrder(entry),
        testId: buildHomeTestId("home-input-suggestion", entry),
      };
      return suggestion;
    })
    .filter((item): item is HomeInputSuggestion => Boolean(item));

  return dynamicSuggestions.length > 0
    ? dynamicSuggestions
    : HOME_INPUT_SUGGESTIONS;
}

export function buildHomeGuideCards(
  entries?: SkillCatalogEntry[],
): HomeGuideCard[] {
  const dynamicCards = listHomePresentationEntries(entries, "guide_card")
    .map((entry) => {
      const prompt = getHomePresentationPrompt(entry);
      if (!prompt) {
        return null;
      }

      const card: HomeGuideCard = {
        id: entry.id,
        title: entry.homePresentation?.title?.trim() || entry.title,
        summary:
          entry.homePresentation?.summary?.trim() ||
          entry.summary.trim() ||
          prompt,
        prompt,
        groupKey: entry.homePresentation?.groupKey,
        iconToken: entry.homePresentation?.iconToken,
        testId: buildHomeTestId("home-guide", entry),
      };
      return card;
    })
    .filter((item): item is HomeGuideCard => Boolean(item));

  return dynamicCards.length > 0 ? dynamicCards : HOME_GUIDE_CARDS;
}
