import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { TurnMemoryPrefetchResult } from "@/lib/api/memoryRuntime";
import { cn } from "@/lib/utils";
import { normalizeTeamMemoryDisplayText } from "../utils/teamMemoryDisplay";

type RuntimeMemoryPrefetchStatus = "idle" | "loading" | "ready" | "error";

interface AgentThreadMemoryPrefetchPreviewProps {
  status: RuntimeMemoryPrefetchStatus;
  result: TurnMemoryPrefetchResult | null;
  error: string | null;
  actions?: ReactNode;
  className?: string;
}

const EMERALD_PANEL_CLASS_NAME = "border-emerald-200 bg-emerald-50/60";
const EMERALD_TITLE_CLASS_NAME = "text-emerald-900";
const EMERALD_OUTLINE_BADGE_CLASS_NAME =
  "border-emerald-200 bg-white text-emerald-700";
const SLATE_PANEL_CLASS_NAME = "border-slate-200/80 bg-white";
const SLATE_TITLE_CLASS_NAME = "text-slate-700";
const MEMORY_PROMPT_SURFACE_CLASS_NAME =
  "overflow-x-auto rounded-lg border border-sky-100 bg-[linear-gradient(180deg,rgba(248,255,254,0.98)_0%,rgba(255,255,255,0.98)_55%,rgba(240,249,255,0.96)_100%)] px-3 py-2 text-xs leading-6 text-slate-700 shadow-sm shadow-sky-950/5";

const DURABLE_CATEGORY_LABELS: Record<string, string> = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
};

