import type { Config, MultiSearchEngineEntryConfig } from "@/lib/api/appConfig";

export type SearchEngine = NonNullable<Config["web_search"]>["engine"];
export type WebSearchProvider = NonNullable<
  NonNullable<Config["web_search"]>["provider"]
>;
type MultiSearchEngineOption = MultiSearchEngineEntryConfig;

const DEFAULT_MSE_ENGINES: MultiSearchEngineOption[] = [
  {
    name: "google",
    url_template: "https://www.google.com/search?q={query}",
    enabled: true,
  },
  {
    name: "bing",
    url_template: "https://www.bing.com/search?q={query}",
    enabled: true,
  },
  {
    name: "duckduckgo",
    url_template: "https://duckduckgo.com/?q={query}",
    enabled: true,
  },
  {
    name: "yahoo",
    url_template: "https://search.yahoo.com/search?p={query}",
    enabled: true,
  },
  {
    name: "baidu",
    url_template: "https://www.baidu.com/s?wd={query}",
    enabled: true,
  },
  {
    name: "yandex",
    url_template: "https://yandex.com/search/?text={query}",
    enabled: true,
  },
  {
    name: "ecosia",
    url_template: "https://www.ecosia.org/search?q={query}",
    enabled: true,
  },
  {
    name: "brave",
    url_template: "https://search.brave.com/search?q={query}",
    enabled: true,
  },
  {
    name: "startpage",
    url_template: "https://www.startpage.com/do/search?query={query}",
    enabled: true,
  },
  {
    name: "qwant",
    url_template: "https://www.qwant.com/?q={query}&t=web",
    enabled: true,
  },
  {
    name: "sogou",
    url_template: "https://www.sogou.com/web?query={query}",
    enabled: true,
  },
  {
    name: "so360",
    url_template: "https://www.so.com/s?q={query}",
    enabled: true,
  },
  {
    name: "aol",
    url_template: "https://search.aol.com/aol/search?q={query}",
    enabled: true,
  },
  {
    name: "ask",
    url_template: "https://www.ask.com/web?q={query}",
    enabled: true,
  },
  {
    name: "naver",
    url_template: "https://search.naver.com/search.naver?query={query}",
    enabled: true,
  },
  {
    name: "seznam",
    url_template: "https://search.seznam.cz/?q={query}",
    enabled: true,
  },
  {
    name: "dogpile",
    url_template: "https://www.dogpile.com/serp?q={query}",
    enabled: true,
  },
  {
    // You.com 搜索 API（JSON）。默认关闭；未设置 YDC_API_KEY 时走免密钥端点（每个 IP 每天 100 次）。
    name: "youcom",
    url_template: "https://api.you.com/v1/agents/search?query={query}",
    enabled: false,
  },
];

const DEFAULT_MSE_ENGINE_NAMES = new Set(
  DEFAULT_MSE_ENGINES.map((item) => item.name),
);
const ALL_PROVIDERS: WebSearchProvider[] = [
  "tavily",
  "multi_search_engine",
  "duckduckgo_instant",
  "bing_search_api",
  "google_custom_search",
];

export function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isWebSearchProvider(value: string): value is WebSearchProvider {
  return ALL_PROVIDERS.includes(value as WebSearchProvider);
}

