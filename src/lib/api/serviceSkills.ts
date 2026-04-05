import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";

export type ServiceSkillSource = "cloud_catalog" | "local_custom";

export type ServiceSkillType = "service" | "site" | "prompt";

export type ServiceSkillRunnerType = "instant" | "scheduled" | "managed";

export type ServiceSkillExecutionLocation = "client_default" | "cloud_required";

export type ServiceSkillArtifactKind =
  | "report"
  | "roadmap"
  | "prd"
  | "brief"
  | "analysis"
  | "comparison"
  | "plan"
  | "table_report";

export type ServiceSkillExecutorBinding =
  | "native_skill"
  | "agent_turn"
  | "browser_assist"
  | "automation_job"
  | "cloud_scene";

export type ServiceSkillSlotType =
  | "text"
  | "textarea"
  | "url"
  | "enum"
  | "platform"
  | "schedule_time"
  | "account_list";

export type ServiceSkillSurfaceScope = "home" | "mention" | "workspace";

export type ServiceSkillPromptTemplateKey =
  | "generic"
  | "replication"
  | "trend_briefing"
  | "account_growth";

export interface ServiceSkillSlotOption {
  value: string;
  label: string;
}

export interface ServiceSkillSlotDefinition {
  key: string;
  label: string;
  type: ServiceSkillSlotType;
  required: boolean;
  placeholder: string;
  defaultValue?: string;
  helpText?: string;
  options?: ServiceSkillSlotOption[];
}

export interface ServiceSkillReadinessRequirements {
  requiresModel?: boolean;
  requiresBrowser?: boolean;
  requiresSkillKey?: string;
  requiresProject?: boolean;
}

export type ServiceSkillSiteCapabilitySaveMode =
  | "current_content"
  | "project_resource";

export interface ServiceSkillSiteCapabilityBinding {
  adapterName: string;
  autoRun?: boolean;
  requireAttachedSession?: boolean;
  saveMode?: ServiceSkillSiteCapabilitySaveMode;
  slotArgMap?: Record<string, string>;
  fixedArgs?: Record<string, unknown>;
  suggestedTitleTemplate?: string;
}

export interface ServiceSkillBundleResourceSummary {
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

export interface ServiceSkillBundleStandardCompliance {
  isStandard: boolean;
  validationErrors?: string[];
  deprecatedFields?: string[];
}

export interface ServiceSkillBundleSummary {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  resourceSummary: ServiceSkillBundleResourceSummary;
  standardCompliance: ServiceSkillBundleStandardCompliance;
}

export interface ServiceSkillItem {
  id: string;
  skillKey?: string;
  skillType?: ServiceSkillType;
  title: string;
  summary: string;
  entryHint?: string;
  aliases?: string[];
  category: string;
  outputHint: string;
  triggerHints?: string[];
  source: ServiceSkillSource;
  runnerType: ServiceSkillRunnerType;
  defaultExecutorBinding: ServiceSkillExecutorBinding;
  executionLocation: ServiceSkillExecutionLocation;
  defaultArtifactKind?: ServiceSkillArtifactKind;
  readinessRequirements?: ServiceSkillReadinessRequirements;
  usageGuidelines?: string[];
  setupRequirements?: string[];
  examples?: string[];
  outputDestination?: string;
  siteCapabilityBinding?: ServiceSkillSiteCapabilityBinding;
  slotSchema: ServiceSkillSlotDefinition[];
  surfaceScopes?: ServiceSkillSurfaceScope[];
  promptTemplateKey?: ServiceSkillPromptTemplateKey;
  themeTarget?: string;
  skillBundle?: ServiceSkillBundleSummary;
  version: string;
}

export interface ServiceSkillCatalog {
  version: string;
  tenantId: string;
  syncedAt: string;
  items: ServiceSkillItem[];
}

export type ServiceSkillCatalogChangeSource =
  | "seeded_fallback"
  | "bootstrap_sync"
  | "manual_override"
  | "cache_clear";

interface ServiceSkillCatalogResponseEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
}

