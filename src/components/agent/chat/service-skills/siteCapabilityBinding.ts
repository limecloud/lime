import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import {
  siteListAdapters,
  type SiteAdapterDefinition,
  type SiteAdapterLaunchReadinessResult,
} from "@/lib/webview-api";
import type { ServiceSkillSlotValues } from "./types";
import {
  composeServiceSkillPrompt,
  resolveServiceSkillSlotValue,
} from "./promptComposer";

export function isServiceSkillSiteCapabilityBound(
  skill: Pick<
    ServiceSkillItem,
    "defaultExecutorBinding" | "siteCapabilityBinding"
  >,
): skill is Pick<
  ServiceSkillItem,
  "defaultExecutorBinding" | "siteCapabilityBinding"
> & {
  siteCapabilityBinding: NonNullable<ServiceSkillItem["siteCapabilityBinding"]>;
} {
  return (
    skill.defaultExecutorBinding === "browser_assist" &&
    !!skill.siteCapabilityBinding
  );
}

export const isServiceSkillExecutableAsSiteAdapter =
  isServiceSkillSiteCapabilityBound;

export interface ServiceSkillClawLaunchReadiness {
  status: SiteAdapterLaunchReadinessResult["status"];
  profileKey?: string;
  targetId?: string;
  domain: string;
  message: string;
  reportHint?: string;
}

export interface ServiceSkillClawLaunchContext {
  kind: "site_adapter";
  skillId: string;
  skillTitle: string;
  adapterName: string;
  isExportStyle?: boolean;
  args: Record<string, unknown>;
  saveMode: "current_content" | "project_resource";
  saveTitle?: string;
  contentId?: string;
  projectId?: string;
  launchReadiness?: ServiceSkillClawLaunchReadiness;
}

export interface ResolvedServiceSkillSiteCapabilityExecution {
  adapterName: string;
  args: Record<string, unknown>;
}

type SiteLaunchReadinessLike =
  | ServiceSkillClawLaunchReadiness
  | SiteAdapterLaunchReadinessResult
  | null
  | undefined;

function isClawLaunchReadiness(
  launchReadiness: SiteLaunchReadinessLike,
): launchReadiness is ServiceSkillClawLaunchReadiness {
  return Boolean(launchReadiness && "reportHint" in launchReadiness);
}

export function isSiteLaunchReadinessReady(
  launchReadiness?: SiteLaunchReadinessLike,
): boolean {
  return launchReadiness?.status === "ready";
}

export function buildSiteLaunchBlockedMessage(
  launchReadiness?: SiteLaunchReadinessLike,
): string {
  const message = launchReadiness?.message?.trim();
  const reportHint = launchReadiness
    ? isClawLaunchReadiness(launchReadiness)
      ? launchReadiness.reportHint?.trim()
      : launchReadiness.report_hint?.trim()
    : undefined;

  return [
    message,
    reportHint,
    "请先在浏览器工作台完成连接、登录或授权后再重试。",
  ]
    .filter((item, index, items): item is string => {
      if (!item) {
        return false;
      }
      return items.indexOf(item) === index;
    })
    .join(" ");
}

const SITE_LABELS: Record<string, string> = {
  "36kr": "36Kr",
  bilibili: "B 站",
  github: "GitHub",
  "linux-do": "linux.do",
  smzdm: "什么值得买",
  "yahoo-finance": "Yahoo Finance",
  zhihu: "知乎",
};

const EXPORT_CAPABILITIES = new Set(["article_export", "markdown_bundle"]);
const SITE_EXPORT_TRANSLATION_FOLLOWUP_ENTRY_SOURCE =
  "service_skill_site_export_followup";

interface ServiceSkillFollowupTranslationRequest {
  prompt: string;
  raw_text: string;
  target_language: string;
  project_id?: string;
  content_id?: string;
  entry_source: string;
}

function normalizeNaturalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function ensureSentence(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }
  return /[。！？.!?]$/.test(normalized) ? normalized : `${normalized}。`;
}

function quoteNaturalValue(value: string): string {
  return `“${value}”`;
}

