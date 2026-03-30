import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";
import {
  getSeededServiceSkillCatalog,
  parseServiceSkillCatalog,
  type ServiceSkillExecutorBinding,
  type ServiceSkillItem,
  type ServiceSkillSiteCapabilityBinding,
} from "./serviceSkills";

export type SkillCatalogExecutionKind =
  | "native_skill"
  | "agent_turn"
  | "automation_job"
  | "cloud_scene"
  | "site_adapter";

export interface SkillCatalogExecution {
  kind: SkillCatalogExecutionKind;
  siteAdapterBinding?: ServiceSkillSiteCapabilityBinding;
}

export interface SkillCatalogGroup {
  key: string;
  title: string;
  summary: string;
  entryHint?: string;
  themeTarget?: string;
  sort: number;
  itemCount: number;
}

export interface SkillCatalogItem extends ServiceSkillItem {
  groupKey: string;
  execution: SkillCatalogExecution;
}

export interface SkillCatalog {
  version: string;
  tenantId: string;
  syncedAt: string;
  groups: SkillCatalogGroup[];
  items: SkillCatalogItem[];
}

export type SkillCatalogChangeSource =
  | "seeded_fallback"
  | "bootstrap_sync"
  | "manual_override"
  | "cache_clear";

interface SkillCatalogResponseEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
}