const SERVICE_SKILL_CATALOG_STORAGE_KEY = "lime:service-skill-catalog:v1";
export const SERVICE_SKILL_CATALOG_CHANGED_EVENT =
  "lime:service-skill-catalog-changed";
const SEEDED_SERVICE_SKILL_CATALOG_VERSION = "client-seed-2026-04-04";

const PLATFORM_OPTIONS: ServiceSkillSlotOption[] = [
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "x", label: "X / Twitter" },
  { value: "bilibili", label: "Bilibili" },
  { value: "general", label: "通用平台" },
];

const SERVICE_SKILL_SURFACE_SCOPES: ServiceSkillSurfaceScope[] = [
  "home",
  "mention",
  "workspace",
];

const SERVICE_SKILL_TYPES: ServiceSkillType[] = [
  "service",
  "site",
  "prompt",
];

const SERVICE_SKILL_PROMPT_TEMPLATE_KEYS: ServiceSkillPromptTemplateKey[] = [
  "generic",
  "replication",
  "trend_briefing",
  "account_growth",
];

const MAX_SERVICE_SKILL_BUNDLE_NAME_LENGTH = 64;
const MAX_SERVICE_SKILL_BUNDLE_DESCRIPTION_LENGTH = 1024;
const MAX_SERVICE_SKILL_BUNDLE_COMPATIBILITY_LENGTH = 500;

function trimToUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toServiceSkillBundleMetadata(
  item: ServiceSkillItem,
): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};
  const skillType =
    item.skillType ??
    (item.defaultExecutorBinding === "browser_assist" || item.siteCapabilityBinding
      ? "site"
      : "service");
  const outputDestination = resolveDerivedServiceSkillOutputDestination(item);

  const candidates: Record<string, string | undefined> = {
    Lime_skill_type: skillType,
    Lime_category: trimToUndefined(item.category),
    Lime_runner_type: item.runnerType,
    Lime_execution_location: item.executionLocation,
    Lime_executor_binding: item.defaultExecutorBinding,
    Lime_output_destination: trimToUndefined(outputDestination),
    Lime_output_hint: trimToUndefined(item.outputHint),
    Lime_entry_hint: trimToUndefined(item.entryHint),
    Lime_prompt_template_key: item.promptTemplateKey,
    Lime_theme_target: trimToUndefined(item.themeTarget),
    Lime_site_adapter: trimToUndefined(item.siteCapabilityBinding?.adapterName),
    Lime_surface_scopes:
      item.surfaceScopes && item.surfaceScopes.length > 0
        ? JSON.stringify(item.surfaceScopes)
        : undefined,
  };

  for (const [key, value] of Object.entries(candidates)) {
    if (value) {
      metadata[key] = value;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function resolveDerivedServiceSkillOutputDestination(item: ServiceSkillItem): string {
  if (trimToUndefined(item.outputDestination)) {
    return item.outputDestination!.trim();
  }

  if (item.executionLocation === "cloud_required") {
    return "运行结果会在云端完成后回流到当前工作区。";
  }

  if (item.siteCapabilityBinding) {
    return item.siteCapabilityBinding.saveMode === "project_resource"
      ? "结果会沉淀为当前项目资源，方便后续复用。"
      : "结果会优先写回当前内容，继续在当前工作区整理。";
  }

  if (item.runnerType === "scheduled") {
    return "首轮结果会进入当前工作区；后续结果会同步到任务中心。";
  }

  if (item.runnerType === "managed") {
    return "首轮策略会进入当前工作区；后续跟踪结果会持续回流。";
  }

  return "结果会写回当前工作区，方便继续编辑。";
}

function buildDerivedServiceSkillCompatibility(item: ServiceSkillItem): string {
  const parts = ["适用于 Lime 客户端技能目录"];

  if (item.readinessRequirements?.requiresModel) {
    parts.push("需要已启用模型");
  }
  if (item.readinessRequirements?.requiresBrowser) {
    parts.push("需要浏览器登录态");
  }
  if (item.readinessRequirements?.requiresProject) {
    parts.push("建议在项目上下文中启动");
  }
  if (item.executionLocation === "cloud_required") {
    parts.push("需要云端执行");
  }
  if (item.defaultExecutorBinding === "browser_assist") {
    parts.push("会复用浏览器站点上下文");
  }

  const compatibility = parts.join("；");
  return compatibility.length > MAX_SERVICE_SKILL_BUNDLE_COMPATIBILITY_LENGTH
    ? compatibility.slice(0, MAX_SERVICE_SKILL_BUNDLE_COMPATIBILITY_LENGTH).trim()
    : compatibility;
}

function validateDerivedServiceSkillBundleName(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) {
    return ["skillBundle.name 不能为空"];
  }

  const errors: string[] = [];
  if (trimmed.length > MAX_SERVICE_SKILL_BUNDLE_NAME_LENGTH) {
    errors.push(
      `skillBundle.name 不能超过 ${MAX_SERVICE_SKILL_BUNDLE_NAME_LENGTH} 个字符`,
    );
  }
  if (trimmed !== trimmed.toLowerCase()) {
    errors.push("skillBundle.name 必须为小写");
  }
  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    errors.push("skillBundle.name 不能以连字符开头或结尾");
  }
  if (trimmed.includes("--")) {
    errors.push("skillBundle.name 不能包含连续连字符");
  }
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    errors.push("skillBundle.name 只能包含小写字母、数字和连字符");
  }
  return errors;
}