function normalizeAdapterName(adapterName: string): string {
  return adapterName.trim().toLowerCase();
}

function normalizeHost(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  let normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(
      normalized.startsWith("http://") || normalized.startsWith("https://")
        ? normalized
        : `https://${normalized}`,
    );
    normalized = parsed.hostname.toLowerCase();
  } catch {
    normalized = normalized
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  }

  return normalized.replace(/^\.+|\.+$/g, "").replace(/^www\./, "");
}

function normalizeCapability(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

function isExportStyleSiteSkill(
  skill: Pick<ServiceSkillItem, "siteCapabilityBinding">,
): boolean {
  const capabilities =
    skill.siteCapabilityBinding?.adapterMatch?.requiredCapabilities ?? [];
  if (
    capabilities.some((capability) =>
      EXPORT_CAPABILITIES.has(normalizeCapability(capability)),
    )
  ) {
    return true;
  }

  const adapterName = normalizeAdapterName(
    skill.siteCapabilityBinding?.adapterName ?? "",
  );
  return (
    adapterName === "article-export" || adapterName.endsWith("/article-export")
  );
}

function resolveSkillSiteLabel(
  skill: Pick<ServiceSkillItem, "title" | "siteCapabilityBinding">,
): string | null {
  const explicitLabel = normalizeNaturalText(
    skill.siteCapabilityBinding?.siteLabel,
  );
  if (explicitLabel) {
    return explicitLabel;
  }

  const adapterName = normalizeNaturalText(skill.siteCapabilityBinding?.adapterName);
  if (!adapterName) {
    return null;
  }

  const label = resolveSiteLabel(adapterName);
  return label === "general" ? null : label;
}

function readRequiredCapabilities(
  skill: Pick<ServiceSkillItem, "siteCapabilityBinding">,
): string[] {
  const values = skill.siteCapabilityBinding?.adapterMatch?.requiredCapabilities;
  if (!values?.length) {
    return [];
  }

  return Array.from(
    new Set(values.map((value) => normalizeCapability(value)).filter(Boolean)),
  );
}

function siteScopeMatchesDomain(scope: string, domain: string): boolean {
  const normalizedScope = normalizeHost(scope);
  const normalizedDomain = normalizeHost(domain);
  if (!normalizedScope || !normalizedDomain) {
    return false;
  }

  return (
    normalizedDomain === normalizedScope ||
    normalizedDomain.endsWith(`.${normalizedScope}`) ||
    normalizedScope.endsWith(`.${normalizedDomain}`)
  );
}

function adapterSupportsCapabilities(
  adapter: SiteAdapterDefinition,
  requiredCapabilities: string[],
): boolean {
  if (requiredCapabilities.length === 0) {
    return true;
  }

  const available = new Set(
    (adapter.capabilities ?? [])
      .map((capability) => normalizeCapability(capability))
      .filter(Boolean),
  );
  return requiredCapabilities.every((capability) => available.has(capability));
}

function scoreMatchedAdapter(params: {
  adapter: SiteAdapterDefinition;
  host: string;
  extraHosts: string[];
  requiredCapabilities: string[];
}): number | null {
  const { adapter, host, extraHosts, requiredCapabilities } = params;
  if (!adapterSupportsCapabilities(adapter, requiredCapabilities)) {
    return null;
  }

  const candidateHosts = Array.from(
    new Set(
      [adapter.domain, ...extraHosts]
        .map((value) => normalizeHost(value))
        .filter(Boolean),
    ),
  );

  let hostScore = 0;
  for (const candidateHost of candidateHosts) {
    if (normalizeHost(host) === candidateHost) {
      hostScore = Math.max(hostScore, 300);
      continue;
    }
    if (siteScopeMatchesDomain(host, candidateHost)) {
      hostScore = Math.max(hostScore, 200);
    }
  }

  if (hostScore === 0) {
    return null;
  }

  return (
    hostScore +
    requiredCapabilities.length * 10 +
    normalizeHost(adapter.domain).length
  );
}

function resolveMatchedAdapterName(params: {
  host: string;
  adapters: SiteAdapterDefinition[];
  extraHosts: string[];
  requiredCapabilities: string[];
}): string | undefined {
  let matched: { name: string; score: number } | null = null;

  for (const adapter of params.adapters) {
    const score = scoreMatchedAdapter({
      adapter,
      host: params.host,
      extraHosts: params.extraHosts,
      requiredCapabilities: params.requiredCapabilities,
    });
    if (score === null) {
      continue;
    }

    if (!matched || score > matched.score) {
      matched = {
        name: adapter.name,
        score,
      };
    }
  }

  return matched?.name;
}

function resolveSiteLabel(adapterName: string): string {
  const groupKey = normalizeAdapterName(adapterName).split("/")[0] || "general";
  return SITE_LABELS[groupKey] ?? groupKey;
}

function readStringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const normalized = String(value).trim();
    return normalized || undefined;
  }
  return undefined;
}

