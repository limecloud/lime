import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  ExternalLink,
  Layers3,
  RefreshCw,
  Rocket,
  Sparkles,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  checkForUpdates,
  downloadUpdate,
  type DownloadUpdateResult,
  type VersionInfo,
} from "@/lib/api/appUpdate";
import { cn } from "@/lib/utils";

const FALLBACK_RELEASES_URL = "https://github.com/aiclientproxy/lime/releases";

const WORKSPACE_FOCUSES = [
  "Claw 对话与技能执行",
  "浏览器协助与站点任务",
  "工作区资源沉淀",
  "项目与素材持续迭代",
] as const;

const QUICK_START_STEPS = [
  "进入 Claw：从主入口直接开始对话、技能或任务",
  "给输入：一句需求、一个方向或一份素材都可以",
  "持续迭代：边聊边改边沉淀，最终得到可发布结果",
] as const;

const TARGET_USERS = [
  "自媒体创作者",
  "短视频团队",
  "小说与剧情创作者",
  "运营与品牌内容团队",
  "需要长期沉淀创作资产的个人与小团队",
] as const;

const PRODUCT_CAPABILITIES = [
  "Lime 以本机 AI Agent 工作台为核心，默认围绕主题工作台、资源沉淀与创作链路组织能力。",
  "常见凭证路径：Kiro `~/.kiro/kiro_creds.json`、Gemini CLI `~/.gemini/oauth_creds.json`、Qwen `~/.qwen-coder/auth.json`。",
] as const;

const RELATED_LINKS = [
  {
    href: "https://github.com/aiclientproxy/lime",
    label: "GitHub 仓库",
    description: "查看源码、版本历史和讨论。",
  },
  {
    href: "https://aiclientproxy.github.io/lime/",
    label: "文档",
    description: "阅读安装、配置与使用说明。",
  },
  {
    href: "https://github.com/aiclientproxy/lime/issues",
    label: "问题反馈",
    description: "提交 bug、改进建议和排障信息。",
  },
] as const;

function formatUpdateDate(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

interface AboutPanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}

