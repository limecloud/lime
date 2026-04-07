import type { AutomationJobRecord } from "@/lib/api/automation";
import type {
  ServiceSkillAutomationLinkRecord,
  ServiceSkillAutomationStatus,
} from "./types";

const SERVICE_SKILL_AUTOMATION_LINKS_STORAGE_KEY =
  "lime:service-skill-automation-links:v1";
export const SERVICE_SKILL_AUTOMATION_LINKS_CHANGED_EVENT =
  "lime:service-skill-automation-links-changed";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function parseLinkedAt(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isValidAutomationLinkRecord(
  value: unknown,
): value is ServiceSkillAutomationLinkRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ServiceSkillAutomationLinkRecord>;
  return (
    typeof record.skillId === "string" &&
    record.skillId.length > 0 &&
    typeof record.jobId === "string" &&
    record.jobId.length > 0 &&
    typeof record.jobName === "string" &&
    record.jobName.length > 0 &&
    typeof record.linkedAt === "number" &&
    Number.isFinite(record.linkedAt)
  );
}

function emitAutomationLinksChanged(): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SERVICE_SKILL_AUTOMATION_LINKS_CHANGED_EVENT, {
      detail: {
        timestamp: Date.now(),
      },
    }),
  );
}

function persistAutomationLinks(
  records: ServiceSkillAutomationLinkRecord[],
): ServiceSkillAutomationLinkRecord[] {
  if (!hasWindow()) {
    return records;
  }

  try {
    window.localStorage.setItem(
      SERVICE_SKILL_AUTOMATION_LINKS_STORAGE_KEY,
      JSON.stringify(records),
    );
  } catch {
    // ignore write errors
  }

  emitAutomationLinksChanged();
  return records;
}

function formatAutomationTime(value?: string | null): string | null {
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

function resolveStatusLabel(status?: string | null): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "success":
      return "成功";
    case "running":
      return "运行中";
    case "waiting_for_human":
      return "等待人工处理";
    case "human_controlling":
      return "人工接管中";
    case "agent_resuming":
      return "恢复给 Agent";
    case "error":
      return "失败";
    case "timeout":
      return "超时";
    default:
      return "待执行";
  }
}

function resolveStatusTone(
  status?: string | null,
): ServiceSkillAutomationStatus["tone"] {
  if (status === "success") {
    return "emerald";
  }
  if (
    status === "queued" ||
    status === "running" ||
    status === "agent_resuming"
  ) {
    return "sky";
  }
  if (
    status === "waiting_for_human" ||
    status === "human_controlling" ||
    status === "timeout"
  ) {
    return "amber";
  }
  if (status === "error") {
    return "amber";
  }
  return "slate";
}

function resolveStatusDetail(job: AutomationJobRecord): string | null {
  if (job.running_started_at) {
    const startedAt = formatAutomationTime(job.running_started_at);
    return startedAt ? `开始于 ${startedAt}` : null;
  }

  if (job.auto_disabled_until) {
    const resumeAt = formatAutomationTime(job.auto_disabled_until);
    return resumeAt ? `冷却至 ${resumeAt}` : "当前处于冷却期";
  }

  if (job.last_status === "success") {
    const nextRunAt = formatAutomationTime(job.next_run_at);
    const finishedAt = formatAutomationTime(job.last_finished_at);
    if (nextRunAt) {
      return `下次 ${nextRunAt}`;
    }
    if (finishedAt) {
      return `完成于 ${finishedAt}`;
    }
    return null;
  }

  if (job.last_status === "error" || job.last_status === "timeout") {
    const finishedAt =
      formatAutomationTime(job.last_finished_at) ??
      formatAutomationTime(job.updated_at);
    if (finishedAt) {
      return `最近一次 ${finishedAt}`;
    }
    return null;
  }

  if (job.next_run_at) {
    const nextRunAt = formatAutomationTime(job.next_run_at);
    return nextRunAt ? `下次 ${nextRunAt}` : null;
  }

  if (!job.enabled) {
    return "任务已停用";
  }

  return null;
}