const SKILL_CATALOG_STORAGE_KEY = "lime:skill-catalog:v1";
export const SKILL_CATALOG_CHANGED_EVENT = "lime:skill-catalog-changed";
const SEEDED_SKILL_GROUP_PRESETS = [
  {
    key: "github",
    title: "GitHub",
    summary: "围绕仓库与 Issue 的只读研究技能，直接复用真实登录态抓线索。",
    entryHint: "先选一个 GitHub 技能，再补关键词或仓库名，结果会直接回流到当前工作区。",
    themeTarget: "knowledge",
    sort: 10,
  },
  {
    key: "zhihu",
    title: "知乎",
    summary: "围绕热榜与内容检索的只读研究技能，适合快速做选题与观点线索扫描。",
    entryHint: "从热榜或关键词入口开始，先抓一轮线索，再回到 Claw 继续整理。",
    themeTarget: "knowledge",
    sort: 20,
  },
  {
    key: "linux-do",
    title: "Linux.do",
    summary: "围绕社区分类与热门讨论的只读研究技能，适合跟踪开发者社区动态。",
    entryHint: "先确定是看分类还是看热门，再直接在真实社区页面采集结果。",
    themeTarget: "knowledge",
    sort: 30,
  },
  {
    key: "bilibili",
    title: "Bilibili",
    summary: "围绕视频检索的只读站点技能，适合快速抓视频线索并回流到当前工作区。",
    entryHint: "先给检索词，再直接复用当前浏览器页面做一轮视频线索采集。",
    themeTarget: "video",
    sort: 40,
  },
  {
    key: "36kr",
    title: "36Kr",
    summary: "围绕快讯和资讯流的只读站点技能，适合快速收集行业动态和新闻线索。",
    entryHint: "先确定主题范围，再直接采集快讯结果回到 Claw 继续整理。",
    themeTarget: "knowledge",
    sort: 50,
  },
  {
    key: "smzdm",
    title: "什么值得买",
    summary: "围绕消费和商品检索的只读站点技能，适合快速抓价格、优惠与选品线索。",
    entryHint: "输入商品关键词后直接采集结果，再回到 Claw 做整理和对比。",
    themeTarget: "knowledge",
    sort: 60,
  },
  {
    key: "yahoo-finance",
    title: "Yahoo Finance",
    summary: "围绕股票与行情摘要的只读站点技能，适合快速拉一轮金融研究线索。",
    entryHint: "输入股票代码后直接抓取行情摘要，再在工作区继续分析。",
    themeTarget: "knowledge",
    sort: 70,
  },
  {
    key: "general",
    title: "通用技能",
    summary: "保留现有写作、调研、趋势与持续跟踪能力，作为站点组之外的业务技能入口。",
    entryHint: "如果任务不依赖站点登录态，直接从这里选一个通用技能进入工作模式。",
    themeTarget: "general",
    sort: 90,
  },
] as const;
const SEEDED_SKILL_CATALOG_VERSION = "client-seed-skill-catalog-2026-03-30";
const SITE_GROUP_TITLE_OVERRIDES: Record<string, string> = {
  github: "GitHub",
  zhihu: "知乎",
  "linux-do": "Linux.do",
  bilibili: "Bilibili",
  "36kr": "36Kr",
  smzdm: "什么值得买",
  "yahoo-finance": "Yahoo Finance",
  general: "通用技能",
};

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSkillCatalog(catalog: SkillCatalog): SkillCatalog {
  return {
    ...catalog,
    groups: catalog.groups.map((group) => ({ ...group })),
    items: catalog.items.map((item) => ({
      ...cloneJsonValue(item),
      execution: {
        ...item.execution,
        siteAdapterBinding: item.execution.siteAdapterBinding
          ? cloneJsonValue(item.execution.siteAdapterBinding)
          : undefined,
      },
    })),
  };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveSkillCatalogExecutionKind(
  binding: ServiceSkillExecutorBinding,
  siteBinding?: ServiceSkillSiteCapabilityBinding,
): SkillCatalogExecutionKind {
  if (siteBinding || binding === "browser_assist") {
    return "site_adapter";
  }
  switch (binding) {
    case "native_skill":
      return "native_skill";
    case "automation_job":
      return "automation_job";
    case "cloud_scene":
      return "cloud_scene";
    default:
      return "agent_turn";
  }
}

function resolveSeededSkillGroupKey(item: ServiceSkillItem): string {
  return resolveAdapterGroupKey(item.siteCapabilityBinding?.adapterName);
}

function buildSeededSkillCatalog(): SkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  const items: SkillCatalogItem[] = seeded.items.map((item) => {
    const clonedItem = cloneJsonValue(item);
    const groupKey = resolveSeededSkillGroupKey(clonedItem);
    const execution: SkillCatalogExecution = {
      kind: resolveSkillCatalogExecutionKind(
        clonedItem.defaultExecutorBinding,
        clonedItem.siteCapabilityBinding,
      ),
      siteAdapterBinding: clonedItem.siteCapabilityBinding
        ? cloneJsonValue(clonedItem.siteCapabilityBinding)
        : undefined,
    };

    return {
      ...clonedItem,
      groupKey,
      execution,
    };
  });

  const itemCountByGroup = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.groupKey] = (acc[item.groupKey] ?? 0) + 1;
    return acc;
  }, {});

  const groups = SEEDED_SKILL_GROUP_PRESETS.filter(
    (preset) => itemCountByGroup[preset.key] > 0,
  ).map((preset) => ({
    ...preset,
    itemCount: itemCountByGroup[preset.key] ?? 0,
  }));

  return {
    version: SEEDED_SKILL_CATALOG_VERSION,
    tenantId: seeded.tenantId,
    syncedAt: seeded.syncedAt,
    groups,
    items,
  };
}

const SEEDED_SKILL_CATALOG = buildSeededSkillCatalog();

function resolveAdapterGroupKey(adapterName?: string | null): string {
  const normalized = normalizeText(adapterName)?.toLowerCase();
  if (!normalized) {
    return "general";
  }

  const [prefix] = normalized.split("/");
  return prefix || "general";
}

function titleCaseSegment(value: string): string {
  if (!value) {
    return value;
  }
  return value[0]!.toUpperCase() + value.slice(1);
}

function resolveGroupTitle(groupKey: string): string {
  const normalized = groupKey.trim().toLowerCase();
  if (SITE_GROUP_TITLE_OVERRIDES[normalized]) {
    return SITE_GROUP_TITLE_OVERRIDES[normalized]!;
  }
  return normalized
    .split(/[-_]/)
    .map(titleCaseSegment)
    .join(" ");
}

function resolveKnownGroupPreset(groupKey: string) {
  return SEEDED_SKILL_GROUP_PRESETS.find((preset) => preset.key === groupKey);
}

