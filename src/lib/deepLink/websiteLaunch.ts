import { findCuratedTaskTemplateById } from "@/components/agent/chat/utils/curatedTaskTemplates";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { AgentPageParams, Page, PageParams } from "@/types/page";

export interface WebsiteOpenDeepLinkPayload {
  kind: "skill" | "prompt";
  slug: string;
  source?: string | null;
  version?: string | null;
}

type SkillLaunchTarget =
  | {
      type: "service_skill";
      skillId: string;
    }
  | {
      type: "curated_task";
      taskId: string;
    };

interface WebsiteSkillLaunchEntry {
  slug: string;
  title: string;
  target: SkillLaunchTarget;
}

interface WebsitePromptLaunchEntry {
  slug: string;
  title: string;
  prompt: string;
  sessionName: string;
}

export interface WebsiteOpenNavigationResult {
  page: Page;
  params: PageParams;
}

const WEBSITE_SKILL_LAUNCH_ENTRIES: WebsiteSkillLaunchEntry[] = [
  {
    slug: "daily-trend-briefing",
    title: "每日趋势摘要",
    target: {
      type: "curated_task",
      taskId: "daily-trend-briefing",
    },
  },
  {
    slug: "social-post-starter",
    title: "内容主稿生成",
    target: {
      type: "curated_task",
      taskId: "social-post-starter",
    },
  },
  {
    slug: "viral-content-breakdown",
    title: "拆解一条爆款内容",
    target: {
      type: "curated_task",
      taskId: "viral-content-breakdown",
    },
  },
  {
    slug: "longform-multiplatform-rewrite",
    title: "长文转多平台发布稿",
    target: {
      type: "curated_task",
      taskId: "longform-multiplatform-rewrite",
    },
  },
  {
    slug: "script-to-voiceover",
    title: "脚本转口播/字幕稿",
    target: {
      type: "curated_task",
      taskId: "script-to-voiceover",
    },
  },
  {
    slug: "account-project-review",
    title: "复盘这个账号/项目",
    target: {
      type: "curated_task",
      taskId: "account-project-review",
    },
  },
  {
    slug: "carousel-post-replication",
    title: "复制轮播帖",
    target: {
      type: "service_skill",
      skillId: "carousel-post-replication",
    },
  },
  {
    slug: "short-video-script-replication",
    title: "复制视频脚本",
    target: {
      type: "service_skill",
      skillId: "short-video-script-replication",
    },
  },
  {
    slug: "article-to-slide-video-outline",
    title: "文章转 Slide 视频提纲",
    target: {
      type: "service_skill",
      skillId: "article-to-slide-video-outline",
    },
  },
  {
    slug: "cloud-video-dubbing",
    title: "视频配音",
    target: {
      type: "service_skill",
      skillId: "cloud-video-dubbing",
    },
  },
  {
    slug: "video-dubbing-language",
    title: "视频配音成其他语言",
    target: {
      type: "service_skill",
      skillId: "video-dubbing-language",
    },
  },
  {
    slug: "x-article-export",
    title: "X 文章转存",
    target: {
      type: "service_skill",
      skillId: "x-article-export",
    },
  },
];

