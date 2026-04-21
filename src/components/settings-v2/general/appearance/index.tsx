/**
 * @file index.tsx
 * @description 通用设置 - 外观与推荐行为
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
  Monitor,
  Moon,
  Palette,
  Puzzle,
  RotateCcw,
  Sparkles,
  Sun,
  Volume2,
  Waypoints,
  Bot,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { cn } from "@/lib/utils";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import type { NavigationEnabledItemId } from "@/lib/api/appConfigTypes";
import { useOnboardingState } from "@/components/onboarding";
import { useI18nPatch } from "@/i18n/I18nPatchProvider";
import type { Language } from "@/i18n/text-map";
import { useSoundContext } from "@/contexts/useSoundContext";
import { Switch } from "@/components/ui/switch";
import {
  CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS,
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
  iconClassName?: string;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

interface HiddenSystemEntryOption {
  id: NavigationEnabledItemId;
  label: string;
  description: string;
  icon: LucideIcon;
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

const HIDDEN_SYSTEM_ENTRY_OPTIONS: HiddenSystemEntryOption[] = [
  {
    id: "plugins",
    label: "插件中心",
    description: "在系统区显示插件安装、管理与扩展入口。",
    icon: Puzzle,
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    description: "在系统区显示 OpenClaw 兼容运行入口。",
    icon: Waypoints,
  },
  {
    id: "companion",
    label: "桌宠",
    description: "在系统区显示桌宠管理与连接诊断入口。",
    icon: Bot,
  },
];

const ACTIVE_OPTION_CARD_CLASS =
  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10";

const INACTIVE_OPTION_CARD_CLASS =
  "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/70 hover:text-slate-900";

const PRIMARY_ACTION_BUTTON_CLASS =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#0ea5e9_0%,#10b981_100%)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-95 shadow-sm shadow-emerald-950/15";

const HEADER_INFO_PILL_CLASS =
  "rounded-full border border-sky-200 bg-sky-50/90 px-2.5 py-1 text-[11px] font-medium text-sky-700";

const HEADER_SUCCESS_PILL_CLASS =
  "rounded-full border border-emerald-200 bg-emerald-50/90 px-2.5 py-1 text-[11px] font-medium text-emerald-700";

const HEADER_NEUTRAL_PILL_CLASS =
  "rounded-full border border-cyan-200 bg-cyan-50/90 px-2.5 py-1 text-[11px] font-medium text-cyan-700";

const CURRENT_INFO_PILL_CLASS =
  "rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700";

const CURRENT_SUCCESS_PILL_CLASS =
  "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700";

const CONTEXT_STATUS_PILL_CLASS =
  "rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700";

const RECOVERY_ICON_BADGE_CLASS =
  "inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.98)_0%,rgba(236,253,245,0.92)_100%)] text-sky-700";

const RECOVERY_NOTICE_CLASS =
  "flex items-center justify-between gap-3 rounded-[18px] border border-cyan-200/80 bg-cyan-50/70 px-4 py-3 text-xs leading-5 text-cyan-700";

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
  iconClassName,
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
            <Icon className={cn("h-4 w-4 text-sky-600", iconClassName)} />
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

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[132px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
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

  const enabledNavigationItems = useMemo(
    () => resolveEnabledSidebarNavItems(config?.navigation?.enabled_items),
    [config],
  );

  const hiddenSystemEntryCount = enabledNavigationItems.length;

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

  const handleHiddenSystemEntryToggle = useCallback(
    async (itemId: NavigationEnabledItemId, checked: boolean) => {
      if (!config) {
        return;
      }

      const previousConfig = config;
      const nextEnabledItems = resolveEnabledSidebarNavItems(
        checked
          ? [...enabledNavigationItems, itemId]
          : enabledNavigationItems.filter((currentItemId) => currentItemId !== itemId),
      ) as NavigationEnabledItemId[];

      const nextConfig: Config = {
        ...config,
        navigation: {
          ...(config.navigation || {}),
          enabled_items: nextEnabledItems,
        },
      };

      setError(null);
      setConfig(nextConfig);

      try {
        await saveConfig(nextConfig);
      } catch (err) {
        console.error("保存隐藏系统入口设置失败:", err);
        setConfig(previousConfig);
        setError("保存隐藏系统入口设置失败，请重试。");
      }
    },
    [config, enabledNavigationItems],
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

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-3.5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
                外观
              </h1>
              <WorkbenchInfoTip
                ariaLabel="外观设置总览说明"
                content="管理主题、语言、提示音效、推荐问题的上下文带入方式，以及隐藏系统入口的显示状态。"
                tone="mint"
              />
            </div>
            <p className="text-[13px] text-slate-500">
              管理主题、语言、提示音效、推荐行为和隐藏入口。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
            <span className={HEADER_INFO_PILL_CLASS}>
              主题：{workspaceSummary.themeLabel}
            </span>
            <span className={HEADER_SUCCESS_PILL_CLASS}>
              语言：{workspaceSummary.languageLabel}
            </span>
            <span
              className={
                soundEnabled ? HEADER_SUCCESS_PILL_CLASS : HEADER_NEUTRAL_PILL_CLASS
              }
            >
              提示音效：{workspaceSummary.soundsLabel}
            </span>
          </div>
        </div>
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <SurfacePanel
          icon={Palette}
          iconClassName="text-sky-600"
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
                <span className={CURRENT_INFO_PILL_CLASS}>
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
                          ? ACTIVE_OPTION_CARD_CLASS
                          : INACTIVE_OPTION_CARD_CLASS,
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
                          active ? "text-slate-600" : "text-slate-500",
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
                <span className={CURRENT_SUCCESS_PILL_CLASS}>
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
                          ? ACTIVE_OPTION_CARD_CLASS
                          : INACTIVE_OPTION_CARD_CLASS,
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
                          active ? "text-slate-600" : "text-slate-500",
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
          iconClassName="text-cyan-600"
          title="初始化与恢复"
          description="当你想重新走一遍首次启动流程，或者排查引导配置异常时，从这里恢复。"
          aside={
            <span className={CURRENT_INFO_PILL_CLASS}>
              适合排障
            </span>
          }
        >
          <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(248,250,252,0.92)_100%)] p-4">
            <div className="space-y-3">
              <div className={RECOVERY_ICON_BADGE_CLASS}>
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

            <div className="space-y-2.5">
              <div className={RECOVERY_NOTICE_CLASS}>
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
                className={PRIMARY_ACTION_BUTTON_CLASS}
              >
                <RotateCcw className="h-4 w-4" />
                重新运行引导
              </button>
            </div>
          </div>
        </SurfacePanel>
      </section>

      <SurfacePanel
        icon={Puzzle}
        iconClassName="text-cyan-600"
        title="隐藏系统入口"
        description="默认保持主导航简洁，只在你需要时把兼容或扩展入口挂回系统区。"
        aside={
          <span className={CURRENT_INFO_PILL_CLASS}>
            已开启 {hiddenSystemEntryCount} / {CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS.length}
          </span>
        }
      >
        <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
          <div className="space-y-3">
            {HIDDEN_SYSTEM_ENTRY_OPTIONS.map((option) => {
              const checked = enabledNavigationItems.includes(option.id);
              return (
                <div
                  key={option.id}
                  className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-white/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
                      <option.icon className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {option.label}
                        </h3>
                        <WorkbenchInfoTip
                          ariaLabel={`${option.label}入口说明`}
                          content={option.description}
                          tone="slate"
                        />
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        {option.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        checked
                          ? CURRENT_SUCCESS_PILL_CLASS
                          : CONTEXT_STATUS_PILL_CLASS
                      }
                    >
                      {checked ? "已显示" : "已隐藏"}
                    </span>
                    <Switch
                      checked={checked}
                      onCheckedChange={(nextChecked) => {
                        void handleHiddenSystemEntryToggle(
                          option.id,
                          nextChecked,
                        );
                      }}
                      aria-label={`切换显示${option.label}入口`}
                      disabled={!config}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </SurfacePanel>

      <SurfacePanel
        icon={Sparkles}
        iconClassName="text-emerald-600"
        title="推荐行为"
        description="控制推荐问题是否自动带上当前选中内容，减少重复粘贴上下文。"
      >
        <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
          <div className="flex flex-col gap-3">
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
                  <span
                    className={
                      appendSelectedTextToRecommendation
                        ? CURRENT_SUCCESS_PILL_CLASS
                        : CONTEXT_STATUS_PILL_CLASS
                    }
                  >
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
      </SurfacePanel>
    </div>
  );
}
