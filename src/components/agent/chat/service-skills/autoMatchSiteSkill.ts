import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import { validateServiceSkillSlotValues } from "./promptComposer";
import { isServiceSkillExecutableAsSiteAdapter } from "./siteCapabilityBinding";
import type { ServiceSkillSlotValues } from "./types";

export interface AutoMatchedSiteSkill<
  T extends ServiceSkillItem = ServiceSkillItem,
> {
  skill: T;
  slotValues: ServiceSkillSlotValues;
  launchUserInput?: string;
}

interface AdapterMatchResult {
  adapterName: string;
  args?: Record<string, string>;
  launchUserInput?: string;
}

interface SearchAdapterMatcherConfig {
  adapterName: string;
  siteKeywords: string[];
  actionKeywords: string[];
  objectKeywords?: string[];
}

interface KeywordAdapterMatcherConfig {
  adapterName: string;
  siteKeywords: string[];
  triggerKeywords: string[];
}

const SEARCH_ACTION_KEYWORDS = [
  "查一下",
  "查下",
  "查查",
  "查找",
  "查",
  "找一下",
  "找下",
  "找找",
  "找",
  "搜一下",
  "搜下",
  "搜搜",
  "搜",
  "搜索",
  "检索",
  "看一下",
  "看看",
  "看下",
  "看",
];

const GITHUB_ISSUE_KEYWORDS = ["issue", "issues", "问题单", "工单"];

const SEARCH_ADAPTER_MATCHERS: SearchAdapterMatcherConfig[] = [
  {
    adapterName: "github/search",
    siteKeywords: ["github", "git hub", "git-hub"],
    actionKeywords: SEARCH_ACTION_KEYWORDS,
    objectKeywords: [
      "项目",
      "仓库",
      "repo",
      "repos",
      "repository",
      "repositories",
    ],
  },
  {
    adapterName: "bilibili/search",
    siteKeywords: ["b站", "bilibili", "哔哩哔哩"],
    actionKeywords: SEARCH_ACTION_KEYWORDS,
    objectKeywords: ["视频", "内容"],
  },
  {
    adapterName: "zhihu/search",
    siteKeywords: ["知乎", "zhihu"],
    actionKeywords: SEARCH_ACTION_KEYWORDS,
    objectKeywords: ["问题", "回答", "文章", "内容"],
  },
  {
    adapterName: "smzdm/search",
    siteKeywords: ["什么值得买", "smzdm"],
    actionKeywords: SEARCH_ACTION_KEYWORDS,
    objectKeywords: ["商品", "优惠", "好价", "线索", "内容"],
  },
];

