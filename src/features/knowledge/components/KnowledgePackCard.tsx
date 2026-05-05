import { BookOpen, MessageSquareText, ShieldCheck } from "lucide-react";
import type { KnowledgePackSummary } from "@/lib/api/knowledge";
import { StatusPill } from "./StatusPill";
import {
  getPackTitle,
  sanitizeKnowledgePreview,
} from "../domain/knowledgeVisibility";

export function KnowledgePackCard({
  pack,
  actionBusy,
  onOpen,
  onSetDefault,
  onUse,
}: {
  pack: KnowledgePackSummary;
  actionBusy: boolean;
  onOpen: (packName: string) => void;
  onSetDefault: (packName: string) => void;
  onUse: (packName: string) => void;
}) {
  const isReady = pack.metadata.status === "ready";
  const primaryLabel = isReady ? "用于生成" : "继续确认";

  return (
    <article className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">
              {getPackTitle(pack)}
            </h3>
            <StatusPill status={pack.metadata.status} />
            {pack.defaultForWorkspace ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                默认资料
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
            {sanitizeKnowledgePreview(pack.preview) ||
              "等待整理适用场景、事实和边界。"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            isReady ? onUse(pack.metadata.name) : onOpen(pack.metadata.name)
          }
          className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <MessageSquareText className="h-4 w-4" />
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={() => onOpen(pack.metadata.name)}
          className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <BookOpen className="h-4 w-4" />
          查看详情
        </button>
        <button
          type="button"
          onClick={() => onSetDefault(pack.metadata.name)}
          disabled={actionBusy || !isReady}
          title={isReady ? undefined : "未确认资料不能设为默认"}
          className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" />
          设为默认
        </button>
      </div>
    </article>
  );
}