function validateDerivedServiceSkillBundleDescription(description: string): string[] {
  const trimmed = description.trim();
  if (!trimmed) {
    return ["skillBundle.description 不能为空"];
  }
  if (trimmed.length > MAX_SERVICE_SKILL_BUNDLE_DESCRIPTION_LENGTH) {
    return [
      `skillBundle.description 不能超过 ${MAX_SERVICE_SKILL_BUNDLE_DESCRIPTION_LENGTH} 个字符`,
    ];
  }
  return [];
}

function validateDerivedServiceSkillBundleCompatibility(
  compatibility: string,
): string[] {
  const trimmed = compatibility.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.length > MAX_SERVICE_SKILL_BUNDLE_COMPATIBILITY_LENGTH) {
    return [
      `skillBundle.compatibility 不能超过 ${MAX_SERVICE_SKILL_BUNDLE_COMPATIBILITY_LENGTH} 个字符`,
    ];
  }
  return [];
}

function buildDerivedServiceSkillBundleSummary(
  item: ServiceSkillItem,
): ServiceSkillBundleSummary {
  const name = trimToUndefined(item.skillKey) ?? item.id.trim();
  const description = trimToUndefined(item.summary) ?? item.title.trim();
  const compatibility = buildDerivedServiceSkillCompatibility(item);
  const validationErrors = [
    ...validateDerivedServiceSkillBundleName(name),
    ...validateDerivedServiceSkillBundleDescription(description),
    ...validateDerivedServiceSkillBundleCompatibility(compatibility),
  ];

  return {
    name,
    description,
    compatibility,
    metadata: toServiceSkillBundleMetadata(item),
    resourceSummary: {
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
    },
    standardCompliance: {
      isStandard: validationErrors.length === 0,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      deprecatedFields: [],
    },
  };
}

