import type { CreationMode } from "@/lib/workspace/workbenchContract";
import {
  AudioLines,
  Clapperboard,
  FileSearch,
  Film,
  Image,
  LayoutTemplate,
  Mic,
  Music4,
  Search,
  Type,
  Video,
} from "lucide-react";
import type { WorkbenchRightRailCapabilitySection } from "./workbenchRightRailTypes";

type VideoCreationTypeKey =
  | "spoken_script"
  | "story"
  | "review"
  | "visit_shop"
  | "tutorial"
  | "generic";

export const VIDEO_CREATION_MODE_LABELS: Record<CreationMode, string> = {
  guided: "引导模式",
  fast: "快速模式",
  hybrid: "混合模式",
  framework: "框架模式",
};

const VIDEO_CAPABILITY_SECTIONS_BY_CREATION_MODE: Record<
  CreationMode,
  WorkbenchRightRailCapabilitySection[]
> = {
  guided: [
    {
      key: "video-script",
      title: "前期准备",
      tone: "violet",
      items: [
        { key: "search-material", label: "找参考", icon: Search, tone: "violet" },
        { key: "generate-title", label: "开场钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "分镜草案", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-visual",
      title: "画面生成",
      tone: "blue",
      items: [
        { key: "generate-video-assets", label: "补素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "开始生成", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-audio",
      title: "声音包装",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "BGM", icon: Music4, tone: "pink" },
        { key: "generate-sfx", label: "音效", icon: AudioLines, tone: "pink" },
      ],
    },
  ],
  fast: [
    {
      key: "video-fast-plan",
      title: "快速准备",
      tone: "violet",
      items: [
        { key: "generate-title", label: "开场钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "分镜草案", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-fast-visual",
      title: "快速出片",
      tone: "blue",
      items: [
        { key: "generate-ai-video", label: "开始生成", icon: Video, tone: "blue" },
        { key: "generate-video-assets", label: "补素材", icon: Clapperboard, tone: "blue" },
      ],
    },
    {
      key: "video-fast-audio",
      title: "快速包装",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "BGM", icon: Music4, tone: "pink" },
      ],
    },
  ],
  hybrid: [
    {
      key: "video-hybrid-plan",
      title: "协同准备",
      tone: "violet",
      items: [
        { key: "search-material", label: "找参考", icon: Search, tone: "violet" },
        { key: "generate-title", label: "开场钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "分镜草案", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-hybrid-visual",
      title: "画面补全",
      tone: "blue",
      items: [
        { key: "generate-video-assets", label: "补素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "开始生成", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-hybrid-audio",
      title: "声音精修",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "BGM", icon: Music4, tone: "pink" },
        { key: "generate-sfx", label: "音效", icon: AudioLines, tone: "pink" },
      ],
    },
  ],
  framework: [
    {
      key: "video-framework-plan",
      title: "结构搭建",
      tone: "violet",
      items: [
        { key: "generate-title", label: "开场钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "分镜草案", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-framework-visual",
      title: "执行制作",
      tone: "blue",
      items: [
        { key: "generate-video-assets", label: "补素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "开始生成", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-framework-audio",
      title: "包装完善",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "BGM", icon: Music4, tone: "pink" },
        { key: "generate-sfx", label: "音效", icon: AudioLines, tone: "pink" },
      ],
    },
  ],
};

const VIDEO_CAPABILITY_SECTIONS_BY_TYPE: Record<
  VideoCreationTypeKey,
  WorkbenchRightRailCapabilitySection[]
> = {
  spoken_script: [
    {
      key: "video-spoken-planning",
      title: "口播策划",
      tone: "violet",
      items: [
        { key: "search-material", label: "找选题", icon: Search, tone: "violet" },
        { key: "generate-title", label: "开场钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "拆口播分镜", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-spoken-audio",
      title: "声音制作",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "配口播", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "配BGM", icon: Music4, tone: "pink" },
        { key: "generate-sfx", label: "补音效", icon: AudioLines, tone: "pink" },
      ],
    },
    {
      key: "video-spoken-visual",
      title: "画面补全",
      tone: "blue",
      items: [
        { key: "generate-cover", label: "做封面", icon: LayoutTemplate, tone: "blue" },
        { key: "generate-video-assets", label: "补素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "生成视频", icon: Video, tone: "blue" },
      ],
    },
  ],
  story: [
    {
      key: "video-story-script",
      title: "剧情脚本",
      tone: "violet",
      items: [
        { key: "generate-title", label: "故事卖点", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "剧情分镜", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-story-visual",
      title: "剧情画面",
      tone: "blue",
      items: [
        { key: "generate-video-assets", label: "场景素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "剧情视频", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-story-audio",
      title: "剧情包装",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "旁白配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "情绪BGM", icon: Music4, tone: "pink" },
        { key: "generate-sfx", label: "氛围音效", icon: AudioLines, tone: "pink" },
      ],
    },
  ],
  review: [
    {
      key: "video-review-plan",
      title: "测评结构",
      tone: "violet",
      items: [
        { key: "search-material", label: "查资料", icon: FileSearch, tone: "violet" },
        { key: "generate-title", label: "测评钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "对比分镜", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-review-visual",
      title: "测评出片",
      tone: "blue",
      items: [
        { key: "generate-image", label: "商品图", icon: Image, tone: "blue" },
        { key: "generate-video-assets", label: "演示素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "测评视频", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-review-audio",
      title: "测评包装",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "解说配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "节奏BGM", icon: Music4, tone: "pink" },
      ],
    },
  ],
  visit_shop: [
    {
      key: "video-visit-plan",
      title: "探店策划",
      tone: "violet",
      items: [
        { key: "search-material", label: "找亮点", icon: Search, tone: "violet" },
        { key: "generate-title", label: "探店钩子", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "动线分镜", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-visit-visual",
      title: "探店画面",
      tone: "blue",
      items: [
        { key: "generate-cover", label: "封面图", icon: LayoutTemplate, tone: "blue" },
        { key: "generate-video-assets", label: "环境素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "探店视频", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-visit-audio",
      title: "现场包装",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "口播配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "氛围BGM", icon: Music4, tone: "pink" },
        { key: "generate-sfx", label: "环境音效", icon: AudioLines, tone: "pink" },
      ],
    },
  ],
  tutorial: [
    {
      key: "video-tutorial-plan",
      title: "教程结构",
      tone: "violet",
      items: [
        { key: "search-material", label: "查步骤", icon: Search, tone: "violet" },
        { key: "generate-title", label: "教程开场", icon: Type, tone: "violet" },
        { key: "generate-storyboard", label: "步骤分镜", icon: Film, tone: "violet" },
      ],
    },
    {
      key: "video-tutorial-visual",
      title: "教程画面",
      tone: "blue",
      items: [
        { key: "generate-image", label: "步骤图", icon: Image, tone: "blue" },
        { key: "generate-video-assets", label: "演示素材", icon: Clapperboard, tone: "blue" },
        { key: "generate-ai-video", label: "教程视频", icon: Video, tone: "blue" },
      ],
    },
    {
      key: "video-tutorial-audio",
      title: "教程讲解",
      tone: "pink",
      items: [
        { key: "generate-voiceover", label: "讲解配音", icon: Mic, tone: "pink" },
        { key: "generate-bgm", label: "辅助BGM", icon: Music4, tone: "pink" },
      ],
    },
  ],
  generic: VIDEO_CAPABILITY_SECTIONS_BY_CREATION_MODE.guided,
};

function normalizeVideoCreationType(contentType?: string): VideoCreationTypeKey {
  const normalized = (contentType || "").trim().toLowerCase();
  if (!normalized) {
    return "generic";
  }
  if (normalized.includes("口播")) {
    return "spoken_script";
  }
  if (normalized.includes("剧情") || normalized.includes("故事") || normalized.includes("情景")) {
    return "story";
  }
  if (normalized.includes("测评") || normalized.includes("评测") || normalized.includes("开箱")) {
    return "review";
  }
  if (normalized.includes("探店") || normalized.includes("探馆")) {
    return "visit_shop";
  }
  if (normalized.includes("教程") || normalized.includes("教学") || normalized.includes("科普")) {
    return "tutorial";
  }
  return "generic";
}

export function getVideoWorkbenchRightRailSections(
  creationMode: CreationMode = "guided",
  creationType?: string,
): WorkbenchRightRailCapabilitySection[] {
  const videoCreationType = normalizeVideoCreationType(creationType);
  return videoCreationType === "generic"
    ? VIDEO_CAPABILITY_SECTIONS_BY_CREATION_MODE[creationMode]
    : VIDEO_CAPABILITY_SECTIONS_BY_TYPE[videoCreationType];
}

export function getVideoWorkbenchRightRailHeading(
  creationMode: CreationMode = "guided",
  creationType?: string,
): string {
  const normalizedType = creationType?.trim();
  if (normalizedType) {
    return `视频制作 · ${normalizedType}`;
  }
  return `视频制作 · ${VIDEO_CREATION_MODE_LABELS[creationMode]}`;
}

export function getVideoWorkbenchRightRailSubheading(
  creationMode: CreationMode = "guided",
  creationType?: string,
): string | null {
  if (!creationType?.trim()) {
    return null;
  }
  return `当前模式：${VIDEO_CREATION_MODE_LABELS[creationMode]}`;
}
