import type {
  RecordServiceSkillUsageInput,
  ServiceSkillUsageRecord,
} from "./types";

const SERVICE_SKILL_USAGE_STORAGE_KEY = "lime:service-skill-usage:v1";
const MAX_SERVICE_SKILL_USAGE_RECORDS = 12;

function isValidUsageRecord(value: unknown): value is ServiceSkillUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ServiceSkillUsageRecord>;
  return (
    typeof record.skillId === "string" &&
    record.skillId.length > 0 &&
    typeof record.usedAt === "number" &&
    Number.isFinite(record.usedAt) &&
    typeof record.runnerType === "string"
  );
}

export function listServiceSkillUsage(): ServiceSkillUsageRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SERVICE_SKILL_USAGE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidUsageRecord)
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, MAX_SERVICE_SKILL_USAGE_RECORDS);
  } catch {
    return [];
  }
}

export function getServiceSkillUsageMap(): Map<
  string,
  ServiceSkillUsageRecord
> {
  return new Map(
    listServiceSkillUsage().map((record) => [record.skillId, record]),
  );
}

export function recordServiceSkillUsage(
  input: RecordServiceSkillUsageInput,
): ServiceSkillUsageRecord[] {
  const nextRecord: ServiceSkillUsageRecord = {
    skillId: input.skillId,
    usedAt: input.usedAt ?? Date.now(),
    runnerType: input.runnerType,
  };

  const nextRecords = [
    nextRecord,
    ...listServiceSkillUsage().filter(
      (record) => record.skillId !== nextRecord.skillId,
    ),
  ].slice(0, MAX_SERVICE_SKILL_USAGE_RECORDS);

  if (typeof window === "undefined") {
    return nextRecords;
  }

  try {
    window.localStorage.setItem(
      SERVICE_SKILL_USAGE_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  } catch {
    // ignore write errors
  }

  return nextRecords;
}