const SEEDED_SERVICE_SKILL_CATALOG: ServiceSkillCatalog = {
  version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
  tenantId: "local-seeded",
  syncedAt: "2026-03-24T00:00:00.000Z",
  items: [
    {
      id: "carousel-post-replication",
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
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
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
      outputDestination: "结果会写回当前工作区中的内容草稿，方便继续改写和发布。",
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "replication",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
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
          options: PLATFORM_OPTIONS,
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
      id: "short-video-script-replication",
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
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
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
      outputDestination: "结果会写回当前工作区中的脚本草稿，方便继续补镜头与口播。",
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "replication",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
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
          options: PLATFORM_OPTIONS,
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
      id: "article-to-slide-video-outline",
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
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "native_skill",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
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
      outputDestination: "结果会写回当前工作区中的提纲文档，方便继续补正文和分镜。",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
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
          options: PLATFORM_OPTIONS,
        },
      ],
    },
    {
      id: "video-dubbing-language",
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
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
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
      outputDestination: "结果会写回当前工作区中的配音稿，方便继续进入配音与剪辑流程。",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
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
      id: "daily-trend-briefing",
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
      source: "cloud_catalog",
      runnerType: "scheduled",
      defaultExecutorBinding: "automation_job",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
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
      outputDestination:
        "首轮结果会进入当前工作区；后续执行结果会同步到任务中心与对应项目内容。",
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "trend_briefing",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
        {
          key: "platform",
          label: "监测平台",
          type: "platform",
          required: true,
          defaultValue: "x",
          placeholder: "选择监测平台",
          options: PLATFORM_OPTIONS,
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
      id: "account-performance-tracking",
      skillKey: "account-performance-tracking",
      skillType: "service",
      title: "账号自动增长",
      summary:
        "围绕参考账号和目标平台先做一版增长策略，再整理后续持续跟踪需要的指标和告警条件。",
      entryHint:
        "给我参考账号、目标平台和增长目标，我先出复制策略、发布节奏和后续跟踪指标。",
      aliases: ["账号增长", "自动增长", "涨粉", "账号表现"],
      category: "内容运营",
      outputHint: "增长策略 + 发布节奏 + 跟踪指标",
      triggerHints: [
        "想先产出增长策略，再持续观察账号表现时使用。",
        "需要围绕目标账号建立长期跟踪和告警规则时使用。",
      ],
      source: "cloud_catalog",
      runnerType: "managed",
      defaultExecutorBinding: "automation_job",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      usageGuidelines: [
        "适合先产出首版增长打法，再逐步收紧指标和告警条件。",
        "账号列表越明确，后续持续跟踪和告警命中会越准确。",
      ],
      setupRequirements: [
        "需要已选择可用模型。",
        "建议在目标项目内启动，方便首轮策略和持续跟踪结果沉淀到同一工作区。",
      ],
      examples: [
        "围绕这几个小红书账号做一版自动增长策略，并设置日更追踪。",
        "帮我针对 X 上的目标账号生成增长计划和后续告警阈值。",
      ],
      outputDestination:
        "首轮策略会写回当前工作区；后续跟踪结果会持续回流到任务中心与项目内容。",
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "account_growth",
      themeTarget: "general",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
        {
          key: "platform",
          label: "目标平台",
          type: "platform",
          required: true,
          defaultValue: "x",
          placeholder: "选择账号平台",
          options: PLATFORM_OPTIONS,
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
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isServiceSkillSurfaceScopeArray(
  value: unknown,
): value is ServiceSkillSurfaceScope[] {
  return (
    isStringArray(value) &&
    value.every((item) =>
      SERVICE_SKILL_SURFACE_SCOPES.includes(item as ServiceSkillSurfaceScope),
    )
  );
}

function isSlotOptionArray(value: unknown): value is ServiceSkillSlotOption[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as ServiceSkillSlotOption).value === "string" &&
        typeof (item as ServiceSkillSlotOption).label === "string",
    )
  );
}

