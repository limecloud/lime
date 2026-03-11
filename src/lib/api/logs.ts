import { safeInvoke } from "@/lib/dev-bridge";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export async function getLogs(): Promise<LogEntry[]> {
  try {
    return await safeInvoke("get_logs");
  } catch {
    return [];
  }
}

export async function getPersistedLogsTail(lines = 200): Promise<LogEntry[]> {
  const safeLines = Number.isFinite(lines)
    ? Math.min(1000, Math.max(20, Math.floor(lines)))
    : 200;
  try {
    return await safeInvoke("get_persisted_logs_tail", { lines: safeLines });
  } catch {
    return [];
  }
}

export async function clearLogs(): Promise<void> {
  try {
    await safeInvoke("clear_logs");
  } catch {
    // ignore
  }
}

export async function clearDiagnosticLogHistory(): Promise<void> {
  await safeInvoke("clear_diagnostic_log_history");
}
