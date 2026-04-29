import type { Skill } from "@/lib/api/skills";
import type { SkillCatalogSceneEntry } from "@/lib/api/skillCatalog";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { CuratedTaskTemplateItem } from "../utils/curatedTaskTemplates";
import type { SlashEntryUsageRecord } from "../skill-selection/slashEntryUsage";
import type {
  HomeSkillCategory,
  HomeSkillSurfaceItem,
} from "./homeSurfaceTypes";

const CURATED_TASK_CATEGORY_BY_ID: Record<string, HomeSkillCategory> = {
  "daily-trend-briefing": "social",
  "social-post-starter": "social",
  "viral-content-breakdown": "social",
  "longform-multiplatform-rewrite": "social",
  "script-to-voiceover": "video",
  "account-project-review": "social",
};

const CURATED_TASK_COVER_BY_ID: Record<string, string> = {
  "daily-trend-briefing": "trend",
  "social-post-starter": "draft",
  "viral-content-breakdown": "viral",
  "longform-multiplatform-rewrite": "rewrite",
  "script-to-voiceover": "voice",
  "account-project-review": "review",
};

const SERVICE_SKILL_COVER_BY_ID: Record<string, string> = {
  "account-performance-tracking": "account-performance-tracking",
  "article-to-slide-video-outline": "article-to-slide-video-outline",
  "carousel-post-replication": "carousel-post-replication",
  "cloud-video-dubbing": "cloud-video-dubbing",
  "daily-trend-briefing": "trend",
  "short-video-script-replication": "short-video-script-replication",
  "video-dubbing-language": "video-dubbing-language",
};

function inferServiceSkillCategory(
  skill: ServiceSkillHomeItem,
): HomeSkillCategory {
  const haystack = [
    skill.title,
    skill.summary,
    skill.groupKey,
    skill.runnerLabel,
    skill.runnerDescription,
  ]
    .filter(Boolean)
    .join(" ");

  if (/视频|口播|字幕|剪辑|video/i.test(haystack)) {
    return "video";
  }
  if (/图|图片|海报|封面|设计|视觉|image|design/i.test(haystack)) {
    return "visual_design";
  }
  if (/音频|音乐|播客|配音|audio|music/i.test(haystack)) {
    return "audio_music";
  }
  if (/编辑|改写|尺寸|背景|editor/i.test(haystack)) {
    return "editor";
  }
  return "social";
}

function inferInstalledSkillCategory(skill: Skill): HomeSkillCategory {
  const haystack = [
    skill.name,
    skill.description,
    ...(skill.allowedTools ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  if (/视频|video/i.test(haystack)) {
    return "video";
  }
  if (/图片|图像|设计|image|design/i.test(haystack)) {
    return "visual_design";
  }
  if (/音频|音乐|audio|music/i.test(haystack)) {
    return "audio_music";
  }
  if (/编辑|editor/i.test(haystack)) {
    return "editor";
  }
  return "other";
}

function buildCoverToken(seed: string, fallback: string): string {
  return seed.trim() || fallback;
}

function inferSceneEntryCategory(
  entry: SkillCatalogSceneEntry,
): HomeSkillCategory {
  const haystack = [
    entry.title,
    entry.summary,
    entry.sceneKey,
    entry.commandPrefix,
  ]
    .filter(Boolean)
    .join(" ");

  if (/视频|脚本|短片|video/i.test(haystack)) {
    return "video";
  }
  if (/图|海报|封面|设计|visual|image|design/i.test(haystack)) {
    return "visual_design";
  }
  if (/音频|播客|配音|audio|music/i.test(haystack)) {
    return "audio_music";
  }
  if (/编辑|改写|rewrite|editor/i.test(haystack)) {
    return "editor";
  }
  return "social";
}

export function fromCuratedTaskTemplate(
  template: CuratedTaskTemplateItem,
): HomeSkillSurfaceItem {
  return {
    id: template.id,
    title: template.title,
    summary: template.summary,
    category: CURATED_TASK_CATEGORY_BY_ID[template.id] ?? "other",
    sourceKind: "curated_task",
    launchKind: "curated_task_launcher",
    coverToken: CURATED_TASK_COVER_BY_ID[template.id] ?? template.id,
    isRecent: template.isRecent,
    isRecommended: true,
    usedAt: template.recentUsedAt,
    testId: `entry-recommended-${template.id}`,
    badge: template.badge,
  };
}

export function fromServiceSkill(
  skill: ServiceSkillHomeItem,
  usage?: SlashEntryUsageRecord,
): HomeSkillSurfaceItem {
  return {
    id: skill.id,
    title: skill.title,
    summary:
      usage?.replayText?.trim() ||
      skill.summary?.trim() ||
      skill.runnerDescription,
    category: inferServiceSkillCategory(skill),
    sourceKind: "service_skill",
    launchKind: "service_skill",
    coverToken:
      SERVICE_SKILL_COVER_BY_ID[skill.id] ??
      buildCoverToken(skill.groupKey ?? skill.id, "service"),
    isRecent: Boolean(usage) || skill.isRecent,
    isRecommended: false,
    usedAt: usage?.usedAt ?? skill.recentUsedAt,
    testId: `entry-service-skill-${skill.id}`,
    badge: usage ? "最近使用" : skill.badge,
  };
}

export function fromInstalledSkill(
  skill: Skill,
  usage?: SlashEntryUsageRecord,
): HomeSkillSurfaceItem {
  return {
    id: skill.key,
    title: skill.name,
    summary: usage?.replayText?.trim() || skill.description,
    category: inferInstalledSkillCategory(skill),
    sourceKind: "installed_skill",
    launchKind: "installed_skill",
    coverToken: buildCoverToken(skill.sourceKind, "installed"),
    isRecent: Boolean(usage),
    isRecommended: false,
    usedAt: usage?.usedAt ?? null,
    testId: `entry-installed-skill-${skill.key}`,
    badge: usage ? "最近使用" : "已安装",
  };
}

export function fromSceneAppEntry(
  item: SceneAppEntryCardItem,
  usage?: SlashEntryUsageRecord,
): HomeSkillSurfaceItem {
  return {
    id: item.id,
    title: item.title,
    summary: usage?.replayText?.trim() || item.summary,
    category: "other",
    sourceKind: "scene_app",
    launchKind: "scene_app",
    coverToken: buildCoverToken(item.executionTone, "scene"),
    isRecent: Boolean(usage),
    isRecommended: false,
    usedAt: usage?.usedAt ?? null,
    testId: `entry-sceneapp-${item.id}`,
    badge: usage ? "最近使用" : item.businessLabel,
  };
}

export function fromSkillCatalogSceneEntry(
  entry: SkillCatalogSceneEntry,
  usage?: SlashEntryUsageRecord,
): HomeSkillSurfaceItem {
  const launchPrompt = entry.templates?.[0]?.prompt?.trim();

  return {
    id: entry.id,
    title: entry.title,
    summary: usage?.replayText?.trim() || entry.summary,
    category: inferSceneEntryCategory(entry),
    sourceKind: "skill_catalog_scene",
    launchKind: "skill_catalog_scene",
    coverToken: buildCoverToken(entry.sceneKey, "scene"),
    isRecent: Boolean(usage),
    isRecommended: false,
    usedAt: usage?.usedAt ?? null,
    testId: `entry-skill-catalog-scene-${entry.id.replace(/[^a-z0-9_-]/gi, "-")}`,
    badge: usage ? "最近使用" : "自定义场景",
    linkedSkillId: entry.linkedSkillId,
    launchPrompt,
    placeholder: entry.placeholder,
  };
}
