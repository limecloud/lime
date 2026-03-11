import { useState, useEffect, useRef } from "react";
import { Trash2, Download } from "lucide-react";
import { clearLogs, getLogs, type LogEntry } from "@/lib/api/logs";

export function LogsTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    try {
      const l = await getLogs();
      // 过滤掉 API 调用相关的日志，只保留系统日志
      // API 调用日志已由 Flow Monitor 接管
      const systemLogs = l.filter((log) => {
        const msg = log.message;
        // 排除 API 请求相关日志
        if (msg.includes("[REQ]")) return false;
        if (msg.includes("[ROUTE]")) return false;
        if (msg.includes("[CLIENT]")) return false;
        if (msg.includes("request_id=")) return false;
        if (msg.includes("POST /v1/")) return false;
        if (msg.includes("GET /v1/")) return false;
        if (msg.includes("Using pool credential")) return false;
        return true;
      });
      setLogs(systemLogs);
    } catch (e) {
      // 如果后端还没实现，使用空数组
      console.error(e);
    }
  };

  const handleClear = async () => {
    try {
      await clearLogs();
      setLogs([]);
    } catch {
      setLogs([]);
    }
  };

  const handleExport = () => {
    const content = logs
      .map(
        (l) =>
          `[${new Date(l.timestamp).toLocaleString()}] [${l.level.toUpperCase()}] ${l.message}`,
      )
      .join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxycast-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-500";
      case "warn":
        return "text-yellow-500";
      case "debug":
        return "text-gray-400";
      default:
        return "text-blue-500";
    }
  };

  const getLevelBg = (level: string) => {
    switch (level) {
      case "error":
        return "bg-red-500/10";
      case "warn":
        return "bg-yellow-500/10";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          导出
        </button>
        <button
          onClick={handleClear}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <Trash2 className="h-4 w-4" />
          清空
        </button>
      </div>

      <div className="rounded-lg border bg-card">
        <div
          ref={logsContainerRef}
          className="max-h-[500px] overflow-auto p-4 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <p className="text-center text-muted-foreground">
              暂无日志，软件运行时将显示网关与系统日志
            </p>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-2 py-0.5 px-2 rounded ${getLevelBg(log.level)}`}
              >
                <span className="text-muted-foreground shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`font-medium shrink-0 ${getLevelColor(log.level)}`}
                >
                  [{log.level.toUpperCase()}]
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