function normalizeText(value?: string | null): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function truncateText(value?: string | null, maxLength = 240): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseDate(value?: string | number | null): Date | null {
  if (typeof value === "number") {
    const normalizedValue = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatDateTime(value?: string | number | null): string | null {
  const date = parseDate(value);
  if (!date) {
    return null;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMemoryLayerStatusLabel(
  label: string,
  count?: number | null,
  active?: boolean,
): string {
  if (typeof count === "number") {
    return `${label} ${count}`;
  }
  return `${label} ${active ? "已命中" : "未命中"}`;
}

function formatDurableCategoryLabel(category: string): string {
  return DURABLE_CATEGORY_LABELS[category] || category;
}

function DetailPanel(props: {
  title: string;
  emptyText: string;
  children?: ReactNode;
}) {
  return (
    <article
      className={cn("rounded-xl border px-3 py-3", SLATE_PANEL_CLASS_NAME)}
    >
      <div className={cn("text-xs font-medium", SLATE_TITLE_CLASS_NAME)}>
        {props.title}
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-700">
        {props.children || (
          <div className="text-sm leading-6 text-slate-500">
            {props.emptyText}
          </div>
        )}
      </div>
    </article>
  );
}

export function AgentThreadMemoryPrefetchPreview({
  status,
  result,
  error,
  actions,
  className,
}: AgentThreadMemoryPrefetchPreviewProps) {
  return (
    <div
      className={cn(
        "mt-4 rounded-2xl border px-4 py-3",
        status === "error"
          ? "border-amber-200 bg-amber-50"
          : EMERALD_PANEL_CLASS_NAME,
        className,
      )}
      data-testid="agent-thread-reliability-memory-prefetch"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "text-sm font-medium",
              status === "error" ? "text-amber-900" : EMERALD_TITLE_CLASS_NAME,
            )}
          >
            本回合记忆预取
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                status === "error"
                  ? "border-amber-300 bg-white text-amber-700"
                  : EMERALD_OUTLINE_BADGE_CLASS_NAME,
              )}
            >
              {status === "loading"
                ? "加载中"
                : status === "ready"
                  ? "记忆命中预演"
                  : status === "error"
                    ? "暂不可用"
                    : "待预取"}
            </Badge>
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-2 text-sm leading-6",
          status === "error" ? "text-amber-900" : "text-slate-700",
        )}
      >
        {status === "loading"
          ? "正在按最新回合 prompt 预演来源链 / 会话记忆 / 持久记忆 / Team Memory / 会话压缩的命中情况。"
          : status === "error"
            ? error
            : "下面展示的是当前这轮真实会用到的记忆命中预演，不会改写会话，只帮助判断续接质量。"}
      </div>

      {result ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
            >
              {formatMemoryLayerStatusLabel(
                "规则",
                result.rules_source_paths.length,
              )}
            </Badge>
            <Badge
              variant="outline"
              className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
            >
              {formatMemoryLayerStatusLabel(
                "会话",
                null,
                Boolean(result.working_memory_excerpt),
              )}
            </Badge>
            <Badge
              variant="outline"
              className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
            >
              {formatMemoryLayerStatusLabel(
                "持久",
                result.durable_memories.length,
              )}
            </Badge>
            <Badge
              variant="outline"
              className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
            >
              {formatMemoryLayerStatusLabel(
                "Team Memory",
                result.team_memory_entries.length,
              )}
            </Badge>
            <Badge
              variant="outline"
              className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
            >
              {formatMemoryLayerStatusLabel(
                "压缩",
                null,
                Boolean(result.latest_compaction),
              )}
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <DetailPanel title="规则来源" emptyText="当前没有命中的规则来源。">
              {result.rules_source_paths.length > 0 ? (
                <div className="space-y-2">
                  {result.rules_source_paths.slice(0, 3).map((path) => (
                    <div
                      key={path}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"
                    >
                      {path}
                    </div>
                  ))}
                  {result.rules_source_paths.length > 3 ? (
                    <div className="text-xs text-slate-500">
                      另有 {result.rules_source_paths.length - 3} 个来源未展开。
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DetailPanel>

            <DetailPanel
              title="会话记忆摘录"
              emptyText="当前回合没有命中会话记忆摘录。"
            >
              {result.working_memory_excerpt ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                  {truncateText(result.working_memory_excerpt, 320)}
                </div>
              ) : null}
            </DetailPanel>

            <DetailPanel
              title="持久记忆命中"
              emptyText="当前没有命中的持久记忆。"
            >
              {result.durable_memories.length > 0 ? (
                <div className="space-y-2">
                  {result.durable_memories.slice(0, 3).map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-white text-slate-700"
                        >
                          {formatDurableCategoryLabel(entry.category)}
                        </Badge>
                        <span className="text-sm font-medium text-slate-900">
                          {entry.title}
                        </span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-700">
                        {truncateText(entry.summary, 220)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        {entry.tags.length > 0 ? (
                          <span>标签：{entry.tags.join("、")}</span>
                        ) : null}
                        {formatDateTime(entry.updated_at) ? (
                          <span>更新于 {formatDateTime(entry.updated_at)}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {result.durable_memories.length > 3 ? (
                    <div className="text-xs text-slate-500">
                      另有 {result.durable_memories.length - 3}{" "}
                      条持久记忆未展开。
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DetailPanel>

            <DetailPanel
              title="Team Memory 明细"
              emptyText="当前没有命中的 Team Memory。"
            >
              {result.team_memory_entries.length > 0 ? (
                <div className="space-y-2">
                  {result.team_memory_entries.slice(0, 3).map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {entry.key}
                        </span>
                        {formatDateTime(entry.updated_at) ? (
                          <span className="text-xs text-slate-500">
                            {formatDateTime(entry.updated_at)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-700">
                        {truncateText(
                          normalizeTeamMemoryDisplayText(entry.content),
                          220,
                        )}
                      </div>
                    </div>
                  ))}
                  {result.team_memory_entries.length > 3 ? (
                    <div className="text-xs text-slate-500">
                      另有 {result.team_memory_entries.length - 3} 条 Team
                      Memory 未展开。
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DetailPanel>

            <DetailPanel
              title="会话压缩摘要"
              emptyText="当前没有命中的会话压缩摘要。"
            >
              {result.latest_compaction ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {result.latest_compaction.trigger ? (
                      <span>触发原因：{result.latest_compaction.trigger}</span>
                    ) : null}
                    {typeof result.latest_compaction.turn_count === "number" ? (
                      <span>
                        覆盖回合：{result.latest_compaction.turn_count}
                      </span>
                    ) : null}
                    {formatDateTime(result.latest_compaction.created_at) ? (
                      <span>
                        生成于{" "}
                        {formatDateTime(result.latest_compaction.created_at)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">
                    {truncateText(
                      result.latest_compaction.summary_preview,
                      260,
                    )}
                  </div>
                </div>
              ) : null}
            </DetailPanel>

            <DetailPanel
              title="运行时记忆片段"
              emptyText="当前没有返回组装后的运行时记忆片段。"
            >
              {result.prompt ? (
                <pre className={MEMORY_PROMPT_SURFACE_CLASS_NAME}>
                  {truncateText(result.prompt, 500)}
                </pre>
              ) : null}
            </DetailPanel>
          </div>
        </>
      ) : null}
    </div>
  );
}