function AboutPanel({
  icon: Icon,
  title,
  description,
  children,
  aside,
}: AboutPanelProps) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function AboutStat({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/90 bg-white/86 p-4 shadow-sm">
      <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

export function AboutSection() {
  const { t } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    current: "",
    latest: undefined,
    hasUpdate: false,
    downloadUrl: undefined,
    error: undefined,
  });
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] =
    useState<DownloadUpdateResult | null>(null);
  const manualDownloadUrl = versionInfo.downloadUrl || FALLBACK_RELEASES_URL;
  const isWindows =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

  useEffect(() => {
    const loadCurrentVersion = async () => {
      try {
        const result = await checkForUpdates();
        setVersionInfo({
          ...result,
          downloadUrl: result.downloadUrl || FALLBACK_RELEASES_URL,
        });
      } catch (error) {
        console.error("Failed to load version:", error);
        setVersionInfo((prev) => ({
          ...prev,
          downloadUrl: prev.downloadUrl || FALLBACK_RELEASES_URL,
        }));
      }
    };

    void loadCurrentVersion();
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setDownloadResult(null);
    try {
      const result = await checkForUpdates();
      setVersionInfo({
        ...result,
        downloadUrl: result.downloadUrl || FALLBACK_RELEASES_URL,
      });
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo((prev) => ({
        ...prev,
        error: t("检查更新失败", "检查更新失败"),
        downloadUrl: prev.downloadUrl || FALLBACK_RELEASES_URL,
      }));
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setDownloading(true);
    setDownloadResult(null);
    try {
      const result = await downloadUpdate();
      setDownloadResult(result);

      if (result.success) {
        setTimeout(() => {
          setDownloadResult({
            ...result,
            message: t(
              "更新已安装，应用将自动重启以完成升级",
              "更新已安装，应用将自动重启以完成升级",
            ),
          });
        }, 1000);
      } else {
        console.error("Download failed:", result.message);
      }
    } catch (error) {
      console.error("Failed to download update:", error);
      setDownloadResult({
        success: false,
        message: t("下载失败，请手动下载最新版", "下载失败，请手动下载最新版"),
        filePath: undefined,
      });
    } finally {
      setDownloading(false);
    }
  };

  const versionBadge = useMemo(() => {
    if (versionInfo.hasUpdate) {
      return {
        label: t("可更新到 {{version}}", {
          version: versionInfo.latest ?? "",
          defaultValue: "可更新到 {{version}}",
        }),
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }

    if (versionInfo.error) {
      return {
        label: versionInfo.error,
        className: "border-rose-200 bg-rose-50 text-rose-700",
      };
    }

    if (versionInfo.latest) {
      return {
        label: t("当前已是最新版本", "当前已是最新版本"),
        className: "border-slate-200 bg-slate-100 text-slate-600",
      };
    }

    return {
      label: t("可手动检查更新", "可手动检查更新"),
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }, [t, versionInfo.error, versionInfo.hasUpdate, versionInfo.latest]);

  const releaseNotesPreview = useMemo(() => {
    const notes = versionInfo.releaseNotes?.trim();
    if (!notes) {
      return null;
    }

    return notes.length > 220 ? `${notes.slice(0, 220)}...` : notes;
  }, [versionInfo.releaseNotes]);

  const updatePublishedAt = useMemo(
    () => formatUpdateDate(versionInfo.pubDate),
    [versionInfo.pubDate],
  );

  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(245,250,248,0.98)_0%,rgba(255,255,255,0.98)_52%,rgba(242,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/28 blur-3xl" />
        <div className="pointer-events-none absolute right-[-80px] top-[-18px] h-56 w-56 rounded-full bg-sky-200/24 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <div className="max-w-3xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                ABOUT LIME
              </span>

              <div className="space-y-2">
                <h2 className="text-[28px] font-semibold tracking-tight text-slate-900">
                  把灵感、素材、出图、改稿和沉淀放进同一个创作工作台
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-slate-600">
                  {t(
                    "Lime 面向真实创作流程而不是单点问答。你可以从一句模糊需求开始，在同一个空间里完成方向判断、内容生成、素材制作和结果沉淀。",
                    "Lime 面向真实创作流程而不是单点问答。你可以从一句模糊需求开始，在同一个空间里完成方向判断、内容生成、素材制作和结果沉淀。",
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  {t(
                    "一句话：从“想到”直接走到“可发布”",
                    "一句话：从“想到”直接走到“可发布”",
                  )}
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  {t(
                    "支持多主题创作与跨媒介工作流",
                    "支持多主题创作与跨媒介工作流",
                  )}
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  {t(
                    "适合个人创作者与小团队长期沉淀资产",
                    "适合个人创作者与小团队长期沉淀资产",
                  )}
                </span>
              </div>
            </div>

            <article className="flex h-full flex-col rounded-[26px] border border-white/90 bg-white/84 p-5 shadow-sm shadow-slate-950/5 backdrop-blur-[2px]">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-gradient-to-br from-slate-900 to-slate-700 shadow-sm shadow-slate-950/20">
                  <img
                    src="/logo.png"
                    alt="Lime"
                    className="h-10 w-10 object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold tracking-tight text-slate-900">
                      Lime
                    </h3>
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        versionBadge.className,
                      )}
                    >
                      {versionBadge.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {t("创作类 AI Agent 平台", "创作类 AI Agent 平台")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {t("当前版本 {{version}}", {
                      version: versionInfo.current || t("读取中", "读取中"),
                      defaultValue: "当前版本 {{version}}",
                    })}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleCheckUpdate()}
                  disabled={checking || downloading}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", checking && "animate-spin")}
                  />
                  {t("检查更新", "检查更新")}
                </button>

                {versionInfo.hasUpdate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleDownloadUpdate()}
                      disabled={downloading}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={cn("h-4 w-4", downloading && "animate-spin")}
                      />
                      {downloading
                        ? t("下载中...", "下载中...")
                        : t("下载更新", "下载更新")}
                    </button>
                    <a
                      href={manualDownloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {t("网页下载", "网页下载")}
                    </a>
                  </>
                ) : null}
              </div>

              {isWindows ? (
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  {t(
                    "Windows 默认下载在线安装包；如果处于离线、内网或受限网络环境，请在网页下载页改用 offline 安装包。",
                    "Windows 默认下载在线安装包；如果处于离线、内网或受限网络环境，请在网页下载页改用 offline 安装包。",
                  )}
                </p>
              ) : null}

              {versionInfo.hasUpdate &&
              (releaseNotesPreview || updatePublishedAt) ? (
                <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/85 p-4 text-sm text-slate-600 shadow-sm shadow-slate-950/5">
                  <p className="font-medium text-slate-700">
                    {t("最新版本 {{version}}", {
                      version: versionInfo.latest ?? "",
                      defaultValue: "最新版本 {{version}}",
                    })}
                    {updatePublishedAt
                      ? ` · ${t("发布时间 {{date}}", {
                          date: updatePublishedAt,
                          defaultValue: "发布时间 {{date}}",
                        })}`
                      : ""}
                  </p>
                  {releaseNotesPreview ? (
                    <p className="mt-2 text-xs leading-6 text-slate-500">
                      {releaseNotesPreview}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {downloadResult ? (
                <div
                  className={cn(
                    "mt-4 rounded-[20px] border p-4 text-sm shadow-sm shadow-slate-950/5",
                    downloadResult.success
                      ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                      : "border-rose-200 bg-rose-50/90 text-rose-700",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p>{downloadResult.message}</p>
                      {!downloadResult.success ? (
                        <a
                          href={manualDownloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 underline hover:no-underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("前往网页下载", "前往网页下载")}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AboutStat
              label={t("工作区主线", "工作区主线")}
              value={WORKSPACE_FOCUSES.length.toString()}
              description={t(
                "围绕 Claw、浏览器协助、资源沉淀与项目迭代组织主路径。",
                "围绕 Claw、浏览器协助、资源沉淀与项目迭代组织主路径。",
              )}
            />
            <AboutStat
              label={t("起步步骤", "起步步骤")}
              value={QUICK_START_STEPS.length.toString()}
              description={t(
                "从进入工作区到持续迭代，压缩成清晰的三步流程。",
                "从进入工作区到持续迭代，压缩成清晰的三步流程。",
              )}
            />
            <AboutStat
              label={t("目标人群", "目标人群")}
              value={TARGET_USERS.length.toString()}
              description={t(
                "既适合单人创作，也适合需要共用策略的小团队。",
                "既适合单人创作，也适合需要共用策略的小团队。",
              )}
            />
            <AboutStat
              label={t("官方入口", "官方入口")}
              value={RELATED_LINKS.length.toString()}
              description={t(
                "源码、文档和 issue 入口集中保留，方便反馈和跟进。",
                "源码、文档和 issue 入口集中保留，方便反馈和跟进。",
              )}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <div className="space-y-6">
          <AboutPanel
            icon={Compass}
            title={t("产品定位", "产品定位")}
            description={t(
              "先说明产品解决什么问题，再说明为什么它和传统聊天工具不同。",
              "先说明产品解决什么问题，再说明为什么它和传统聊天工具不同。",
            )}
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-7 text-slate-600">
                {t(
                  "Lime 是面向普通创作者的 AI Agent 平台。你不需要先懂复杂设置，只要带着一个想法进来，就可以在同一处完成对话定方向、生成内容与素材、持续迭代修改，并把结果沉淀成可复用资产。",
                  "Lime 是面向普通创作者的 AI Agent 平台。你不需要先懂复杂设置，只要带着一个想法进来，就可以在同一处完成对话定方向、生成内容与素材、持续迭代修改，并把结果沉淀成可复用资产。",
                )}
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {t("一句话总结", "一句话总结")}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {t(
                    "从“想到”直接走到“可发布”。",
                    "从“想到”直接走到“可发布”。",
                  )}
                </p>
              </div>
            </div>
          </AboutPanel>

          <AboutPanel
            icon={Rocket}
            title={t("3 步开始创作", "3 步开始创作")}
            description={t(
              "把首次上手流程压缩成三步，避免用户在设置里迷路。",
              "把首次上手流程压缩成三步，避免用户在设置里迷路。",
            )}
          >
            <div className="grid gap-3 lg:grid-cols-3">
              {QUICK_START_STEPS.map((step, index) => (
                <div
                  key={step}
                  className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
                    {index + 1}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {t(step, step)}
                  </p>
                </div>
              ))}
            </div>
          </AboutPanel>

          <AboutPanel
            icon={Users}
            title={t("适合谁", "适合谁")}
            description={t(
              "更像是创作工作台而不是纯聊天窗口，因此目标人群也更明确。",
              "更像是创作工作台而不是纯聊天窗口，因此目标人群也更明确。",
            )}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {TARGET_USERS.map((user) => (
                <div
                  key={user}
                  className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-2 inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <p className="text-sm leading-6 text-slate-600">
                      {t(user, user)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </AboutPanel>
        </div>

        <div className="space-y-6">
          <AboutPanel
            icon={Layers3}
            title={t("工作区主线", "工作区主线")}
            description={t(
              "这里保留当前分支仍然承载的主路径，不再把工作区能力包装成独立主题集合。",
              "这里保留当前分支仍然承载的主路径，不再把工作区能力包装成独立主题集合。",
            )}
            aside={
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {WORKSPACE_FOCUSES.length} {t("项", "项")}
              </span>
            }
          >
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_FOCUSES.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600"
                >
                  {t(item, item)}
                </span>
              ))}
            </div>
          </AboutPanel>

          <AboutPanel
            icon={BookOpen}
            title={t("相关链接", "相关链接")}
            description={t(
              "源码、文档和问题反馈保持直达，减少寻找成本。",
              "源码、文档和问题反馈保持直达，减少寻找成本。",
            )}
          >
            <div className="space-y-3">
              {RELATED_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {t(link.label, link.label)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {t(link.description, link.description)}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                </a>
              ))}
            </div>
          </AboutPanel>

          <AboutPanel
            icon={Wand2}
            title={t("可选能力", "可选能力")}
            description={t(
              "这两类说明更偏进阶使用场景，不应和主叙事混在一起。",
              "这两类说明更偏进阶使用场景，不应和主叙事混在一起。",
            )}
          >
            <div className="space-y-3">
              {PRODUCT_CAPABILITIES.map((item) => (
                <div
                  key={item}
                  className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-6 text-slate-600"
                >
                  {t(item, item)}
                </div>
              ))}
            </div>
          </AboutPanel>
        </div>
      </div>

      <section className="rounded-[26px] border border-slate-200/80 bg-white p-5 text-center shadow-sm shadow-slate-950/5">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          {t("Made for creators & builders", "Made for creators & builders")}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500">2025-2026 Lime</p>
      </section>
    </div>
  );
}
