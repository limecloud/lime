import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";

export type ServiceSkillSource = "cloud_catalog" | "local_custom";

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

export interface ServiceSkillItem {
  id: string;
  skillKey?: string;
  title: string;
  summary: string;
  entryHint?: string;
  aliases?: string[];
  category: string;
  outputHint: string;
  source: ServiceSkillSource;
  runnerType: ServiceSkillRunnerType;
  defaultExecutorBinding: ServiceSkillExecutorBinding;
  executionLocation: ServiceSkillExecutionLocation;
  defaultArtifactKind?: ServiceSkillArtifactKind;
  readinessRequirements?: ServiceSkillReadinessRequirements;
  siteCapabilityBinding?: ServiceSkillSiteCapabilityBinding;
  slotSchema: ServiceSkillSlotDefinition[];
  surfaceScopes?: ServiceSkillSurfaceScope[];
  promptTemplateKey?: ServiceSkillPromptTemplateKey;
  themeTarget?: string;
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
const SEEDED_SERVICE_SKILL_CATALOG_VERSION = "client-seed-2026-03-24";

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

const SERVICE_SKILL_PROMPT_TEMPLATE_KEYS: ServiceSkillPromptTemplateKey[] = [
  "generic",
  "replication",
  "trend_briefing",
  "account_growth",
];

const SEEDED_SERVICE_SKILL_CATALOG: ServiceSkillCatalog = {
  version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
  tenantId: "local-seeded",
  syncedAt: "2026-03-24T00:00:00.000Z",
  items: [
    {
      id: "carousel-post-replication",
      skillKey: "carousel-post-replication",
      title: "复制轮播帖",
      summary:
        "拆解参考轮播帖的结构、文风和卖点，再输出一版可继续改写的轮播内容。",
      entryHint:
        "给我参考帖子和要保留的信息，我先拆结构，再产出一版可继续改的轮播帖。",
      aliases: ["复刻轮播帖", "轮播帖", "小红书轮播", "轮播复刻"],
      category: "社媒内容",
      outputHint: "轮播结构 + 文案初稿",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "replication",
      themeTarget: "social-media",
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
      title: "复制短视频脚本",
      summary: "围绕参考视频的结构和节奏，输出一版可直接继续加工的脚本。",
      entryHint:
        "把参考视频链接、平台和想改的地方给我，我先按原结构拆一版可继续加工的脚本。",
      aliases: ["复刻短视频", "短视频脚本", "视频脚本复刻", "视频复刻"],
      category: "视频创作",
      outputHint: "脚本大纲 + 镜头节奏",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "replication",
      themeTarget: "video",
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
      title: "文章转 Slide 视频提纲",
      summary: "把文章拆成镜头化结构，先生成一版适合做 Slide 视频的提纲。",
      category: "知识转化",
      outputHint: "Slide 分镜 + 提纲结构",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "native_skill",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      themeTarget: "knowledge",
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
      title: "视频配音成其他语言",
      summary: "先整理配音脚本和语言要求，输出一版可继续进入配音流程的执行稿。",
      category: "视频创作",
      outputHint: "配音脚本 + 语言说明",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      themeTarget: "video",
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
      id: "github-repo-radar",
      skillKey: "github-repo-radar",
      title: "GitHub 仓库线索检索",
      summary:
        "复用你当前浏览器里的 GitHub 登录态，直接检索主题仓库并沉淀成结构化线索。",
      category: "情报研究",
      outputHint: "仓库列表 + 关键线索",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "browser_assist",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
      readinessRequirements: {
        requiresBrowser: true,
        requiresProject: true,
      },
      siteCapabilityBinding: {
        adapterName: "github/search",
        autoRun: true,
        requireAttachedSession: true,
        saveMode: "current_content",
        slotArgMap: {
          repository_query: "query",
        },
        fixedArgs: {
          limit: 10,
        },
        suggestedTitleTemplate: "GitHub 仓库线索 · {{repository_query}}",
      },
      themeTarget: "knowledge",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
        {
          key: "repository_query",
          label: "检索主题",
          type: "text",
          required: true,
          placeholder: "例如 MCP agent browser automation",
          helpText:
            "进入后会自动打开浏览器站点工作台，并执行 GitHub 仓库搜索。",
        },
      ],
    },
    {
      id: "daily-trend-briefing",
      skillKey: "daily-trend-briefing",
      title: "每日趋势摘要",
      summary:
        "围绕指定平台、行业和地区，先产出一版趋势摘要和后续本地定时任务建议。",
      entryHint:
        "把平台、行业关键词和时间范围给我，我先整理一份趋势报告，再补定时追踪建议。",
      aliases: ["趋势摘要", "趋势报告", "热点摘要", "每日趋势"],
      category: "社媒运营",
      outputHint: "趋势摘要 + 调度建议",
      source: "cloud_catalog",
      runnerType: "scheduled",
      defaultExecutorBinding: "automation_job",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "trend_briefing",
      themeTarget: "social-media",
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
      title: "账号自动增长",
      summary:
        "围绕参考账号和目标平台先做一版增长策略，再整理后续持续跟踪需要的指标和告警条件。",
      entryHint:
        "给我参考账号、目标平台和增长目标，我先出复制策略、发布节奏和后续跟踪指标。",
      aliases: ["账号增长", "自动增长", "涨粉", "账号表现"],
      category: "社媒运营",
      outputHint: "增长策略 + 发布节奏 + 跟踪指标",
      source: "cloud_catalog",
      runnerType: "managed",
      defaultExecutorBinding: "automation_job",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      surfaceScopes: SERVICE_SKILL_SURFACE_SCOPES,
      promptTemplateKey: "account_growth",
      themeTarget: "social-media",
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
    typeof item.title === "string" &&
    typeof item.summary === "string" &&
    (item.entryHint === undefined || typeof item.entryHint === "string") &&
    (item.aliases === undefined || isStringArray(item.aliases)) &&
    typeof item.category === "string" &&
    typeof item.outputHint === "string" &&
    typeof item.source === "string" &&
    typeof item.runnerType === "string" &&
    typeof item.defaultExecutorBinding === "string" &&
    typeof item.executionLocation === "string" &&
    artifactKindValid &&
    promptTemplateKeyValid &&
    (item.siteCapabilityBinding === undefined ||
      isServiceSkillSiteCapabilityBinding(item.siteCapabilityBinding)) &&
    Array.isArray(item.slotSchema) &&
    item.slotSchema.every(isServiceSkillSlotDefinition) &&
    (item.surfaceScopes === undefined ||
      isServiceSkillSurfaceScopeArray(item.surfaceScopes)) &&
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