const KEYWORD_ADAPTER_MATCHERS: KeywordAdapterMatcherConfig[] = [
  {
    adapterName: "zhihu/hot",
    siteKeywords: ["知乎", "zhihu"],
    triggerKeywords: ["热榜", "热搜", "热门"],
  },
  {
    adapterName: "36kr/newsflash",
    siteKeywords: ["36kr", "36氪"],
    triggerKeywords: ["快讯", "最新快讯", "新闻快讯"],
  },
  {
    adapterName: "linux-do/categories",
    siteKeywords: ["linux.do", "linux-do", "linux do"],
    triggerKeywords: ["分类", "版块", "节点"],
  },
  {
    adapterName: "linux-do/hot",
    siteKeywords: ["linux.do", "linux-do", "linux do"],
    triggerKeywords: ["热门", "热门话题", "热帖", "热榜"],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegex(keywords: string[]): RegExp {
  return new RegExp(keywords.map(escapeRegExp).join("|"), "iu");
}

function normalizeAdapterName(adapterName?: string | null): string {
  return adapterName?.trim().toLowerCase() || "";
}

function normalizeInputText(inputText: string): string {
  return inputText.trim().replace(/\s+/g, " ");
}

function splitCoreAndSupplement(value: string): {
  core: string;
  launchUserInput?: string;
} {
  const normalized = normalizeInputText(value);
  const separatorMatch = /[，；。！？]|,\s+|;\s+/u.exec(normalized);
  if (!separatorMatch || separatorMatch.index < 0) {
    return {
      core: normalized,
    };
  }

  const separatorIndex = separatorMatch.index;
  const separatorLength = separatorMatch[0].length;
  const core = normalized.slice(0, separatorIndex).trim();
  const launchUserInput = normalized
    .slice(separatorIndex + separatorLength)
    .trim();

  return {
    core,
    launchUserInput: launchUserInput || undefined,
  };
}

function cleanupQueryFragment(value: string): string {
  let next = value.trim();
  const cleanupPatterns = [
    /^(?:请|请帮我|帮我|麻烦|劳烦|帮忙|想|想要|我要|我想|我想要)\s*/iu,
    /^(?:在|用|使用|去|到|给我|帮我)\s*/iu,
    /^(?:查一下|查下|查找|查|找一下|找下|找找|找|搜一下|搜下|搜搜|搜|搜索|检索|看一下|看下|看看|看)\s*/iu,
    /^(?:有没有|有无|一些|一些和|一些关于|几个|哪些|有哪些|一下)\s*/iu,
    /^(?:和|与|关于|有关(?:的)?|相关(?:的)?|主题是|主题为|主题|的)\s*/iu,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of cleanupPatterns) {
      const updated = next.replace(pattern, "").trim();
      if (updated !== next) {
        next = updated;
        changed = true;
      }
    }
  }

  next = next
    .replace(/\s*(?:相关(?:的)?|有关(?:的)?|的)\s*$/iu, "")
    .replace(/^[“"'`]+|[”"'`]+$/gu, "")
    .trim();

  return next;
}

function trimTrailingKeywords(value: string, keywords: string[]): string {
  if (keywords.length === 0) {
    return value.trim();
  }

  const keywordPattern = new RegExp(
    `(?:\\s*(?:相关(?:的)?|有关(?:的)?|的)?\\s*(?:${keywords
      .map(escapeRegExp)
      .join("|")}))\\s*$`,
    "iu",
  );

  let next = value.trim();
  while (keywordPattern.test(next)) {
    next = next.replace(keywordPattern, "").trim();
  }

  return next;
}

function stripLeadingSiteContext(value: string): string {
  let next = value.trim();
  const patterns = [
    /^(?:上|上面|里|中|里面|网站上|平台上)\s*/iu,
    /^(?:的)\s*/iu,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const updated = next.replace(pattern, "").trim();
      if (updated !== next) {
        next = updated;
        changed = true;
      }
    }
  }

  return next;
}

function extractQueryAndSupplement(
  value: string,
  trailingKeywords: string[],
): { query: string; launchUserInput?: string } | null {
  const { core, launchUserInput } = splitCoreAndSupplement(value);
  const query = cleanupQueryFragment(
    trimTrailingKeywords(core, trailingKeywords),
  );
  if (!query) {
    return null;
  }

  return {
    query,
    launchUserInput,
  };
}

function matchSearchAdapter(
  inputText: string,
  config: SearchAdapterMatcherConfig,
): AdapterMatchResult | null {
  const normalized = normalizeInputText(inputText);
  if (!normalized) {
    return null;
  }

  const siteMatch = buildKeywordRegex(config.siteKeywords).exec(normalized);
  if (!siteMatch || siteMatch.index < 0) {
    return null;
  }

  const beforeSite = normalized.slice(0, siteMatch.index).trim();
  const afterSite = stripLeadingSiteContext(
    normalized.slice(siteMatch.index + siteMatch[0].length),
  );
  const actionRegex = buildKeywordRegex(config.actionKeywords);

  const actionMatchAfterSite = actionRegex.exec(afterSite);
  if (actionMatchAfterSite && actionMatchAfterSite.index >= 0) {
    const parsed = extractQueryAndSupplement(
      afterSite.slice(
        actionMatchAfterSite.index + actionMatchAfterSite[0].length,
      ),
      config.objectKeywords ?? [],
    );
    if (parsed) {
      return {
        adapterName: config.adapterName,
        args: {
          query: parsed.query,
        },
        launchUserInput: parsed.launchUserInput,
      };
    }
  }

  if (!actionRegex.test(beforeSite)) {
    return null;
  }

  const parsed = extractQueryAndSupplement(
    afterSite,
    config.objectKeywords ?? [],
  );
  if (!parsed) {
    return null;
  }

  return {
    adapterName: config.adapterName,
    args: {
      query: parsed.query,
    },
    launchUserInput: parsed.launchUserInput,
  };
}

function matchKeywordAdapter(
  inputText: string,
  config: KeywordAdapterMatcherConfig,
): AdapterMatchResult | null {
  const normalized = normalizeInputText(inputText);
  if (!normalized) {
    return null;
  }

  if (!buildKeywordRegex(config.siteKeywords).test(normalized)) {
    return null;
  }
  if (!buildKeywordRegex(config.triggerKeywords).test(normalized)) {
    return null;
  }

  return {
    adapterName: config.adapterName,
  };
}

function matchYahooFinanceQuote(inputText: string): AdapterMatchResult | null {
  const normalized = normalizeInputText(inputText);
  if (!normalized) {
    return null;
  }

  const siteMatch = /(?:yahoo finance|yahoo-finance|雅虎财经)/iu.exec(
    normalized,
  );
  if (!siteMatch || siteMatch.index < 0) {
    return null;
  }

  if (!/(?:行情|股价|报价|quote|ticker)/iu.test(normalized)) {
    return null;
  }

  const afterSite = normalized
    .slice(siteMatch.index + siteMatch[0].length)
    .trim();
  const symbolMatch = /\b([A-Za-z][A-Za-z0-9.-]{0,9})\b/u.exec(afterSite);
  if (!symbolMatch?.[1]) {
    return null;
  }

  return {
    adapterName: "yahoo-finance/quote",
    args: {
      symbol: symbolMatch[1].toUpperCase(),
    },
  };
}

function isGithubIssuesIntent(inputText: string): boolean {
  return (
    /(?:github|git hub|git-hub)/iu.test(inputText) &&
    buildKeywordRegex(GITHUB_ISSUE_KEYWORDS).test(inputText)
  );
}

function detectGithubIssuesState(
  value: string,
): "open" | "closed" | "all" | undefined {
  if (/(?:\ball\b|全部|所有)/iu.test(value)) {
    return "all";
  }
  if (/(?:\bclosed?\b|已关闭|关闭的?)/iu.test(value)) {
    return "closed";
  }
  if (/(?:\bopen\b|开启中?|打开的?|未关闭)/iu.test(value)) {
    return "open";
  }
  return undefined;
}

function stripGithubIssuesState(value: string): string {
  return value
    .replace(
      /(?:\ball\b|\bclosed?\b|\bopen\b|全部|所有|已关闭|关闭的?|开启中?|打开的?|未关闭)/giu,
      " ",
    )
    .trim();
}

function stripLeadingGithubIssueContext(value: string): string {
  let next = stripLeadingSiteContext(value);
  const patterns = [
    /^(?:仓库|repo|repository)\s*/iu,
    /^(?:的|里|中|里面)\s*/iu,
    /^(?:issue|issues)\b\s*/iu,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const updated = next.replace(pattern, "").trim();
      if (updated !== next) {
        next = updated;
        changed = true;
      }
    }
  }

  return next;
}

function matchGithubIssuesAdapter(
  inputText: string,
): AdapterMatchResult | null {
  const normalized = normalizeInputText(inputText);
  if (!normalized || !isGithubIssuesIntent(normalized)) {
    return null;
  }

  const repoMatch = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/u.exec(normalized);
  if (!repoMatch?.[1]) {
    return null;
  }

  const state =
    detectGithubIssuesState(normalized.slice(0, repoMatch.index)) ??
    detectGithubIssuesState(
      normalized.slice(repoMatch.index + repoMatch[0].length),
    );
  const tail = normalized.slice(repoMatch.index + repoMatch[0].length);
  const { core, launchUserInput } = splitCoreAndSupplement(tail);
  const querySource = trimTrailingKeywords(
    stripGithubIssuesState(stripLeadingGithubIssueContext(core)),
    GITHUB_ISSUE_KEYWORDS,
  );
  const query = cleanupQueryFragment(querySource) || undefined;

  return {
    adapterName: "github/issues",
    args: {
      repo: repoMatch[1],
      ...(query ? { query } : {}),
      ...(state ? { state } : {}),
    },
    launchUserInput,
  };
}

function resolveAdapterMatch(inputText: string): AdapterMatchResult | null {
  if (isGithubIssuesIntent(inputText)) {
    return matchGithubIssuesAdapter(inputText);
  }

  for (const config of SEARCH_ADAPTER_MATCHERS) {
    const match = matchSearchAdapter(inputText, config);
    if (match) {
      return match;
    }
  }

  for (const config of KEYWORD_ADAPTER_MATCHERS) {
    const match = matchKeywordAdapter(inputText, config);
    if (match) {
      return match;
    }
  }

  return matchYahooFinanceQuote(inputText);
}

function buildSlotValuesFromArgs(
  skill: ServiceSkillItem,
  args: Record<string, string>,
): ServiceSkillSlotValues {
  if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
    return {};
  }

  return skill.slotSchema.reduce<ServiceSkillSlotValues>((acc, slot) => {
    const argName = skill.siteCapabilityBinding.slotArgMap?.[slot.key];
    if (!argName) {
      return acc;
    }

    const value = args[argName]?.trim();
    if (!value) {
      return acc;
    }

    acc[slot.key] = value;
    return acc;
  }, {});
}

export function matchAutoLaunchSiteSkillFromText<
  T extends ServiceSkillItem,
>(input: {
  inputText: string;
  serviceSkills: T[];
}): AutoMatchedSiteSkill<T> | null {
  const normalized = normalizeInputText(input.inputText);
  if (!normalized) {
    return null;
  }

  const adapterMatch = resolveAdapterMatch(normalized);
  if (!adapterMatch) {
    return null;
  }

  const matchedSkill =
    input.serviceSkills.find((skill) => {
      if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
        return false;
      }
      return (
        normalizeAdapterName(skill.siteCapabilityBinding.adapterName) ===
        normalizeAdapterName(adapterMatch.adapterName)
      );
    }) ?? null;
  if (!matchedSkill) {
    return null;
  }

  const slotValues = buildSlotValuesFromArgs(
    matchedSkill,
    adapterMatch.args ?? {},
  );
  if (!validateServiceSkillSlotValues(matchedSkill, slotValues).valid) {
    return null;
  }

  return {
    skill: matchedSkill,
    slotValues,
    launchUserInput: adapterMatch.launchUserInput,
  };
}
