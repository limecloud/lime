import type { ServiceSkillRun } from "@/lib/api/serviceSkillRuns";
import type { ServiceSkillCloudRunStatus, ServiceSkillTone } from "./types";

const SERVICE_SKILL_CLOUD_RUNS_STORAGE_KEY =
  "lime:service-skill-cloud-runs:v1";
export const SERVICE_SKILL_CLOUD_RUNS_CHANGED_EVENT =
  "lime:service-skill-cloud-runs-changed";

interface ServiceSkillCloudRunRecord extends ServiceSkillCloudRunStatus {
  skillId: string;
  status: string;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function normalizeNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function parseTimestamp(value?: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatCloudRunTime(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveCloudRunStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "success":
      return "成功";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    case "timeout":
      return "超时";
    default:
      return "处理中";
  }
}

function resolveCloudRunStatusTone(status: string): ServiceSkillTone {
  switch (status) {
    case "queued":
    case "running":
      return "sky";
    case "success":
      return "emerald";
    case "failed":
    case "canceled":
    case "timeout":
      return "amber";
    default:
      return "slate";
  }
}

function resolveCloudRunDetail(run: ServiceSkillRun): string | null {
  const outputSummary = normalizeNonEmptyText(run.outputSummary);
  const errorMessage = normalizeNonEmptyText(run.errorMessage);
  const startedAt = formatCloudRunTime(run.startedAt);
  const finishedAt = formatCloudRunTime(run.finishedAt);
  const updatedAt = formatCloudRunTime(run.updatedAt);

  switch (run.status) {
    case "queued":
      return updatedAt ? `已提交 · ${updatedAt}` : "已提交到云端，等待执行";
    case "running":
      return startedAt ? `开始于 ${startedAt}` : "云端执行中";
    case "success":
      return outputSummary ?? (finishedAt ? `完成于 ${finishedAt}` : "云端结果已生成");
    case "failed":
    case "canceled":
    case "timeout":
      return errorMessage ?? (finishedAt ? `结束于 ${finishedAt}` : null);
    default:
      return updatedAt ? `最近更新 ${updatedAt}` : null;
  }
}

function isValidCloudRunRecord(value: unknown): value is ServiceSkillCloudRunRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ServiceSkillCloudRunRecord>;
  return (
    typeof record.skillId === "string" &&
    record.skillId.length > 0 &&
    typeof record.runId === "string" &&
    record.runId.length > 0 &&
    typeof record.status === "string" &&
    record.status.length > 0 &&
    typeof record.statusLabel === "string" &&
    record.statusLabel.length > 0 &&
    typeof record.tone === "string" &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

function emitCloudRunsChanged(): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SERVICE_SKILL_CLOUD_RUNS_CHANGED_EVENT, {
      detail: {
        timestamp: Date.now(),
      },
    }),
  );
}

function persistCloudRuns(
  records: ServiceSkillCloudRunRecord[],
): ServiceSkillCloudRunRecord[] {
  if (!hasWindow()) {
    return records;
  }

  try {
    window.localStorage.setItem(
      SERVICE_SKILL_CLOUD_RUNS_STORAGE_KEY,
      JSON.stringify(records),
    );
  } catch {
    // ignore write errors
  }

  emitCloudRunsChanged();
  return records;
}

export function listServiceSkillCloudRuns(): ServiceSkillCloudRunRecord[] {
  if (!hasWindow()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SERVICE_SKILL_CLOUD_RUNS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidCloudRunRecord)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

export function getServiceSkillCloudRunStatusMap(): Record<
  string,
  ServiceSkillCloudRunStatus
> {
  return listServiceSkillCloudRuns().reduce<
    Record<string, ServiceSkillCloudRunStatus>
  >((result, record) => {
    result[record.skillId] = {
      runId: record.runId,
      statusLabel: record.statusLabel,
      tone: record.tone,
      detail: record.detail,
      updatedAt: record.updatedAt,
    };
    return result;
  }, {});
}

export function recordServiceSkillCloudRun(
  skillId: string,
  run: ServiceSkillRun,
): ServiceSkillCloudRunRecord[] {
  const normalizedSkillId = skillId.trim();
  const normalizedRunId = run.id.trim();
  if (!normalizedSkillId || !normalizedRunId) {
    return listServiceSkillCloudRuns();
  }

  const nextRecord: ServiceSkillCloudRunRecord = {
    skillId: normalizedSkillId,
    runId: normalizedRunId,
    status: run.status,
    statusLabel: resolveCloudRunStatusLabel(run.status),
    tone: resolveCloudRunStatusTone(run.status),
    detail: resolveCloudRunDetail(run),
    updatedAt:
      parseTimestamp(run.updatedAt) ||
      parseTimestamp(run.finishedAt) ||
      parseTimestamp(run.startedAt) ||
      Date.now(),
  };

  const nextRecords = [
    nextRecord,
    ...listServiceSkillCloudRuns().filter(
      (record) => record.skillId !== nextRecord.skillId,
    ),
  ];

  return persistCloudRuns(nextRecords);
}

export function subscribeServiceSkillCloudRunsChanged(
  callback: () => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const customEventHandler = () => {
    callback();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SERVICE_SKILL_CLOUD_RUNS_STORAGE_KEY) {
      return;
    }
    callback();
  };

  window.addEventListener(
    SERVICE_SKILL_CLOUD_RUNS_CHANGED_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      SERVICE_SKILL_CLOUD_RUNS_CHANGED_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
}