function buildFallbackGroupPreset(groupKey: string): Omit<SkillCatalogGroup, "itemCount"> {
  const title = resolveGroupTitle(groupKey);
  return {
    key: groupKey,
    title,
    summary: `围绕 ${title} 的只读站点技能入口，适合直接复用真实页面上下文采集结果。`,
    entryHint: `先进入 ${title} 技能组，再选择具体技能项开始采集。`,
    themeTarget: "knowledge",
    sort: 80,
  };
}

function mergeCatalogGroups(
  currentGroups: SkillCatalogGroup[],
  items: SkillCatalogItem[],
): SkillCatalogGroup[] {
  const itemCountByGroup = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.groupKey] = (acc[item.groupKey] ?? 0) + 1;
    return acc;
  }, {});
  const groupsByKey = new Map<string, SkillCatalogGroup>();

  for (const group of currentGroups) {
    groupsByKey.set(group.key, {
      ...group,
      itemCount: itemCountByGroup[group.key] ?? 0,
    });
  }

  for (const groupKey of Object.keys(itemCountByGroup)) {
    if (groupsByKey.has(groupKey)) {
      continue;
    }

    const preset =
      resolveKnownGroupPreset(groupKey) ?? buildFallbackGroupPreset(groupKey);
    groupsByKey.set(groupKey, {
      ...preset,
      itemCount: itemCountByGroup[groupKey] ?? 0,
    });
  }

  return Array.from(groupsByKey.values())
    .filter((group) => group.itemCount > 0)
    .sort((left, right) => left.sort - right.sort);
}

function shouldExposeSkillCatalogItem(item: SkillCatalogItem): boolean {
  if (item.execution.kind === "site_adapter") {
    return false;
  }

  if (
    item.defaultExecutorBinding === "browser_assist" ||
    item.siteCapabilityBinding
  ) {
    return false;
  }

  return true;
}

function normalizeSkillCatalog(catalog: SkillCatalog): SkillCatalog {
  const filteredItems = catalog.items.filter(shouldExposeSkillCatalogItem);
  const normalizedGroups = mergeCatalogGroups(catalog.groups, filteredItems);

  return cloneSkillCatalog({
    ...catalog,
    groups: normalizedGroups,
    items: filteredItems,
  });
}

function parseSkillCatalogExecution(value: unknown): SkillCatalogExecution | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const kind = normalizeText(value.kind);
  if (
    kind !== "native_skill" &&
    kind !== "agent_turn" &&
    kind !== "automation_job" &&
    kind !== "cloud_scene" &&
    kind !== "site_adapter"
  ) {
    return null;
  }

  const siteAdapterBindingEnvelope =
    value.siteAdapterBinding === undefined
      ? undefined
      : parseServiceSkillCatalog({
          version: "__internal__",
          tenantId: "__internal__",
          syncedAt: "__internal__",
          items: [
            {
              id: "__internal__",
              title: "__internal__",
              summary: "__internal__",
              category: "__internal__",
              outputHint: "__internal__",
              source: "cloud_catalog",
              runnerType: "instant",
              defaultExecutorBinding: "browser_assist",
              executionLocation: "client_default",
              slotSchema: [],
              siteCapabilityBinding: value.siteAdapterBinding,
              version: "__internal__",
            },
          ],
        });

  return {
    kind,
    siteAdapterBinding: siteAdapterBindingEnvelope?.items[0]?.siteCapabilityBinding,
  };
}

function parseSkillCatalogItem(value: unknown): SkillCatalogItem | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const groupKey = normalizeText(value.groupKey);
  if (!groupKey) {
    return null;
  }
  const execution = parseSkillCatalogExecution(value.execution);
  if (!execution) {
    return null;
  }

  const serviceSkillCandidate = {
    ...value,
  };
  delete (serviceSkillCandidate as Record<string, unknown>).groupKey;
  delete (serviceSkillCandidate as Record<string, unknown>).execution;

  const parsed = parseServiceSkillCatalog({
    version: "__internal__",
    tenantId: "__internal__",
    syncedAt: "__internal__",
    items: [serviceSkillCandidate],
  });
  const item = parsed?.items[0];
  if (!item) {
    return null;
  }

  return {
    ...item,
    groupKey,
    execution,
  };
}

