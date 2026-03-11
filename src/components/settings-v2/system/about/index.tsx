import { useState, useEffect } from "react";
import {
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  checkForUpdates,
  downloadUpdate,
  type DownloadUpdateResult,
  type VersionInfo,
} from "@/lib/api/appUpdate";
import { ProviderIcon } from "@/icons/providers";

const FALLBACK_TAGS_URL = "https://github.com/aiclientproxy/proxycast/tags";

const CREATIVE_THEMES = [
  "通用对话",
  "社媒内容",
  "图文海报",
  "歌词曲谱",
  "知识探索",
  "计划规划",
  "办公文档",
  "短视频",
  "小说创作",
] as const;

const QUICK_START_STEPS = [
  "选主题：按目标进入对应创作主题",
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
  const manualDownloadUrl = versionInfo.downloadUrl || FALLBACK_TAGS_URL;

  // 加载当前版本号（从后端获取，确保与 Cargo.toml 同步）
  useEffect(() => {
    const loadCurrentVersion = async () => {
      try {
        // check_for_updates 会返回当前版本号
        const result = await checkForUpdates();
        setVersionInfo((prev) => ({
          ...prev,
          current: result.current,
          downloadUrl: result.downloadUrl || FALLBACK_TAGS_URL,
        }));
      } catch (error) {
        console.error("Failed to load version:", error);
        setVersionInfo((prev) => ({
          ...prev,
          downloadUrl: prev.downloadUrl || FALLBACK_TAGS_URL,
        }));
      }
    };
    loadCurrentVersion();
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setDownloadResult(null);
    try {
      const result = await checkForUpdates();
      setVersionInfo({
        ...result,
        downloadUrl: result.downloadUrl || FALLBACK_TAGS_URL,
      });
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo((prev) => ({
        ...prev,
        error: t("检查更新失败", "检查更新失败"),
        downloadUrl: prev.downloadUrl || FALLBACK_TAGS_URL,
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
        // 下载成功，显示安装提示
        setTimeout(() => {
          setDownloadResult({
            ...result,
            message: t(
              "安装程序已启动，应用将自动关闭以完成更新",
              "安装程序已启动，应用将自动关闭以完成更新",
            ),
          });
        }, 1000);
      } else {
        // 下载失败，显示错误信息
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

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 应用信息 */}
      <div className="p-6 rounded-lg border text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
          <ProviderIcon providerType="proxycast" size={40} />
        </div>

        <div>
          <h2 className="text-xl font-bold">ProxyCast</h2>
          <p className="text-sm text-muted-foreground">
            {t("创作类 AI Agent 平台", "创作类 AI Agent 平台")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t(
              "把灵感、写作、出图、改稿、沉淀放进同一个工作台",
              "把灵感、写作、出图、改稿、沉淀放进同一个工作台",
            )}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-sm">
            {t("版本 {{version}}", {
              version: versionInfo.current,
              defaultValue: "版本 {{version}}",
            })}
          </span>
          {versionInfo.hasUpdate ? (
            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">
              {t("有新版本 {{version}}", {
                version: versionInfo.latest ?? "",
                defaultValue: "有新版本 {{version}}",
              })}
            </span>
          ) : versionInfo.error ? (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {versionInfo.error}
            </span>
          ) : versionInfo.latest ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" />
              {t("已是最新", "已是最新")}
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-2">
          <button
            onClick={handleCheckUpdate}
            disabled={checking || downloading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${checking ? "animate-spin" : ""}`}
            />
            {t("检查更新", "检查更新")}
          </button>

          {versionInfo.hasUpdate && (
            <>
              <button
                onClick={handleDownloadUpdate}
                disabled={downloading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${downloading ? "animate-spin" : ""}`}
                />
                {downloading
                  ? t("下载中...", "下载中...")
                  : t("下载更新", "下载更新")}
              </button>

              <a
                href={manualDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm hover:bg-muted"
              >
                <ExternalLink className="h-4 w-4" />
                {t("网页下载", "网页下载")}
              </a>
            </>
          )}
        </div>

        {/* 下载结果提示 */}
        {downloadResult && (
          <div
            className={`mt-2 p-3 rounded-lg text-sm ${
              downloadResult.success
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            <div className="flex items-start gap-2">
              {downloadResult.success ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p>{downloadResult.message}</p>
                {!downloadResult.success && (
                  <a
                    href={manualDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 underline hover:no-underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("前往网页下载", "前往网页下载")}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 链接 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("相关链接", "相关链接")}</h3>
        <div className="space-y-2">
          <a
            href="https://github.com/aiclientproxy/proxycast"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
          >
            <span className="text-sm">{t("GitHub 仓库", "GitHub 仓库")}</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
          <a
            href="https://aiclientproxy.github.io/proxycast/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
          >
            <span className="text-sm">{t("文档", "文档")}</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
          <a
            href="https://github.com/aiclientproxy/proxycast/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50"
          >
            <span className="text-sm">{t("问题反馈", "问题反馈")}</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
        </div>
      </div>

      {/* 产品定位 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("产品定位", "产品定位")}</h3>
        <div className="p-4 rounded-lg border space-y-2">
          <p className="text-sm text-muted-foreground">
            {t(
              "ProxyCast 是面向普通创作者的 AI Agent 平台。你不需要先懂复杂设置，只要带着一个想法进来，就可以在同一处完成对话定方向、生成内容与素材、持续迭代修改，并把结果沉淀成可复用资产。",
              "ProxyCast 是面向普通创作者的 AI Agent 平台。你不需要先懂复杂设置，只要带着一个想法进来，就可以在同一处完成对话定方向、生成内容与素材、持续迭代修改，并把结果沉淀成可复用资产。",
            )}
          </p>
          <p className="text-sm">
            <span className="font-medium">{t("一句话：", "一句话：")}</span>
            {t("从“想到”直接走到“可发布”。", "从“想到”直接走到“可发布”。")}
          </p>
        </div>
      </div>

      {/* 创作主题 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("支持的创作主题", "支持的创作主题")}
        </h3>
        <div className="p-4 rounded-lg border">
          <div className="flex flex-wrap gap-2">
            {CREATIVE_THEMES.map((theme) => (
              <span
                key={theme}
                className="px-2.5 py-1 rounded-full bg-muted text-sm text-muted-foreground"
              >
                {t(theme, theme)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 快速开始 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("3 步开始创作", "3 步开始创作")}
        </h3>
        <div className="p-4 rounded-lg border">
          <ol className="space-y-2 list-decimal pl-5 text-sm text-muted-foreground">
            {QUICK_START_STEPS.map((step) => (
              <li key={step}>{t(step, step)}</li>
            ))}
          </ol>
        </div>
      </div>

      {/* 适合谁 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("适合谁", "适合谁")}</h3>
        <div className="p-4 rounded-lg border">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {TARGET_USERS.map((user) => (
              <li key={user} className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{t(user, user)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 可选能力说明 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("可选能力", "可选能力")}</h3>
        <div className="space-y-2">
          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
            {t(
              "团队共享网关用于在局域网内统一暴露兼容 OpenAI/Anthropic 的接口，便于团队复用同一套 Provider 策略与默认模型；单人创作场景可不启用。",
              "团队共享网关用于在局域网内统一暴露兼容 OpenAI/Anthropic 的接口，便于团队复用同一套 Provider 策略与默认模型；单人创作场景可不启用。",
            )}
          </div>
          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
            {t(
              "常见凭证路径：Kiro `~/.kiro/kiro_creds.json`、Gemini CLI `~/.gemini/oauth_creds.json`、Qwen `~/.qwen-coder/auth.json`。",
              "常见凭证路径：Kiro `~/.kiro/kiro_creds.json`、Gemini CLI `~/.gemini/oauth_creds.json`、Qwen `~/.qwen-coder/auth.json`。",
            )}
          </div>
        </div>
      </div>

      {/* 版权信息 */}
      <div className="text-center text-xs text-muted-foreground pt-4 border-t">
        <p>
          {t(
            "Made with love for creators & builders",
            "Made with love for creators & builders",
          )}
        </p>
        <p className="mt-1">2025-2026 ProxyCast</p>
      </div>
    </div>
  );
}
