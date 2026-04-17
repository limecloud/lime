import type { ServiceSkillCatalog } from "@/lib/api/serviceSkills";
import { compileBaseSetupPackage } from "./compiler";
import type { BaseSetupPackage } from "./types";

export const SEEDED_SERVICE_SKILL_CATALOG_VERSION =
  "client-seed-2026-04-15-local-custom-package";
export const SEEDED_SERVICE_SKILL_CATALOG_SYNCED_AT =
  "2026-03-24T00:00:00.000Z";
export const SEEDED_SERVICE_SKILL_CATALOG_TENANT_ID = "local-seeded";

const PLATFORM_OPTIONS = [
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "x", label: "X / Twitter" },
  { value: "bilibili", label: "Bilibili" },
  { value: "general", label: "通用平台" },
] as const;

const SEEDED_SERVICE_SKILL_SURFACE_SCOPES = [
  "home",
  "mention",
  "workspace",
] as const;

const SEEDED_SERVICE_SKILL_PACKAGE: BaseSetupPackage = {
  id: "lime-seeded-service-skills",
  version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
  title: "Lime Seeded Service Skills",
  summary: "Lime 内置默认场景目录的基础设置包事实源。",
  bundleRefs: [
    {
      id: "carousel-post-replication-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/carousel-post-replication",
      kind: "skill_bundle",
    },
    {
      id: "short-video-script-replication-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/short-video-script-replication",
      kind: "skill_bundle",
    },
    {
      id: "article-to-slide-video-outline-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/article-to-slide-video-outline",
      kind: "skill_bundle",
    },
    {
      id: "cloud-video-dubbing-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/cloud-video-dubbing",
      kind: "skill_bundle",
    },
    {
      id: "video-dubbing-language-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/video-dubbing-language",
      kind: "skill_bundle",
    },
    {
      id: "daily-trend-briefing-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/daily-trend-briefing",
      kind: "skill_bundle",
    },
    {
      id: "account-performance-tracking-bundle",
      source: "builtin",
      pathOrUri: "seeded://service-skills/account-performance-tracking",
      kind: "skill_bundle",
    },
  ],
  catalogProjections: [
    {
      id: "carousel-post-replication",
      targetCatalog: "service_skill_catalog",
      entryKey: "carousel-post-replication",
      skillKey: "carousel-post-replication",
      skillType: "service",
      title: "复制轮播帖",
      summary:
        "拆解参考轮播帖的结构、文风和卖点，再输出一版可继续改写的轮播内容。",
      entryHint:
        "给我参考帖子和要保留的信息，我先拆结构，再产出一版可继续改的轮播帖。",
      aliases: ["复刻轮播帖", "轮播帖", "小红书轮播", "轮播复刻"],
      category: "内容创作",
      outputHint: "轮播结构 + 文案初稿",
      triggerHints: [
        "已经有参考轮播帖，希望快速拆结构并生成一版同风格内容时使用。",
        "需要保留品牌、活动或结论信息，但重新整理表达方式时使用。",
      ],
      bundleRefId: "carousel-post-replication-bundle",
      slotProfileRef: "carousel-post-replication-slots",
      bindingProfileRef: "agent-turn-instant",
      artifactProfileRef: "carousel-post-replication-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-all-surfaces",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合先产出一版结构化草稿，再在当前工作区继续精修。",
        "参考内容越完整，结构复刻和卖点提炼会越稳定。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在目标项目内启动，方便结果直接写回当前工作区。",
      ],
      examples: [
        "帮我按这篇小红书轮播帖复刻一版，但保留我的品牌名和活动信息。",
        "参考这个轮播结构，做一版更克制、更像真实用户分享的文案。",
      ],
      promptTemplateKey: "replication",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
    {
      id: "short-video-script-replication",
      targetCatalog: "service_skill_catalog",
      entryKey: "short-video-script-replication",
      skillKey: "short-video-script-replication",
      skillType: "service",
      title: "复制视频脚本",
      summary: "围绕参考视频的结构和节奏，输出一版可直接继续加工的脚本。",
      entryHint:
        "把参考视频链接、平台和想改的地方给我，我先按原结构拆一版可继续加工的脚本。",
      aliases: ["复刻短视频", "短视频脚本", "视频脚本复刻", "视频复刻"],
      category: "视频创作",
      outputHint: "脚本大纲 + 镜头节奏",
      triggerHints: [
        "已经有参考视频，希望先得到一版结构接近的脚本时使用。",
        "需要围绕同类视频快速起草镜头节奏和口播框架时使用。",
      ],
      bundleRefId: "short-video-script-replication-bundle",
      slotProfileRef: "short-video-script-replication-slots",
      bindingProfileRef: "agent-turn-instant",
      artifactProfileRef: "short-video-script-replication-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-all-surfaces",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合先锁定结构和节奏，再继续补镜头、字幕和口播细节。",
        "如果希望明显偏离原视频，建议在重点调整点里写清楚。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在视频项目内启动，方便脚本直接回到当前工作区。",
      ],
      examples: [
        "参考这个抖音视频结构，帮我写一版同节奏但更适合新品开箱的脚本。",
        "按这个视频框架拆一版口播脚本，重点弱化夸张表达。",
      ],
      promptTemplateKey: "replication",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
    {
      id: "article-to-slide-video-outline",
      targetCatalog: "service_skill_catalog",
      entryKey: "article-to-slide-video-outline",
      skillKey: "article-to-slide-video-outline",
      skillType: "service",
      title: "文章转 Slide 视频提纲",
      summary: "把文章拆成镜头化结构，先生成一版适合做 Slide 视频的提纲。",
      category: "知识转化",
      outputHint: "Slide 分镜 + 提纲结构",
      triggerHints: [
        "已经有文章或长文素材，想尽快转成视频提纲时使用。",
        "需要把知识内容改造成适合 Slide 演示的视频结构时使用。",
      ],
      bundleRefId: "article-to-slide-video-outline-bundle",
      slotProfileRef: "article-to-slide-video-outline-slots",
      bindingProfileRef: "native-skill-instant",
      artifactProfileRef: "article-to-slide-video-outline-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-default-policy",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合先确定章节切分和镜头逻辑，再继续补页面文案和旁白。",
        "文章正文越完整，提纲拆分和重点保留会越稳定。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在知识类项目内启动，方便提纲直接沉淀为当前内容。",
      ],
      examples: [
        "把这篇公众号文章拆成一个 90 秒 Slide 视频提纲。",
        "按文章内容生成一版适合 Bilibili 讲解视频的分镜结构。",
      ],
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
    {
      id: "cloud-video-dubbing",
      targetCatalog: "service_skill_catalog",
      entryKey: "cloud-video-dubbing",
      skillKey: "cloud-video-dubbing",
      skillType: "service",
      title: "云端视频配音",
      summary:
        "把视频素材、语言要求与旁白意图提交到云端，生成一版可继续加工的配音结果。",
      category: "视频创作",
      outputHint: "配音脚本 + 云端运行状态",
      triggerHints: [
        "已有视频素材，希望直接提交一版配音任务时使用。",
        "需要围绕目标语言、旁白风格快速进入云端配音流程时使用。",
      ],
      bundleRefId: "cloud-video-dubbing-bundle",
      slotProfileRef: "cloud-video-dubbing-slots",
      bindingProfileRef: "cloud-scene-instant",
      artifactProfileRef: "cloud-video-dubbing-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-all-surfaces",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合已经有视频素材或旁白目标，希望直接提交一版云端配音任务。",
        "如果有目标语言、声线或字幕偏好，建议直接写在命令里一起提交。",
      ],
      setupRequirements: [
        "需要已登录 OEM 云端并具备有效 Session Token。",
        "建议在视频项目内启动，方便结果回流到当前工作区。",
      ],
      examples: [
        "给这条新品视频做一版英文配音，保留中英双语字幕。",
        "参考这个视频链接，生成一版更有科技感的中文旁白配音稿。",
      ],
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
    {
      id: "video-dubbing-language",
      targetCatalog: "service_skill_catalog",
      entryKey: "video-dubbing-language",
      skillKey: "video-dubbing-language",
      skillType: "service",
      title: "视频配音成其他语言",
      summary: "先整理配音脚本和语言要求，输出一版可继续进入配音流程的执行稿。",
      category: "视频创作",
      outputHint: "配音脚本 + 语言说明",
      triggerHints: [
        "已有视频素材，希望先得到一版多语言配音稿时使用。",
        "需要围绕目标语言和字幕要求快速整理配音文本时使用。",
      ],
      bundleRefId: "video-dubbing-language-bundle",
      slotProfileRef: "video-dubbing-language-slots",
      bindingProfileRef: "agent-turn-instant",
      artifactProfileRef: "video-dubbing-language-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-default-policy",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合先整理语言版本和字幕要求，再进入正式配音或剪辑流程。",
        "如果视频有专业术语，建议在素材说明里一并补充。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在视频项目内启动，方便配音稿直接回到当前工作区。",
      ],
      examples: [
        "把这个中文视频整理成一版英文配音稿，并保留双语字幕要求。",
        "参考这段素材，输出一版日文配音文本和字幕说明。",
      ],
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
    {
      id: "daily-trend-briefing",
      targetCatalog: "service_skill_catalog",
      entryKey: "daily-trend-briefing",
      skillKey: "daily-trend-briefing",
      skillType: "service",
      title: "每日趋势摘要",
      summary:
        "围绕指定平台、行业和地区，先产出一版趋势摘要和后续本地定时任务建议。",
      entryHint:
        "把平台、行业关键词和时间范围给我，我先整理一份趋势报告，再补定时追踪建议。",
      aliases: ["趋势摘要", "趋势报告", "热点摘要", "每日趋势"],
      category: "内容运营",
      outputHint: "趋势摘要 + 调度建议",
      triggerHints: [
        "想先做一版趋势摘要，再决定是否开启定时跟踪时使用。",
        "需要围绕平台、行业关键词持续追热点时使用。",
      ],
      bundleRefId: "daily-trend-briefing-bundle",
      slotProfileRef: "daily-trend-briefing-slots",
      bindingProfileRef: "automation-job-scheduled",
      artifactProfileRef: "daily-trend-briefing-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-all-surfaces",
      automationProfileRef: "daily-trend-briefing-automation",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "先完成一次首轮摘要，再根据结果决定推送频率和关键词范围。",
        "关键词尽量聚焦一个主题域，定时结果会更稳定可读。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在目标项目内启动，方便首轮结果和后续回流都落到同一工作区。",
      ],
      examples: [
        "每天早上帮我跟踪 AI Agent 行业热点，并生成一版趋势摘要。",
        "围绕跨境电商和北美地区做一个每日趋势巡检任务。",
      ],
      promptTemplateKey: "trend_briefing",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
    {
      id: "account-performance-tracking",
      targetCatalog: "service_skill_catalog",
      entryKey: "account-performance-tracking",
      skillKey: "account-performance-tracking",
      skillType: "service",
      title: "账号增长跟踪",
      summary:
        "围绕参考账号和目标平台先整理一版增长打法，再持续跟踪内容节奏、关键指标和提醒条件。",
      entryHint:
        "给我参考账号、目标平台和增长目标，我先出内容打法、发布节奏和后续跟踪指标。",
      aliases: ["账号增长", "增长跟踪", "自动增长", "涨粉", "账号表现"],
      category: "内容运营",
      outputHint: "增长策略 + 发布节奏 + 跟踪指标",
      triggerHints: [
        "想先产出增长打法，再持续观察账号表现时使用。",
        "需要围绕目标账号持续跟踪内容节奏和提醒条件时使用。",
      ],
      bundleRefId: "account-performance-tracking-bundle",
      slotProfileRef: "account-performance-tracking-slots",
      bindingProfileRef: "automation-job-managed",
      artifactProfileRef: "account-performance-tracking-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-all-surfaces",
      automationProfileRef: "account-performance-tracking-automation",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合先产出首版增长打法，再逐步收紧跟踪指标和提醒条件。",
        "账号列表越明确，后续持续跟踪和提醒命中会越准确。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在目标项目内启动，方便首轮策略和持续跟踪结果沉淀到同一工作区。",
      ],
      examples: [
        "围绕这几个小红书账号做一版增长跟踪策略，并设置日更追踪。",
        "帮我针对 X 上的目标账号生成增长计划和后续提醒阈值。",
      ],
      promptTemplateKey: "account_growth",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
  ],
  slotProfiles: [
    {
      id: "carousel-post-replication-slots",
      slots: [
        {
          key: "reference_post",
          label: "参考帖子",
          type: "textarea",
          required: true,
          placeholder: "粘贴参考轮播帖链接、正文或结构摘要",
        },
        {
          key: "delivery_mode",
          label: "执行方式",
          type: "enum",
          required: true,
          defaultValue: "one_to_one",
          placeholder: "选择复制方式",
          options: [
            { value: "one_to_one", label: "1:1 复刻" },
            { value: "expand", label: "同风格扩写" },
          ],
        },
        {
          key: "platform",
          label: "发布平台",
          type: "platform",
          required: true,
          defaultValue: "xiaohongshu",
          placeholder: "选择发布平台",
          options: [...PLATFORM_OPTIONS],
        },
        {
          key: "must_keep",
          label: "必须保留的信息",
          type: "textarea",
          required: false,
          placeholder: "例如品牌名、核心结论、活动信息",
        },
      ],
    },
    {
      id: "short-video-script-replication-slots",
      slots: [
        {
          key: "reference_video",
          label: "参考视频链接/素材",
          type: "url",
          required: true,
          placeholder: "输入视频链接，或粘贴素材描述",
        },
        {
          key: "script_mode",
          label: "脚本模式",
          type: "enum",
          required: true,
          defaultValue: "replicate",
          placeholder: "选择脚本模式",
          options: [
            { value: "replicate", label: "贴近原结构" },
            { value: "expand", label: "同风格扩展" },
          ],
        },
        {
          key: "platform",
          label: "发布平台",
          type: "platform",
          required: true,
          defaultValue: "douyin",
          placeholder: "选择发布平台",
          options: [...PLATFORM_OPTIONS],
        },
        {
          key: "focus_changes",
          label: "重点调整点",
          type: "textarea",
          required: false,
          placeholder: "例如语气更克制、减少夸张表述、加强转化 CTA",
        },
      ],
    },
    {
      id: "article-to-slide-video-outline-slots",
      slots: [
        {
          key: "article_source",
          label: "文章链接/正文",
          type: "textarea",
          required: true,
          placeholder: "输入文章链接、正文，或文章摘要",
        },
        {
          key: "target_duration",
          label: "目标时长",
          type: "text",
          required: true,
          defaultValue: "60-90 秒",
          placeholder: "例如 60-90 秒",
        },
        {
          key: "platform",
          label: "发布平台",
          type: "platform",
          required: true,
          defaultValue: "bilibili",
          placeholder: "选择发布平台",
          options: [...PLATFORM_OPTIONS],
        },
      ],
    },
    {
      id: "cloud-video-dubbing-slots",
      slots: [
        {
          key: "reference_video",
          label: "参考视频链接/素材",
          type: "url",
          required: true,
          placeholder: "输入视频链接，或在命令里补充素材说明",
        },
        {
          key: "target_language",
          label: "目标语言",
          type: "text",
          required: false,
          defaultValue: "中文",
          placeholder: "例如 中文、英文、日文",
        },
        {
          key: "voice_style",
          label: "旁白风格",
          type: "text",
          required: false,
          defaultValue: "自然清晰",
          placeholder: "例如 自然清晰、科技感、温柔讲解",
        },
      ],
    },
    {
      id: "video-dubbing-language-slots",
      slots: [
        {
          key: "video_source",
          label: "视频链接/素材",
          type: "url",
          required: true,
          placeholder: "输入视频链接，或补充素材说明",
        },
        {
          key: "target_language",
          label: "目标语言",
          type: "text",
          required: true,
          defaultValue: "英文",
          placeholder: "例如 英文、日文、西班牙语",
        },
        {
          key: "subtitle_preference",
          label: "字幕要求",
          type: "enum",
          required: false,
          defaultValue: "keep_original",
          placeholder: "选择字幕要求",
          options: [
            { value: "keep_original", label: "保留原字幕" },
            { value: "bilingual", label: "中英双语字幕" },
            { value: "dub_only", label: "只做配音稿" },
          ],
        },
      ],
    },
    {
      id: "daily-trend-briefing-slots",
      slots: [
        {
          key: "platform",
          label: "监测平台",
          type: "platform",
          required: true,
          defaultValue: "x",
          placeholder: "选择监测平台",
          options: [...PLATFORM_OPTIONS],
        },
        {
          key: "industry_keywords",
          label: "行业关键词",
          type: "textarea",
          required: true,
          placeholder: "例如 AI Agent、短剧出海、跨境电商",
        },
        {
          key: "time_window",
          label: "时间范围",
          type: "text",
          required: true,
          defaultValue: "过去 24 小时",
          placeholder: "例如 过去 24 小时、过去 7 天",
        },
        {
          key: "region",
          label: "地区",
          type: "text",
          required: false,
          defaultValue: "全球",
          placeholder: "例如 中国、北美、全球",
        },
        {
          key: "schedule_time",
          label: "推送时间",
          type: "schedule_time",
          required: false,
          defaultValue: "每天 09:00",
          placeholder: "例如 每天 09:00",
        },
      ],
    },
    {
      id: "account-performance-tracking-slots",
      slots: [
        {
          key: "platform",
          label: "目标平台",
          type: "platform",
          required: true,
          defaultValue: "x",
          placeholder: "选择账号平台",
          options: [...PLATFORM_OPTIONS],
        },
        {
          key: "account_list",
          label: "参考账号 / 目标账号",
          type: "account_list",
          required: true,
          placeholder: "每行一个账号，或用逗号分隔多个账号",
        },
        {
          key: "report_cadence",
          label: "回报频率",
          type: "schedule_time",
          required: false,
          defaultValue: "每天 10:00",
          placeholder: "例如 每天 10:00",
        },
        {
          key: "alert_threshold",
          label: "告警阈值",
          type: "text",
          required: false,
          placeholder: "例如 日增粉低于 1% 或互动率骤降 20%",
        },
      ],
    },
  ],
  bindingProfiles: [
    {
      id: "agent-turn-instant",
      bindingFamily: "agent_turn",
      runnerType: "instant",
      executionLocation: "client_default",
    },
    {
      id: "native-skill-instant",
      bindingFamily: "native_skill",
      runnerType: "instant",
      executionLocation: "client_default",
    },
    {
      id: "cloud-scene-instant",
      bindingFamily: "cloud_scene",
      runnerType: "instant",
      executionLocation: "cloud_required",
    },
    {
      id: "automation-job-scheduled",
      bindingFamily: "automation_job",
      runnerType: "scheduled",
      executionLocation: "client_default",
    },
    {
      id: "automation-job-managed",
      bindingFamily: "automation_job",
      runnerType: "managed",
      executionLocation: "client_default",
    },
  ],
  artifactProfiles: [
    {
      id: "carousel-post-replication-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "brief",
      outputDestination:
        "结果会写回当前工作区中的内容草稿，方便继续改写和发布。",
    },
    {
      id: "short-video-script-replication-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "brief",
      outputDestination:
        "结果会写回当前工作区中的脚本草稿，方便继续补镜头与口播。",
    },
    {
      id: "article-to-slide-video-outline-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "analysis",
      outputDestination:
        "结果会写回当前工作区中的提纲文档，方便继续补正文和分镜。",
    },
    {
      id: "cloud-video-dubbing-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "brief",
      outputDestination:
        "任务会提交到 OEM 云端执行，结果状态与回流摘要会展示在当前工作区。",
    },
    {
      id: "video-dubbing-language-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "brief",
      outputDestination:
        "结果会写回当前工作区中的配音稿，方便继续进入配音与剪辑流程。",
    },
    {
      id: "daily-trend-briefing-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "analysis",
      outputDestination:
        "首轮结果会进入当前工作区；后续执行结果会同步到生成工作台与对应项目内容。",
    },
    {
      id: "account-performance-tracking-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md"],
      viewerKind: "artifact_bundle",
      defaultArtifactKind: "analysis",
      outputDestination:
        "首轮策略会写回当前工作区；后续跟踪结果会持续回流到生成工作台与项目内容。",
    },
  ],
  scorecardProfiles: [
    {
      id: "seeded-service-skill-scorecard",
      metrics: ["activation_rate", "completion_rate"],
    },
  ],
  automationProfiles: [
    {
      id: "daily-trend-briefing-automation",
      enabledByDefault: true,
      schedule: {
        kind: "cron",
        cronExpr: "0 9 * * *",
        cronTz: "Asia/Shanghai",
        slotKey: "schedule_time",
      },
      maxRetries: 2,
      delivery: {
        mode: "none",
        bestEffort: true,
      },
    },
    {
      id: "account-performance-tracking-automation",
      enabledByDefault: true,
      schedule: {
        kind: "cron",
        cronExpr: "0 10 * * *",
        cronTz: "Asia/Shanghai",
        slotKey: "report_cadence",
      },
      maxRetries: 2,
      delivery: {
        mode: "none",
        bestEffort: true,
      },
    },
  ],
  policyProfiles: [
    {
      id: "seeded-all-surfaces",
      enabled: true,
      surfaceScopes: [...SEEDED_SERVICE_SKILL_SURFACE_SCOPES],
      rolloutStage: "seeded",
    },
    {
      id: "seeded-default-policy",
      enabled: true,
      rolloutStage: "seeded",
    },
  ],
  compatibility: {
    minAppVersion: "1.11.0",
    requiredKernelCapabilities: [
      "agent_turn",
      "native_skill",
      "automation_job",
      "cloud_scene",
      "artifact_viewer",
      "workspace_storage",
    ],
    seededFallback: true,
    compatCatalogProjection: true,
  },
};