function isGenericContinuationUserInput(value: string): boolean {
  const normalized = value.replace(/[\s，,。！？.!?]/g, "");
  return [
    "继续",
    "请继续",
    "继续处理",
    "继续处理当前任务",
    "继续当前任务",
    "请继续处理当前任务",
    "请结合当前上下文继续",
    "结合当前上下文继续",
    "请结合上下文继续",
    "结合上下文继续",
  ].includes(normalized);
}

function buildSupplementalSentence(value: string): string {
  if (/^(请|帮我|麻烦|另外|并且|同时|优先|只看)/.test(value)) {
    return ensureSentence(value);
  }
  return ensureSentence(`另外，${value}`);
}

function resolveGithubIssuesStateLabel(value?: string): string | null {
  switch (value?.trim().toLowerCase()) {
    case "open":
      return "open 状态";
    case "closed":
      return "closed 状态";
    case "all":
      return "全部状态";
    default:
      return value?.trim() || null;
  }
}

function buildSiteSkillPrimarySentence(
  skill: ServiceSkillItem,
  args: Record<string, unknown>,
): string {
  const adapterName = normalizeAdapterName(
    skill.siteCapabilityBinding?.adapterName ?? "",
  );
  const query = readStringArg(args, "query");
  const repo = readStringArg(args, "repo");
  const symbol = readStringArg(args, "symbol");
  const period = readStringArg(args, "period");
  const targetLanguage = readStringArg(args, "target_language");
  const siteLabel = resolveSkillSiteLabel(skill);

  if (isExportStyleSiteSkill(skill)) {
    const exportTarget = siteLabel ? `这篇${siteLabel}文章` : "这个页面";
    if (targetLanguage) {
      return `你帮我把${exportTarget}导出为 Markdown，并将正文翻译成${quoteNaturalValue(targetLanguage)}，保留代码块原文、图片链接和 Markdown 结构`;
    }
    return `你帮我把${exportTarget}导出为 Markdown，并把文内图片和代码块一起保存到项目里`;
  }

  switch (adapterName) {
    case "github/search":
      return query
        ? `你帮我在 GitHub 找一下和${quoteNaturalValue(query)}相关的项目`
        : "你帮我在 GitHub 找一些值得关注的项目";
    case "github/issues": {
      const stateLabel = resolveGithubIssuesStateLabel(
        readStringArg(args, "state"),
      );
      if (repo && query && stateLabel) {
        return `你帮我看一下 GitHub 上 ${repo} 仓库里 ${stateLabel}、和${quoteNaturalValue(query)}相关的 issue`;
      }
      if (repo && query) {
        return `你帮我看一下 GitHub 上 ${repo} 仓库里和${quoteNaturalValue(query)}相关的 issue`;
      }
      if (repo && stateLabel) {
        return `你帮我看一下 GitHub 上 ${repo} 仓库里 ${stateLabel} 的 issue`;
      }
      if (repo) {
        return `你帮我看一下 GitHub 上 ${repo} 仓库的 issue`;
      }
      if (query) {
        return `你帮我在 GitHub 看一下和${quoteNaturalValue(query)}相关的 issue`;
      }
      return "你帮我在 GitHub 看一下值得关注的 issue";
    }
    case "bilibili/search":
      return query
        ? `你帮我在 B 站搜一下和${quoteNaturalValue(query)}相关的视频`
        : "你帮我在 B 站搜一些值得关注的视频";
    case "zhihu/search":
      return query
        ? `你帮我在知乎搜一下和${quoteNaturalValue(query)}相关的内容`
        : "你帮我在知乎搜一些值得关注的内容";
    case "zhihu/hot":
      return "你帮我看一下当前知乎热榜";
    case "36kr/newsflash":
      return "你帮我看一下 36Kr 最新快讯";
    case "linux-do/categories":
      return "你帮我看一下 linux.do 的分类列表";
    case "linux-do/hot":
      return period
        ? `你帮我看一下 linux.do 在 ${period} 范围内的热门话题`
        : "你帮我看一下 linux.do 当前的热门话题";
    case "smzdm/search":
      return query
        ? `你帮我在什么值得买搜一下和${quoteNaturalValue(query)}相关的商品线索`
        : "你帮我在什么值得买搜一些值得关注的商品线索";
    case "yahoo-finance/quote":
      return symbol
        ? `你帮我看一下 ${symbol} 的最新行情摘要`
        : "你帮我看一下最新行情摘要";
    default: {
      if (query) {
        if (siteLabel) {
          return `你帮我在 ${siteLabel} 搜一下和${quoteNaturalValue(query)}相关的内容`;
        }
        return `你帮我找一下和${quoteNaturalValue(query)}相关的内容`;
      }
      if (symbol) {
        if (siteLabel) {
          return `你帮我在 ${siteLabel} 看一下 ${symbol} 的最新信息`;
        }
        return `你帮我看一下 ${symbol} 的最新信息`;
      }
      if (siteLabel) {
        return `你帮我在 ${siteLabel} 执行一下${skill.title}`;
      }
      return `你帮我执行一下${skill.title}`;
    }
  }
}