const WEBSITE_PROMPT_LAUNCH_ENTRIES: WebsitePromptLaunchEntry[] = [
  {
    slug: "nano-banana-pro-cover",
    title: "Nano Banana Pro 封面提示词",
    sessionName: "Nano Banana Pro 封面提示词",
    prompt:
      "你是一名内容封面设计师。请围绕我的主题先整理一版可直接出图的封面提示词：明确主体、画面气质、构图、光线、画幅比例，以及文案留白区。先给一句方向总结，再给完整提示词，最后补 3 个可替换的视觉变化方向。",
  },
  {
    slug: "seedance-storyboard",
    title: "Seedance 2.0 分镜提示词",
    sessionName: "Seedance 2.0 分镜提示词",
    prompt:
      "请把我的主题整理成一版适合短视频生成的分镜提示词：先拆成 6-8 个镜头段落，每段写清画面内容、镜头运动、字幕或口播重点，最后补一版整体节奏建议。",
  },
  {
    slug: "gpt-image-cover-copy",
    title: "GPT Image 1.5 标题与配图提示词",
    sessionName: "GPT Image 1.5 标题与配图提示词",
    prompt:
      "请围绕我的内容主题，同时整理标题组、封面短句和一版完整配图提示词。输出 5 个标题方向、3 条封面短句，再给 1 版明确主体、构图、光线和视觉风格的配图提示词。",
  },
  {
    slug: "seedream-poster-campaign",
    title: "Seedream 4.5 海报场景提示词",
    sessionName: "Seedream 4.5 海报场景提示词",
    prompt:
      "你是一名品牌视觉设计师。请围绕我的活动主题整理一版完整海报提示词：先给一句海报概念，再给完整提示词，最后补 3 个适合延展成不同尺寸的变化方向。",
  },
  {
    slug: "gemini-longform-master",
    title: "Gemini 3 长文主稿提示词",
    sessionName: "Gemini 3 长文主稿提示词",
    prompt:
      "请根据我的资料，先整理一版适合长文起稿的工作提示词：先给写作策略，再给完整长文主稿提示词，最后补一个适合继续扩写的文章结构。",
  },
];

function buildWebsiteEntryBanner(title: string, source?: string | null) {
  const normalizedSource = source?.trim().toLowerCase();
  const sourceLabel =
    !normalizedSource || normalizedSource === "website"
      ? "官网"
      : source!.trim();
  return `已从${sourceLabel}详情页打开“${title}”，可继续补上下文后直接开始。`;
}

function buildServiceSkillParams(params: {
  skillId: string;
  title: string;
  source?: string | null;
}): AgentPageParams {
  return buildHomeAgentParams({
    initialPendingServiceSkillLaunch: {
      skillId: params.skillId,
      requestKey: Date.now(),
    },
    entryBannerMessage: buildWebsiteEntryBanner(params.title, params.source),
    initialSessionName: params.title,
  });
}

function buildCuratedTaskParams(params: {
  taskId: string;
  title: string;
  source?: string | null;
}): AgentPageParams | null {
  const template = findCuratedTaskTemplateById(params.taskId);
  if (!template) {
    return null;
  }

  return buildHomeAgentParams({
    initialInputCapability: {
      capabilityRoute: {
        kind: "curated_task",
        taskId: template.id,
        taskTitle: template.title,
        prompt: template.prompt,
      },
      requestKey: Date.now(),
    },
    entryBannerMessage: buildWebsiteEntryBanner(params.title, params.source),
    initialSessionName: params.title,
  });
}

export function resolveWebsiteOpenNavigation(
  payload: WebsiteOpenDeepLinkPayload,
): WebsiteOpenNavigationResult | null {
  if (payload.kind === "skill") {
    const entry =
      WEBSITE_SKILL_LAUNCH_ENTRIES.find((item) => item.slug === payload.slug) ??
      null;
    if (!entry) {
      return null;
    }

    if (entry.target.type === "service_skill") {
      return {
        page: "agent",
        params: buildServiceSkillParams({
          skillId: entry.target.skillId,
          title: entry.title,
          source: payload.source,
        }),
      };
    }

    if (entry.target.type === "curated_task") {
      const params = buildCuratedTaskParams({
        taskId: entry.target.taskId,
        title: entry.title,
        source: payload.source,
      });
      return params
        ? {
            page: "agent",
            params,
          }
        : null;
    }
    return null;
  }

  const promptEntry =
    WEBSITE_PROMPT_LAUNCH_ENTRIES.find((item) => item.slug === payload.slug) ??
    null;
  if (!promptEntry) {
    return null;
  }

  return {
    page: "agent",
    params: buildHomeAgentParams({
      initialUserPrompt: promptEntry.prompt,
      initialSessionName: promptEntry.sessionName,
      entryBannerMessage: buildWebsiteEntryBanner(
        promptEntry.title,
        payload.source,
      ),
    }),
  };
}
