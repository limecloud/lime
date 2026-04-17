import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";
import { getRuntimeAppVersion } from "@/lib/appVersion";
import { resolveBaseSetupCatalogPayload } from "@/lib/base-setup/bootstrap";
import {
  clearStoredBaseSetupPackageSnapshot,
  saveStoredBaseSetupPackageSnapshot,
  type StoredBaseSetupPackageSnapshot,
} from "@/lib/base-setup/storage";
import {
  createSeededCloudServiceSkillCatalog,
  createSeededLocalCustomServiceSkillCatalog,
} from "@/lib/base-setup/seededServiceSkillPackage";

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
  description?: string;
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

export interface ServiceSkillSiteCapabilityAdapterMatch {
  urlArgName: string;
  requiredCapabilities?: string[];
  hostAliases?: string[];
}

export interface ServiceSkillSiteCapabilityBinding {
  adapterName?: string;
  adapterMatch?: ServiceSkillSiteCapabilityAdapterMatch;
  autoRun?: boolean;
  requireAttachedSession?: boolean;
  saveMode?: ServiceSkillSiteCapabilitySaveMode;
  slotArgMap?: Record<string, string>;
  fixedArgs?: Record<string, unknown>;
  suggestedTitleTemplate?: string;
  siteLabel?: string;
}

