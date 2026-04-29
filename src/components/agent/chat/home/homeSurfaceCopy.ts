import type { HomeSkillCategory, HomeStarterChip } from "./homeSurfaceTypes";

export const HOME_COMPOSER_PLACEHOLDER =
  "先说这轮要做什么，目标、对象或限制都可以。";

export const HOME_CATEGORY_LABELS: Record<HomeSkillCategory, string> = {
  recent: "最近使用",
  social: "社交媒体",
  video: "视频",
  visual_design: "视觉设计",
  editor: "编辑器",
  audio_music: "音频与音乐",
  other: "其他做法",
};

export const HOME_CATEGORY_ORDER: HomeSkillCategory[] = [
  "recent",
  "social",
  "video",
  "visual_design",
  "editor",
  "audio_music",
  "other",
];

export const HOME_STARTER_CHIPS: HomeStarterChip[] = [
  {
    id: "starter-daily-trend",
    label: "帮我想选题",
    launchKind: "curated_task_launcher",
    targetItemId: "daily-trend-briefing",
    category: "social",
    primary: true,
    testId: "entry-recommended-daily-trend-briefing",
  },
  {
    id: "starter-first-draft",
    label: "写第一版",
    launchKind: "curated_task_launcher",
    targetItemId: "social-post-starter",
    category: "social",
    testId: "entry-recommended-social-post-starter",
  },
  {
    id: "starter-breakdown",
    label: "拆解爆款",
    launchKind: "curated_task_launcher",
    targetItemId: "viral-content-breakdown",
    category: "social",
    testId: "entry-recommended-viral-content-breakdown",
  },
  {
    id: "starter-rewrite-style",
    label: "改成我的风格",
    launchKind: "curated_task_launcher",
    targetItemId: "longform-multiplatform-rewrite",
    category: "social",
    testId: "entry-recommended-longform-multiplatform-rewrite",
  },
  {
    id: "starter-video-script",
    label: "转成视频脚本",
    launchKind: "curated_task_launcher",
    targetItemId: "script-to-voiceover",
    category: "video",
    testId: "entry-recommended-script-to-voiceover",
  },
  {
    id: "starter-account-review",
    label: "复盘账号",
    launchKind: "curated_task_launcher",
    targetItemId: "account-project-review",
    category: "social",
    testId: "entry-recommended-account-project-review",
  },
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