function isServiceSkillSlotDefinition(
  value: unknown,
): value is ServiceSkillSlotDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const slot = value as Partial<ServiceSkillSlotDefinition>;
  return (
    typeof slot.key === "string" &&
    typeof slot.label === "string" &&
    typeof slot.type === "string" &&
    typeof slot.required === "boolean" &&
    typeof slot.placeholder === "string" &&
    (slot.defaultValue === undefined ||
      typeof slot.defaultValue === "string") &&
    (slot.helpText === undefined || typeof slot.helpText === "string") &&
    (slot.options === undefined || isSlotOptionArray(slot.options))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isServiceSkillBundleResourceSummary(
  value: unknown,
): value is ServiceSkillBundleResourceSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const summary = value as Partial<ServiceSkillBundleResourceSummary>;
  return (
    typeof summary.hasScripts === "boolean" &&
    typeof summary.hasReferences === "boolean" &&
    typeof summary.hasAssets === "boolean"
  );
}

function isServiceSkillBundleStandardCompliance(
  value: unknown,
): value is ServiceSkillBundleStandardCompliance {
  if (!value || typeof value !== "object") {
    return false;
  }

  const compliance = value as Partial<ServiceSkillBundleStandardCompliance>;
  return (
    typeof compliance.isStandard === "boolean" &&
    (compliance.validationErrors === undefined ||
      isStringArray(compliance.validationErrors)) &&
    (compliance.deprecatedFields === undefined ||
      isStringArray(compliance.deprecatedFields))
  );
}

function isServiceSkillBundleSummary(
  value: unknown,
): value is ServiceSkillBundleSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const bundle = value as Partial<ServiceSkillBundleSummary>;
  return (
    typeof bundle.name === "string" &&
    typeof bundle.description === "string" &&
    (bundle.license === undefined || typeof bundle.license === "string") &&
    (bundle.compatibility === undefined ||
      typeof bundle.compatibility === "string") &&
    (bundle.metadata === undefined || isStringRecord(bundle.metadata)) &&
    (bundle.allowedTools === undefined || isStringArray(bundle.allowedTools)) &&
    isServiceSkillBundleResourceSummary(bundle.resourceSummary) &&
    isServiceSkillBundleStandardCompliance(bundle.standardCompliance)
  );
}

function isServiceSkillSiteCapabilityBinding(
  value: unknown,
): value is ServiceSkillSiteCapabilityBinding {
  if (!value || typeof value !== "object") {
    return false;
  }

  const binding = value as Partial<ServiceSkillSiteCapabilityBinding>;
  const saveModeValid =
    binding.saveMode === undefined ||
    binding.saveMode === "current_content" ||
    binding.saveMode === "project_resource";

  return (
    typeof binding.adapterName === "string" &&
    binding.adapterName.trim().length > 0 &&
    (binding.autoRun === undefined || typeof binding.autoRun === "boolean") &&
    (binding.requireAttachedSession === undefined ||
      typeof binding.requireAttachedSession === "boolean") &&
    saveModeValid &&
    (binding.slotArgMap === undefined || isStringRecord(binding.slotArgMap)) &&
    (binding.fixedArgs === undefined || isPlainRecord(binding.fixedArgs)) &&
    (binding.suggestedTitleTemplate === undefined ||
      typeof binding.suggestedTitleTemplate === "string")
  );
}

