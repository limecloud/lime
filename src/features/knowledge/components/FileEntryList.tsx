import type { KnowledgePackFileEntry } from "@/lib/api/knowledge";
import {
  buildEntryDisplayLabel,
  getKnowledgeEntryPreview,
} from "../domain/knowledgeVisibility";

export function FileEntryList({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: KnowledgePackFileEntry[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
          {entries.length} 个
        </span>
      </div>
      <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
        {entries.length === 0 ? (
          <div className="m-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            {emptyLabel}
          </div>
        ) : (
          entries.map((entry) => {
            const preview = getKnowledgeEntryPreview(title, entry);
            return (
              <article
                key={entry.relativePath}
                className="px-4 py-3 transition hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-xs font-semibold text-slate-800">
                    {buildEntryDisplayLabel(title, entry)}
                  </div>
                  <div className="shrink-0 text-xs text-slate-400">已整理</div>
                </div>
                {preview ? (
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">
                    {preview}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
