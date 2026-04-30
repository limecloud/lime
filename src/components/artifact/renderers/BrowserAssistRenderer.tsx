/**
 * @file Browser Assist Artifact 渲染器
 * @description 仅展示浏览器协助状态说明，不再在 Claw 画布中嵌入浏览器工作台
 * @module components/artifact/renderers/BrowserAssistRenderer
 */

import React, { memo } from "react";
import {
  AlertCircle,
  Camera,
  Eye,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import type { ArtifactRendererProps } from "@/lib/artifact/types";

interface BrowserActionReplayItem {
  artifactKind?: string;
  toolName?: string;
  action?: string;
  status?: string;
  success?: boolean;
  sessionId?: string;
  targetId?: string;
  profileKey?: string;
  backend?: string;
  requestId?: string;
  lastUrl?: string;
  title?: string;
  entrySource?: string;
  observationAvailable?: boolean;
  screenshotAvailable?: boolean;
}

interface BrowserActionReplayIndex {
  actionCount: number;
  sessionCount: number;
  observationCount: number;
  screenshotCount: number;
  lastUrl?: string;
  sessionIds: string[];
  targetIds: string[];
  profileKeys: string[];
  items: BrowserActionReplayItem[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

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

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  return readMetaString(record, ...keys);
}

function readNumber(
  record: Record<string, unknown>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function readBoolean(
  record: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function readStringList(
  record: Record<string, unknown>,
  ...keys: string[]
): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

function normalizeReplayItem(value: unknown): BrowserActionReplayItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const item: BrowserActionReplayItem = {
    artifactKind: readString(record, "artifactKind", "artifact_kind"),
    toolName: readString(record, "toolName", "tool_name"),
    action: readString(record, "action"),
    status: readString(record, "status"),
    success: readBoolean(record, "success"),
    sessionId: readString(record, "sessionId", "session_id"),
    targetId: readString(record, "targetId", "target_id"),
    profileKey: readString(record, "profileKey", "profile_key"),
    backend: readString(record, "backend"),
    requestId: readString(record, "requestId", "request_id"),
    lastUrl: readString(record, "lastUrl", "last_url"),
    title: readString(record, "title"),
    entrySource: readString(record, "entrySource", "entry_source"),
    observationAvailable: readBoolean(
      record,
      "observationAvailable",
      "observation_available",
    ),
    screenshotAvailable: readBoolean(
      record,
      "screenshotAvailable",
      "screenshot_available",
    ),
  };

  return Object.values(item).some(
    (field) => field !== undefined && field !== "",
  )
    ? item
    : null;
}

function findBrowserActionIndexRecord(
  meta: Record<string, unknown>,
  content: string,
): Record<string, unknown> | null {
  const direct =
    asRecord(meta.browserActionIndex) || asRecord(meta.browser_action_index);
  if (direct) {
    return direct;
  }

  const modalityRuntimeContracts =
    asRecord(meta.modalityRuntimeContracts) ||
    asRecord(meta.modality_runtime_contracts);
  const snapshotIndex =
    asRecord(modalityRuntimeContracts?.snapshotIndex) ||
    asRecord(modalityRuntimeContracts?.snapshot_index);
  const nested =
    asRecord(snapshotIndex?.browserActionIndex) ||
    asRecord(snapshotIndex?.browser_action_index);
  if (nested) {
    return nested;
  }

  if (!content.trim()) {
    return null;
  }

  try {
    const parsed = asRecord(JSON.parse(content));
    if (!parsed) {
      return null;
    }
    return (
      asRecord(parsed.browserActionIndex) ||
      asRecord(parsed.browser_action_index) ||
      null
    );
  } catch {
    return null;
  }
}

function normalizeBrowserActionIndex(
  meta: Record<string, unknown>,
  content: string,
): BrowserActionReplayIndex | null {
  const record = findBrowserActionIndexRecord(meta, content);
  if (!record) {
    return null;
  }

  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems
    .map((item) => normalizeReplayItem(item))
    .filter((item): item is BrowserActionReplayItem => item !== null);
  const actionCount = readNumber(record, "actionCount", "action_count");
  const sessionCount = readNumber(record, "sessionCount", "session_count");
  const observationCount = readNumber(
    record,
    "observationCount",
    "observation_count",
  );
  const screenshotCount = readNumber(
    record,
    "screenshotCount",
    "screenshot_count",
  );

  if (
    actionCount === 0 &&
    sessionCount === 0 &&
    observationCount === 0 &&
    screenshotCount === 0 &&
    items.length === 0
  ) {
    return null;
  }

  return {
    actionCount,
    sessionCount,
    observationCount,
    screenshotCount,
    lastUrl: readString(record, "lastUrl", "last_url"),
    sessionIds: readStringList(record, "sessionIds", "session_ids"),
    targetIds: readStringList(record, "targetIds", "target_ids"),
    profileKeys: readStringList(record, "profileKeys", "profile_keys"),
    items,
  };
}

function formatReplayStatus(item: BrowserActionReplayItem): string {
  if (item.success === true && !item.status) {
    return "成功";
  }
  if (item.success === false && !item.status) {
    return "失败";
  }

  switch (item.status) {
    case "completed":
    case "success":
    case "succeeded":
      return "成功";
    case "failed":
    case "error":
      return "失败";
    case "running":
      return "执行中";
    case "pending":
      return "待处理";
    default:
      return item.status || "未知状态";
  }
}

function BrowserReplayStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold text-foreground">
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function BrowserReplayView({ index }: { index: BrowserActionReplayIndex }) {
  const recentItems = index.items.slice(-5).reverse();
  const latestItem = recentItems.find((item) => item.lastUrl) || recentItems[0];
  const latestUrl = index.lastUrl || latestItem?.lastUrl || "暂无 URL";

  return (
    <div className="h-full overflow-auto bg-background p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-sky-700">
                <Eye className="h-4 w-4" />
                <span>browser_replay_viewer</span>
              </div>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                Browser Assist 复盘
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                从 browserActionIndex 恢复浏览器动作、会话与观察证据。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
                browser_control
              </span>
              <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {index.actionCount} actions
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <BrowserReplayStat
            label="浏览器动作"
            value={`${index.actionCount}`}
            hint="typed browser action"
          />
          <BrowserReplayStat
            label="会话"
            value={`${index.sessionCount}`}
            hint={index.sessionIds[0] || latestItem?.sessionId || "session"}
          />
          <BrowserReplayStat
            label="观察 / 截图"
            value={`${index.observationCount} / ${index.screenshotCount}`}
            hint="observation / screenshot"
          />
          <BrowserReplayStat
            label="最近 URL"
            value={latestUrl === "暂无 URL" ? latestUrl : "已记录"}
            hint={latestUrl}
          />
        </div>

        {recentItems.length > 0 ? (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <MousePointerClick className="h-4 w-4 text-muted-foreground" />
              <span>最近浏览器动作</span>
            </div>
            <div className="space-y-2">
              {recentItems.map((item, itemIndex) => (
                <div
                  key={[item.requestId, item.sessionId, item.action, itemIndex]
                    .filter(Boolean)
                    .join(":")}
                  className="rounded-xl border border-border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {item.action || item.toolName || "browser action"}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {item.artifactKind || "browser_session"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                      {formatReplayStatus(item)}
                    </span>
                    {item.backend ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {item.backend}
                      </span>
                    ) : null}
                    {item.screenshotAvailable ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
                        <Camera className="h-3 w-3" />
                        screenshot
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {item.lastUrl ? (
                      <div className="break-all">
                        URL：
                        <span className="ml-1 font-mono text-foreground">
                          {item.lastUrl}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {item.sessionId ? (
                        <span>
                          session：
                          <span className="ml-1 font-mono text-foreground">
                            {item.sessionId}
                          </span>
                        </span>
                      ) : null}
                      {item.targetId ? (
                        <span>
                          target：
                          <span className="ml-1 font-mono text-foreground">
                            {item.targetId}
                          </span>
                        </span>
                      ) : null}
                      {item.entrySource ? (
                        <span>
                          entry：
                          <span className="ml-1 font-mono text-foreground">
                            {item.entrySource}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
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
    const replayIndex = normalizeBrowserActionIndex(
      artifact.meta,
      artifact.content,
    );

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

    if (replayIndex) {
      return <BrowserReplayView index={replayIndex} />;
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