function parseSkillCatalogGroup(value: unknown): SkillCatalogGroup | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const key = normalizeText(value.key);
  const title = normalizeText(value.title);
  const summary = normalizeText(value.summary);
  if (!key || !title || !summary || typeof value.sort !== "number") {
    return null;
  }

  return {
    key,
    title,
    summary,
    entryHint: normalizeText(value.entryHint) ?? undefined,
    themeTarget: normalizeText(value.themeTarget) ?? undefined,
    sort: value.sort,
    itemCount:
      typeof value.itemCount === "number" && Number.isFinite(value.itemCount)
        ? value.itemCount
        : 0,
  };
}

export function parseSkillCatalog(value: unknown): SkillCatalog | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const version = normalizeText(value.version);
  const tenantId = normalizeText(value.tenantId);
  const syncedAt = normalizeText(value.syncedAt);
  if (!version || !tenantId || !syncedAt) {
    return null;
  }
  if (!Array.isArray(value.groups) || !Array.isArray(value.items)) {
    return null;
  }

  const groups: SkillCatalogGroup[] = [];
  for (const item of value.groups) {
    const parsed = parseSkillCatalogGroup(item);
    if (!parsed) {
      return null;
    }
    groups.push(parsed);
  }

  const items: SkillCatalogItem[] = [];
  for (const item of value.items) {
    const parsed = parseSkillCatalogItem(item);
    if (!parsed) {
      return null;
    }
    items.push(parsed);
  }

  return normalizeSkillCatalog({
    version,
    tenantId,
    syncedAt,
    groups,
    items,
  });
}

function persistSkillCatalog(catalog: SkillCatalog): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SKILL_CATALOG_STORAGE_KEY,
      JSON.stringify(catalog),
    );
  } catch {
    // ignore local cache errors
  }
}

function readCachedSkillCatalog(): SkillCatalog | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SKILL_CATALOG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseSkillCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isSameSkillCatalog(left: SkillCatalog, right: SkillCatalog): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

function isSeededCatalogCompatibleWithActiveTenant(catalog: SkillCatalog): boolean {
  if (isSeededSkillCatalog(catalog)) {
    return true;
  }

  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    return true;
  }

  return catalog.tenantId === runtime.tenantId;
}

function shouldRefreshSeededSkillCatalog(
  cached: SkillCatalog,
  seeded: SkillCatalog,
): boolean {
  if (cached.tenantId !== seeded.tenantId) {
    return false;
  }

  for (const seededGroup of seeded.groups) {
    const cachedGroup = cached.groups.find((group) => group.key === seededGroup.key);
    if (!cachedGroup || JSON.stringify(cachedGroup) !== JSON.stringify(seededGroup)) {
      return true;
    }
  }

  for (const seededItem of seeded.items) {
    const cachedItem = cached.items.find((item) => item.id === seededItem.id);
    if (!cachedItem || JSON.stringify(cachedItem) !== JSON.stringify(seededItem)) {
      return true;
    }
  }

  return false;
}

function shouldIgnoreServerSyncedCatalog(
  current: SkillCatalog | null,
  incoming: SkillCatalog,
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

function emitSkillCatalogChanged(source: SkillCatalogChangeSource): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ source: SkillCatalogChangeSource; timestamp: number }>(
      SKILL_CATALOG_CHANGED_EVENT,
      {
        detail: {
          source,
          timestamp: Date.now(),
        },
      },
    ),
  );
}

export function getSeededSkillCatalog(): SkillCatalog {
  return cloneSkillCatalog(SEEDED_SKILL_CATALOG);
}

export function isSeededSkillCatalog(catalog: SkillCatalog): boolean {
  return (
    catalog.tenantId === SEEDED_SKILL_CATALOG.tenantId &&
    catalog.version === SEEDED_SKILL_CATALOG.version
  );
}

