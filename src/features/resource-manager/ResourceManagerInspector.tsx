import { Info } from "lucide-react";
import { getItemTitle, type ResourceManagerRow } from "./resourceManagerPresentation";
import type { ResourceManagerItem } from "./types";

interface ResourceManagerInspectorProps {
  item: ResourceManagerItem;
  inspectorRows: ResourceManagerRow[];
  sourceContextRows: ResourceManagerRow[];
}

export function ResourceManagerInspector({
  item,
  inspectorRows,
  sourceContextRows,
}: ResourceManagerInspectorProps) {
  return (
    <aside
      data-testid="resource-manager-inspector"
      className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white text-slate-800 shadow-sm shadow-slate-950/5"
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Info className="h-4 w-4 text-[#13c95b]" />
          资源详情
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">
          {getItemTitle(item)}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-xs [scrollbar-width:thin]">
        <section>
          <h3 className="mb-2 font-semibold text-slate-900">文件信息</h3>
          <dl className="space-y-2">
            {inspectorRows.map((row) => (
              <div key={row.label} className="rounded-lg bg-slate-50 p-2">
                <dt className="text-[11px] font-medium text-slate-400">
                  {row.label}
                </dt>
                <dd className="mt-1 break-words leading-5 text-slate-700">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3 className="mb-2 font-semibold text-slate-900">业务来源</h3>
          {sourceContextRows.length > 0 ? (
            <dl className="space-y-2">
              {sourceContextRows.map((row) => (
                <div key={row.label} className="rounded-lg bg-slate-50 p-2">
                  <dt className="text-[11px] font-medium text-slate-400">
                    {row.label}
                  </dt>
                  <dd className="mt-1 break-words leading-5 text-slate-700">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 leading-5 text-slate-500">
              暂无业务来源上下文
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
