import {
  ArrowRight,
  Blocks,
  Bot,
  Brain,
  Image as ImageIcon,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  useSettingsCategory,
  type CategoryGroup,
  type CategoryItem,
} from "../hooks/useSettingsCategory";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";

interface SettingsHomePageProps {
  onTabChange: (tab: SettingsTabs) => void;
  onTabPrefetch?: (tab: SettingsTabs) => void;
  onOpenCompanion?: () => void;
}

type DisplayGroupKey = Exclude<SettingsGroupKey, SettingsGroupKey.Overview>;
type DisplayGroup = CategoryGroup & { key: DisplayGroupKey };

function isDisplayGroup(group: CategoryGroup): group is DisplayGroup {
  return group.key !== SettingsGroupKey.Overview;
}

function hasQuickAccessMeta(item: CategoryItem) {
  return Boolean(quickAccessMeta[item.key]);
}

const groupMeta: Record<
  DisplayGroupKey,
  {
    description: string;
    accentClassName: string;
    iconClassName: string;
    icon: LucideIcon;
  }
> = {
  account: {
    description: "个人资料、数据统计与账号相关信息。",
    accentClassName: "from-slate-200/70 via-white to-white",
    iconClassName: "border-slate-200 bg-slate-100 text-slate-700",
    icon: Settings2,
  },
  general: {
    description: "外观、快捷键、记忆等全局体验配置。",
    accentClassName: "from-sky-200/60 via-white to-white",
    iconClassName: "border-sky-200 bg-sky-100 text-sky-700",
    icon: Palette,
  },
  agent: {
    description: "服务商、技能与媒体能力的统一配置。",
    accentClassName: "from-emerald-200/70 via-white to-white",
    iconClassName: "border-emerald-200 bg-emerald-100 text-emerald-700",
    icon: Brain,
  },
  system: {
    description: "连接器、MCP、环境变量与运行治理设置。",
    accentClassName: "from-amber-200/65 via-white to-white",
    iconClassName: "border-amber-200 bg-amber-100 text-amber-700",
    icon: ShieldCheck,
  },
};

const quickAccessMeta: Partial<
  Record<
    SettingsTabs,
    {
      title: string;
      description: string;
      icon: LucideIcon;
    }
  >
> = {
  [SettingsTabs.Appearance]: {
    title: "外观",
    description: "主题、语言与提示音效",
    icon: Palette,
  },
  [SettingsTabs.Providers]: {
    title: "AI 服务商",
    description: "凭证与服务来源管理",
    icon: Brain,
  },
  [SettingsTabs.Skills]: {
    title: "技能管理",
    description: "管理内置、本地与远程 Skill",
    icon: Blocks,
  },
  [SettingsTabs.MediaServices]: {
    title: "服务模型",
    description: "统一管理助理、媒体与语音识别模型",
    icon: ImageIcon,
  },
};

export function SettingsHomePage({
  onTabChange,
  onTabPrefetch,
  onOpenCompanion,
}: SettingsHomePageProps) {
  const groups = useSettingsCategory();

  const overview = useMemo(() => {
    const visibleGroups = groups.filter(isDisplayGroup);
    const totalItems = visibleGroups.reduce(
      (count, group) => count + group.items.length,
      0,
    );
    const experimentalCount = visibleGroups.reduce(
      (count, group) =>
        count + group.items.filter((item) => item.experimental).length,
      0,
    );
    const quickAccessItems = visibleGroups
      .flatMap((group) => group.items)
      .filter(hasQuickAccessMeta)
      .slice(0, 4);

    return {
      visibleGroups,
      totalItems,
      experimentalCount,
      quickAccessItems,
    };
  }, [groups]);

  return (
    <div className="space-y-6 pb-8">
      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                设置首页
              </h1>
              <WorkbenchInfoTip
                ariaLabel="设置首页说明"
                content="快速进入常用设置并查看各分组入口，减少在多层菜单之间来回寻找。"
                tone="mint"
              />
            </div>
            <p className="text-sm text-slate-500">
              快速进入常用设置并查看各分组入口。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              设置分组：{overview.visibleGroups.length}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              可配置项：{overview.totalItems}
            </span>
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                overview.experimentalCount > 0
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              实验功能：{overview.experimentalCount}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              常用入口：
              {overview.quickAccessItems.length + (onOpenCompanion ? 1 : 0)}
            </span>
          </div>
        </div>
      </section>

      {overview.quickAccessItems.length > 0 || onOpenCompanion ? (
        <section className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                常用入口
                <WorkbenchInfoTip
                  ariaLabel="常用入口说明"
                  content="把最常走的页面留在首屏，进入后再展开更细的设置项。"
                  tone="slate"
                />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                把高频页面放在首屏，减少设置中心内部跳转成本。
              </p>
            </div>

            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              {overview.quickAccessItems.length + (onOpenCompanion ? 1 : 0)} 项
            </span>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {overview.quickAccessItems.map((item) => {
              const meta = quickAccessMeta[item.key];
              if (!meta) {
                return null;
              }
              const ItemIcon = meta.icon;
              return (
                <article
                  key={item.key}
                  className="group rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <button
                    type="button"
                    onMouseEnter={() => onTabPrefetch?.(item.key)}
                    onMouseDown={() => onTabPrefetch?.(item.key)}
                    onFocus={() => onTabPrefetch?.(item.key)}
                    onClick={() => onTabChange(item.key)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700">
                        <ItemIcon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </div>
                    <p className="mt-4 text-base font-semibold text-slate-900">
                      {meta.title}
                    </p>
                  </button>

                  <div className="mt-3 flex justify-end">
                    <WorkbenchInfoTip
                      ariaLabel={`${meta.title}说明`}
                      content={meta.description}
                      tone="slate"
                    />
                  </div>
                </article>
              );
            })}
            {onOpenCompanion ? (
              <article className="group rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
                <button
                  type="button"
                  onMouseEnter={() => onTabPrefetch?.(SettingsTabs.Providers)}
                  onMouseDown={() => onTabPrefetch?.(SettingsTabs.Providers)}
                  onFocus={() => onTabPrefetch?.(SettingsTabs.Providers)}
                  onClick={() => onOpenCompanion()}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700">
                      <Bot className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-slate-900">
                    桌宠
                  </p>
                </button>

                <div className="mt-3 flex justify-end">
                  <WorkbenchInfoTip
                    ariaLabel="桌宠说明"
                    content="开启桌宠、安装引导与连接诊断。"
                    tone="slate"
                  />
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        {overview.visibleGroups.map((group) => {
          const meta = groupMeta[group.key];
          const GroupIcon = meta.icon;

          return (
            <article
              key={group.key}
              className="relative overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5"
            >
              <div
                className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${meta.accentClassName}`}
              />
              <div className="relative p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${meta.iconClassName}`}
                    >
                      <GroupIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                        {group.title}
                      </h2>
                      <div className="mt-1">
                        <WorkbenchInfoTip
                          ariaLabel={`${group.title}说明`}
                          content={meta.description}
                          tone="slate"
                        />
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {group.items.length} 项
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => onTabChange(item.key)}
                      className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
                          <item.icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-800">
                            {item.label}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {item.experimental ? "实验能力" : "进入配置"}
                          </div>
                        </div>
                      </div>

                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </button>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
