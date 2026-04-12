import React, { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import {
  resolveConfiguredProviderPromptCacheSupportNotice,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";

interface InputbarPromptCacheNoticeProps {
  providerType: string;
}

export const InputbarPromptCacheNotice: React.FC<
  InputbarPromptCacheNoticeProps
> = ({ providerType }) => {
  const shouldInspectCapability = Boolean(providerType.trim());

  const { providers, loading: providersLoading } = useConfiguredProviders({
    autoLoad: shouldInspectCapability,
  });

  const notice = useMemo(() => {
    if (!shouldInspectCapability || providersLoading) {
      return null;
    }

    return resolveConfiguredProviderPromptCacheSupportNotice(
      providers,
      providerType,
    );
  }, [providerType, providers, providersLoading, shouldInspectCapability]);

  if (!notice) {
    return null;
  }

  return (
    <div
      data-testid="inputbar-prompt-cache-warning"
      className="mx-3 mb-2 flex items-start gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] leading-5 text-amber-800"
      title={notice.detail}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span>
        当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式{" "}
        cache_control 标记
      </span>
    </div>
  );
};
