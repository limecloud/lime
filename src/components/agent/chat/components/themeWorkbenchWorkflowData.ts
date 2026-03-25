import { extractArtifactProtocolPathsFromRecord } from "@/lib/artifact-protocol";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";

export interface ThemeWorkbenchCreationTaskEvent {
  taskId: string;
  taskType: string;
  path: string;
  absolutePath?: string;
  createdAt: number;
  timeLabel: string;
}

type ThemeWorkbenchActivityStatus = SidebarActivityLog["status"];

export interface ThemeWorkbenchActivityLogGroup {
  key: string;
  runId?: string;
  sessionId?: string;
  messageId?: string;
  status: ThemeWorkbenchActivityStatus;
  source?: string;
  gateKey?: SidebarActivityLog["gateKey"];
  timeLabel: string;
  artifactPaths: string[];
  logs: SidebarActivityLog[];
}

export interface ThemeWorkbenchCreationTaskGroup {
  key: string;
  taskType: string;
  label: string;
  latestTimeLabel: string;
  tasks: ThemeWorkbenchCreationTaskEvent[];
}

export interface ThemeWorkbenchRunMetadataSummary {
  workflow: string | null;
  executionId: string | null;
  versionId: string | null;
  stages: string[];
  artifactPaths: string[];
}

export function formatThemeWorkbenchRunMetadata(raw: string | null): string {
  if (!raw || !raw.trim()) {
    return "-";
  }
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function normalizeArtifactPaths(raw?: string[]): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

function mergeArtifactPaths(current: string[], incoming?: string[]): string[] {
  const next = normalizeArtifactPaths(incoming);
  if (next.length === 0) {
    return current;
  }
  const merged = new Set(current);
  next.forEach((path) => merged.add(path));
  return Array.from(merged);
}

function mergeActivityStatus(
  previous: ThemeWorkbenchActivityStatus,
  next: ThemeWorkbenchActivityStatus,
): ThemeWorkbenchActivityStatus {
  if (previous === "running" || next === "running") {
    return "running";
  }
  if (previous === "failed" || next === "failed") {
    return "failed";
  }
  return "completed";
}

function resolveActivityGroupIdentity(log: SidebarActivityLog): {
  key: string;
  runId?: string;
  messageId?: string;
} {
  const normalizedRunId = log.runId?.trim();
  if (normalizedRunId) {
    return {
      key: `run:${normalizedRunId}`,
      runId: normalizedRunId,
    };
  }

  const normalizedMessageId = log.messageId?.trim();
  if (normalizedMessageId) {
    return {
      key: `message:${normalizedMessageId}`,
      messageId: normalizedMessageId,
    };
  }

  return {
    key: `orphan:${log.id}`,
  };
}

function formatCreationTaskTypeLabel(taskType: string): string {
  const normalized = taskType.trim().toLowerCase();
  if (normalized === "video_generate") {
    return "视频生成";
  }
  if (normalized === "broadcast_generate") {
    return "播客整理";
  }
  if (normalized === "cover_generate") {
    return "封面生成";
  }
  if (normalized === "modal_resource_search") {
    return "资源检索";
  }
  if (normalized === "image_generate") {
    return "配图生成";
  }
  if (normalized === "url_parse") {
    return "链接解析";
  }
  if (normalized === "typesetting") {
    return "排版优化";
  }
  return taskType.trim() || "未分类任务";
}

export function parseThemeWorkbenchRunMetadataSummary(
  raw: string | null,
): ThemeWorkbenchRunMetadataSummary {
  const fallback: ThemeWorkbenchRunMetadataSummary = {
    workflow: null,
    executionId: null,
    versionId: null,
    stages: [],
    artifactPaths: [],
  };
  if (!raw || !raw.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const readString = (value: unknown): string | null => {
      if (typeof value !== "string") {
        return null;
      }
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    };
    const readStringArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
    };

    return {
      workflow: readString(parsed.workflow),
      executionId: readString(parsed.execution_id),
      versionId: readString(parsed.version_id),
      stages: readStringArray(parsed.stages),
      artifactPaths: extractArtifactProtocolPathsFromRecord(parsed),
    };
  } catch {
    return fallback;
  }
}