function parseBoundedInt(
  value: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

export interface WebSearchDraft {
  engine: SearchEngine;
  provider: WebSearchProvider;
  providerPriority: string;
  tavilyApiKey: string;
  bingSearchApiKey: string;
  googleSearchApiKey: string;
  googleSearchEngineId: string;
  msePriority: string;
  mseMaxResultsPerEngine: string;
  mseMaxTotalResults: string;
  mseTimeoutMs: string;
  mseCustomEngineName: string;
  mseCustomEngineTemplate: string;
  pexelsApiKey: string;
  pixabayApiKey: string;
}

export interface WebSearchFormProps {
  draft: WebSearchDraft;
  change: <K extends keyof WebSearchDraft>(
    key: K,
    value: WebSearchDraft[K],
  ) => void;
}

export function readWebSearchDraft(config?: Config): WebSearchDraft {
  const search = config?.web_search;
  const multi = search?.multi_search;
  const custom = multi?.engines?.find(
    (engine) => !DEFAULT_MSE_ENGINE_NAMES.has(engine.name),
  );
  return {
    engine: search?.engine ?? "google",
    provider: search?.provider ?? "duckduckgo_instant",
    providerPriority: (search?.provider_priority ?? []).join(", "),
    tavilyApiKey: search?.tavily_api_key ?? "",
    bingSearchApiKey: search?.bing_search_api_key ?? "",
    googleSearchApiKey: search?.google_search_api_key ?? "",
    googleSearchEngineId: search?.google_search_engine_id ?? "",
    msePriority: (multi?.priority ?? []).join(", "),
    mseMaxResultsPerEngine: String(multi?.max_results_per_engine ?? 5),
    mseMaxTotalResults: String(multi?.max_total_results ?? 20),
    mseTimeoutMs: String(multi?.timeout_ms ?? 4000),
    mseCustomEngineName: custom?.name ?? "",
    mseCustomEngineTemplate: custom?.url_template ?? "",
    pexelsApiKey: config?.image_gen?.image_search_pexels_api_key ?? "",
    pixabayApiKey: config?.image_gen?.image_search_pixabay_api_key ?? "",
  };
}

export function hasInvalidCustomEngine(draft: WebSearchDraft) {
  const name = draft.mseCustomEngineName.trim();
  const template = draft.mseCustomEngineTemplate.trim();
  return Boolean(name || template) && (!name || !template.includes("{query}"));
}

export function mergeWebSearchDraft(
  current: Config,
  draft: WebSearchDraft,
  snapshot: WebSearchDraft,
): Config {
  const search = {
    ...current.web_search,
    engine: current.web_search?.engine ?? "google",
  };
  const multi = { ...search.multi_search };
  const image = { ...current.image_gen };
  const changed = (key: keyof WebSearchDraft) => draft[key] !== snapshot[key];
  let searchChanged = false;
  let multiChanged = false;
  let imageChanged = false;
  if (changed("engine")) {
    search.engine = draft.engine;
    searchChanged = true;
  }
  if (changed("provider")) {
    search.provider = draft.provider;
    searchChanged = true;
  }
  if (changed("providerPriority")) {
    search.provider_priority = parseCsv(draft.providerPriority).filter(
      isWebSearchProvider,
    );
    searchChanged = true;
  }
  for (const [field, key] of [
    ["tavilyApiKey", "tavily_api_key"],
    ["bingSearchApiKey", "bing_search_api_key"],
    ["googleSearchApiKey", "google_search_api_key"],
    ["googleSearchEngineId", "google_search_engine_id"],
  ] as const) {
    if (changed(field)) {
      search[key] = draft[field].trim() || null;
      searchChanged = true;
    }
  }
  if (changed("msePriority")) {
    multi.priority = parseCsv(draft.msePriority);
    multiChanged = true;
  }
  for (const [field, key, min, max, fallback] of [
    ["mseMaxResultsPerEngine", "max_results_per_engine", 1, 20, 5],
    ["mseMaxTotalResults", "max_total_results", 1, 100, 20],
    ["mseTimeoutMs", "timeout_ms", 500, 15000, 4000],
  ] as const) {
    if (changed(field)) {
      multi[key] = parseBoundedInt(draft[field], min, max, fallback);
      multiChanged = true;
    }
  }
  if (changed("mseCustomEngineName") || changed("mseCustomEngineTemplate")) {
    // The form edits one custom entry; the other current entries stay owned by config.
    const engines = (multi.engines ?? DEFAULT_MSE_ENGINES).map((engine) => ({
      ...engine,
    }));
    const index = engines.findIndex(
      (engine) =>
        engine.name === snapshot.mseCustomEngineName &&
        !DEFAULT_MSE_ENGINE_NAMES.has(engine.name),
    );
    const name = draft.mseCustomEngineName.trim();
    const template = draft.mseCustomEngineTemplate.trim();
    if (name && template.includes("{query}")) {
      if (
        engines.some(
          (engine, position) => position !== index && engine.name === name,
        )
      ) {
        throw new Error("Search engine name already exists");
      }
      const entry = {
        name,
        url_template: template,
        enabled: index >= 0 ? engines[index].enabled : true,
      };
      if (index >= 0) engines[index] = entry;
      else engines.push(entry);
    } else if (!name && !template && index >= 0) engines.splice(index, 1);
    multi.engines = engines;
    multiChanged = true;
  }
  if (multiChanged) {
    search.multi_search = multi;
    searchChanged = true;
  }
  for (const [field, key] of [
    ["pexelsApiKey", "image_search_pexels_api_key"],
    ["pixabayApiKey", "image_search_pixabay_api_key"],
  ] as const) {
    if (changed(field)) {
      image[key] = draft[field].trim();
      imageChanged = true;
    }
  }
  return {
    ...current,
    ...(searchChanged ? { web_search: search } : {}),
    ...(imageChanged ? { image_gen: image } : {}),
  };
}