function isServiceSkillItem(value: unknown): value is ServiceSkillItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<ServiceSkillItem>;
  const skillTypeValid =
    item.skillType === undefined || SERVICE_SKILL_TYPES.includes(item.skillType);
  const promptTemplateKeyValid =
    item.promptTemplateKey === undefined ||
    SERVICE_SKILL_PROMPT_TEMPLATE_KEYS.includes(item.promptTemplateKey);
  const artifactKindValid =
    item.defaultArtifactKind === undefined ||
    [
      "report",
      "roadmap",
      "prd",
      "brief",
      "analysis",
      "comparison",
      "plan",
      "table_report",
    ].includes(item.defaultArtifactKind);
  return (
    typeof item.id === "string" &&
    (item.skillKey === undefined || typeof item.skillKey === "string") &&
    skillTypeValid &&
    typeof item.title === "string" &&
    typeof item.summary === "string" &&
    (item.entryHint === undefined || typeof item.entryHint === "string") &&
    (item.aliases === undefined || isStringArray(item.aliases)) &&
    typeof item.category === "string" &&
    typeof item.outputHint === "string" &&
    (item.triggerHints === undefined || isStringArray(item.triggerHints)) &&
    typeof item.source === "string" &&
    typeof item.runnerType === "string" &&
    typeof item.defaultExecutorBinding === "string" &&
    typeof item.executionLocation === "string" &&
    artifactKindValid &&
    promptTemplateKeyValid &&
    (item.usageGuidelines === undefined ||
      isStringArray(item.usageGuidelines)) &&
    (item.setupRequirements === undefined ||
      isStringArray(item.setupRequirements)) &&
    (item.examples === undefined || isStringArray(item.examples)) &&
    (item.outputDestination === undefined ||
      typeof item.outputDestination === "string") &&
    (item.siteCapabilityBinding === undefined ||
      isServiceSkillSiteCapabilityBinding(item.siteCapabilityBinding)) &&
    Array.isArray(item.slotSchema) &&
    item.slotSchema.every(isServiceSkillSlotDefinition) &&
    (item.surfaceScopes === undefined ||
      isServiceSkillSurfaceScopeArray(item.surfaceScopes)) &&
    (item.skillBundle === undefined ||
      isServiceSkillBundleSummary(item.skillBundle)) &&
    typeof item.version === "string"
  );
}

function isServiceSkillCatalog(value: unknown): value is ServiceSkillCatalog {
  if (!value || typeof value !== "object") {
    return false;
  }

  const catalog = value as Partial<ServiceSkillCatalog>;
  return (
    typeof catalog.version === "string" &&
    typeof catalog.tenantId === "string" &&
    typeof catalog.syncedAt === "string" &&
    Array.isArray(catalog.items) &&
    catalog.items.every(isServiceSkillItem)
  );
}

function cloneServiceSkillCatalog(
  catalog: ServiceSkillCatalog,
): ServiceSkillCatalog {
  return {
    ...catalog,
    items: catalog.items.map((item) => ({
      ...item,
      aliases: item.aliases ? [...item.aliases] : undefined,
      triggerHints: item.triggerHints ? [...item.triggerHints] : undefined,
      usageGuidelines: item.usageGuidelines
        ? [...item.usageGuidelines]
        : undefined,
      setupRequirements: item.setupRequirements
        ? [...item.setupRequirements]
        : undefined,
      examples: item.examples ? [...item.examples] : undefined,
      slotSchema: item.slotSchema.map((slot) => ({
        ...slot,
        options: slot.options ? [...slot.options] : undefined,
      })),
      surfaceScopes: item.surfaceScopes ? [...item.surfaceScopes] : undefined,
      readinessRequirements: item.readinessRequirements
        ? { ...item.readinessRequirements }
        : undefined,
      siteCapabilityBinding: item.siteCapabilityBinding
        ? {
            ...item.siteCapabilityBinding,
            slotArgMap: item.siteCapabilityBinding.slotArgMap
              ? { ...item.siteCapabilityBinding.slotArgMap }
              : undefined,
            fixedArgs: item.siteCapabilityBinding.fixedArgs
              ? JSON.parse(JSON.stringify(item.siteCapabilityBinding.fixedArgs))
              : undefined,
          }
        : undefined,
      skillBundle: item.skillBundle
        ? {
            ...item.skillBundle,
            metadata: item.skillBundle.metadata
              ? { ...item.skillBundle.metadata }
              : undefined,
            allowedTools: item.skillBundle.allowedTools
              ? [...item.skillBundle.allowedTools]
              : undefined,
            resourceSummary: { ...item.skillBundle.resourceSummary },
            standardCompliance: {
              ...item.skillBundle.standardCompliance,
              validationErrors: item.skillBundle.standardCompliance.validationErrors
                ? [...item.skillBundle.standardCompliance.validationErrors]
                : undefined,
              deprecatedFields: item.skillBundle.standardCompliance.deprecatedFields
                ? [...item.skillBundle.standardCompliance.deprecatedFields]
                : undefined,
            },
          }
        : buildDerivedServiceSkillBundleSummary(item),
    })),
  };
}