export function formatThemeWorkbenchStageLabel(raw: string): string {
  if (raw === "topic_select") {
    return "选题闸门";
  }
  if (raw === "write_mode") {
    return "写作闸门";
  }
  if (raw === "publish_confirm") {
    return "发布闸门";
  }
  return raw;
}

export function formatThemeWorkbenchStagesLabel(stages: string[]): string | null {
  if (stages.length === 0) {
    return null;
  }
  return stages.map((stage) => formatThemeWorkbenchStageLabel(stage)).join(" → ");
}

export function buildThemeWorkbenchActivityLogGroups(
  activityLogs: SidebarActivityLog[],
): ThemeWorkbenchActivityLogGroup[] {
  if (activityLogs.length === 0) {
    return [];
  }

  const groups: ThemeWorkbenchActivityLogGroup[] = [];
  const groupByKey = new Map<string, ThemeWorkbenchActivityLogGroup>();

  activityLogs.forEach((log) => {
    const identity = resolveActivityGroupIdentity(log);
    const existingGroup = groupByKey.get(identity.key);
    if (!existingGroup) {
      const nextGroup: ThemeWorkbenchActivityLogGroup = {
        key: identity.key,
        runId: identity.runId,
        sessionId: log.sessionId?.trim() || undefined,
        messageId: identity.messageId,
        status: log.status,
        source: log.source,
        gateKey: log.gateKey,
        timeLabel: log.timeLabel,
        artifactPaths: normalizeArtifactPaths(log.artifactPaths),
        logs: [log],
      };
      groups.push(nextGroup);
      groupByKey.set(identity.key, nextGroup);
      return;
    }

    existingGroup.logs.push(log);
    existingGroup.status = mergeActivityStatus(existingGroup.status, log.status);
    if (!existingGroup.source && log.source) {
      existingGroup.source = log.source;
    }
    if (!existingGroup.sessionId && log.sessionId?.trim()) {
      existingGroup.sessionId = log.sessionId.trim();
    }
    if (!existingGroup.gateKey && log.gateKey) {
      existingGroup.gateKey = log.gateKey;
    }
    if (
      (existingGroup.timeLabel === "--:--" || !existingGroup.timeLabel) &&
      log.timeLabel &&
      log.timeLabel !== "--:--"
    ) {
      existingGroup.timeLabel = log.timeLabel;
    }
    existingGroup.artifactPaths = mergeArtifactPaths(
      existingGroup.artifactPaths,
      log.artifactPaths,
    );
  });

  return groups;
}

export function buildThemeWorkbenchCreationTaskGroups(
  creationTaskEvents: ThemeWorkbenchCreationTaskEvent[],
): ThemeWorkbenchCreationTaskGroup[] {
  if (creationTaskEvents.length === 0) {
    return [];
  }

  const groupMap = new Map<string, ThemeWorkbenchCreationTaskGroup>();
  creationTaskEvents.forEach((task) => {
    const groupKey = task.taskType.trim().toLowerCase() || "unknown";
    const existing = groupMap.get(groupKey);
    if (!existing) {
      groupMap.set(groupKey, {
        key: groupKey,
        taskType: task.taskType,
        label: formatCreationTaskTypeLabel(task.taskType),
        latestTimeLabel: task.timeLabel,
        tasks: [task],
      });
      return;
    }
    existing.tasks.push(task);
  });

  return Array.from(groupMap.values())
    .map((group) => {
      const sortedTasks = [...group.tasks].sort(
        (left, right) => right.createdAt - left.createdAt,
      );
      return {
        ...group,
        latestTimeLabel: sortedTasks[0]?.timeLabel || group.latestTimeLabel,
        tasks: sortedTasks,
      };
    })
    .sort((left, right) => {
      const leftLatest = left.tasks[0]?.createdAt || 0;
      const rightLatest = right.tasks[0]?.createdAt || 0;
      return rightLatest - leftLatest;
    });
}
