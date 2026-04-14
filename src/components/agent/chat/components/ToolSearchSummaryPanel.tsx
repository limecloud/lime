import {
  type ToolSearchResultSummary,
  resolveUserFacingToolSearchItemLabel,
} from "../utils/toolSearchResultSummary";

interface ToolSearchSummaryPanelProps {
  summary: ToolSearchResultSummary;
  testId?: string;
}

function shouldShowUserFacingQuery(query: string | undefined): boolean {
  const normalized = query?.trim();
  if (!normalized) {
    return false;
  }

  return !/^(?:select|tool|tools|name|tag):/i.test(normalized);
}

function resolveUserFacingToolSearchNote(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) {
    return null;
  }

  if (/未命中.*deferred/i.test(trimmed)) {
    return "没有找到更多匹配工具";
  }

  if (
    /(?:always[_\s-]?visible|native[_\s-]?registry|extension[_\s-]?name|total[_\s-]?deferred|caller)/i.test(
      trimmed,
    )
  ) {
    return null;
  }

  return trimmed.replace(/\bdeferred\b/gi, "更多").trim();
}

export function ToolSearchSummaryPanel({
  summary,
  testId,
}: ToolSearchSummaryPanelProps) {
  const pendingServersText =
    summary.pendingMcpServers && summary.pendingMcpServers.length > 0
      ? `以下 MCP 服务仍在连接中：${summary.pendingMcpServers.join("、")}`
      : null;
  const userFacingNotes = summary.notes
    .map((note) => resolveUserFacingToolSearchNote(note))
    .filter((note): note is string => Boolean(note));

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>找到工具：{summary.count} 个</span>
        {shouldShowUserFacingQuery(summary.query) ? (
          <span className="break-all">查询：{summary.query}</span>
        ) : null}
      </div>

      {pendingServersText ? (
        <div className="space-y-1 text-[11px] text-sky-700">
          <div>{pendingServersText}</div>
        </div>
      ) : null}

      {userFacingNotes.length > 0 ? (
        <div className="space-y-1 text-[11px] text-amber-700">
          {userFacingNotes.map((note, index) => (
            <div key={`${note}-${index}`}>{note}</div>
          ))}
        </div>
      ) : null}

      {summary.tools.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {summary.tools.map((item) => {
            const label = resolveUserFacingToolSearchItemLabel(item.name);
            const rawName = item.name.trim();

            return (
              <div
                key={item.name}
                title={label !== rawName ? rawName : undefined}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <span className="font-medium text-slate-900">{label}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default ToolSearchSummaryPanel;
