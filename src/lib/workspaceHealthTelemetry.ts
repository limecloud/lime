export type WorkspaceRepairSource =
  | "app_startup"
  | "workspace_refresh"
  | "workspace_set_default"
  | "projects_refresh"
  | "agent_chat_page";

export interface WorkspaceRepairRecord {
  timestamp: string;
  workspace_id: string;
  root_path: string;
  source: WorkspaceRepairSource;
}

interface RecordWorkspaceRepairInput {
  workspaceId: string;
  rootPath: string;
  source: WorkspaceRepairSource;
}

const WORKSPACE_REPAIR_HISTORY_KEY = "lime.workspace_repair_history.v1";
const MAX_WORKSPACE_REPAIR_HISTORY = 50;

export function recordWorkspaceRepair(
  input: RecordWorkspaceRepairInput,
): void {
  if (!input.workspaceId || !input.rootPath) return;

  const nextRecord: WorkspaceRepairRecord = {
    timestamp: new Date().toISOString(),
    workspace_id: input.workspaceId,
    root_path: input.rootPath,
    source: input.source,
  };

  const history = readWorkspaceRepairHistory();
  history.push(nextRecord);
  const trimmed = history.slice(-MAX_WORKSPACE_REPAIR_HISTORY);
  writeWorkspaceRepairHistory(trimmed);
}

export function getWorkspaceRepairHistory(limit = 50): WorkspaceRepairRecord[] {
  if (limit <= 0) return [];
  const history = readWorkspaceRepairHistory();
  return history.slice(-limit).reverse();
}

export function clearWorkspaceRepairHistory(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(WORKSPACE_REPAIR_HISTORY_KEY);
}

export function buildWorkspaceRepairSummary(
  record: WorkspaceRepairRecord,
): string {
  return [
    "# Lime Workspace 自愈记录",
    `- 时间: ${record.timestamp}`,
    `- Workspace ID: ${record.workspace_id}`,
    `- 来源: ${record.source}`,
    `- 修复后路径: ${record.root_path}`,
  ].join("\n");
}

export function buildWorkspaceRepairBatchSummary(
  records: WorkspaceRepairRecord[],
): string {
  if (records.length === 0) {
    return "# Lime Workspace 自愈记录\n- 暂无记录";
  }

  const lines: string[] = ["# Lime Workspace 自愈记录（最近）"];
  records.forEach((record, index) => {
    lines.push(
      `\n## 记录 ${index + 1}`,
      `- 时间: ${record.timestamp}`,
      `- Workspace ID: ${record.workspace_id}`,
      `- 来源: ${record.source}`,
      `- 修复后路径: ${record.root_path}`,
    );
  });
  return lines.join("\n");
}

function readWorkspaceRepairHistory(): WorkspaceRepairRecord[] {
  if (typeof localStorage === "undefined") return [];

  const raw = localStorage.getItem(WORKSPACE_REPAIR_HISTORY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkspaceRepairRecord);
  } catch {
    return [];
  }
}

function writeWorkspaceRepairHistory(records: WorkspaceRepairRecord[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WORKSPACE_REPAIR_HISTORY_KEY, JSON.stringify(records));
}

function isWorkspaceRepairRecord(value: unknown): value is WorkspaceRepairRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.timestamp === "string" &&
    typeof record.workspace_id === "string" &&
    typeof record.root_path === "string" &&
    typeof record.source === "string"
  );
}