const SEEDED_LOCAL_CUSTOM_SERVICE_SKILL_PACKAGE: BaseSetupPackage = {
  id: "lime-seeded-local-custom-service-skills",
  version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
  title: "Lime Seeded Local Custom Service Skills",
  summary: "Lime 内置本地定制场景的基础设置包事实源。",
  bundleRefs: [
    {
      id: "x-article-export-bundle",
      source: "local",
      pathOrUri: "seeded://local-custom/x-article-export",
      kind: "local_bundle",
    },
  ],
  catalogProjections: [
    {
      id: "x-article-export",
      targetCatalog: "service_skill_catalog",
      entryKey: "x-article-export",
      skillKey: "x-article-export",
      skillType: "site",
      title: "X 文章转存",
      summary:
        "复用已连接的 X / Twitter 浏览器登录态，导出长文为 Markdown，并可按目标语言翻译正文后把文内图片一并落到项目目录。",
      entryHint:
        "给我 X 文章链接，我会复用现有浏览器上下文抓正文、代码块和图片，并按需要翻译成中文后沉淀到项目导出目录。",
      aliases: [
        "x文章转存",
        "x 长文转存",
        "twitter article export",
        "twitter-article-export",
      ],
      category: "站点采集",
      outputHint: "Markdown 正文 + 图片目录 + 元信息",
      triggerHints: [
        "需要把 X 长文沉淀到本地项目目录，方便继续改写或引用时使用。",
        "需要保留文内图片、代码块和标题结构，转换成 Markdown 时使用。",
      ],
      bundleRefId: "x-article-export-bundle",
      slotProfileRef: "x-article-export-slots",
      bindingProfileRef: "browser-assist-instant",
      artifactProfileRef: "x-article-export-artifact",
      scorecardProfileRef: "seeded-service-skill-scorecard",
      policyProfileRef: "seeded-workspace-only",
      readinessRequirements: {
        requiresBrowser: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "优先在已连接浏览器上下文中执行，避免丢失 X 的登录态和长文阅读权限。",
        "结果会落到当前项目目录，适合后续继续整理、引用和版本管理。",
      ],
      setupRequirements: [
        "需要先在浏览器工作台连接目标浏览器。",
        "需要当前会话已经选择项目，方便把 Markdown 和图片写入项目目录。",
      ],
      examples: [
        "把这篇 X 长文导出成 Markdown，并把图片一起保存到项目里。",
        "请转存这条 Twitter Article，并翻译成中文，我后面还要继续改写和引用里面的代码示例。",
      ],
      siteCapabilityBinding: {
        autoRun: true,
        requireAttachedSession: true,
        saveMode: "project_resource",
        siteLabel: "X",
        adapterMatch: {
          urlArgName: "url",
          requiredCapabilities: ["article_export", "markdown_bundle"],
          hostAliases: ["twitter.com", "www.twitter.com", "www.x.com"],
        },
        slotArgMap: {
          article_url: "url",
          target_language: "target_language",
        },
      },
      sceneBinding: {
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        title: "X文章转存",
        summary:
          "复用 X / Twitter 登录态，把长文导出成 Markdown，并把文内图片一起写入项目目录。",
        aliases: [
          "x文章转存",
          "x转存",
          "twitter-article-export",
          "twitter文章转存",
        ],
      },
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
    },
  ],
  slotProfiles: [
    {
      id: "x-article-export-slots",
      slots: [
        {
          key: "article_url",
          label: "X 文章链接",
          type: "url",
          required: true,
          placeholder: "https://x.com/<账号>/article/<文章ID>",
          helpText: "支持 x.com 和 twitter.com 的 Article 链接。",
        },
        {
          key: "target_language",
          label: "目标语言",
          type: "text",
          required: false,
          defaultValue: "中文",
          placeholder: "例如 中文、英文、日文",
          helpText: "仅翻译正文，代码块、链接和图片路径保持原样。",
        },
      ],
    },
  ],
  bindingProfiles: [
    {
      id: "browser-assist-instant",
      bindingFamily: "browser_assist",
      runnerType: "instant",
      executionLocation: "client_default",
    },
  ],
  artifactProfiles: [
    {
      id: "x-article-export-artifact",
      deliveryContract: "artifact_bundle",
      requiredParts: ["index.md", "meta.json"],
      viewerKind: "artifact_bundle",
      outputDestination:
        "结果会写入当前项目目录下的导出文件夹，并在工作区生成一个结果入口文档。",
    },
  ],
  scorecardProfiles: [
    {
      id: "seeded-service-skill-scorecard",
      metrics: ["activation_rate", "completion_rate"],
    },
  ],
  policyProfiles: [
    {
      id: "seeded-workspace-only",
      enabled: true,
      surfaceScopes: ["workspace"],
      rolloutStage: "seeded",
    },
  ],
  compatibility: {
    minAppVersion: "1.11.0",
    requiredKernelCapabilities: [
      "browser_assist",
      "artifact_viewer",
      "workspace_storage",
    ],
    seededFallback: true,
    compatCatalogProjection: true,
  },
};

