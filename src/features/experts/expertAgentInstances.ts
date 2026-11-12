const EXPERT_AGENT_INSTANCES_STORAGE_KEY = "lime:expert-agent-instances:v1";
const MAX_EXPERT_AGENT_INSTANCES = 100;

export type ExpertAgentInstanceStatus = "active" | "archived";

export interface ExpertAgentInstanceIdentity {
  catalogId: string;
  projectId?: string | null;
  expertId: string;
  releaseId: string;
}

export interface ExpertAgentInstanceRecord extends ExpertAgentInstanceIdentity {
  agentInstanceId: string;
  agentInstanceKey: string;
  catalogVersion?: string;
  skillRefsOverride?: string[];
  status: ExpertAgentInstanceStatus;
  createdAt: number;
  updatedAt: number;
  lastStartedAt: number;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeProjectScopeId(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  if (
    lower === "default" ||
    lower === "workspace-default" ||
    lower === "__invalid__" ||
    normalized === "[object Promise]"
  ) {
    return null;
  }
  return normalized;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
  return result.length > 0 ? Array.from(new Set(result)) : undefined;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

export function buildExpertAgentInstanceKey(
  identity: ExpertAgentInstanceIdentity,
): string {
  const projectId = normalizeProjectScopeId(identity.projectId);
  return [identity.catalogId, projectId, identity.expertId, identity.releaseId]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.trim())
    .join(":");
}

export function buildExpertAgentInstanceId(
  identity: ExpertAgentInstanceIdentity,
): string {
  return `expert:${buildExpertAgentInstanceKey(identity)}`;
}

function normalizeExpertAgentInstanceRecord(
  value: unknown,
): ExpertAgentInstanceRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const catalogId = normalizeText(record.catalogId);
  const projectId = normalizeProjectScopeId(record.projectId);
  const expertId = normalizeText(record.expertId);
  const releaseId = normalizeText(record.releaseId);
  if (!catalogId || !expertId || !releaseId) {
    return null;
  }
  const identity = {
    catalogId,
    ...(projectId ? { projectId } : {}),
    expertId,
    releaseId,
  };
  const agentInstanceKey = buildExpertAgentInstanceKey(identity);
  const now = Date.now();
  const createdAt = normalizeTimestamp(record.createdAt) ?? now;
  const updatedAt = normalizeTimestamp(record.updatedAt) ?? createdAt;
  return {
    ...identity,
    agentInstanceId:
      normalizeText(record.agentInstanceId) ??
      buildExpertAgentInstanceId(identity),
    agentInstanceKey,
    catalogVersion: normalizeText(record.catalogVersion) ?? undefined,
    skillRefsOverride: normalizeStringList(record.skillRefsOverride),
    status:
      record.status === "archived" || record.status === "active"
        ? record.status
        : "active",
    createdAt,
    updatedAt,
    lastStartedAt: normalizeTimestamp(record.lastStartedAt) ?? updatedAt,
  };
}

export function readExpertAgentInstances(): ExpertAgentInstanceRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(EXPERT_AGENT_INSTANCES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeExpertAgentInstanceRecord)
      .filter((item): item is ExpertAgentInstanceRecord => Boolean(item))
      .sort((left, right) => right.lastStartedAt - left.lastStartedAt)
      .slice(0, MAX_EXPERT_AGENT_INSTANCES);
  } catch {
    return [];
  }
}

export function saveExpertAgentInstances(
  records: ExpertAgentInstanceRecord[],
): ExpertAgentInstanceRecord[] {
  const normalized = records
    .map(normalizeExpertAgentInstanceRecord)
    .filter((item): item is ExpertAgentInstanceRecord => Boolean(item))
    .sort((left, right) => right.lastStartedAt - left.lastStartedAt)
    .slice(0, MAX_EXPERT_AGENT_INSTANCES);

  if (typeof window !== "undefined") {
    if (normalized.length === 0) {
      window.localStorage.removeItem(EXPERT_AGENT_INSTANCES_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        EXPERT_AGENT_INSTANCES_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    }
  }
  return normalized;
}

export function findExpertAgentInstance(
  identity: ExpertAgentInstanceIdentity,
): ExpertAgentInstanceRecord | null {
  if (!normalizeProjectScopeId(identity.projectId)) {
    return null;
  }
  const key = buildExpertAgentInstanceKey(identity);
  return (
    readExpertAgentInstances().find(
      (item) => item.agentInstanceKey === key && item.status === "active",
    ) ?? null
  );
}

export function upsertExpertAgentInstance(
  identity: ExpertAgentInstanceIdentity & {
    catalogVersion?: string;
    skillRefsOverride?: string[] | null;
    now?: number;
  },
): ExpertAgentInstanceRecord {
  const now = identity.now ?? Date.now();
  const projectId = normalizeProjectScopeId(identity.projectId);
  const key = buildExpertAgentInstanceKey(identity);
  const current = readExpertAgentInstances();
  const existing = current.find((item) => item.agentInstanceKey === key);
  const record: ExpertAgentInstanceRecord = {
    ...(existing ?? {
      catalogId: identity.catalogId.trim(),
      ...(projectId ? { projectId } : {}),
      expertId: identity.expertId.trim(),
      releaseId: identity.releaseId.trim(),
      agentInstanceId: buildExpertAgentInstanceId(identity),
      agentInstanceKey: key,
      status: "active" as const,
      createdAt: now,
    }),
    catalogVersion:
      normalizeText(identity.catalogVersion) ?? existing?.catalogVersion,
    skillRefsOverride:
      normalizeStringList(identity.skillRefsOverride) ??
      existing?.skillRefsOverride,
    status: "active",
    updatedAt: now,
    lastStartedAt: now,
  };

  saveExpertAgentInstances([
    record,
    ...current.filter((item) => item.agentInstanceKey !== key),
  ]);
  return record;
}

export function updateExpertAgentInstanceSkillRefs(
  identity: ExpertAgentInstanceIdentity & {
    catalogVersion?: string;
    skillRefsOverride: string[];
  },
): ExpertAgentInstanceRecord {
  return upsertExpertAgentInstance({
    ...identity,
    skillRefsOverride: identity.skillRefsOverride,
  });
}

export const expertAgentInstanceStorageKeys = {
  instances: EXPERT_AGENT_INSTANCES_STORAGE_KEY,
} as const;
