import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Film,
  Image as ImageIcon,
  Mic,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  loadMediaServicesSection,
  preloadMediaServicesSection,
  type MediaServicesSection,
} from "./preload";

const ImageGenSettings = lazy(() =>
  loadMediaServicesSection("image").then((module) => ({
    default: (module as typeof import("../image-gen")).ImageGenSettings,
  })),
);
const VideoGenSettings = lazy(() =>
  loadMediaServicesSection("video").then((module) => ({
    default: (module as typeof import("../video-gen")).VideoGenSettings,
  })),
);
const VoiceSettings = lazy(() =>
  loadMediaServicesSection("voice").then((module) => ({
    default: (module as typeof import("../voice")).VoiceSettings,
  })),
);

interface MediaServiceTabMeta {
  value: MediaServicesSection;
  label: string;
  caption: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  badgeClassName: string;
  accentClassName: string;
  iconClassName: string;
  icon: LucideIcon;
}

const MEDIA_SERVICE_TABS: MediaServiceTabMeta[] = [
  {
    value: "image",
    label: "图片服务",
    caption: "出图模型与默认参数",
    description: "统一设置默认 Provider、模型、图像质量和生成偏好。",
    panelTitle: "图片生成默认策略",
    panelDescription:
      "适合统一新项目的出图入口、常用模型和默认质量参数，避免重复在项目里逐个配置。",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    accentClassName: "from-emerald-200/65 via-white to-sky-50/70",
    iconClassName: "border-emerald-200 bg-emerald-100 text-emerald-700",
    icon: ImageIcon,
  },
  {
    value: "video",
    label: "视频服务",
    caption: "视频生成与默认模型",
    description: "集中设置视频任务的默认 Provider、模型和回退策略。",
    panelTitle: "视频生成默认策略",
    panelDescription:
      "视频能力通常依赖更少但更重的服务源，把默认策略放在一起更便于维护和排障。",
    badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
    accentClassName: "from-sky-200/60 via-white to-slate-50/90",
    iconClassName: "border-sky-200 bg-sky-100 text-sky-700",
    icon: Film,
  },
  {
    value: "voice",
    label: "语音服务",
    caption: "配音、TTS 与 STT",
    description: "管理语音输入输出、默认模型和可选的交互参数。",
    panelTitle: "语音输入输出策略",
    panelDescription:
      "把配音、识别和基础语音交互放在同一页签内，可以更快判断当前语音链路是否完整。",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    accentClassName: "from-amber-200/65 via-white to-rose-50/60",
    iconClassName: "border-amber-200 bg-amber-100 text-amber-700",
    icon: Mic,
  },
];

interface MediaServicesSettingsProps {
  initialSection?: MediaServicesSection;
}

function getTabMeta(section: MediaServicesSection) {
  return (
    MEDIA_SERVICE_TABS.find((item) => item.value === section) ??
    MEDIA_SERVICE_TABS[0]
  );
}

function renderSectionContent(section: MediaServicesSection) {
  switch (section) {
    case "image":
      return <ImageGenSettings />;
    case "video":
      return <VideoGenSettings />;
    case "voice":
      return <VoiceSettings />;
    default:
      return null;
  }
}

function MediaServiceContentFallback({ label }: { label: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500">
      正在加载{label}配置...
    </div>
  );
}