export function createSeededServiceSkillBaseSetupPackage(): BaseSetupPackage {
  return JSON.parse(JSON.stringify(SEEDED_SERVICE_SKILL_PACKAGE)) as BaseSetupPackage;
}

export function createSeededLocalCustomServiceSkillBaseSetupPackage(): BaseSetupPackage {
  return JSON.parse(
    JSON.stringify(SEEDED_LOCAL_CUSTOM_SERVICE_SKILL_PACKAGE),
  ) as BaseSetupPackage;
}

export function createSeededCloudServiceSkillCatalog(): ServiceSkillCatalog {
  return compileBaseSetupPackage(createSeededServiceSkillBaseSetupPackage(), {
    tenantId: SEEDED_SERVICE_SKILL_CATALOG_TENANT_ID,
    syncedAt: SEEDED_SERVICE_SKILL_CATALOG_SYNCED_AT,
  }).serviceSkillCatalogProjection;
}

export function createSeededLocalCustomServiceSkillCatalog(): ServiceSkillCatalog {
  return compileBaseSetupPackage(
    createSeededLocalCustomServiceSkillBaseSetupPackage(),
    {
      tenantId: SEEDED_SERVICE_SKILL_CATALOG_TENANT_ID,
      syncedAt: SEEDED_SERVICE_SKILL_CATALOG_SYNCED_AT,
    },
  ).serviceSkillCatalogProjection;
}
