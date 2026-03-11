import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import { clearLogs, getPersistedLogsTail, type LogEntry } from "@/lib/api/logs";
import {
  type ChannelLogPreset,
  buildChannelLogRegex,
  filterChannelLogs,
} from "./channel-log-filter";

const POLL_INTERVAL_MS = 1000;
const TAIL_LINES = 800;
const MAX_DISPLAY_LINES = 500;

function formatTime(timestamp: string): string {
  const hmsMatch = timestamp.match(/(\d{2}:\d{2}:\d{2})/);
  if (hmsMatch) {
    return hmsMatch[1];
  }

  const date = new Date(timestamp);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleTimeString();
  }

  return timestamp;
}

function formatExportLine(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
}

export function ChannelLogTailPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [preset, setPreset] = useState<ChannelLogPreset>("all");
  const [customPattern, setCustomPattern] = useState("");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyTip, setCopyTip] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { regex, error: regexError } = useMemo(
    () => buildChannelLogRegex(preset, customPattern),
    [preset, customPattern],
  );

  const filteredLogs = useMemo(() => {
    const matched = filterChannelLogs(logs, regex);
    if (matched.length <= MAX_DISPLAY_LINES) {
      return matched;
    }
    return matched.slice(-MAX_DISPLAY_LINES);
  }, [logs, regex]);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const entries = await getPersistedLogsTail(TAIL_LINES);
        if (!active) return;
        setLogs(entries);
        setError(null);
      } catch (e) {
        if (!active) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void poll();
    if (paused) {
      return () => {
        active = false;
      };
    }

    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [paused]);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const container = listRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [filteredLogs, autoScroll]);

  const handleCopy = async () => {
    const content = filteredLogs.map(formatExportLine).join("\n");
    if (!content) {
      setCopyTip("当前无可复制日志");
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopyTip("已复制当前视图");
      window.setTimeout(() => setCopyTip(null), 1500);
    } catch {
      setCopyTip("复制失败，请检查系统剪贴板权限");
    }
  };

  const handleClear = async () => {
    const confirmed = window.confirm(
      "确认清空日志吗？\n这会清空当前内存日志和 ~/.proxycast/logs/proxycast.log，且无法恢复。",
    );
    if (!confirmed) {
      return;
    }

    try {
      await clearLogs();
      setLogs([]);
      setError(null);
      setCopyTip("日志已清空");
      window.setTimeout(() => setCopyTip(null), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`清空日志失败: ${msg}`);
    }
  };

  return (
    <div className="space-y-3 p-4 rounded-lg border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">渠道日志 Tail</h3>
          <p className="text-xs text-muted-foreground">
            数据源：~/.proxycast/logs/proxycast.log（每秒刷新）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
            {paused ? "继续" : "暂停"}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
          >
            <Copy className="h-3.5 w-3.5" />
            复制视图
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空日志
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">过滤模式</span>
          <select
            value={preset}
            onChange={(event) =>
              setPreset(event.target.value as ChannelLogPreset)
            }
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">全部</option>
            <option value="telegram">TelegramGateway</option>
            <option value="rpc">RPC</option>
            <option value="feishu">FeishuGateway</option>
            <option value="custom">自定义正则</option>
          </select>
        </label>

        {preset === "custom" ? (
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs text-muted-foreground">正则表达式</span>
            <input
              value={customPattern}
              onChange={(event) => setCustomPattern(event.target.value)}
              placeholder="TelegramGateway|RPC"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            />
          </label>
        ) : (
          <label className="inline-flex items-center gap-2 mt-6 md:col-span-2">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <span className="text-xs text-muted-foreground">
              自动滚动到底部
            </span>
          </label>
        )}
      </div>

      {preset === "custom" && (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
            className="h-4 w-4 rounded border"
          />
          <span className="text-xs text-muted-foreground">自动滚动到底部</span>
        </label>
      )}

      {(error || regexError || copyTip) && (
        <div className="space-y-1">
          {error && (
            <p className="text-xs text-destructive">拉取日志失败: {error}</p>
          )}
          {regexError && <p className="text-xs text-amber-600">{regexError}</p>}
          {copyTip && (
            <p className="text-xs text-muted-foreground">{copyTip}</p>
          )}
        </div>
      )}

      <div
        ref={listRef}
        className="max-h-80 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs"
      >
        {loading ? (
          <p className="text-muted-foreground">加载中...</p>
        ) : filteredLogs.length === 0 ? (
          <p className="text-muted-foreground">
            暂无匹配日志{paused ? "（已暂停刷新）" : "，等待新日志写入"}
          </p>
        ) : (
          filteredLogs.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className="py-0.5 break-all"
            >
              <span className="text-muted-foreground">
                [{formatTime(entry.timestamp)}]
              </span>{" "}
              <span className="text-blue-500">
                [{entry.level.toUpperCase()}]
              </span>{" "}
              {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ChannelLogTailPanel;
