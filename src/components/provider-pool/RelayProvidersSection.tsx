/**
 * @file RelayProvidersSection 组件
 * @description 中转商列表展示组件，支持浏览和一键跳转获取 API Key
 * @module components/provider-pool/RelayProvidersSection
 *
 * _Requirements: Connect 中转商浏览功能_
 */

import { useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  Globe,
  Mail,
  MessageCircle,
  Shield,
  ShieldCheck,
  Zap,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useRelayRegistry } from "@/hooks/useRelayRegistry";
import type { RelayInfo } from "@/hooks/useDeepLink";
import { open } from "@tauri-apps/plugin-shell";

/**
 * 中转商卡片组件
 */
function RelayProviderCard({ provider }: { provider: RelayInfo }) {
  const [imageError, setImageError] = useState(false);
  const primaryActionButtonClassName =
    "rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] text-sm font-medium text-white shadow-sm shadow-emerald-950/15 hover:opacity-95 transition-colors";

  // 打开外部链接
  const handleOpenLink = async (url: string) => {
    try {
      await open(url);
    } catch (e) {
      console.error("打开链接失败:", e);
      // 回退到 window.open
      window.open(url, "_blank");
    }
  };

  // 获取 API Key 的链接（优先使用 dashboard，其次 website）
  const getApiKeyLink = () => {
    return provider.links.dashboard || provider.links.website;
  };

  return (
    <div className="rounded-lg border bg-card p-4 hover:border-primary/50 transition-colors">
      {/* 头部：Logo + 名称 */}
      <div className="flex items-start gap-3 mb-3">
        {/* Logo */}
        <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
          {provider.branding.logo && !imageError ? (
            <img
              src={provider.branding.logo}
              alt={provider.name}
              className="w-full h-full object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <Globe className="w-6 h-6 text-muted-foreground" />
          )}
        </div>

        {/* 名称和描述 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground truncate">
              {provider.name}
            </h3>
            {provider.features.verified && (
              <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
            {provider.description}
          </p>
        </div>
      </div>

      {/* API 信息 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
          <Zap className="w-3 h-3" />
          {provider.api.protocol.toUpperCase()}
        </span>
        {provider.features.streaming && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
            流式响应
          </span>
        )}
        {provider.features.models && provider.features.models.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
            {provider.features.models.length} 个模型
          </span>
        )}
      </div>

      {/* 功能特性 */}
      {provider.features.models && provider.features.models.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">支持模型：</p>
          <div className="flex flex-wrap gap-1">
            {provider.features.models.slice(0, 5).map((model) => (
              <span
                key={model}
                className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground"
              >
                {model}
              </span>
            ))}
            {provider.features.models.length > 5 && (
              <span className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
                +{provider.features.models.length - 5}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-3 border-t">
        {getApiKeyLink() && (
          <button
            onClick={() => handleOpenLink(getApiKeyLink()!)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 ${primaryActionButtonClassName}`}
          >
            <ExternalLink className="w-4 h-4" />
            获取 API Key
          </button>
        )}

        {provider.links.docs && (
          <button
            onClick={() => handleOpenLink(provider.links.docs!)}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border text-sm hover:bg-muted transition-colors"
            title="查看文档"
          >
            <Globe className="w-4 h-4" />
          </button>
        )}

        {provider.contact.email && (
          <button
            onClick={() => handleOpenLink(`mailto:${provider.contact.email}`)}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border text-sm hover:bg-muted transition-colors"
            title="联系邮箱"
          >
            <Mail className="w-4 h-4" />
          </button>
        )}

        {provider.contact.discord && (
          <button
            onClick={() => handleOpenLink(provider.contact.discord!)}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border text-sm hover:bg-muted transition-colors"
            title="Discord"
          >
            <MessageCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 中转商列表组件
 */
export function RelayProvidersSection() {
  const { providers, isLoading, error, refresh } = useRelayRegistry();

  return (
    <div className="space-y-4">
      {/* 头部说明 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Lime Connect</h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            浏览已验证的 AI API 中转服务商，获取 API Key
            后可通过链接一键添加到凭证池
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error.message}</span>
          <button
            onClick={refresh}
            className="ml-auto text-sm underline hover:no-underline"
          >
            重试
          </button>
        </div>
      )}

      {/* 加载状态 */}
      {isLoading && providers.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* 空状态 */}
      {!isLoading && providers.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Clock className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg">暂无中转商</p>
          <p className="text-sm mt-1">点击刷新按钮加载中转商列表</p>
          <button
            onClick={refresh}
            className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2 text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
          >
            <RefreshCw className="w-4 h-4" />
            加载中转商
          </button>
        </div>
      )}

      {/* 中转商列表 */}
      {providers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((provider) => (
            <RelayProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      )}

      {/* 底部说明 */}
      {providers.length > 0 && (
        <div className="text-center text-xs text-muted-foreground pt-4 border-t">
          <p>
            获取 API Key 后，中转商会提供一个 <code>lime://</code>{" "}
            链接，点击即可一键添加到凭证池
          </p>
        </div>
      )}
    </div>
  );
}

export default RelayProvidersSection;
