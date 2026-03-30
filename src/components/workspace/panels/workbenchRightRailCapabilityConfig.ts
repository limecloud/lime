import type { CreationMode } from "@/lib/workspace/workbenchContract";
import type { WorkspaceTheme } from "@/types/page";
import {
  AudioLines,
  Clapperboard,
  Film,
  Image,
  LayoutTemplate,
  Mic,
  Music4,
  Search,
  Type,
  Video,
  WandSparkles,
} from "lucide-react";
import {
  getVideoWorkbenchRightRailHeading,
  getVideoWorkbenchRightRailSections,
  getVideoWorkbenchRightRailSubheading,
} from "./workbenchRightRailVideoConfig";
import type { WorkbenchRightRailCapabilitySection } from "./workbenchRightRailTypes";

const CAPABILITY_SECTIONS: WorkbenchRightRailCapabilitySection[] = [
  {
    key: "text-search",
    title: "文字多搜索",
    tone: "violet",
    items: [
      {
        key: "search-material",
        label: "搜索素材",
        icon: Search,
        tone: "violet",
      },
      { key: "generate-title", label: "生成标题", icon: Type, tone: "violet" },
    ],
  },
  {
    key: "visual",
    title: "视觉生成",
    tone: "blue",
    items: [
      { key: "generate-image", label: "生成图片", icon: Image, tone: "blue" },
      {
        key: "generate-cover",
        label: "生成封面",
        icon: LayoutTemplate,
        tone: "blue",
      },
      {
        key: "generate-storyboard",
        label: "生成分镜",
        icon: Film,
        tone: "blue",
      },
      {
        key: "generate-video-assets",
        label: "生成视频素材",
        icon: Clapperboard,
        tone: "blue",
      },
      {
        key: "generate-ai-video",
        label: "生成视频(非AI画面)",
        icon: Video,
        tone: "blue",
      },
    ],
  },
  {
    key: "audio",
    title: "音频生成",
    tone: "pink",
    items: [
      { key: "generate-voiceover", label: "生成配音", icon: Mic, tone: "pink" },
      { key: "generate-bgm", label: "生成BGM", icon: Music4, tone: "pink" },
      {
        key: "generate-sfx",
        label: "生成音效",
        icon: AudioLines,
        tone: "pink",
      },
      {
        key: "generate-podcast",
        label: "生成播客",
        icon: WandSparkles,
        tone: "pink",
      },
    ],
  },
];

export function resolveCapabilitySections(
  theme?: WorkspaceTheme,
  creationMode: CreationMode = "guided",
  creationType?: string,
): WorkbenchRightRailCapabilitySection[] {
  if (theme === "video") {
    return getVideoWorkbenchRightRailSections(creationMode, creationType);
  }
  return CAPABILITY_SECTIONS;
}

export function resolveRailHeading(
  theme?: WorkspaceTheme,
  creationMode: CreationMode = "guided",
  creationType?: string,
): string | null {
  if (theme !== "video") {
    return null;
  }
  return getVideoWorkbenchRightRailHeading(creationMode, creationType);
}

export function resolveRailSubheading(
  theme?: WorkspaceTheme,
  creationMode: CreationMode = "guided",
  creationType?: string,
): string | null {
  if (theme !== "video") {
    return null;
  }
  return getVideoWorkbenchRightRailSubheading(creationMode, creationType);
}