export interface ServiceSkillSceneBinding {
  sceneKey: string;
  commandPrefix: string;
  title?: string;
  summary?: string;
  aliases?: string[];
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
  sceneBinding?: ServiceSkillSceneBinding;
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

interface NormalizedServiceSkillCatalogInput {
  catalog: ServiceSkillCatalog;
  baseSetupSnapshot: StoredBaseSetupPackageSnapshot | null;
}

const SERVICE_SKILL_CATALOG_STORAGE_KEY = "lime:service-skill-catalog:v1";
const SERVICE_SKILL_CATALOG_CHANGED_EVENT =
  "lime:service-skill-catalog-changed";

const SERVICE_SKILL_SURFACE_SCOPES: ServiceSkillSurfaceScope[] = [
  "home",
  "mention",
  "workspace",
];

const SERVICE_SKILL_TYPES: ServiceSkillType[] = ["service", "site", "prompt"];

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
    (item.defaultExecutorBinding === "browser_assist" ||
    item.siteCapabilityBinding
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
    Lime_site_label: trimToUndefined(item.siteCapabilityBinding?.siteLabel),
    Lime_site_adapter_match_url_arg: trimToUndefined(
      item.siteCapabilityBinding?.adapterMatch?.urlArgName,
    ),
    Lime_site_adapter_match_capabilities:
      item.siteCapabilityBinding?.adapterMatch?.requiredCapabilities &&
      item.siteCapabilityBinding.adapterMatch.requiredCapabilities.length > 0
        ? JSON.stringify(
            item.siteCapabilityBinding.adapterMatch.requiredCapabilities,
          )
        : undefined,
    Lime_site_adapter_match_host_aliases:
      item.siteCapabilityBinding?.adapterMatch?.hostAliases &&
      item.siteCapabilityBinding.adapterMatch.hostAliases.length > 0
        ? JSON.stringify(item.siteCapabilityBinding.adapterMatch.hostAliases)
        : undefined,
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

function resolveDerivedServiceSkillOutputDestination(
  item: ServiceSkillItem,
): string {
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
    return "首轮结果会进入当前工作区；后续结果会同步到生成工作台。";
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
    ? compatibility
        .slice(0, MAX_SERVICE_SKILL_BUNDLE_COMPATIBILITY_LENGTH)
        .trim()
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

function validateDerivedServiceSkillBundleDescription(
  description: string,
): string[] {
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
      validationErrors:
        validationErrors.length > 0 ? validationErrors : undefined,
      deprecatedFields: [],
    },
  };
}

const SEEDED_CLOUD_SERVICE_SKILL_CATALOG =
  createSeededCloudServiceSkillCatalog();
const SEEDED_LOCAL_CUSTOM_SERVICE_SKILL_CATALOG =
  createSeededLocalCustomServiceSkillCatalog();

const SEEDED_SERVICE_SKILL_CATALOG: ServiceSkillCatalog = {
  ...SEEDED_CLOUD_SERVICE_SKILL_CATALOG,
  items: [
    ...SEEDED_CLOUD_SERVICE_SKILL_CATALOG.items,
    ...SEEDED_LOCAL_CUSTOM_SERVICE_SKILL_CATALOG.items,
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
  const adapterNameValid =
    binding.adapterName === undefined ||
    (typeof binding.adapterName === "string" &&
      binding.adapterName.trim().length > 0);
  const adapterMatchValid =
    binding.adapterMatch === undefined ||
    (typeof binding.adapterMatch === "object" &&
      binding.adapterMatch !== null &&
      typeof binding.adapterMatch.urlArgName === "string" &&
      binding.adapterMatch.urlArgName.trim().length > 0 &&
      (binding.adapterMatch.requiredCapabilities === undefined ||
        isStringArray(binding.adapterMatch.requiredCapabilities)) &&
      (binding.adapterMatch.hostAliases === undefined ||
        isStringArray(binding.adapterMatch.hostAliases)));
  const hasAdapterSelector =
    (typeof binding.adapterName === "string" &&
      binding.adapterName.trim().length > 0) ||
    binding.adapterMatch !== undefined;

  return (
    hasAdapterSelector &&
    adapterNameValid &&
    adapterMatchValid &&
    (binding.autoRun === undefined || typeof binding.autoRun === "boolean") &&
    (binding.requireAttachedSession === undefined ||
      typeof binding.requireAttachedSession === "boolean") &&
    saveModeValid &&
    (binding.slotArgMap === undefined || isStringRecord(binding.slotArgMap)) &&
    (binding.fixedArgs === undefined || isPlainRecord(binding.fixedArgs)) &&
    (binding.suggestedTitleTemplate === undefined ||
      typeof binding.suggestedTitleTemplate === "string") &&
    (binding.siteLabel === undefined || typeof binding.siteLabel === "string")
  );
}

function isServiceSkillSceneBinding(
  value: unknown,
): value is ServiceSkillSceneBinding {
  if (!value || typeof value !== "object") {
    return false;
  }

  const binding = value as Partial<ServiceSkillSceneBinding>;
  return (
    typeof binding.sceneKey === "string" &&
    binding.sceneKey.trim().length > 0 &&
    typeof binding.commandPrefix === "string" &&
    binding.commandPrefix.trim().length > 0 &&
    (binding.title === undefined || typeof binding.title === "string") &&
    (binding.summary === undefined || typeof binding.summary === "string") &&
    (binding.aliases === undefined || isStringArray(binding.aliases))
  );
}

function isServiceSkillItem(value: unknown): value is ServiceSkillItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<ServiceSkillItem>;
  const skillTypeValid =
    item.skillType === undefined ||
    SERVICE_SKILL_TYPES.includes(item.skillType);
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
    (item.sceneBinding === undefined ||
      isServiceSkillSceneBinding(item.sceneBinding)) &&
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
            adapterMatch: item.siteCapabilityBinding.adapterMatch
              ? {
                  ...item.siteCapabilityBinding.adapterMatch,
                  requiredCapabilities: item.siteCapabilityBinding.adapterMatch
                    .requiredCapabilities
                    ? [
                        ...item.siteCapabilityBinding.adapterMatch
                          .requiredCapabilities,
                      ]
                    : undefined,
                  hostAliases: item.siteCapabilityBinding.adapterMatch
                    .hostAliases
                    ? [...item.siteCapabilityBinding.adapterMatch.hostAliases]
                    : undefined,
                }
              : undefined,
            slotArgMap: item.siteCapabilityBinding.slotArgMap
              ? { ...item.siteCapabilityBinding.slotArgMap }
              : undefined,
            fixedArgs: item.siteCapabilityBinding.fixedArgs
              ? JSON.parse(JSON.stringify(item.siteCapabilityBinding.fixedArgs))
              : undefined,
          }
        : undefined,
      sceneBinding: item.sceneBinding
        ? {
            ...item.sceneBinding,
            aliases: item.sceneBinding.aliases
              ? [...item.sceneBinding.aliases]
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
              validationErrors: item.skillBundle.standardCompliance
                .validationErrors
                ? [...item.skillBundle.standardCompliance.validationErrors]
                : undefined,
              deprecatedFields: item.skillBundle.standardCompliance
                .deprecatedFields
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

function mergeSeededLocalCustomServiceSkillItems(
  catalog: ServiceSkillCatalog,
): ServiceSkillCatalog {
  const localCustomItems = SEEDED_LOCAL_CUSTOM_SERVICE_SKILL_CATALOG.items;
  if (localCustomItems.length === 0) {
    return catalog;
  }

  const localCustomIds = new Set(localCustomItems.map((item) => item.id));
  return {
    ...catalog,
    items: [
      ...catalog.items.filter((item) => !localCustomIds.has(item.id)),
      ...localCustomItems.map(
        (item) => JSON.parse(JSON.stringify(item)) as ServiceSkillItem,
      ),
    ],
  };
}

function normalizeServiceSkillCatalog(
  catalog: ServiceSkillCatalog,
): ServiceSkillCatalog {
  return cloneServiceSkillCatalog(
    mergeSeededLocalCustomServiceSkillItems(catalog),
  );
}

function normalizeServiceSkillCatalogInput(
  value: unknown,
): NormalizedServiceSkillCatalogInput | null {
  if (isServiceSkillCatalog(value)) {
    return {
      catalog: normalizeServiceSkillCatalog(value),
      baseSetupSnapshot: null,
    };
  }

  const runtime = resolveOemCloudRuntimeContext();
  const compiledFromBaseSetup = resolveBaseSetupCatalogPayload(value, {
    appVersion: getRuntimeAppVersion(),
    tenantId: runtime?.tenantId ?? "base-setup",
    seededFallbackAvailable: true,
  });
  if (compiledFromBaseSetup) {
    return {
      catalog: normalizeServiceSkillCatalog(compiledFromBaseSetup.catalog),
      baseSetupSnapshot: compiledFromBaseSetup.snapshot,
    };
  }

  return null;
}

function isNormalizedServiceSkillCatalogInput(
  value: unknown,
): value is NormalizedServiceSkillCatalogInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (!("catalog" in record) || !isServiceSkillCatalog(record.catalog)) {
    return false;
  }

  return record.baseSetupSnapshot === null || "baseSetupSnapshot" in record;
}

export function parseServiceSkillCatalog(
  value: unknown,
): ServiceSkillCatalog | null {
  return normalizeServiceSkillCatalogInput(value)?.catalog ?? null;
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
  catalog: unknown,
  source: "bootstrap_sync",
): ServiceSkillCatalog {
  const normalizedInput = isNormalizedServiceSkillCatalogInput(catalog)
    ? catalog
    : normalizeServiceSkillCatalogInput(catalog);
  if (!normalizedInput) {
    return getSeededServiceSkillCatalog();
  }

  const current = readCachedServiceSkillCatalog();
  if (shouldIgnoreServerSyncedCatalog(current, normalizedInput.catalog)) {
    return current && isCatalogCompatibleWithActiveTenant(current)
      ? current
      : getSeededServiceSkillCatalog();
  }

  if (current && isSameServiceSkillCatalog(current, normalizedInput.catalog)) {
    persistServiceSkillCatalog(normalizedInput.catalog);
    if (normalizedInput.baseSetupSnapshot) {
      saveStoredBaseSetupPackageSnapshot(normalizedInput.baseSetupSnapshot);
    } else {
      clearStoredBaseSetupPackageSnapshot();
    }
    return normalizedInput.catalog;
  }

  persistServiceSkillCatalog(normalizedInput.catalog);
  if (normalizedInput.baseSetupSnapshot) {
    saveStoredBaseSetupPackageSnapshot(normalizedInput.baseSetupSnapshot);
  } else {
    clearStoredBaseSetupPackageSnapshot();
  }
  emitServiceSkillCatalogChanged(source);
  return normalizedInput.catalog;
}

async function requestRemoteServiceSkillCatalog(): Promise<NormalizedServiceSkillCatalogInput> {
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

  const normalizedInput = normalizeServiceSkillCatalogInput(payload?.data);
  if (!normalizedInput) {
    throw new Error(payload?.message?.trim() || "服务端返回的目录格式非法");
  }

  return normalizedInput;
}

export function getSeededServiceSkillCatalog(): ServiceSkillCatalog {
  return cloneServiceSkillCatalog(SEEDED_SERVICE_SKILL_CATALOG);
}

function isSeededServiceSkillCatalog(catalog: ServiceSkillCatalog): boolean {
  return (
    catalog.tenantId === SEEDED_SERVICE_SKILL_CATALOG.tenantId &&
    catalog.version === SEEDED_SERVICE_SKILL_CATALOG.version
  );
}

export function saveServiceSkillCatalog(
  catalog: unknown,
  source: Exclude<
    ServiceSkillCatalogChangeSource,
    "seeded_fallback" | "cache_clear"
  > = "manual_override",
): ServiceSkillCatalog {
  const normalizedInput = normalizeServiceSkillCatalogInput(catalog);
  if (!normalizedInput) {
    throw new Error("invalid service skill catalog");
  }
  const current = readCachedServiceSkillCatalog();
  if (current && isSameServiceSkillCatalog(current, normalizedInput.catalog)) {
    persistServiceSkillCatalog(normalizedInput.catalog);
    if (normalizedInput.baseSetupSnapshot) {
      saveStoredBaseSetupPackageSnapshot(normalizedInput.baseSetupSnapshot);
    } else {
      clearStoredBaseSetupPackageSnapshot();
    }
    return normalizedInput.catalog;
  }
  persistServiceSkillCatalog(normalizedInput.catalog);
  if (normalizedInput.baseSetupSnapshot) {
    saveStoredBaseSetupPackageSnapshot(normalizedInput.baseSetupSnapshot);
  } else {
    clearStoredBaseSetupPackageSnapshot();
  }
  emitServiceSkillCatalogChanged(source);
  return normalizedInput.catalog;
}

export function clearServiceSkillCatalogCache(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SERVICE_SKILL_CATALOG_STORAGE_KEY);
    } catch {
      // ignore local cache errors
    }
  }

  clearStoredBaseSetupPackageSnapshot();
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
      clearStoredBaseSetupPackageSnapshot();
      return seeded;
    }
    return cached;
  }

  persistServiceSkillCatalog(seeded);
  clearStoredBaseSetupPackageSnapshot();
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
  return catalog.items;
}
