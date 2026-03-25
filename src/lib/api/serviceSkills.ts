import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";

export type ServiceSkillSource = "cloud_catalog" | "local_custom";

export type ServiceSkillRunnerType = "instant" | "scheduled" | "managed";

export type ServiceSkillExecutionLocation =
  | "client_default"
  | "cloud_required";

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

export interface ServiceSkillItem {
  id: string;
  skillKey?: string;
  title: string;
  summary: string;
  category: string;
  outputHint: string;
  source: ServiceSkillSource;
  runnerType: ServiceSkillRunnerType;
  defaultExecutorBinding: ServiceSkillExecutorBinding;
  executionLocation: ServiceSkillExecutionLocation;
  defaultArtifactKind?: ServiceSkillArtifactKind;
  readinessRequirements?: ServiceSkillReadinessRequirements;
  slotSchema: ServiceSkillSlotDefinition[];
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

const SEEDED_SERVICE_SKILL_CATALOG: ServiceSkillCatalog = {
  version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
  tenantId: "local-seeded",
  syncedAt: "2026-03-24T00:00:00.000Z",
  items: [
    {
      id: "carousel-post-replication",
      skillKey: "carousel-post-replication",
      title: "复制轮播帖",
      summary: "拆解参考轮播帖的结构、文风和卖点，再输出一版可继续改写的轮播内容。",
      category: "社媒内容",
      outputHint: "轮播结构 + 文案初稿",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "native_skill",
      executionLocation: "client_default",
      defaultArtifactKind: "brief",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
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
      id: "daily-trend-briefing",
      skillKey: "daily-trend-briefing",
      title: "每日趋势摘要",
      summary: "围绕指定平台、行业和地区，先产出一版趋势摘要和后续本地定时任务建议。",
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
      title: "跟踪账号表现",
      summary: "围绕指定账号先做一版表现分析，并整理后续本地跟踪任务需要的指标和告警条件。",
      category: "社媒运营",
      outputHint: "账号分析 + 跟踪指标",
      source: "cloud_catalog",
      runnerType: "managed",
      defaultExecutorBinding: "automation_job",
      executionLocation: "client_default",
      defaultArtifactKind: "analysis",
      readinessRequirements: {
        requiresModel: true,
        requiresProject: true,
      },
      themeTarget: "social-media",
      version: SEEDED_SERVICE_SKILL_CATALOG_VERSION,
      slotSchema: [
        {
          key: "platform",
          label: "账号平台",
          type: "platform",
          required: true,
          defaultValue: "x",
          placeholder: "选择账号平台",
          options: PLATFORM_OPTIONS,
        },
        {
          key: "account_list",
          label: "账号列表",
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
    (slot.defaultValue === undefined || typeof slot.defaultValue === "string") &&
    (slot.helpText === undefined || typeof slot.helpText === "string") &&
    (slot.options === undefined || isSlotOptionArray(slot.options))
  );
}

function isServiceSkillItem(value: unknown): value is ServiceSkillItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<ServiceSkillItem>;
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
    typeof item.category === "string" &&
    typeof item.outputHint === "string" &&
    typeof item.source === "string" &&
    typeof item.runnerType === "string" &&
    typeof item.defaultExecutorBinding === "string" &&
    typeof item.executionLocation === "string" &&
    artifactKindValid &&
    Array.isArray(item.slotSchema) &&
    item.slotSchema.every(isServiceSkillSlotDefinition) &&
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

function cloneServiceSkillCatalog(catalog: ServiceSkillCatalog): ServiceSkillCatalog {
  return {
    ...catalog,
    items: catalog.items.map((item) => ({
      ...item,
      slotSchema: item.slotSchema.map((slot) => ({
        ...slot,
        options: slot.options ? [...slot.options] : undefined,
      })),
      readinessRequirements: item.readinessRequirements
        ? { ...item.readinessRequirements }
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
    throw new Error(payload?.message?.trim() || `请求失败 (${response.status})`);
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
  source: Exclude<ServiceSkillCatalogChangeSource, "seeded_fallback" | "cache_clear"> = "manual_override",
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
  const cached = readCachedServiceSkillCatalog();
  if (cached) {
    return cached;
  }

  const seeded = getSeededServiceSkillCatalog();
  persistServiceSkillCatalog(seeded);
  return seeded;
}

export async function refreshServiceSkillCatalogFromRemote(): Promise<ServiceSkillCatalog | null> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime || !hasOemCloudSession(runtime)) {
    return null;
  }

  const catalog = await requestRemoteServiceSkillCatalog();
  return saveServiceSkillCatalog(catalog, "bootstrap_sync");
}

export async function listServiceSkills(): Promise<ServiceSkillItem[]> {
  const catalog = await getServiceSkillCatalog();
  return catalog.items.filter((item) => item.source === "cloud_catalog");
}