function isSameServiceSkillCatalog(
  left: ServiceSkillCatalog,
  right: ServiceSkillCatalog,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emitServiceSkillCatalogChanged(
  source: ServiceSkillCatalogChangeSource,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{
      source: ServiceSkillCatalogChangeSource;
      timestamp: number;
    }>(SERVICE_SKILL_CATALOG_CHANGED_EVENT, {
      detail: {
        source,
        timestamp: Date.now(),
      },
    }),
  );
}

function readCachedServiceSkillCatalog(): ServiceSkillCatalog | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SERVICE_SKILL_CATALOG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!isServiceSkillCatalog(parsed)) {
      return null;
    }
    return cloneServiceSkillCatalog(parsed);
  } catch {
    return null;
  }
}

function shouldRefreshSeededServiceSkillCatalog(
  cached: ServiceSkillCatalog,
  seeded: ServiceSkillCatalog,
): boolean {
  if (cached.tenantId !== seeded.tenantId) {
    return false;
  }

  return !isSameServiceSkillCatalog(cached, seeded);
}

function parseCatalogSyncedAt(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareCatalogVersion(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function isCatalogCompatibleWithActiveTenant(
  catalog: ServiceSkillCatalog,
): boolean {
  if (isSeededServiceSkillCatalog(catalog)) {
    return true;
  }

  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    return true;
  }

  return catalog.tenantId === runtime.tenantId;
}

function shouldIgnoreServerSyncedCatalog(
  current: ServiceSkillCatalog | null,
  incoming: ServiceSkillCatalog,
): boolean {
  const runtime = resolveOemCloudRuntimeContext();
  if (runtime && incoming.tenantId !== runtime.tenantId) {
    return true;
  }

  if (!current || current.tenantId !== incoming.tenantId) {
    return false;
  }

  const currentSyncedAt = parseCatalogSyncedAt(current.syncedAt);
  const incomingSyncedAt = parseCatalogSyncedAt(incoming.syncedAt);

  if (currentSyncedAt > 0 && incomingSyncedAt > 0) {
    if (incomingSyncedAt < currentSyncedAt) {
      return true;
    }
    if (incomingSyncedAt > currentSyncedAt) {
      return false;
    }
  }

  return compareCatalogVersion(incoming.version, current.version) < 0;
}

export function parseServiceSkillCatalog(
  value: unknown,
): ServiceSkillCatalog | null {
  if (!isServiceSkillCatalog(value)) {
    return null;
  }

  return cloneServiceSkillCatalog(value);
}

function persistServiceSkillCatalog(catalog: ServiceSkillCatalog): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SERVICE_SKILL_CATALOG_STORAGE_KEY,
      JSON.stringify(catalog),
    );
  } catch {
    // ignore local cache errors
  }
}

export function applyServerSyncedServiceSkillCatalog(
  catalog: ServiceSkillCatalog,
  source: "bootstrap_sync",
): ServiceSkillCatalog {
  const current = readCachedServiceSkillCatalog();
  if (shouldIgnoreServerSyncedCatalog(current, catalog)) {
    return current && isCatalogCompatibleWithActiveTenant(current)
      ? current
      : getSeededServiceSkillCatalog();
  }

  if (current && isSameServiceSkillCatalog(current, catalog)) {
    persistServiceSkillCatalog(catalog);
    return catalog;
  }

  persistServiceSkillCatalog(catalog);
  emitServiceSkillCatalogChanged(source);
  return catalog;
}