export function MediaServicesSettings({
  initialSection = "image",
}: MediaServicesSettingsProps) {
  const [activeSection, setActiveSection] =
    useState<MediaServicesSection>(initialSection);
  const prefetchedSectionsRef = useRef<Set<MediaServicesSection>>(new Set());

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const handleSectionPrefetch = (section: MediaServicesSection) => {
    if (prefetchedSectionsRef.current.has(section)) {
      return;
    }

    prefetchedSectionsRef.current.add(section);
    void preloadMediaServicesSection(section).catch(() => {
      prefetchedSectionsRef.current.delete(section);
    });
  };

  const activeMeta = useMemo(() => getTabMeta(activeSection), [activeSection]);
  const ActiveIcon = activeMeta.icon;

  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(245,250,248,0.98)_0%,rgba(248,250,252,0.98)_48%,rgba(246,248,252,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-24 top-[-76px] h-60 w-60 rounded-full bg-emerald-200/28 blur-3xl" />
        <div className="pointer-events-none absolute right-[-72px] top-[-20px] h-56 w-56 rounded-full bg-sky-200/24 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-88px] left-1/3 h-56 w-56 rounded-full bg-amber-200/18 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-slate-600 shadow-sm">
                MEDIA SERVICES
              </span>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                    媒体服务
                  </h1>
                  <WorkbenchInfoTip
                    ariaLabel="媒体服务总览说明"
                    content="将图片、视频和语音的全局默认服务集中到一个工作台里管理，减少在侧栏来回切换，也让默认策略更容易统一。"
                    tone="mint"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/90 bg-white/82 p-5 shadow-sm xl:w-[340px]">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Sparkles className="h-4 w-4 text-slate-500" />
                统一入口
                <WorkbenchInfoTip
                  ariaLabel="统一入口说明"
                  content="图片、视频和语音只保留一个设置入口，正式切换交互放在下方 Tabs，Hero 只负责说明页面目的和当前焦点。"
                  tone="slate"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {MEDIA_SERVICE_TABS.map((item) => (
                  <span
                    key={item.value}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                      item.badgeClassName,
                    )}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/90 bg-white/86 p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                    activeMeta.iconClassName,
                  )}
                >
                  <ActiveIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                      {activeMeta.panelTitle}
                    </h2>
                    <WorkbenchInfoTip
                      ariaLabel={`${activeMeta.panelTitle}说明`}
                      content={activeMeta.panelDescription}
                      tone="slate"
                    />
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        activeMeta.badgeClassName,
                      )}
                    >
                      当前页签
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                <Sparkles className="h-3.5 w-3.5 text-slate-500" />
                统一管理默认 Provider、模型与关键行为
              </div>
            </div>
          </div>
        </div>
      </section>

      <Tabs
        value={activeSection}
        onValueChange={(value) =>
          setActiveSection(value as MediaServicesSection)
        }
        className="space-y-5"
      >
        <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5 lg:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-[0.14em] text-slate-500">
                统一管理
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                在一个视图里切换媒体能力
              </h2>
              <div className="mt-2">
                <WorkbenchInfoTip
                  ariaLabel="在一个视图里切换媒体能力说明"
                  content="三类能力共享同一页的上下文信息，但各自保留独立设置区域，避免页面拆散后产生重复认知成本。"
                  tone="slate"
                />
              </div>
            </div>

            <TabsList className="grid h-auto w-full max-w-[560px] grid-cols-1 gap-2 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-2 shadow-sm sm:grid-cols-3">
              {MEDIA_SERVICE_TABS.map((item) => {
                const ItemIcon = item.icon;
                const active = item.value === activeSection;

                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    onMouseEnter={() => handleSectionPrefetch(item.value)}
                    onMouseDown={() => handleSectionPrefetch(item.value)}
                    onFocus={() => handleSectionPrefetch(item.value)}
                    className={cn(
                      "h-auto rounded-[18px] border px-4 py-3 text-left",
                      active
                        ? "border-slate-300 bg-white text-slate-900 shadow-sm"
                        : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white/80 hover:text-slate-900",
                    )}
                  >
                    <div className="flex w-full items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border",
                          item.iconClassName,
                        )}
                      >
                        <ItemIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {item.label}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {item.caption}
                        </div>
                      </div>
                    </div>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </section>

        {MEDIA_SERVICE_TABS.map((item) => {
          const PanelIcon = item.icon;

          return (
            <TabsContent key={item.value} value={item.value} className="mt-0">
              <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
                <div
                  className={cn(
                    "absolute inset-x-0 top-0 h-24 bg-gradient-to-br",
                    item.accentClassName,
                  )}
                />
                <div className="relative space-y-5 p-4 lg:p-6">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-11 w-11 items-center justify-center rounded-2xl border",
                            item.iconClassName,
                          )}
                        >
                          <PanelIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                            {item.label}
                          </h3>
                          <div className="mt-1">
                            <WorkbenchInfoTip
                              ariaLabel={`${item.label}说明`}
                              content={item.description}
                              tone="slate"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
                        item.badgeClassName,
                      )}
                    >
                      独立配置区域
                    </span>
                  </div>

                  <Suspense
                    fallback={
                      <MediaServiceContentFallback label={item.label} />
                    }
                  >
                    {renderSectionContent(item.value)}
                  </Suspense>
                </div>
              </section>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
