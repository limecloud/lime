import { BrainCircuit, FolderTree, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TeamMemoryEntry, TeamMemorySnapshot } from "@/lib/teamMemorySync";

interface TeamMemoryShadowCardProps {
  snapshot?: TeamMemorySnapshot | null;
}

interface TeamMemoryDisplayEntry {
  key: string;
  label: string;
  icon: typeof Users;
  lines: string[];
  updatedAt: number;
}

const ENTRY_META: Record<string, { label: string; icon: typeof Users }> = {
  "team.selection": {
    label: "当前 Team",
    icon: Users,
  },
  "team.subagents": {
    label: "子代理概览",
    icon: Sparkles,
  },
  "team.parent_context": {
    label: "父会话上下文",
    icon: FolderTree,
  },
};

function formatUpdatedAt(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "刚刚";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDisplayEntry(entry: TeamMemoryEntry): TeamMemoryDisplayEntry {
  const meta = ENTRY_META[entry.key] ?? {
    label: entry.key,
    icon: BrainCircuit,
  };

  return {
    key: entry.key,
    label: meta.label,
    icon: meta.icon,
    lines: entry.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4),
    updatedAt: entry.updatedAt,
  };
}

export function TeamMemoryShadowCard({
  snapshot = null,
}: TeamMemoryShadowCardProps) {
  const entries = Object.values(snapshot?.entries ?? {})
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(toDisplayEntry);

  if (entries.length === 0 || !snapshot?.repoScope?.trim()) {
    return null;
  }

  const latestUpdatedAt = entries[0]?.updatedAt ?? 0;

  return (
    <section
      data-testid="team-memory-shadow-card"
      className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <BrainCircuit className="h-3.5 w-3.5" />
            <span>协作记忆影子</span>
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-900">
            当前仓库已缓存 {entries.length} 条 Team 续接上下文
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            仅保存在当前仓库本地作用域，用来续接 Team 选择、子代理概览和父会话上下文。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-sky-200 bg-sky-50 text-sky-700"
          >
            本地影子
          </Badge>
          <span className="text-[11px] text-slate-500">
            更新于 {formatUpdatedAt(latestUpdatedAt)}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-[20px] border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-900">作用域：</span>
        <span className="break-all">{snapshot.repoScope}</span>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <section
              key={entry.key}
              className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-3"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <Icon className="h-3.5 w-3.5 text-slate-500" />
                <span>{entry.label}</span>
              </div>
              <div className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
                {entry.lines.map((line) => (
                  <div key={`${entry.key}:${line}`}>{line}</div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