function extractPersistedServiceSkillLink(
  job: AutomationJobRecord,
): ServiceSkillAutomationLinkRecord | null {
  if (job.payload.kind !== "agent_turn") {
    return null;
  }

  const requestMetadata = job.payload.request_metadata;
  if (!isPlainRecord(requestMetadata)) {
    return null;
  }

  const serviceSkillValue =
    requestMetadata.service_skill ?? requestMetadata.serviceSkill;
  if (!isPlainRecord(serviceSkillValue)) {
    return null;
  }

  const skillId =
    normalizeNonEmptyText(serviceSkillValue.id) ??
    normalizeNonEmptyText(serviceSkillValue.skill_id) ??
    normalizeNonEmptyText(serviceSkillValue.skillId);
  if (!skillId) {
    return null;
  }

  return {
    skillId,
    jobId: job.id,
    jobName: job.name,
    linkedAt: parseLinkedAt(job.updated_at) || parseLinkedAt(job.created_at),
  };
}

export function resolveServiceSkillAutomationLinks(
  jobs: AutomationJobRecord[],
): ServiceSkillAutomationLinkRecord[] {
  const merged = new Map<string, ServiceSkillAutomationLinkRecord>();

  jobs.forEach((job) => {
    const persistedLink = extractPersistedServiceSkillLink(job);
    if (!persistedLink) {
      return;
    }

    const current = merged.get(persistedLink.skillId);
    if (!current || persistedLink.linkedAt >= current.linkedAt) {
      merged.set(persistedLink.skillId, persistedLink);
    }
  });

  listServiceSkillAutomationLinks().forEach((link) => {
    const current = merged.get(link.skillId);
    if (!current || link.linkedAt > current.linkedAt) {
      merged.set(link.skillId, link);
    }
  });

  return [...merged.values()].sort(
    (left, right) => right.linkedAt - left.linkedAt,
  );
}

export function listServiceSkillAutomationLinks(): ServiceSkillAutomationLinkRecord[] {
  if (!hasWindow()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      SERVICE_SKILL_AUTOMATION_LINKS_STORAGE_KEY,
    );
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidAutomationLinkRecord)
      .sort((left, right) => right.linkedAt - left.linkedAt);
  } catch {
    return [];
  }
}

export function recordServiceSkillAutomationLink(
  input: Omit<ServiceSkillAutomationLinkRecord, "linkedAt"> & {
    linkedAt?: number;
  },
): ServiceSkillAutomationLinkRecord[] {
  const nextRecord: ServiceSkillAutomationLinkRecord = {
    skillId: input.skillId,
    jobId: input.jobId,
    jobName: input.jobName,
    linkedAt: input.linkedAt ?? Date.now(),
  };

  const nextRecords = [
    nextRecord,
    ...listServiceSkillAutomationLinks().filter(
      (record) => record.skillId !== nextRecord.skillId,
    ),
  ];

  return persistAutomationLinks(nextRecords);
}

export function subscribeServiceSkillAutomationLinksChanged(
  callback: () => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const customEventHandler = () => {
    callback();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SERVICE_SKILL_AUTOMATION_LINKS_STORAGE_KEY) {
      return;
    }
    callback();
  };

  window.addEventListener(
    SERVICE_SKILL_AUTOMATION_LINKS_CHANGED_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      SERVICE_SKILL_AUTOMATION_LINKS_CHANGED_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
}

export function buildServiceSkillAutomationStatusMap(
  jobs: AutomationJobRecord[],
): Record<string, ServiceSkillAutomationStatus> {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  return resolveServiceSkillAutomationLinks(jobs).reduce<
    Record<string, ServiceSkillAutomationStatus>
  >((result, link) => {
    const job = jobsById.get(link.jobId);
    if (!job) {
      return result;
    }

    const statusLabel = job.auto_disabled_until
      ? "冷却中"
      : resolveStatusLabel(
          job.running_started_at ? "running" : job.last_status,
        );

    result[link.skillId] = {
      jobId: job.id,
      jobName: job.name || link.jobName,
      statusLabel,
      tone: resolveStatusTone(
        job.auto_disabled_until
          ? "timeout"
          : job.running_started_at
            ? "running"
            : job.last_status,
      ),
      detail: resolveStatusDetail(job),
    };
    return result;
  }, {});
}
