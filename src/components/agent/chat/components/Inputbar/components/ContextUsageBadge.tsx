import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { subscribeAppServerNotifications } from "@/lib/api/appServerEventBus";
import { useComposerEditorPreferences } from "@/lib/composerEditorPreferences";

interface ContextUsage {
  totalTokens: number;
  contextWindow: number;
}

function readUsage(params: unknown): ContextUsage | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const tokenUsage =
    record.tokenUsage && typeof record.tokenUsage === "object"
      ? (record.tokenUsage as Record<string, unknown>)
      : null;
  const total =
    tokenUsage?.total && typeof tokenUsage.total === "object"
      ? (tokenUsage.total as Record<string, unknown>)
      : null;
  const totalTokens =
    typeof total?.totalTokens === "number" ? total.totalTokens : null;
  const contextWindow =
    typeof tokenUsage?.modelContextWindow === "number"
      ? tokenUsage.modelContextWindow
      : null;
  if (!totalTokens || !contextWindow || contextWindow <= 0) return null;
  return { totalTokens, contextWindow };
}

export function ContextUsageBadge({ threadId }: { threadId?: string | null }) {
  const { t } = useTranslation("agent");
  const { showContextWindowUsage } = useComposerEditorPreferences();
  const [usage, setUsage] = useState<ContextUsage | null>(null);

  useEffect(() => {
    setUsage(null);
    const activeThreadId = threadId?.trim();
    if (!activeThreadId) return;
    return subscribeAppServerNotifications({
      onNotifications: (notifications) => {
        for (const notification of notifications) {
          if (notification.method !== "thread/tokenUsage/updated") continue;
          const params = notification.params as { threadId?: unknown } | undefined;
          if (params?.threadId !== activeThreadId) continue;
          const next = readUsage(notification.params);
          if (next) setUsage(next);
        }
      },
    });
  }, [threadId]);

  if (!showContextWindowUsage || !usage) return null;
  const percent = Math.min(
    100,
    Math.max(1, Math.round((usage.totalTokens / usage.contextWindow) * 100)),
  );
  const label = t("agentChat.inputbar.contextUsage.label", {
    percent,
    defaultValue: "上下文 {{percent}}%",
  });
  const title = t("agentChat.inputbar.contextUsage.title", {
    used: usage.totalTokens,
    total: usage.contextWindow,
    defaultValue: "上下文窗口已用 {{used}} / {{total}} tokens",
  });
  return (
    <span
      data-testid="composer-context-usage"
      title={title}
      className="whitespace-nowrap px-1 text-[11px] tabular-nums text-muted-foreground"
    >
      {label}
    </span>
  );
}