export function saveSkillCatalog(
  catalog: SkillCatalog,
  source: Exclude<SkillCatalogChangeSource, "seeded_fallback" | "cache_clear"> = "manual_override",
): SkillCatalog {
  const normalized = parseSkillCatalog(catalog);
  if (!normalized) {
    throw new Error("invalid skill catalog");
  }
  const current = readCachedSkillCatalog();
  if (current && isSameSkillCatalog(current, normalized)) {
    persistSkillCatalog(normalized);
    return normalized;
  }
  persistSkillCatalog(normalized);
  emitSkillCatalogChanged(source);
  return normalized;
}

export function applyServerSyncedSkillCatalog(
  catalog: SkillCatalog,
  source: "bootstrap_sync",
): SkillCatalog {
  const current = readCachedSkillCatalog();
  if (shouldIgnoreServerSyncedCatalog(current, catalog)) {
    return current && isSeededCatalogCompatibleWithActiveTenant(current)
      ? current
      : getSeededSkillCatalog();
  }

  if (current && isSameSkillCatalog(current, catalog)) {
    persistSkillCatalog(catalog);
    return catalog;
  }

  persistSkillCatalog(catalog);
  emitSkillCatalogChanged(source);
  return catalog;
}

export function clearSkillCatalogCache(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SKILL_CATALOG_STORAGE_KEY);
    } catch {
      // ignore local cache errors
    }
  }

  emitSkillCatalogChanged("cache_clear");
}

export function subscribeSkillCatalogChanged(
  callback: (source: SkillCatalogChangeSource) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const customEventHandler = (event: Event) => {
    const customEvent = event as CustomEvent<{
      source?: SkillCatalogChangeSource;
    }>;
    const source = customEvent.detail?.source;
    if (source) {
      callback(source);
    }
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SKILL_CATALOG_STORAGE_KEY) {
      return;
    }
    callback(event.newValue ? "manual_override" : "cache_clear");
  };

  window.addEventListener(SKILL_CATALOG_CHANGED_EVENT, customEventHandler);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(SKILL_CATALOG_CHANGED_EVENT, customEventHandler);
    window.removeEventListener("storage", storageHandler);
  };
}

async function requestRemoteSkillCatalog(): Promise<SkillCatalog> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    throw new Error("缺少 OEM 云端配置，请先注入 base_url 与 tenant_id。");
  }
  if (!hasOemCloudSession(runtime)) {
    throw new Error("缺少 OEM 云端 Session Token，请先完成登录或注入会话。");
  }

  const response = await fetch(
    `${runtime.controlPlaneBaseUrl}/v1/public/tenants/${encodeURIComponent(runtime.tenantId)}/client/skills`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${runtime.sessionToken}`,
      },
    },
  );

  let payload: SkillCatalogResponseEnvelope | null = null;
  try {
    payload = (await response.json()) as SkillCatalogResponseEnvelope;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message?.trim() || `请求失败 (${response.status})`);
  }

  const catalog = parseSkillCatalog(payload?.data);
  if (!catalog) {
    throw new Error(payload?.message?.trim() || "服务端返回的技能目录格式非法");
  }

  return catalog;
}

export async function getSkillCatalog(): Promise<SkillCatalog> {
  const seeded = getSeededSkillCatalog();
  const cached = readCachedSkillCatalog();
  if (cached) {
    if (!isSeededCatalogCompatibleWithActiveTenant(cached)) {
      return seeded;
    }

    if (shouldRefreshSeededSkillCatalog(cached, seeded)) {
      persistSkillCatalog(seeded);
      return seeded;
    }

    return cached;
  }

  persistSkillCatalog(seeded);
  return seeded;
}

export async function refreshSkillCatalogFromRemote(): Promise<SkillCatalog | null> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime || !hasOemCloudSession(runtime)) {
    return null;
  }

  const catalog = await requestRemoteSkillCatalog();
  return applyServerSyncedSkillCatalog(catalog, "bootstrap_sync");
}