export function buildServiceSkillNaturalLaunchMessage(input: {
  skill: ServiceSkillItem;
  slotValues: ServiceSkillSlotValues;
  userInput?: string;
}): string {
  const { skill, slotValues, userInput } = input;
  if (!isServiceSkillSiteCapabilityBound(skill)) {
    return composeServiceSkillPrompt({
      skill,
      slotValues,
      userInput,
    });
  }

  const primarySentence = ensureSentence(
    buildSiteSkillPrimarySentence(
      skill,
      buildServiceSkillSiteCapabilityArgs(skill, slotValues),
    ),
  );
  const normalizedUserInput = normalizeNaturalText(userInput);

  if (
    !normalizedUserInput ||
    isGenericContinuationUserInput(normalizedUserInput)
  ) {
    return primarySentence;
  }

  return `${primarySentence}${buildSupplementalSentence(normalizedUserInput)}`;
}

export function buildServiceSkillSiteCapabilityArgs(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
): Record<string, unknown> {
  if (!isServiceSkillSiteCapabilityBound(skill)) {
    return {};
  }

  const mappedArgs = skill.slotSchema.reduce<Record<string, unknown>>(
    (acc, slot) => {
      const argName = skill.siteCapabilityBinding.slotArgMap?.[slot.key];
      if (!argName) {
        return acc;
      }

      const value = resolveServiceSkillSlotValue(slot, slotValues);
      if (!value) {
        return acc;
      }

      acc[argName] = value;
      return acc;
    },
    {},
  );

  return {
    ...mappedArgs,
    ...(skill.siteCapabilityBinding.fixedArgs ?? {}),
  };
}

