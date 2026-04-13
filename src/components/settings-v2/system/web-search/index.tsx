import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Compass,
  Image as ImageIcon,
  Layers3,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { cn } from "@/lib/utils";
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

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

interface FieldBlockProps {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}

interface StatusPillProps {
  active: boolean;
  label: string;
}

const INPUT_CLASS_NAME =
  "w-full rounded-[16px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const TEXT_BUTTON_CLASS_NAME =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900";
const ACTION_BUTTON_CLASS_NAME =
  "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS_NAME =
  "rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

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

function SurfacePanel({
  icon: Icon,
  title,
  description,
  aside,
  children,
}: SurfacePanelProps) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
            <WorkbenchInfoTip
              ariaLabel={`${title}说明`}
              content={description}
              tone="slate"
            />
          </div>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
        ) : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function FieldBlock({ label, htmlFor, hint, children }: FieldBlockProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-2 text-sm font-medium text-slate-900"
      >
        <span>{label}</span>
        {hint ? (
          <WorkbenchInfoTip
            ariaLabel={`${label}说明`}
            content={hint}
            tone="slate"
          />
        ) : null}
      </label>
      {children}
    </div>
  );
}

function StatusPill({ active, label }: StatusPillProps) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-500",
      )}
    >
      {label}
    </span>
  );
}

