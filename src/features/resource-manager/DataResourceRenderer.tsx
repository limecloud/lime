import { useCallback, useEffect, useMemo, useRef } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import {
  countPreviewSearchMatches,
  renderHighlightedPreviewText,
} from "./resourcePreviewSearch";
import type { ResourceManagerItem } from "./types";
import { useResourceTextPreview } from "./useResourceTextPreview";

interface DataResourceRendererProps {
  item: ResourceManagerItem;
  searchQuery: string;
  activeSearchMatchIndex: number;
  viewMode: "formatted" | "raw";
  onSearchMatchCountChange: (matchCount: number) => void;
}

interface DataPreviewModel {
  mode: "json" | "csv" | "xml" | "yaml" | "toml" | "code";
  content: string;
  rows: string[][] | null;
}

export const DATA_RESOURCE_PREVIEW_MAX_SIZE = 512 * 1024;
const CSV_PREVIEW_ROW_LIMIT = 80;

function getDataSourceHint(item: ResourceManagerItem): string {
  return `${item.title || ""} ${item.filePath || ""} ${item.src || ""} ${
    item.mimeType || ""
  }`.toLowerCase();
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvRows(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, CSV_PREVIEW_ROW_LIMIT)
    .map(splitCsvLine);
}

function buildDataPreviewModel(
  item: ResourceManagerItem,
  content: string,
): DataPreviewModel {
  const sourceHint = getDataSourceHint(item);
  if (sourceHint.includes(".json") || sourceHint.includes("json")) {
    try {
      return {
        mode: "json",
        content: JSON.stringify(JSON.parse(content), null, 2),
        rows: null,
      };
    } catch {
      return {
        mode: "code",
        content,
        rows: null,
      };
    }
  }

  if (sourceHint.includes(".csv") || sourceHint.includes("csv")) {
    const rows = parseCsvRows(content);
    return {
      mode: rows.length > 0 ? "csv" : "code",
      content,
      rows: rows.length > 0 ? rows : null,
    };
  }

  if (sourceHint.includes(".xml") || sourceHint.includes("xml")) {
    return {
      mode: "xml",
      content,
      rows: null,
    };
  }

  if (
    sourceHint.includes(".yaml") ||
    sourceHint.includes(".yml") ||
    sourceHint.includes("yaml")
  ) {
    return {
      mode: "yaml",
      content,
      rows: null,
    };
  }

  if (sourceHint.includes(".toml") || sourceHint.includes("toml")) {
    return {
      mode: "toml",
      content,
      rows: null,
    };
  }

  return {
    mode: "code",
    content,
    rows: null,
  };
}

function countDataPreviewMatches(
  preview: DataPreviewModel | null,
  query: string,
): number {
  if (!preview) return 0;
  if (preview.mode !== "csv" || !preview.rows) {
    return countPreviewSearchMatches(preview.content, query);
  }

  return preview.rows.reduce(
    (rowTotal, row) =>
      rowTotal +
      row.reduce(
        (cellTotal, cell) =>
          cellTotal + countPreviewSearchMatches(cell, query),
        0,
      ),
    0,
  );
}

export function DataResourceRenderer({
  item,
  searchQuery,
  activeSearchMatchIndex,
  viewMode,
  onSearchMatchCountChange,
}: DataResourceRendererProps) {
  const previewRef = useRef<HTMLDivElement | HTMLPreElement | null>(null);
  const setPreviewNode = useCallback(
    (node: HTMLDivElement | HTMLPreElement | null) => {
      previewRef.current = node;
    },
    [],
  );
  const state = useResourceTextPreview({
    item,
    maxSize: DATA_RESOURCE_PREVIEW_MAX_SIZE,
    missingPathError: "该数据资源缺少本地路径，暂时无法读取内容。",
    binaryError: "该文件被识别为二进制内容，不能按数据文本预览。",
  });

  const preview = useMemo(
    () => {
      if (state.content === null) {
        return null;
      }
      if (viewMode === "raw") {
        return {
          mode: "code",
          content: state.content,
          rows: null,
        } satisfies DataPreviewModel;
      }
      return buildDataPreviewModel(item, state.content);
    },
    [item, state.content, viewMode],
  );
  const matchCount = useMemo(
    () => countDataPreviewMatches(preview, searchQuery),
    [preview, searchQuery],
  );
  const normalizedActiveMatchIndex =
    matchCount > 0 ? Math.min(activeSearchMatchIndex, matchCount - 1) : -1;

  useEffect(() => {
    onSearchMatchCountChange(matchCount);
  }, [matchCount, onSearchMatchCountChange]);

  useEffect(() => {
    if (!searchQuery.trim() || matchCount <= 0) return;

    const activeHit = previewRef.current?.querySelector(
      '[data-resource-preview-search-active="true"]',
    );
    activeHit?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [matchCount, normalizedActiveMatchIndex, searchQuery]);

  if (state.loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] text-slate-500">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm shadow-sm shadow-slate-950/5">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在读取数据预览...
        </div>
      </div>
    );
  }

  if (state.error || !preview) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] px-6 text-center text-slate-500">
        <div className="max-w-sm rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm shadow-slate-950/5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-slate-950">
            数据预览不可用
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {state.error || "当前没有可展示的数据内容。"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f5f6f8]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {preview.mode === "csv" && preview.rows ? (
          <div
            ref={setPreviewNode}
            data-testid="resource-manager-data-table"
            className="min-h-0 flex-1 overflow-auto p-6"
          >
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <tbody>
                {(() => {
                  let matchIndexOffset = 0;
                  return preview.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => {
                        const renderedCell = renderHighlightedPreviewText(
                          cell || "—",
                          searchQuery,
                          {
                            activeIndex: normalizedActiveMatchIndex,
                            matchIndexOffset,
                          },
                        );
                        matchIndexOffset += countPreviewSearchMatches(
                          cell,
                          searchQuery,
                        );
                        return (
                          <td
                            key={`cell-${rowIndex}-${cellIndex}`}
                            className="max-w-[22rem] border-b border-r border-slate-200 px-3 py-2 first:border-l first:font-medium first:text-slate-700"
                          >
                            <span className="line-clamp-3 break-words text-slate-700">
                              {renderedCell}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        ) : (
          <pre
            ref={setPreviewNode}
            data-testid="resource-manager-data-code"
            className="min-h-0 flex-1 overflow-auto p-6 font-mono text-sm leading-6 text-slate-800"
          >
            {renderHighlightedPreviewText(preview.content, searchQuery, {
              activeIndex: normalizedActiveMatchIndex,
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
