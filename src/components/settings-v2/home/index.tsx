import {
  ArrowRight,
  Blocks,
  Brain,
  Image as ImageIcon,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import {
  useSettingsCategory,
  type CategoryGroup,
  type CategoryItem,
} from "../hooks/useSettingsCategory";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";

interface SettingsHomePageProps {
  onTabChange: (tab: SettingsTabs) => void;
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
    accentClassName:
      "from-slate-200/70 via-white to-white",
    iconClassName: "border-slate-200 bg-slate-100 text-slate-700",
    icon: Settings2,
  },
  general: {
    description: "外观、快捷键、记忆等全局体验配置。",
    accentClassName:
      "from-sky-200/60 via-white to-white",
    iconClassName: "border-sky-200 bg-sky-100 text-sky-700",
    icon: Palette,
  },
  agent: {
    description: "服务商、技能与媒体能力的统一配置。",
    accentClassName:
      "from-emerald-200/70 via-white to-white",
    iconClassName: "border-emerald-200 bg-emerald-100 text-emerald-700",
    icon: Brain,
  },
  system: {
    description: "渠道、MCP、环境变量与安全性能设置。",
    accentClassName:
      "from-amber-200/65 via-white to-white",
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
    title: "媒体服务",
    description: "集中管理图片、视频与语音默认策略",
    icon: ImageIcon,
  },
  [SettingsTabs.SecurityPerformance]: {
    title: "安全与性能",
    description: "权限、稳定性与运行开关",
    icon: ShieldCheck,
  },
};

export function SettingsHomePage({ onTabChange }: SettingsHomePageProps) {
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
      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />
        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                SETTINGS OVERVIEW
              </span>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                  设置首页
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  在一个总览页里快速进入常用设置，减少在多层菜单之间来回寻找。
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
              <div className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">设置分组</p>
                <p className="mt-1 text-xs text-slate-500">
                  账号、通用、智能体、系统
                </p>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  {overview.visibleGroups.length}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">可配置项</p>
                <p className="mt-1 text-xs text-slate-500">
                  当前设置中心入口总数
                </p>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  {overview.totalItems}
                </p>
              </div>
              <div className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">实验功能</p>
                <p className="mt-1 text-xs text-slate-500">
                  需要额外关注稳定性的入口
                </p>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  {overview.experimentalCount}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              常用入口
            </div>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              {overview.quickAccessItems.map((item) => {
                const meta = quickAccessMeta[item.key];
                if (!meta) {
                  return null;
                }
                const ItemIcon = meta.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => onTabChange(item.key)}
                    className="group rounded-[22px] border border-white/90 bg-white/90 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
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
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {meta.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

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
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {meta.description}
                      </p>
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

export default SettingsHomePage;