async function requestRemoteServiceSkillCatalog(): Promise<ServiceSkillCatalog> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    throw new Error("缺少 OEM 云端配置，请先注入 base_url 与 tenant_id。");
  }
  if (!hasOemCloudSession(runtime)) {
    throw new Error("缺少 OEM 云端 Session Token，请先完成登录或注入会话。");
  }

  const response = await fetch(
    `${runtime.controlPlaneBaseUrl}/v1/public/tenants/${encodeURIComponent(runtime.tenantId)}/client/service-skills`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${runtime.sessionToken}`,
      },
    },
  );

  let payload: ServiceSkillCatalogResponseEnvelope | null = null;
  try {
    payload = (await response.json()) as ServiceSkillCatalogResponseEnvelope;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.message?.trim() || `请求失败 (${response.status})`,
    );
  }

  const catalog = parseServiceSkillCatalog(payload?.data);
  if (!catalog) {
    throw new Error(payload?.message?.trim() || "服务端返回的目录格式非法");
  }

  return catalog;
}

export function getSeededServiceSkillCatalog(): ServiceSkillCatalog {
  return cloneServiceSkillCatalog(SEEDED_SERVICE_SKILL_CATALOG);
}

export function isSeededServiceSkillCatalog(
  catalog: ServiceSkillCatalog,
): boolean {
  return (
    catalog.tenantId === SEEDED_SERVICE_SKILL_CATALOG.tenantId &&
    catalog.version === SEEDED_SERVICE_SKILL_CATALOG.version
  );
}

export function saveServiceSkillCatalog(
  catalog: ServiceSkillCatalog,
  source: Exclude<
    ServiceSkillCatalogChangeSource,
    "seeded_fallback" | "cache_clear"
  > = "manual_override",
): ServiceSkillCatalog {
  const normalized = parseServiceSkillCatalog(catalog);
  if (!normalized) {
    throw new Error("invalid service skill catalog");
  }
  const current = readCachedServiceSkillCatalog();
  if (current && isSameServiceSkillCatalog(current, normalized)) {
    persistServiceSkillCatalog(normalized);
    return normalized;
  }
  persistServiceSkillCatalog(normalized);
  emitServiceSkillCatalogChanged(source);
  return normalized;
}

export function clearServiceSkillCatalogCache(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SERVICE_SKILL_CATALOG_STORAGE_KEY);
    } catch {
      // ignore local cache errors
    }
  }

  emitServiceSkillCatalogChanged("cache_clear");
}

export function subscribeServiceSkillCatalogChanged(
  callback: (source: ServiceSkillCatalogChangeSource) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const customEventHandler = (event: Event) => {
    const customEvent = event as CustomEvent<{
      source?: ServiceSkillCatalogChangeSource;
    }>;
    const source = customEvent.detail?.source;
    if (source) {
      callback(source);
    }
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SERVICE_SKILL_CATALOG_STORAGE_KEY) {
      return;
    }
    callback(event.newValue ? "manual_override" : "cache_clear");
  };

  window.addEventListener(
    SERVICE_SKILL_CATALOG_CHANGED_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      SERVICE_SKILL_CATALOG_CHANGED_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
}

export async function getServiceSkillCatalog(): Promise<ServiceSkillCatalog> {
  const seeded = getSeededServiceSkillCatalog();
  const cached = readCachedServiceSkillCatalog();
  if (cached) {
    if (!isCatalogCompatibleWithActiveTenant(cached)) {
      return seeded;
    }

    if (shouldRefreshSeededServiceSkillCatalog(cached, seeded)) {
      persistServiceSkillCatalog(seeded);
      return seeded;
    }
    return cached;
  }

  persistServiceSkillCatalog(seeded);
  return seeded;
}

export async function refreshServiceSkillCatalogFromRemote(): Promise<ServiceSkillCatalog | null> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime || !hasOemCloudSession(runtime)) {
    return null;
  }

  const catalog = await requestRemoteServiceSkillCatalog();
  return applyServerSyncedServiceSkillCatalog(catalog, "bootstrap_sync");
}

export async function listServiceSkills(): Promise<ServiceSkillItem[]> {
  const catalog = await getServiceSkillCatalog();
  return catalog.items.filter((item) => item.source === "cloud_catalog");
}
