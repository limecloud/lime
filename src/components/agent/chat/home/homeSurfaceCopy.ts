import type {
  HomeGuideCard,
  HomeInputSuggestion,
  HomeSkillCategory,
  HomeStarterChip,
} from "./homeSurfaceTypes";

export const HOME_COMPOSER_PLACEHOLDER =
  "先说这轮要做什么，目标、对象或限制都可以。";
export const HOME_GUIDE_HELP_CONTEXT_LABEL = "Lime 引导帮助";
export const HOME_GUIDE_HELP_PLACEHOLDER =
  "想了解什么？试试：怎么创建长期计划 / 如何添加模型 / 语音输入怎么用";

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
    id: "starter-guide-help",
    label: "引导帮助",
    launchKind: "toggle_guide",
    groupKey: "guide_help",
    iconToken: "lightbulb",
    primary: true,
    testId: "home-guide-help-trigger",
  },
  {
    id: "starter-writing",
    label: "写作",
    launchKind: "curated_task_launcher",
    targetItemId: "social-post-starter",
    category: "social",
    primary: true,
    testId: "entry-recommended-social-post-starter",
  },
  {
    id: "starter-ppt",
    label: "PPT",
    launchKind: "prefill_prompt",
    category: "editor",
    prompt:
      "请帮我做一份 PPT，先确认主题、听众、页数、结构和每页核心表达，再给出大纲与页面文案。",
    testId: "entry-home-ppt",
  },
  {
    id: "starter-research-report",
    label: "调研报告",
    launchKind: "curated_task_launcher",
    targetItemId: "daily-trend-briefing",
    category: "social",
    testId: "entry-recommended-daily-trend-briefing",
  },
  {
    id: "starter-requirement-analysis",
    label: "需求分析",
    launchKind: "curated_task_launcher",
    targetItemId: "account-project-review",
    category: "social",
    testId: "entry-recommended-account-project-review",
  },
  {
    id: "starter-video",
    label: "视频",
    launchKind: "curated_task_launcher",
    targetItemId: "script-to-voiceover",
    category: "video",
    testId: "entry-recommended-script-to-voiceover",
  },
  {
    id: "starter-design",
    label: "设计",
    launchKind: "prefill_prompt",
    category: "visual_design",
    prompt:
      "请帮我设计一个视觉方案，先确认使用场景、目标受众、风格关键词、主视觉方向和可执行的版式建议。",
    testId: "entry-home-design",
  },
  {
    id: "starter-excel",
    label: "Excel",
    launchKind: "prefill_prompt",
    category: "editor",
    prompt:
      "请帮我整理一个 Excel 表格方案，先确认字段、数据来源、统计口径、公式和最终要看的结论。",
    testId: "entry-home-excel",
  },
  {
    id: "starter-code",
    label: "编程",
    launchKind: "prefill_prompt",
    category: "other",
    prompt:
      "请帮我完成一个编程任务，先确认目标、运行环境、输入输出、约束和验收方式，再给出实现步骤。",
    testId: "entry-home-code",
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

export const HOME_INPUT_SUGGESTIONS: HomeInputSuggestion[] = [
  {
    id: "suggestion-meeting-notes",
    label: "帮我整理一下会议纪要",
    prompt:
      "帮我整理一下会议纪要，提炼议题、关键结论、待办事项、负责人、截止时间和需要继续确认的问题。",
    order: 5,
    testId: "home-input-suggestion-meeting-notes",
  },
  {
    id: "suggestion-research-report",
    label: "帮我写一份调研报告",
    prompt:
      "帮我写一份调研报告，先明确研究问题、目标读者、资料来源、分析框架和最终输出结构。",
    order: 10,
    testId: "home-input-suggestion-research-report",
  },
  {
    id: "suggestion-ppt-outline",
    label: "帮我做一份 PPT 大纲",
    prompt:
      "帮我做一份 PPT 大纲，先确认主题、听众、页数、叙事顺序和每页要表达的核心信息。",
    order: 20,
    testId: "home-input-suggestion-ppt-outline",
  },
  {
    id: "suggestion-requirement-analysis",
    label: "帮我梳理一下需求分析",
    prompt:
      "帮我梳理一下需求分析，包含目标用户、核心场景、边界条件、优先级、风险和验收标准。",
    order: 30,
    testId: "home-input-suggestion-requirement-analysis",
  },
  {
    id: "suggestion-video-script",
    label: "帮我把内容改成视频脚本",
    prompt:
      "帮我把这段内容改成短视频口播脚本，包含开头钩子、分镜节奏、字幕重点和结尾行动引导。",
    order: 40,
    testId: "home-input-suggestion-video-script",
  },
];

export const HOME_GUIDE_CARDS: HomeGuideCard[] = [
  {
    id: "guide-long-term-plan",
    title: "怎么创建长期计划？",
    summary: "让 AI 自动规划任务、定期执行。",
    prompt:
      "请告诉我怎么创建和使用长期计划功能。我想让 Lime 帮我围绕一个内容目标持续执行、提醒和复盘。",
    groupKey: "guide_help",
    testId: "home-guide-long-term-plan",
  },
  {
    id: "guide-add-model",
    title: "如何添加新的 AI 模型？",
    summary: "配置 Ollama、Kimi 等第三方模型。",
    prompt:
      "请告诉我如何在 Lime 里添加新的 AI 模型，包括供应商配置、默认模型选择和验证方式。",
    groupKey: "guide_help",
    testId: "home-guide-add-model",
  },
  {
    id: "guide-install-skill",
    title: "技能怎么安装和使用？",
    summary: "从商店安装技能、在对话中启用。",
    prompt:
      "请告诉我 Lime 的技能怎么安装和使用。我想知道如何把一个高频创作流程沉淀为可复用 skill。",
    groupKey: "guide_help",
    testId: "home-guide-install-skill",
  },
  {
    id: "guide-voice-input",
    title: "语音输入怎么设置？",
    summary: "下载语音模型、配置快捷键。",
    prompt:
      "请告诉我 Lime 的语音输入怎么设置，包括启用方式、识别模型配置和常见问题排查。",
    groupKey: "guide_help",
    testId: "home-guide-voice-input",
  },
];
