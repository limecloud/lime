/**
 * @file index.tsx
 * @description 通用设置 - 外观、主导航入口与推荐行为
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  Languages,
  LayoutPanelLeft,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sparkles,
  Sun,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { cn } from "@/lib/utils";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { useOnboardingState } from "@/components/onboarding";
import { useI18nPatch } from "@/i18n/I18nPatchProvider";
import type { Language } from "@/i18n/text-map";
import { useSoundContext } from "@/contexts/useSoundContext";
import { Switch } from "@/components/ui/switch";
import {
  CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS,
  CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS,
  DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  FIXED_MAIN_SIDEBAR_NAV_ITEMS,
  FIXED_FOOTER_SIDEBAR_NAV_ITEMS,
  resolveEnabledSidebarNavItems,
} from "@/lib/navigation/sidebarNav";

type Theme = "light" | "dark" | "system";

interface ThemeOption {
  id: Theme;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface LanguageOption {
  id: Language;
  label: string;
  hint: string;
}

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

interface StatCardProps {
  label: string;
  value: string;
  description: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "light",
    label: "浅色",
    description: "适合白天和高亮环境。",
    icon: Sun,
  },
  {
    id: "dark",
    label: "深色",
    description: "降低夜间使用时的眩光。",
    icon: Moon,
  },
  {
    id: "system",
    label: "跟随系统",
    description: "自动同步系统外观。",
    icon: Monitor,
  },
];

const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    id: "zh",
    label: "中文",
    hint: "适合主要中文工作流。",
  },
  {
    id: "en",
    label: "English",
    hint: "适合英文界面与术语环境。",
  },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "system") {
    const systemDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.classList.toggle("dark", systemDark);
    return;
  }

  root.classList.toggle("dark", theme === "dark");
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
        {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function StatCard({ label, value, description }: StatCardProps) {
  return (
    <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium tracking-[0.12em] text-slate-500">
        <span>{label}</span>
        <WorkbenchInfoTip
          ariaLabel={`${label}说明`}
          content={description}
          tone="slate"
        />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[228px] animate-pulse rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)]" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      </div>
      <div className="h-[420px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
    </div>
  );
}

function resolveThemeLabel(theme: Theme) {
  return THEME_OPTIONS.find((option) => option.id === theme)?.label || "系统";
}

function resolveLanguageLabel(language: Language) {
  return (
    LANGUAGE_OPTIONS.find((option) => option.id === language)?.label || "中文"
  );
}

export function AppearanceSettings() {
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>("system");
  const [language, setLanguageState] = useState<Language>("zh");
  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  );
  const [
    appendSelectedTextToRecommendation,
    setAppendSelectedTextToRecommendation,
  ] = useState(true);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { setLanguage: setI18nLanguage } = useI18nPatch();
  const { soundEnabled, setSoundEnabled, playToolcallSound } =
    useSoundContext();
  const { resetOnboarding } = useOnboardingState();

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const loadedConfig = await getConfig();
      setConfig(loadedConfig);
      setLanguageState((loadedConfig.language || "zh") as Language);
      setEnabledNavItems(
        resolveEnabledSidebarNavItems(loadedConfig.navigation?.enabled_items),
      );
      setAppendSelectedTextToRecommendation(
        loadedConfig.chat_appearance?.append_selected_text_to_recommendation ??
          true,
      );
    } catch (err) {
      console.error("加载外观设置失败:", err);
      setError("加载外观设置失败，请稍后重试。");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    const nextTheme = savedTheme || "system";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    void loadConfig();
  }, [loadConfig]);

  const workspaceSummary = useMemo(
    () => ({
      themeLabel: resolveThemeLabel(theme),
      languageLabel: resolveLanguageLabel(language),
      soundsLabel: soundEnabled ? "已开启" : "已关闭",
    }),
    [language, soundEnabled, theme],
  );

  const enabledWorkspaceNavCount = useMemo(
    () =>
      FIXED_MAIN_SIDEBAR_NAV_ITEMS.length +
      CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS.filter((item) =>
        enabledNavItems.includes(item.id),
      ).length,
    [enabledNavItems],
  );

  const enabledFooterNavCount = useMemo(
    () =>
      CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS.filter((item) =>
        enabledNavItems.includes(item.id),
      ).length,
    [enabledNavItems],
  );

  const visibleNavItemCount =
    FIXED_MAIN_SIDEBAR_NAV_ITEMS.length +
    enabledNavItems.length +
    FIXED_FOOTER_SIDEBAR_NAV_ITEMS.length;

  const handleThemeChange = useCallback((nextTheme: Theme) => {
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    applyTheme(nextTheme);
  }, []);

  const handleLanguageChange = useCallback(
    async (nextLanguage: Language) => {
      if (!config) {
        return;
      }

      const previousConfig = config;
      const previousLanguage = language;
      const nextConfig = {
        ...config,
        language: nextLanguage,
      };

      setError(null);
      setConfig(nextConfig);
      setLanguageState(nextLanguage);
      setI18nLanguage(nextLanguage);

      try {
        await saveConfig(nextConfig);
      } catch (err) {
        console.error("保存语言设置失败:", err);
        setConfig(previousConfig);
        setLanguageState(previousLanguage);
        setI18nLanguage(previousLanguage);
        setError("保存语言设置失败，请重试。");
      }
    },
    [config, language, setI18nLanguage],
  );

  const handleSoundToggle = useCallback(
    (checked: boolean) => {
      setSoundEnabled(checked);
      if (checked) {
        playToolcallSound();
      }
    },
    [playToolcallSound, setSoundEnabled],
  );

  const handleNavItemToggle = useCallback(
    async (itemId: string) => {
      if (!config) {
        return;
      }

      const previousNavItems = enabledNavItems;
      const nextItems = enabledNavItems.includes(itemId)
        ? enabledNavItems.filter((item) => item !== itemId)
        : [...enabledNavItems, itemId];

      if (nextItems.length === 0) {
        return;
      }

      const previousConfig = config;
      const nextConfig = {
        ...config,
        navigation: {
          ...(config.navigation || {}),
          enabled_items: nextItems,
        },
      };

      setError(null);
      setEnabledNavItems(nextItems);
      setConfig(nextConfig);

      try {
        await saveConfig(nextConfig);
        window.dispatchEvent(new CustomEvent("nav-config-changed"));
      } catch (err) {
        console.error("保存导航设置失败:", err);
        setEnabledNavItems(previousNavItems);
        setConfig(previousConfig);
        setError("保存左侧导航设置失败，请重试。");
      }
    },
    [config, enabledNavItems],
  );

  const handleRecommendationSelectionToggle = useCallback(
    async (checked: boolean) => {
      if (!config) {
        return;
      }

      const previousValue = appendSelectedTextToRecommendation;
      const previousConfig = config;
      const nextConfig = {
        ...config,
        chat_appearance: {
          ...(config.chat_appearance || {}),
          append_selected_text_to_recommendation: checked,
        },
      };

      setError(null);
      setAppendSelectedTextToRecommendation(checked);
      setConfig(nextConfig);

      try {
        await saveConfig(nextConfig);
        window.dispatchEvent(new CustomEvent("chat-appearance-config-changed"));
      } catch (err) {
        console.error("保存推荐上下文设置失败:", err);
        setAppendSelectedTextToRecommendation(previousValue);
        setConfig(previousConfig);
        setError("保存聊天外观设置失败，请重试。");
      }
    },
    [appendSelectedTextToRecommendation, config],
  );

  const handleResetOnboarding = useCallback(() => {
    resetOnboarding();
    window.location.reload();
  }, [resetOnboarding]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-6 pb-8">
      {error ? (
        <div className="flex items-center justify-between gap-4 rounded-[20px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 shadow-sm shadow-slate-950/5">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadConfig()}
            className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-50"
          >
            重新加载
          </button>
        </div>
      ) : null}

      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)] xl:items-stretch">
            <div className="max-w-3xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                APPEARANCE STUDIO
              </span>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[28px] font-semibold tracking-tight text-slate-900">
                    把界面观感、主导航入口和推荐行为放在同一个视图里调整
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="外观设置总览说明"
                    content="主题、语言、提示音效，以及工作区里的侧栏入口和推荐行为，都在这里统一维护。"
                    tone="mint"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  主题：{workspaceSummary.themeLabel}
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  语言：{workspaceSummary.languageLabel}
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  提示音效：{workspaceSummary.soundsLabel}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 xl:content-start">
              <StatCard
                label="主导航入口"
                value={visibleNavItemCount.toString()}
                description="左侧工作区当前可见的导航入口数量。"
              />
              <StatCard
                label="主导航"
                value={enabledWorkspaceNavCount.toString()}
                description="主导航区域当前启用的工作台、资料库与系统入口数量。"
              />
              <StatCard
                label="推荐上下文"
                value={appendSelectedTextToRecommendation ? "开启" : "关闭"}
                description="控制推荐问题时是否自动带上当前选中内容。"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <SurfacePanel
          icon={Palette}
          title="基础外观"
          description="先确定全局主题、语言和声音反馈，再统一工作区里的视觉节奏。"
        >
          <div className="space-y-5">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      主题模式
                    </h3>
                    <WorkbenchInfoTip
                      ariaLabel="主题模式说明"
                      content="优先控制整个应用的明暗观感，适配不同设备环境。"
                      tone="slate"
                    />
                  </div>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                  当前：{resolveThemeLabel(theme)}
                </span>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {THEME_OPTIONS.map((option) => {
                  const active = theme === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleThemeChange(option.id)}
                      className={cn(
                        "rounded-[20px] border px-4 py-4 text-left transition shadow-sm",
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-current/10 bg-current/10">
                          <option.icon className="h-5 w-5" />
                        </div>
                        {active ? <Check className="h-4 w-4" /> : null}
                      </div>
                      <p className="mt-4 text-sm font-semibold">
                        {option.label}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-xs leading-5",
                          active ? "text-white/70" : "text-slate-500",
                        )}
                      >
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
                    <Languages className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        界面语言
                      </h3>
                      <WorkbenchInfoTip
                        ariaLabel="界面语言说明"
                        content="切换设置、工作区与提示文案的主要显示语言。"
                        tone="slate"
                      />
                    </div>
                  </div>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                  当前：{resolveLanguageLabel(language)}
                </span>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {LANGUAGE_OPTIONS.map((option) => {
                  const active = language === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={!config}
                      onClick={() => void handleLanguageChange(option.id)}
                      className={cn(
                        "rounded-[20px] border px-4 py-4 text-left transition shadow-sm",
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900",
                        !config && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold">{option.label}</p>
                        {active ? <Check className="h-4 w-4" /> : null}
                      </div>
                      <p
                        className={cn(
                          "mt-2 text-xs leading-5",
                          active ? "text-white/70" : "text-slate-500",
                        )}
                      >
                        {option.hint}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-[24px] border border-slate-200/80 bg-slate-50/60 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
                  <Volume2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      提示音效
                    </p>
                    <WorkbenchInfoTip
                      ariaLabel="提示音效说明"
                      content="在工具调用和消息生成时播放提示音，提升状态感知。"
                      tone="slate"
                    />
                  </div>
                </div>
              </div>
              <Switch
                checked={soundEnabled}
                onCheckedChange={handleSoundToggle}
                aria-label="切换提示音效"
              />
            </div>
          </div>
        </SurfacePanel>

        <SurfacePanel
          icon={RotateCcw}
          title="初始化与恢复"
          description="当你想重新走一遍首次启动流程，或者排查引导配置异常时，从这里恢复。"
          aside={
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              适合排障
            </span>
          }
        >
          <div className="flex h-full flex-col justify-between gap-5 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(248,250,252,0.92)_100%)] p-5">
            <div className="space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-amber-200 bg-amber-50 text-amber-700">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    重新运行初始化向导
                  </h3>
                  <WorkbenchInfoTip
                    ariaLabel="重新运行初始化向导说明"
                    content="会重新展示首次启动时的关键配置步骤，适合在更换工作方式或排查环境问题时使用。"
                    tone="slate"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500">
                <span>重新运行不会删除现有数据</span>
                <WorkbenchInfoTip
                  ariaLabel="重新运行引导注意事项"
                  content="重新运行后会刷新当前界面，但不会删除已有的账号、聊天和工作区数据。"
                  tone="slate"
                />
              </div>
              <button
                type="button"
                onClick={handleResetOnboarding}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                重新运行引导
              </button>
            </div>
          </div>
        </SurfacePanel>
      </section>

      <SurfacePanel
        icon={Sparkles}
        title="主导航入口与推荐行为"
        description="统一控制左侧边栏的任务、工作台、能力与资料库入口，以及推荐问题的上下文带入方式。"
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
                  <LayoutPanelLeft className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      左侧边栏导航
                    </h3>
                    <WorkbenchInfoTip
                      ariaLabel="左侧边栏导航说明"
                      content="控制工作区左侧常驻入口，保留高频内容即可，减少视觉干扰。"
                      tone="slate"
                    />
                  </div>
                </div>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                {visibleNavItemCount} 个已显示
              </span>
            </div>

            <div className="mt-4 space-y-4">
              <section className="rounded-[20px] border border-slate-200 bg-white/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">
                        主导航入口
                      </h4>
                      <WorkbenchInfoTip
                        ariaLabel="主导航入口说明"
                        content="控制主导航区展示的工作台、资料库和系统功能入口，任务与能力核心入口会固定保留。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                    {enabledWorkspaceNavCount} 个已启用
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2.5">
                  {CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS.map((item) => {
                    const active = enabledNavItems.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!config}
                        onClick={() => void handleNavItemToggle(item.id)}
                        className={cn(
                          "rounded-full border px-3.5 py-2 text-sm transition shadow-sm",
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                          !config && "cursor-not-allowed opacity-60",
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {FIXED_MAIN_SIDEBAR_NAV_ITEMS.length > 0 ? (
                  <div className="mt-3 rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-600">
                    核心入口固定显示：
                    {FIXED_MAIN_SIDEBAR_NAV_ITEMS.map(
                      (item) => item.label,
                    ).join("、")}
                  </div>
                ) : null}
              </section>

              <section className="rounded-[20px] border border-slate-200 bg-white/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">
                        系统入口
                      </h4>
                      <WorkbenchInfoTip
                        ariaLabel="系统入口说明"
                        content="设置入口固定显示，这里只管理系统区的其余功能入口。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                    {enabledFooterNavCount} 个已启用
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2.5">
                  {CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS.map((item) => {
                    const active = enabledNavItems.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!config}
                        onClick={() => void handleNavItemToggle(item.id)}
                        className={cn(
                          "rounded-full border px-3.5 py-2 text-sm transition shadow-sm",
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                          !config && "cursor-not-allowed opacity-60",
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </article>

          <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
            <div className="flex h-full flex-col justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      推荐行为
                    </h3>
                    <WorkbenchInfoTip
                      ariaLabel="推荐行为说明"
                      content="控制首页推荐问题是否自动带上当前选中内容，减少重复粘贴上下文。"
                      tone="slate"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-white/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">
                        推荐自动附带选中内容
                      </h4>
                      <WorkbenchInfoTip
                        ariaLabel="推荐自动附带选中内容说明"
                        content="在文档或画布中有选区时，推荐问题会自动把该段内容作为上下文带入，减少手工复制粘贴。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                      {appendSelectedTextToRecommendation ? "已开启" : "已关闭"}
                    </span>
                    <Switch
                      checked={appendSelectedTextToRecommendation}
                      onCheckedChange={(checked) => {
                        void handleRecommendationSelectionToggle(checked);
                      }}
                      aria-label="切换推荐自动附带选中内容"
                      disabled={!config}
                    />
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </SurfacePanel>
    </div>
  );
}