export async function resolveServiceSkillSiteCapabilityExecution(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
  options?: {
    listAdapters?: () => Promise<SiteAdapterDefinition[]>;
  },
): Promise<ResolvedServiceSkillSiteCapabilityExecution> {
  if (!isServiceSkillSiteCapabilityBound(skill)) {
    throw new Error("当前技能未绑定站点执行能力");
  }

  const args = buildServiceSkillSiteCapabilityArgs(skill, slotValues);
  const binding = skill.siteCapabilityBinding;
  const fallbackAdapterName = normalizeNaturalText(binding.adapterName);
  const adapterMatch = binding.adapterMatch;

  if (!adapterMatch) {
    if (!fallbackAdapterName) {
      throw new Error("当前技能缺少站点适配器绑定。");
    }

    return {
      adapterName: fallbackAdapterName,
      args,
    };
  }

  const urlValue = readStringArg(args, adapterMatch.urlArgName);
  if (!urlValue) {
    if (fallbackAdapterName) {
      return {
        adapterName: fallbackAdapterName,
        args,
      };
    }
    throw new Error(
      `当前技能缺少 ${adapterMatch.urlArgName}，暂时无法匹配站点适配器。`,
    );
  }

  const host = normalizeHost(urlValue);
  if (!host) {
    if (fallbackAdapterName) {
      return {
        adapterName: fallbackAdapterName,
        args,
      };
    }
    throw new Error("当前链接格式无效，暂时无法匹配站点适配器。");
  }

  const listAdapters = options?.listAdapters ?? siteListAdapters;
  const adapters = await listAdapters();
  const matchedAdapterName = resolveMatchedAdapterName({
    host,
    adapters,
    extraHosts: adapterMatch.hostAliases ?? [],
    requiredCapabilities: readRequiredCapabilities(skill),
  });

  if (matchedAdapterName) {
    return {
      adapterName: matchedAdapterName,
      args,
    };
  }

  if (fallbackAdapterName) {
    return {
      adapterName: fallbackAdapterName,
      args,
    };
  }

  const siteLabel = resolveSkillSiteLabel(skill);
  if (siteLabel) {
    throw new Error(`当前没有找到可处理该 ${siteLabel} 链接的站点适配器。`);
  }
  throw new Error("当前没有找到可处理该链接的站点适配器。");
}

export function buildServiceSkillClawLaunchContext(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
  options?: {
    adapterName?: string | null;
    contentId?: string | null;
    projectId?: string | null;
    launchReadiness?: SiteAdapterLaunchReadinessResult | null;
  },
): ServiceSkillClawLaunchContext {
  if (!isServiceSkillSiteCapabilityBound(skill)) {
    throw new Error("当前技能未绑定站点执行能力");
  }

  const binding = skill.siteCapabilityBinding;
  const adapterName =
    normalizeNaturalText(options?.adapterName) ??
    normalizeNaturalText(binding.adapterName);
  if (!adapterName) {
    throw new Error("当前技能未解析出可用的站点适配器");
  }
  const launchReadiness = options?.launchReadiness
    ? {
        status: options.launchReadiness.status,
        profileKey: options.launchReadiness.profile_key?.trim() || undefined,
        targetId: options.launchReadiness.target_id?.trim() || undefined,
        domain: options.launchReadiness.domain,
        message: options.launchReadiness.message,
        reportHint: options.launchReadiness.report_hint?.trim() || undefined,
      }
    : undefined;

  return {
    kind: "site_adapter",
    skillId: skill.id,
    skillTitle: skill.title,
    adapterName,
    isExportStyle: isExportStyleSiteSkill(skill),
    args: buildServiceSkillSiteCapabilityArgs(skill, slotValues),
    saveMode: binding.saveMode ?? "project_resource",
    saveTitle: buildServiceSkillSiteCapabilitySaveTitle(skill, slotValues, {
      adapterName,
    }),
    contentId: options?.contentId?.trim() || undefined,
    projectId: options?.projectId?.trim() || undefined,
    launchReadiness,
  };
}

function buildServiceSkillFollowupTranslationRequest(
  context: ServiceSkillClawLaunchContext,
): ServiceSkillFollowupTranslationRequest | null {
  if (!context.isExportStyle) {
    return null;
  }

  const targetLanguage = readStringArg(context.args, "target_language");
  if (!targetLanguage) {
    return null;
  }

  return {
    prompt: `请读取本轮刚导出的 Markdown 文件，并将正文翻译成${quoteNaturalValue(
      targetLanguage,
    )}，保留 Markdown 结构、代码块原文、图片链接和相对路径，再回写到原文件。`,
    raw_text: `${context.skillTitle}：导出后将 Markdown 正文翻译成${targetLanguage}并回写原文件`,
    target_language: targetLanguage,
    ...(context.projectId ? { project_id: context.projectId } : {}),
    ...(context.contentId ? { content_id: context.contentId } : {}),
    entry_source: SITE_EXPORT_TRANSLATION_FOLLOWUP_ENTRY_SOURCE,
  };
}

