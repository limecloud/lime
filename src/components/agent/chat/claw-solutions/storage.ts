import type {
  ClawSolutionUsageRecord,
  RecordClawSolutionUsageInput,
} from "./types";

const CLAW_SOLUTION_USAGE_STORAGE_KEY = "lime:claw-solution-usage:v1";
const MAX_CLAW_SOLUTION_USAGE_RECORDS = 12;

function isValidUsageRecord(value: unknown): value is ClawSolutionUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ClawSolutionUsageRecord>;
  return (
    typeof record.solutionId === "string" &&
    record.solutionId.length > 0 &&
    typeof record.usedAt === "number" &&
    Number.isFinite(record.usedAt)
  );
}

export function listClawSolutionUsage(): ClawSolutionUsageRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CLAW_SOLUTION_USAGE_STORAGE_KEY);
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
      .slice(0, MAX_CLAW_SOLUTION_USAGE_RECORDS);
  } catch {
    return [];
  }
}

export function getClawSolutionUsageMap(): Map<
  string,
  ClawSolutionUsageRecord
> {
  return new Map(
    listClawSolutionUsage().map((record) => [record.solutionId, record]),
  );
}

export function recordClawSolutionUsage(
  input: RecordClawSolutionUsageInput,
): ClawSolutionUsageRecord[] {
  const nextRecord: ClawSolutionUsageRecord = {
    solutionId: input.solutionId,
    usedAt: input.usedAt ?? Date.now(),
    actionType: input.actionType,
    themeTarget: input.themeTarget ?? null,
  };

  const nextRecords = [
    nextRecord,
    ...listClawSolutionUsage().filter(
      (record) => record.solutionId !== nextRecord.solutionId,
    ),
  ].slice(0, MAX_CLAW_SOLUTION_USAGE_RECORDS);

  if (typeof window === "undefined") {
    return nextRecords;
  }

  try {
    window.localStorage.setItem(
      CLAW_SOLUTION_USAGE_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  } catch {
    // ignore write errors
  }

  return nextRecords;
}