function SecretInput({
  id,
  value,
  placeholder,
  visible,
  onToggleVisible,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  visible: boolean;
  onToggleVisible: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLASS_NAME} pr-20`}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
      >
        {visible ? "隐藏" : "显示"}
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-20">
      <div className="h-[228px] animate-pulse rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)]" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-6">
          <div className="h-[380px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[420px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
        <div className="space-y-6">
          <div className="h-[280px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[260px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
      </div>
    </div>
  );
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

  const providerChainPreview =
    parseCsv(draftProviderPriority).length > 0
      ? parseCsv(draftProviderPriority).join(" -> ")
      : "自动默认链";

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
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-6 pb-20">
      {message ? (
        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "error"
              ? "border-rose-200 bg-rose-50/90 text-rose-700"
              : "border-emerald-200 bg-emerald-50/90 text-emerald-700",
          )}
        >
          <span>{message.text}</span>
          {message.type === "error" ? (
            <button
              type="button"
              onClick={() => void loadConfig()}
              className="rounded-full border border-current/15 bg-white/80 px-3 py-1.5 text-xs font-medium transition hover:bg-white"
            >
              重新加载
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                网络搜索
              </h1>
              <WorkbenchInfoTip
                ariaLabel="联网搜索设置总览说明"
                content="管理搜索引擎、Provider 回退链和图片搜索 Key；各服务的接入说明已经分别收进对应配置分区。"
                tone="mint"
              />
            </div>
            <p className="text-sm text-slate-500">
              管理搜索引擎、Provider 回退和图片搜索 Key。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              搜索引擎：{draftEngine === "google" ? "Google" : "小红书"}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              当前 Provider：{draftProvider}
            </span>
            <span
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium",
                hasUnsavedChanges
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
            >
              状态：{hasUnsavedChanges ? "待保存" : "已保存"}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-6">
          <SurfacePanel
            icon={Search}
            title="联网搜索配置"
            description="先确定搜索引擎和首选 Provider，再补齐回退顺序与所需凭证。"
            aside={
              <>
                <StatusPill
                  active={draftEngine === "google"}
                  label={
                    draftEngine === "google" ? "通用搜索优先" : "小红书内容优先"
                  }
                />
                <StatusPill
                  active={draftProvider === "duckduckgo_instant"}
                  label={`当前 Provider：${draftProvider}`}
                />
              </>
            }
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="space-y-4">
                  <FieldBlock
                    label="选择搜索引擎"
                    htmlFor="web-search-engine"
                    hint="Google 适用于通用搜索，小红书适用于中文生活方式和购物内容。"
                  >
                    <select
                      id="web-search-engine"
                      value={draftEngine}
                      onChange={(e) =>
                        setDraftEngine(e.target.value as SearchEngine)
                      }
                      className={`${INPUT_CLASS_NAME} h-11`}
                    >
                      <option value="google">Google</option>
                      <option value="xiaohongshu">小红书</option>
                    </select>
                  </FieldBlock>

                  <FieldBlock
                    label="首选搜索提供商"
                    htmlFor="web-search-provider"
                  >
                    <select
                      id="web-search-provider"
                      value={draftProvider}
                      onChange={(e) =>
                        setDraftProvider(e.target.value as WebSearchProvider)
                      }
                      className={`${INPUT_CLASS_NAME} h-11`}
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
                  </FieldBlock>

                  <FieldBlock
                    label="提供商回退优先级（逗号分隔）"
                    htmlFor="web-search-provider-priority"
                    hint="未填写时会自动使用默认回退链；未知 provider 会被忽略。"
                  >
                    <input
                      id="web-search-provider-priority"
                      value={draftProviderPriority}
                      onChange={(e) => setDraftProviderPriority(e.target.value)}
                      placeholder="tavily, multi_search_engine, bing_search_api, google_custom_search, duckduckgo_instant"
                      className={INPUT_CLASS_NAME}
                    />
                  </FieldBlock>
                </div>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="space-y-4">
                  <div className="rounded-[20px] border border-slate-200/80 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      Provider 凭证状态
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusPill
                        active={tavilyKeyConfigured}
                        label={`Tavily ${tavilyKeyConfigured ? "已填写" : "未填写"}`}
                      />
                      <StatusPill
                        active={bingSearchKeyConfigured}
                        label={`Bing ${bingSearchKeyConfigured ? "已填写" : "未填写"}`}
                      />
                      <StatusPill
                        active={googleSearchKeyConfigured}
                        label={`Google ${googleSearchKeyConfigured ? "已填写" : "未填写"}`}
                      />
                      <StatusPill
                        active={googleSearchEngineConfigured}
                        label={`CSE ${googleSearchEngineConfigured ? "已填写" : "未填写"}`}
                      />
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-slate-200/80 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span>当前回退预览</span>
                      <WorkbenchInfoTip
                        ariaLabel="当前回退预览说明"
                        content="按当前 Provider 顺序展示搜索回退链。"
                        tone="slate"
                      />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {providerChainPreview}
                    </p>
                  </div>

                  <div className="rounded-[20px] border border-slate-200/80 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span>配置建议</span>
                      <WorkbenchInfoTip
                        ariaLabel="联网搜索配置建议"
                        content="如果需要更稳定的通用联网搜索，优先补齐 Tavily、Bing 或 Google Custom Search；MSE 更适合做聚合兜底。"
                        tone="slate"
                      />
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={ShieldCheck}
            title="Provider 凭证"
            description="把 Tavily、Bing、Google Custom Search 的 Key 放在同一块配置，减少来回跳转。"
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <FieldBlock
                  label="Tavily API Key"
                  htmlFor="web-search-tavily-key"
                  hint="未填写时会回退环境变量 TAVILY_API_KEY。"
                >
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(TAVILY_APPLY_URL)}
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        申请 Tavily Key
                      </button>
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(TAVILY_DOC_URL)}
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        查看文档
                      </button>
                    </div>
                    <SecretInput
                      id="web-search-tavily-key"
                      value={draftTavilyApiKey}
                      placeholder="输入 TAVILY_API_KEY"
                      visible={showTavilyApiKey}
                      onToggleVisible={() =>
                        setShowTavilyApiKey((prev) => !prev)
                      }
                      onChange={setDraftTavilyApiKey}
                    />
                  </>
                </FieldBlock>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <FieldBlock
                  label="Bing Search API Key"
                  htmlFor="web-search-bing-key"
                  hint="未填写时会回退环境变量 BING_SEARCH_API_KEY。"
                >
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void openExternalUrl(BING_SEARCH_APPLY_URL)
                        }
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        申请 Bing Key
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void openExternalUrl(BING_SEARCH_DOC_URL)
                        }
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        查看文档
                      </button>
                    </div>
                    <SecretInput
                      id="web-search-bing-key"
                      value={draftBingSearchApiKey}
                      placeholder="输入 BING_SEARCH_API_KEY"
                      visible={showBingSearchApiKey}
                      onToggleVisible={() =>
                        setShowBingSearchApiKey((prev) => !prev)
                      }
                      onChange={setDraftBingSearchApiKey}
                    />
                  </>
                </FieldBlock>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4 xl:col-span-2">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.74fr)]">
                  <FieldBlock
                    label="Google Search API Key"
                    htmlFor="web-search-google-key"
                    hint="未填写时会回退环境变量 GOOGLE_SEARCH_API_KEY。"
                  >
                    <>
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void openExternalUrl(GOOGLE_SEARCH_API_APPLY_URL)
                          }
                          className={TEXT_BUTTON_CLASS_NAME}
                        >
                          申请 Google Key
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void openExternalUrl(GOOGLE_SEARCH_DOC_URL)
                          }
                          className={TEXT_BUTTON_CLASS_NAME}
                        >
                          查看文档
                        </button>
                      </div>
                      <SecretInput
                        id="web-search-google-key"
                        value={draftGoogleSearchApiKey}
                        placeholder="输入 GOOGLE_SEARCH_API_KEY"
                        visible={showGoogleSearchApiKey}
                        onToggleVisible={() =>
                          setShowGoogleSearchApiKey((prev) => !prev)
                        }
                        onChange={setDraftGoogleSearchApiKey}
                      />
                    </>
                  </FieldBlock>

                  <FieldBlock
                    label="Google Search Engine ID (CSE CX)"
                    htmlFor="web-search-google-engine-id"
                    hint="未填写时会回退环境变量 GOOGLE_SEARCH_ENGINE_ID。"
                  >
                    <>
                      <div className="mb-2">
                        <button
                          type="button"
                          onClick={() =>
                            void openExternalUrl(GOOGLE_SEARCH_CSE_URL)
                          }
                          className={TEXT_BUTTON_CLASS_NAME}
                        >
                          创建 CSE
                        </button>
                      </div>
                      <input
                        id="web-search-google-engine-id"
                        value={draftGoogleSearchEngineId}
                        onChange={(e) =>
                          setDraftGoogleSearchEngineId(e.target.value)
                        }
                        placeholder="输入 GOOGLE_SEARCH_ENGINE_ID"
                        className={INPUT_CLASS_NAME}
                      />
                    </>
                  </FieldBlock>
                </div>
              </article>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Layers3}
            title="Multi Search Engine"
            description="集中维护 MSE 聚合顺序、上限、超时和自定义引擎模板。"
            aside={
              <StatusPill
                active={mseCustomEngineReady}
                label={`自定义模板 ${mseCustomEngineReady ? "可用" : "未配置"}`}
              />
            }
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="space-y-4">
                  <FieldBlock
                    label="Multi Search Engine 引擎优先级（逗号分隔）"
                    htmlFor="web-search-mse-priority"
                  >
                    <>
                      <div className="mb-2">
                        <button
                          type="button"
                          onClick={() => void openExternalUrl(MSE_DOC_URL)}
                          className={TEXT_BUTTON_CLASS_NAME}
                        >
                          查看 MSE 设计参考
                        </button>
                      </div>
                      <input
                        id="web-search-mse-priority"
                        value={draftMsePriority}
                        onChange={(e) => setDraftMsePriority(e.target.value)}
                        placeholder="google, bing, duckduckgo, brave"
                        className={INPUT_CLASS_NAME}
                      />
                    </>
                  </FieldBlock>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <FieldBlock
                      label="每引擎结果上限"
                      htmlFor="web-search-mse-max-per-engine"
                    >
                      <input
                        id="web-search-mse-max-per-engine"
                        value={draftMseMaxResultsPerEngine}
                        onChange={(e) =>
                          setDraftMseMaxResultsPerEngine(e.target.value)
                        }
                        className={INPUT_CLASS_NAME}
                      />
                    </FieldBlock>
                    <FieldBlock
                      label="聚合结果总上限"
                      htmlFor="web-search-mse-max-total"
                    >
                      <input
                        id="web-search-mse-max-total"
                        value={draftMseMaxTotalResults}
                        onChange={(e) =>
                          setDraftMseMaxTotalResults(e.target.value)
                        }
                        className={INPUT_CLASS_NAME}
                      />
                    </FieldBlock>
                    <FieldBlock
                      label="单引擎超时 (ms)"
                      htmlFor="web-search-mse-timeout"
                    >
                      <input
                        id="web-search-mse-timeout"
                        value={draftMseTimeoutMs}
                        onChange={(e) => setDraftMseTimeoutMs(e.target.value)}
                        className={INPUT_CLASS_NAME}
                      />
                    </FieldBlock>
                  </div>

                  <FieldBlock
                    label="自定义引擎名称（可选）"
                    htmlFor="web-search-mse-custom-engine-name"
                  >
                    <input
                      id="web-search-mse-custom-engine-name"
                      value={draftMseCustomEngineName}
                      onChange={(e) =>
                        setDraftMseCustomEngineName(e.target.value)
                      }
                      placeholder="例如: hn"
                      className={INPUT_CLASS_NAME}
                    />
                  </FieldBlock>

                  <FieldBlock
                    label={"自定义引擎 URL 模板（必须包含 {query}）"}
                    htmlFor="web-search-mse-custom-engine-template"
                  >
                    <input
                      id="web-search-mse-custom-engine-template"
                      value={draftMseCustomEngineTemplate}
                      onChange={(e) =>
                        setDraftMseCustomEngineTemplate(e.target.value)
                      }
                      placeholder="https://example.com/search?q={query}"
                      className={INPUT_CLASS_NAME}
                    />
                  </FieldBlock>
                </div>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="space-y-4">
                  <div className="rounded-[20px] border border-slate-200/80 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span>MSE 使用建议</span>
                      <WorkbenchInfoTip
                        ariaLabel="MSE 使用建议说明"
                        content="优先把常用引擎放在前面，避免总上限太高导致响应慢；超时建议维持在 4s 左右作为桌面端均衡值。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-slate-200/80 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      当前模板状态
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {mseCustomEngineReady
                        ? `已准备好自定义引擎：${draftMseCustomEngineName}`
                        : "自定义引擎还未就绪，需要名称和包含 {query} 的模板。"}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </SurfacePanel>
        </div>

        <div className="space-y-6">
          <SurfacePanel
            icon={ImageIcon}
            title="联网图片搜索"
            description="配置 Claw `@素材` 在线搜图使用的 Pexels 与 Pixabay API Key。"
            aside={
              <>
                <StatusPill
                  active={pexelsKeyConfigured}
                  label={`Pexels ${pexelsKeyConfigured ? "已填写" : "未填写"}`}
                />
                <StatusPill
                  active={pixabayKeyConfigured}
                  label={`Pixabay ${pixabayKeyConfigured ? "已填写" : "未填写"}`}
                />
              </>
            }
          >
            <div className="space-y-5">
              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <FieldBlock
                  label="Pexels API Key"
                  htmlFor="web-search-pexels-key"
                  hint="未填写时会回退读取环境变量 PEXELS_API_KEY。"
                >
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(PEXELS_APPLY_URL)}
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        申请 Pexels Key
                      </button>
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(PEXELS_DOC_URL)}
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        查看文档
                      </button>
                    </div>
                    <SecretInput
                      id="web-search-pexels-key"
                      value={draftPexelsApiKey}
                      placeholder="输入 Pexels API Key"
                      visible={showPexelsApiKey}
                      onToggleVisible={() =>
                        setShowPexelsApiKey((prev) => !prev)
                      }
                      onChange={setDraftPexelsApiKey}
                    />
                  </>
                </FieldBlock>

                <div className="mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
                  <span>Pexels 接入说明已收纳</span>
                  <WorkbenchInfoTip
                    ariaLabel="Pexels 接入说明"
                    content={`申请地址：${PEXELS_APPLY_URL}\n验证路径：Claw → @素材 → Pexels 图片候选。`}
                    tone="slate"
                  />
                </div>
              </article>

              <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <FieldBlock
                  label="Pixabay API Key"
                  htmlFor="web-search-pixabay-key"
                  hint="未填写时会回退读取环境变量 PIXABAY_API_KEY。"
                >
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(PIXABAY_APPLY_URL)}
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        申请 Pixabay Key
                      </button>
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(PIXABAY_DOC_URL)}
                        className={TEXT_BUTTON_CLASS_NAME}
                      >
                        查看文档
                      </button>
                    </div>
                    <SecretInput
                      id="web-search-pixabay-key"
                      value={draftPixabayApiKey}
                      placeholder="输入 Pixabay API Key"
                      visible={showPixabayApiKey}
                      onToggleVisible={() =>
                        setShowPixabayApiKey((prev) => !prev)
                      }
                      onChange={setDraftPixabayApiKey}
                    />
                  </>
                </FieldBlock>

                <div className="mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
                  <span>Pixabay 接入说明已收纳</span>
                  <WorkbenchInfoTip
                    ariaLabel="Pixabay 接入说明"
                    content={`申请地址：${PIXABAY_APPLY_URL}\n验证路径：Claw → @素材 → Pixabay 图片候选。`}
                    tone="slate"
                  />
                </div>
              </article>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Compass}
            title="观测面板"
            description="快速判断当前搜索链路是否齐全，便于在保存前做一次配置自检。"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  active={tavilyKeyConfigured}
                  label={`Tavily ${tavilyKeyConfigured ? "已填写" : "未填写"}`}
                />
                <StatusPill
                  active={bingSearchKeyConfigured}
                  label={`Bing ${bingSearchKeyConfigured ? "已填写" : "未填写"}`}
                />
                <StatusPill
                  active={googleSearchKeyConfigured}
                  label={`Google ${googleSearchKeyConfigured ? "已填写" : "未填写"}`}
                />
                <StatusPill
                  active={googleSearchEngineConfigured}
                  label={`CSE ${googleSearchEngineConfigured ? "已填写" : "未填写"}`}
                />
                <StatusPill
                  active={mseCustomEngineReady}
                  label={`MSE 自定义模板 ${mseCustomEngineReady ? "可用" : "未配置"}`}
                />
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  当前 provider 回退链
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {providerChainPreview}
                </p>
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  图片搜索 Key
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {pexelsKeyConfigured || pixabayKeyConfigured
                    ? "Claw 图片素材搜索至少已有一个联网图片来源可用。"
                    : "图片搜索 Key 仍未配置，Claw `@素材` 会回退到环境变量或不可用状态。"}
                </p>
              </div>
            </div>
          </SurfacePanel>
        </div>
      </div>

      <div className="sticky bottom-0 rounded-[24px] border border-slate-200/80 bg-white/92 px-4 py-3 shadow-lg shadow-slate-950/5 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-500">
            {hasUnsavedChanges ? "未保存的更改" : "所有更改已保存"}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={!hasUnsavedChanges || saving}
              className={ACTION_BUTTON_CLASS_NAME}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasUnsavedChanges || saving}
              className={PRIMARY_BUTTON_CLASS_NAME}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