export function buildServiceSkillClawLaunchRequestMetadata(
  context: ServiceSkillClawLaunchContext,
): Record<string, unknown> {
  const followupTranslationRequest =
    buildServiceSkillFollowupTranslationRequest(context);
  const readyLaunchReadiness = isSiteLaunchReadinessReady(
    context.launchReadiness,
  )
    ? context.launchReadiness
    : undefined;
  const attachedProfileKey =
    readyLaunchReadiness?.profileKey?.trim() || undefined;
  const browserRequirementReason =
    context.launchReadiness?.message ||
    "当前任务要求优先复用已连接的浏览器上下文执行站点技能，不应回退到 WebSearch。";

  return {
    harness: {
      browser_requirement: "required",
      browser_requirement_reason: browserRequirementReason,
      ...(followupTranslationRequest
        ? {
            allow_model_skills: true,
            translation_skill_launch: {
              skill_name: "translation",
              kind: "translation_request",
              translation_request: followupTranslationRequest,
            },
          }
        : {}),
      ...(attachedProfileKey
        ? {
            browser_assist: {
              enabled: true,
              profile_key: attachedProfileKey,
              preferred_backend: "lime_extension_bridge",
              auto_launch: false,
              stream_mode: "both",
            },
          }
        : {}),
      service_skill_launch: {
        kind: context.kind,
        skill_id: context.skillId,
        skill_title: context.skillTitle,
        adapter_name: context.adapterName,
        args: context.args,
        save_mode: context.saveMode,
        save_title: context.saveTitle,
        content_id: context.contentId,
        project_id: context.projectId,
        launch_readiness: context.launchReadiness
          ? {
              status: context.launchReadiness.status,
              profile_key: context.launchReadiness.profileKey,
              target_id: context.launchReadiness.targetId,
              domain: context.launchReadiness.domain,
              message: context.launchReadiness.message,
              report_hint: context.launchReadiness.reportHint,
            }
          : undefined,
      },
    },
  };
}

export function composeServiceSkillClawLaunchPrompt(input: {
  skill: ServiceSkillItem;
  slotValues: ServiceSkillSlotValues;
  context: ServiceSkillClawLaunchContext;
  userInput?: string;
}): string {
  const { skill, slotValues, context, userInput } = input;
  void context;
  return buildServiceSkillNaturalLaunchMessage({
    skill,
    slotValues,
    userInput,
  });
}

function normalizeTemplateSegment(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized;
}

export function buildServiceSkillSiteCapabilitySaveTitle(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
  options?: {
    adapterName?: string | null;
  },
): string | undefined {
  if (
    !isServiceSkillSiteCapabilityBound(skill) ||
    !skill.siteCapabilityBinding.suggestedTitleTemplate
  ) {
    return undefined;
  }

  const slotValueMap = Object.fromEntries(
    skill.slotSchema.map((slot) => [
      slot.key,
      resolveServiceSkillSlotValue(slot, slotValues),
    ]),
  );
  const template = skill.siteCapabilityBinding.suggestedTitleTemplate;
  const rendered = template
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, rawToken: string) => {
      switch (rawToken) {
        case "skill.title":
          return normalizeTemplateSegment(skill.title);
        case "adapter.name":
          return normalizeTemplateSegment(
            options?.adapterName ??
              skill.siteCapabilityBinding.adapterName ??
              skill.siteCapabilityBinding.siteLabel,
          );
        default:
          return normalizeTemplateSegment(slotValueMap[rawToken]);
      }
    })
    .replace(/\s+/g, " ")
    .trim();

  return rendered || undefined;
}
