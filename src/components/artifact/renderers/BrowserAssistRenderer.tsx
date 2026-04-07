/**
 * @file Browser Assist Artifact 渲染器
 * @description 仅展示浏览器协助状态说明，不再在 Claw 画布中嵌入浏览器工作台
 * @module components/artifact/renderers/BrowserAssistRenderer
 */

import React, { memo } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { ArtifactRendererProps } from "@/lib/artifact/types";

function readMetaString(
  meta: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export const BrowserAssistRenderer: React.FC<ArtifactRendererProps> = memo(
  ({ artifact }) => {
    const initialSessionId = readMetaString(
      artifact.meta,
      "sessionId",
      "session_id",
    );
    const initialProfileKey = readMetaString(
      artifact.meta,
      "profileKey",
      "profile_key",
    );
    const initialTargetId = readMetaString(
      artifact.meta,
      "targetId",
      "target_id",
    );
    const launchState = readMetaString(
      artifact.meta,
      "launchState",
      "launch_state",
    );
    const launchHint = readMetaString(
      artifact.meta,
      "launchHint",
      "launch_hint",
    );
    const launchUrl = readMetaString(artifact.meta, "url", "launchUrl");
    const launchError =
      artifact.error ||
      readMetaString(artifact.meta, "launchError", "launch_error");

    if (artifact.status === "pending" || launchState === "launching") {
      return (
        <div className="flex h-full items-center justify-center bg-background p-6">
          <div className="max-w-lg rounded-2xl border border-border/70 bg-card/70 p-6 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-300">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <div className="text-base font-semibold text-foreground">
              正在启动浏览器协助
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {launchHint ||
                "正在启动 Chrome 并准备浏览器工作台会话，通常需要 3–8 秒。"}
            </p>
            {launchUrl ? (
              <div className="mt-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                {launchUrl}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (artifact.status === "error" || launchState === "failed") {
      return (
        <div className="flex h-full items-center justify-center bg-background p-6">
          <div className="max-w-lg rounded-2xl border border-destructive/25 bg-destructive/5 p-6 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="text-base font-semibold text-foreground">
              浏览器协助启动失败
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {launchError || "未能建立浏览器实时会话，请稍后重试。"}
            </p>
            {launchUrl ? (
              <div className="mt-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                {launchUrl}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (!initialSessionId && !initialProfileKey) {
      return (
        <div className="flex h-full items-center justify-center bg-background p-6">
          <div className="max-w-md rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="text-base font-semibold text-foreground">
              浏览器协助尚未就绪
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              当前 Artifact
              缺少可附着的浏览器会话信息，请重新从通用对话启动浏览器协助。
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-lg rounded-2xl border border-border/70 bg-card/70 p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="text-base font-semibold text-foreground">
            浏览器协助已迁移到浏览器工作台
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Claw
            不再在当前工作区中渲染浏览器实时画面。请从首页、顶栏或技能入口打开浏览器工作台继续接管与调试。
          </p>
          {launchUrl ? (
            <div className="mt-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
              {launchUrl}
            </div>
          ) : null}
          {initialSessionId || initialProfileKey || initialTargetId ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {initialSessionId
                ? `当前会话 ${initialSessionId} 已可用于浏览器工作台接管。`
                : `当前配置 ${initialProfileKey || initialTargetId} 已可用于浏览器工作台接管。`}
            </p>
          ) : null}
        </div>
      </div>
    );
  },
);

BrowserAssistRenderer.displayName = "BrowserAssistRenderer";

export default BrowserAssistRenderer;
