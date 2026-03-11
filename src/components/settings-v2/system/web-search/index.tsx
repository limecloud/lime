import { useEffect, useMemo, useState } from "react";
import { Globe, Image as ImageIcon, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";

type SearchEngine = "google" | "xiaohongshu";
type WebSearchProvider =
  | "tavily"
  | "multi_search_engine"
  | "duckduckgo_instant"
  | "bing_search_api"
  | "google_custom_search";

type MultiSearchEngineOption = {
  name: string;
  url_template: string;
  enabled: boolean;
};

const PEXELS_APPLY_URL = "https://www.pexels.com/api/new/";
const PEXELS_DOC_URL = "https://www.pexels.com/api/";
const PIXABAY_APPLY_URL = "https://pixabay.com/accounts/register/";
const PIXABAY_DOC_URL = "https://pixabay.com/api/docs/";
const TAVILY_APPLY_URL = "https://app.tavily.com/";
const TAVILY_DOC_URL = "https://docs.tavily.com/";
const MSE_DOC_URL =
  "https://openclaw.ai/blog/openclaw-multi-search-engine-enhanced";
const BING_SEARCH_APPLY_URL =
  "https://portal.azure.com/#create/Microsoft.CognitiveServicesBingSearch-v7";
const BING_SEARCH_DOC_URL =
  "https://learn.microsoft.com/zh-cn/bing/search-apis/bing-web-search/overview";
const GOOGLE_SEARCH_API_APPLY_URL =
  "https://console.cloud.google.com/apis/library/customsearch.googleapis.com";
const GOOGLE_SEARCH_DOC_URL =
  "https://developers.google.com/custom-search/v1/overview";
const GOOGLE_SEARCH_CSE_URL = "https://programmablesearchengine.google.com/";

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

function parseCsv(input: string): string[] {
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

export function WebSearchSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [draftEngine, setDraftEngine] = useState<SearchEngine>("google");
  const [draftProvider, setDraftProvider] =
    useState<WebSearchProvider>("duckduckgo_instant");
  const [draftProviderPriority, setDraftProviderPriority] = useState("");
  const [draftTavilyApiKey, setDraftTavilyApiKey] = useState("");
  const [draftBingSearchApiKey, setDraftBingSearchApiKey] = useState("");
  const [draftGoogleSearchApiKey, setDraftGoogleSearchApiKey] = useState("");
  const [draftGoogleSearchEngineId, setDraftGoogleSearchEngineId] =
    useState("");
  const [draftMsePriority, setDraftMsePriority] = useState("");
  const [draftMseMaxResultsPerEngine, setDraftMseMaxResultsPerEngine] =
    useState("5");
  const [draftMseMaxTotalResults, setDraftMseMaxTotalResults] = useState("20");
  const [draftMseTimeoutMs, setDraftMseTimeoutMs] = useState("4000");
  const [draftMseCustomEngineName, setDraftMseCustomEngineName] = useState("");
  const [draftMseCustomEngineTemplate, setDraftMseCustomEngineTemplate] =
    useState("");
  const [draftPexelsApiKey, setDraftPexelsApiKey] = useState("");
  const [draftPixabayApiKey, setDraftPixabayApiKey] = useState("");
  const [showTavilyApiKey, setShowTavilyApiKey] = useState(false);
  const [showBingSearchApiKey, setShowBingSearchApiKey] = useState(false);
  const [showGoogleSearchApiKey, setShowGoogleSearchApiKey] = useState(false);
  const [showPexelsApiKey, setShowPexelsApiKey] = useState(false);
  const [showPixabayApiKey, setShowPixabayApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const nextConfig = await getConfig();
      const engine = (nextConfig.web_search?.engine ||
        "google") as SearchEngine;
      const provider = (nextConfig.web_search?.provider ||
        "duckduckgo_instant") as WebSearchProvider;
      const providerPriority = (
        nextConfig.web_search?.provider_priority || []
      ).join(", ");
      const tavilyApiKey = nextConfig.web_search?.tavily_api_key || "";
      const bingSearchApiKey = nextConfig.web_search?.bing_search_api_key || "";
      const googleSearchApiKey =
        nextConfig.web_search?.google_search_api_key || "";
      const googleSearchEngineId =
        nextConfig.web_search?.google_search_engine_id || "";
      const multiSearch = nextConfig.web_search?.multi_search;
      const msePriority = (multiSearch?.priority || []).join(", ");
      const mseMaxResultsPerEngine = String(
        multiSearch?.max_results_per_engine || 5,
      );
      const mseMaxTotalResults = String(multiSearch?.max_total_results || 20);
      const mseTimeoutMs = String(multiSearch?.timeout_ms || 4000);
      const customEngine = (multiSearch?.engines || []).find(
        (engineItem) => !DEFAULT_MSE_ENGINE_NAMES.has(engineItem.name),
      );
      const pexelsApiKey =
        nextConfig.image_gen?.image_search_pexels_api_key || "";
      const pixabayApiKey =
        nextConfig.image_gen?.image_search_pixabay_api_key || "";

      setConfig(nextConfig);
      setDraftEngine(engine);
      setDraftProvider(provider);
      setDraftProviderPriority(providerPriority);
      setDraftTavilyApiKey(tavilyApiKey);
      setDraftBingSearchApiKey(bingSearchApiKey);
      setDraftGoogleSearchApiKey(googleSearchApiKey);
      setDraftGoogleSearchEngineId(googleSearchEngineId);
      setDraftMsePriority(msePriority);
      setDraftMseMaxResultsPerEngine(mseMaxResultsPerEngine);
      setDraftMseMaxTotalResults(mseMaxTotalResults);
      setDraftMseTimeoutMs(mseTimeoutMs);
      setDraftMseCustomEngineName(customEngine?.name || "");
      setDraftMseCustomEngineTemplate(customEngine?.url_template || "");
      setDraftPexelsApiKey(pexelsApiKey);
      setDraftPixabayApiKey(pixabayApiKey);
    } catch (error) {
      console.error("加载网络搜索配置失败:", error);
      setMessage({
        type: "error",
        text: `加载配置失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const currentEngine = useMemo(
    () => (config?.web_search?.engine || "google") as SearchEngine,
    [config],
  );
  const currentProvider = useMemo(
    () =>
      (config?.web_search?.provider ||
        "duckduckgo_instant") as WebSearchProvider,
    [config],
  );
  const currentProviderPriority = useMemo(
    () => (config?.web_search?.provider_priority || []).join(", "),
    [config],
  );
  const currentTavilyApiKey = useMemo(
    () => config?.web_search?.tavily_api_key || "",
    [config],
  );
  const currentBingSearchApiKey = useMemo(
    () => config?.web_search?.bing_search_api_key || "",
    [config],
  );
  const currentGoogleSearchApiKey = useMemo(
    () => config?.web_search?.google_search_api_key || "",
    [config],
  );
  const currentGoogleSearchEngineId = useMemo(
    () => config?.web_search?.google_search_engine_id || "",
    [config],
  );
  const currentMsePriority = useMemo(
    () => (config?.web_search?.multi_search?.priority || []).join(", "),
    [config],
  );
  const currentMseMaxResultsPerEngine = useMemo(
    () => String(config?.web_search?.multi_search?.max_results_per_engine || 5),
    [config],
  );
  const currentMseMaxTotalResults = useMemo(
    () => String(config?.web_search?.multi_search?.max_total_results || 20),
    [config],
  );
  const currentMseTimeoutMs = useMemo(
    () => String(config?.web_search?.multi_search?.timeout_ms || 4000),
    [config],
  );
  const currentMseCustomEngine = useMemo(
    () =>
      (config?.web_search?.multi_search?.engines || []).find(
        (engineItem) => !DEFAULT_MSE_ENGINE_NAMES.has(engineItem.name),
      ) || null,
    [config],
  );
  const currentPexelsApiKey = useMemo(
    () => config?.image_gen?.image_search_pexels_api_key || "",
    [config],
  );
  const currentPixabayApiKey = useMemo(
    () => config?.image_gen?.image_search_pixabay_api_key || "",
    [config],
  );

  const hasUnsavedChanges =
    draftEngine !== currentEngine ||
    draftProvider !== currentProvider ||
    draftProviderPriority.trim() !== currentProviderPriority ||
    draftTavilyApiKey.trim() !== currentTavilyApiKey ||
    draftBingSearchApiKey.trim() !== currentBingSearchApiKey ||
    draftGoogleSearchApiKey.trim() !== currentGoogleSearchApiKey ||
    draftGoogleSearchEngineId.trim() !== currentGoogleSearchEngineId ||
    draftMsePriority.trim() !== currentMsePriority ||
    draftMseMaxResultsPerEngine.trim() !== currentMseMaxResultsPerEngine ||
    draftMseMaxTotalResults.trim() !== currentMseMaxTotalResults ||
    draftMseTimeoutMs.trim() !== currentMseTimeoutMs ||
    draftMseCustomEngineName.trim() !== (currentMseCustomEngine?.name || "") ||
    draftMseCustomEngineTemplate.trim() !==
      (currentMseCustomEngine?.url_template || "") ||
    draftPexelsApiKey.trim() !== currentPexelsApiKey ||
    draftPixabayApiKey.trim() !== currentPixabayApiKey;

  const tavilyKeyConfigured = draftTavilyApiKey.trim().length > 0;
  const bingSearchKeyConfigured = draftBingSearchApiKey.trim().length > 0;
  const googleSearchKeyConfigured = draftGoogleSearchApiKey.trim().length > 0;
  const googleSearchEngineConfigured =
    draftGoogleSearchEngineId.trim().length > 0;
  const mseCustomEngineReady =
    draftMseCustomEngineName.trim().length > 0 &&
    draftMseCustomEngineTemplate.trim().includes("{query}");
  const pexelsKeyConfigured = draftPexelsApiKey.trim().length > 0;
  const pixabayKeyConfigured = draftPixabayApiKey.trim().length > 0;

  const handleSave = async () => {
    if (!config || !hasUnsavedChanges) return;

    const providerPriority = parseCsv(draftProviderPriority).filter(
      isWebSearchProvider,
    );
    const msePriority = parseCsv(draftMsePriority);
    const customName = draftMseCustomEngineName.trim();
    const customTemplate = draftMseCustomEngineTemplate.trim();

    const mseEngines: MultiSearchEngineOption[] = [...DEFAULT_MSE_ENGINES];
    if (customName && customTemplate.includes("{query}")) {
      mseEngines.push({
        name: customName,
        url_template: customTemplate,
        enabled: true,
      });
    }

    const nextConfig: Config = {
      ...config,
      web_search: {
        engine: draftEngine,
        provider: draftProvider,
        provider_priority: providerPriority,
        tavily_api_key: draftTavilyApiKey.trim() || null,
        bing_search_api_key: draftBingSearchApiKey.trim() || null,
        google_search_api_key: draftGoogleSearchApiKey.trim() || null,
        google_search_engine_id: draftGoogleSearchEngineId.trim() || null,
        multi_search: {
          priority: msePriority,
          engines: mseEngines,
          max_results_per_engine: parseBoundedInt(
            draftMseMaxResultsPerEngine,
            1,
            20,
            5,
          ),
          max_total_results: parseBoundedInt(
            draftMseMaxTotalResults,
            1,
            100,
            20,
          ),
          timeout_ms: parseBoundedInt(draftMseTimeoutMs, 500, 15000, 4000),
        },
      },
      image_gen: {
        ...(config.image_gen || {}),
        image_search_pexels_api_key: draftPexelsApiKey.trim(),
        image_search_pixabay_api_key: draftPixabayApiKey.trim(),
      },
    };

    setSaving(true);
    setMessage(null);
    try {
      await saveConfig(nextConfig);
      setConfig(nextConfig);
      setMessage({ type: "success", text: "网络搜索设置已保存" });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      setMessage({
        type: "error",
        text: `保存失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraftEngine(currentEngine);
    setDraftProvider(currentProvider);
    setDraftProviderPriority(currentProviderPriority);
    setDraftTavilyApiKey(currentTavilyApiKey);
    setDraftBingSearchApiKey(currentBingSearchApiKey);
    setDraftGoogleSearchApiKey(currentGoogleSearchApiKey);
    setDraftGoogleSearchEngineId(currentGoogleSearchEngineId);
    setDraftMsePriority(currentMsePriority);
    setDraftMseMaxResultsPerEngine(currentMseMaxResultsPerEngine);
    setDraftMseMaxTotalResults(currentMseMaxTotalResults);
    setDraftMseTimeoutMs(currentMseTimeoutMs);
    setDraftMseCustomEngineName(currentMseCustomEngine?.name || "");
    setDraftMseCustomEngineTemplate(currentMseCustomEngine?.url_template || "");
    setDraftPexelsApiKey(currentPexelsApiKey);
    setDraftPixabayApiKey(currentPixabayApiKey);
    setMessage(null);
  };

  const openExternalUrl = async (url: string) => {
    try {
      await open(url);
    } catch (error) {
      console.error("打开外部链接失败:", error);
      window.open(url, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl pb-20">
      {message && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.type === "error"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-medium">联网搜索配置</h3>
            <p className="text-xs text-muted-foreground">
              使用策略化回退链路统一管理 Tavily / MSE / Bing / Google /
              DuckDuckGo。
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="web-search-engine" className="text-sm font-medium">
            选择搜索引擎
          </label>
          <select
            id="web-search-engine"
            value={draftEngine}
            onChange={(e) => setDraftEngine(e.target.value as SearchEngine)}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="google">Google</option>
            <option value="xiaohongshu">小红书</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Google 适用于通用搜索，小红书适用于中文生活方式和购物内容。
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="web-search-provider" className="text-sm font-medium">
            首选搜索提供商
          </label>
          <select
            id="web-search-provider"
            value={draftProvider}
            onChange={(e) =>
              setDraftProvider(e.target.value as WebSearchProvider)
            }
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="tavily">Tavily Search API</option>
            <option value="multi_search_engine">
              Multi Search Engine v2.0.1
            </option>
            <option value="duckduckgo_instant">
              DuckDuckGo Instant Answer (免费)
            </option>
            <option value="bing_search_api">Bing Search API</option>
            <option value="google_custom_search">
              Google Custom Search API
            </option>
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="web-search-provider-priority"
            className="text-sm font-medium"
          >
            提供商回退优先级（逗号分隔）
          </label>
          <input
            id="web-search-provider-priority"
            value={draftProviderPriority}
            onChange={(e) => setDraftProviderPriority(e.target.value)}
            placeholder="tavily, multi_search_engine, bing_search_api, google_custom_search, duckduckgo_instant"
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground">
            未填写时会自动使用默认回退链；未知 provider 会被忽略。
          </p>
        </div>

        <div className="h-px bg-border/60" />

        <div className="space-y-2">
          <label
            htmlFor="web-search-tavily-key"
            className="text-sm font-medium"
          >
            Tavily API Key
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(TAVILY_APPLY_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              申请 Tavily Key
            </button>
            <button
              type="button"
              onClick={() => void openExternalUrl(TAVILY_DOC_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              查看文档
            </button>
          </div>
          <div className="relative">
            <input
              id="web-search-tavily-key"
              type={showTavilyApiKey ? "text" : "password"}
              value={draftTavilyApiKey}
              onChange={(e) => setDraftTavilyApiKey(e.target.value)}
              placeholder="输入 TAVILY_API_KEY"
              className="w-full h-10 rounded-md border bg-background px-3 pr-20 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowTavilyApiKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border px-2.5 py-1 text-xs"
            >
              {showTavilyApiKey ? "隐藏" : "显示"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            未填写时会回退环境变量 <code>TAVILY_API_KEY</code>。
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="web-search-bing-key" className="text-sm font-medium">
            Bing Search API Key
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(BING_SEARCH_APPLY_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              申请 Bing Key
            </button>
            <button
              type="button"
              onClick={() => void openExternalUrl(BING_SEARCH_DOC_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              查看文档
            </button>
          </div>
          <div className="relative">
            <input
              id="web-search-bing-key"
              type={showBingSearchApiKey ? "text" : "password"}
              value={draftBingSearchApiKey}
              onChange={(e) => setDraftBingSearchApiKey(e.target.value)}
              placeholder="输入 BING_SEARCH_API_KEY"
              className="w-full h-10 rounded-md border bg-background px-3 pr-20 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowBingSearchApiKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border px-2.5 py-1 text-xs"
            >
              {showBingSearchApiKey ? "隐藏" : "显示"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            未填写时会回退环境变量 <code>BING_SEARCH_API_KEY</code>。
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="web-search-google-key"
            className="text-sm font-medium"
          >
            Google Search API Key
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(GOOGLE_SEARCH_API_APPLY_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              申请 Google Key
            </button>
            <button
              type="button"
              onClick={() => void openExternalUrl(GOOGLE_SEARCH_DOC_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              查看文档
            </button>
          </div>
          <div className="relative">
            <input
              id="web-search-google-key"
              type={showGoogleSearchApiKey ? "text" : "password"}
              value={draftGoogleSearchApiKey}
              onChange={(e) => setDraftGoogleSearchApiKey(e.target.value)}
              placeholder="输入 GOOGLE_SEARCH_API_KEY"
              className="w-full h-10 rounded-md border bg-background px-3 pr-20 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowGoogleSearchApiKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border px-2.5 py-1 text-xs"
            >
              {showGoogleSearchApiKey ? "隐藏" : "显示"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            未填写时会回退环境变量 <code>GOOGLE_SEARCH_API_KEY</code>。
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="web-search-google-engine-id"
            className="text-sm font-medium"
          >
            Google Search Engine ID (CSE CX)
          </label>
          <input
            id="web-search-google-engine-id"
            value={draftGoogleSearchEngineId}
            onChange={(e) => setDraftGoogleSearchEngineId(e.target.value)}
            placeholder="输入 GOOGLE_SEARCH_ENGINE_ID"
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(GOOGLE_SEARCH_CSE_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              创建 CSE
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            未填写时会回退环境变量 <code>GOOGLE_SEARCH_ENGINE_ID</code>。
          </p>
        </div>

        <div className="h-px bg-border/60" />

        <div className="space-y-2">
          <label
            htmlFor="web-search-mse-priority"
            className="text-sm font-medium"
          >
            Multi Search Engine 引擎优先级（逗号分隔）
          </label>
          <input
            id="web-search-mse-priority"
            value={draftMsePriority}
            onChange={(e) => setDraftMsePriority(e.target.value)}
            placeholder="google, bing, duckduckgo, brave"
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(MSE_DOC_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              查看 MSE 设计参考
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <label
              htmlFor="web-search-mse-max-per-engine"
              className="text-sm font-medium"
            >
              每引擎结果上限
            </label>
            <input
              id="web-search-mse-max-per-engine"
              value={draftMseMaxResultsPerEngine}
              onChange={(e) => setDraftMseMaxResultsPerEngine(e.target.value)}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="web-search-mse-max-total"
              className="text-sm font-medium"
            >
              聚合结果总上限
            </label>
            <input
              id="web-search-mse-max-total"
              value={draftMseMaxTotalResults}
              onChange={(e) => setDraftMseMaxTotalResults(e.target.value)}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="web-search-mse-timeout"
              className="text-sm font-medium"
            >
              单引擎超时 (ms)
            </label>
            <input
              id="web-search-mse-timeout"
              value={draftMseTimeoutMs}
              onChange={(e) => setDraftMseTimeoutMs(e.target.value)}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="web-search-mse-custom-engine-name"
            className="text-sm font-medium"
          >
            自定义引擎名称（可选）
          </label>
          <input
            id="web-search-mse-custom-engine-name"
            value={draftMseCustomEngineName}
            onChange={(e) => setDraftMseCustomEngineName(e.target.value)}
            placeholder="例如: hn"
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <label
            htmlFor="web-search-mse-custom-engine-template"
            className="text-sm font-medium"
          >
            自定义引擎 URL 模板（必须包含 {"{query}"}）
          </label>
          <input
            id="web-search-mse-custom-engine-template"
            value={draftMseCustomEngineTemplate}
            onChange={(e) => setDraftMseCustomEngineTemplate(e.target.value)}
            placeholder="https://example.com/search?q={query}"
            className="w-full h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-sm font-medium">联网图片搜索</h3>
              <p className="text-xs text-muted-foreground">
                配置插图页「图片搜索 → 联网搜索」使用的 Pexels API Key。
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                pexelsKeyConfigured
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              Pexels {pexelsKeyConfigured ? "已填写" : "未填写"}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                pixabayKeyConfigured
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              Pixabay {pixabayKeyConfigured ? "已填写" : "未填写"}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <label
            htmlFor="web-search-pexels-key"
            className="text-sm font-medium"
          >
            Pexels API Key
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(PEXELS_APPLY_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              申请 Pexels Key
            </button>
            <button
              type="button"
              onClick={() => void openExternalUrl(PEXELS_DOC_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              查看文档
            </button>
          </div>
          <div className="relative">
            <input
              id="web-search-pexels-key"
              type={showPexelsApiKey ? "text" : "password"}
              value={draftPexelsApiKey}
              onChange={(e) => setDraftPexelsApiKey(e.target.value)}
              placeholder="输入 Pexels API Key"
              className="w-full h-10 rounded-md border bg-background px-3 pr-20 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowPexelsApiKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border px-2.5 py-1 text-xs"
            >
              {showPexelsApiKey ? "隐藏" : "显示"}
            </button>
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p>
              未填写时会回退读取环境变量 <code>PEXELS_API_KEY</code>。
            </p>
            <p>申请地址：{PEXELS_APPLY_URL}</p>
            <p>验证路径：插图 → 图片搜索 → 联网搜索。</p>
          </div>

          <div className="h-px bg-border/60" />

          <label
            htmlFor="web-search-pixabay-key"
            className="text-sm font-medium"
          >
            Pixabay API Key
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openExternalUrl(PIXABAY_APPLY_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              申请 Pixabay Key
            </button>
            <button
              type="button"
              onClick={() => void openExternalUrl(PIXABAY_DOC_URL)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              查看文档
            </button>
          </div>
          <div className="relative">
            <input
              id="web-search-pixabay-key"
              type={showPixabayApiKey ? "text" : "password"}
              value={draftPixabayApiKey}
              onChange={(e) => setDraftPixabayApiKey(e.target.value)}
              placeholder="输入 Pixabay API Key"
              className="w-full h-10 rounded-md border bg-background px-3 pr-20 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setShowPixabayApiKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md border px-2.5 py-1 text-xs"
            >
              {showPixabayApiKey ? "隐藏" : "显示"}
            </button>
          </div>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p>
              未填写时会回退读取环境变量 <code>PIXABAY_API_KEY</code>。
            </p>
            <p>申请地址：{PIXABAY_APPLY_URL}</p>
            <p>验证路径：插图 → 图片搜索 → Pixabay图库。</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="text-sm font-medium">观测面板</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
              tavilyKeyConfigured
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Tavily {tavilyKeyConfigured ? "已填写" : "未填写"}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
              bingSearchKeyConfigured
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Bing {bingSearchKeyConfigured ? "已填写" : "未填写"}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
              googleSearchKeyConfigured
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Google {googleSearchKeyConfigured ? "已填写" : "未填写"}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
              googleSearchEngineConfigured
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            CSE {googleSearchEngineConfigured ? "已填写" : "未填写"}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
              mseCustomEngineReady
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            MSE 自定义模板 {mseCustomEngineReady ? "可用" : "未配置"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          当前 provider 回退链：
          {parseCsv(draftProviderPriority).length > 0
            ? parseCsv(draftProviderPriority).join(" -> ")
            : "自动默认链"}
        </p>
      </div>

      <div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border rounded-lg px-4 py-3 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {hasUnsavedChanges ? "未保存的更改" : "所有更改已保存"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasUnsavedChanges || saving}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasUnsavedChanges || saving}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WebSearchSettings;
