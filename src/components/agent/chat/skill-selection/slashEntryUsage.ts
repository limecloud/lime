export type SlashEntryUsageKind = "command" | "scene" | "skill";

export interface SlashEntryUsageRecord {
  kind: SlashEntryUsageKind;
  entryId: string;
  usedAt: number;
}

export interface RecordSlashEntryUsageInput {
  kind: SlashEntryUsageKind;
  entryId: string;
  usedAt?: number;
}

const SLASH_ENTRY_USAGE_STORAGE_KEY = "lime:slash-entry-usage:v1";
const MAX_SLASH_ENTRY_USAGE_RECORDS = 12;

export function getSlashEntryUsageRecordKey(
  kind: SlashEntryUsageKind,
  entryId: string,
): string {
  return `${kind}:${entryId}`;
}

function isValidSlashEntryUsageRecord(
  value: unknown,
): value is SlashEntryUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<SlashEntryUsageRecord>;
  return (
    (record.kind === "command" ||
      record.kind === "scene" ||
      record.kind === "skill") &&
    typeof record.entryId === "string" &&
    record.entryId.length > 0 &&
    typeof record.usedAt === "number" &&
    Number.isFinite(record.usedAt)
  );
}

export function listSlashEntryUsage(): SlashEntryUsageRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SLASH_ENTRY_USAGE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidSlashEntryUsageRecord)
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, MAX_SLASH_ENTRY_USAGE_RECORDS);
  } catch {
    return [];
  }
}

export function getSlashEntryUsageMap(): Map<string, SlashEntryUsageRecord> {
  return new Map(
    listSlashEntryUsage().map((record) => [
      getSlashEntryUsageRecordKey(record.kind, record.entryId),
      record,
    ]),
  );
}

export function recordSlashEntryUsage(
  input: RecordSlashEntryUsageInput,
): SlashEntryUsageRecord[] {
  const nextRecord: SlashEntryUsageRecord = {
    kind: input.kind,
    entryId: input.entryId,
    usedAt: input.usedAt ?? Date.now(),
  };

  const nextRecords = [
    nextRecord,
    ...listSlashEntryUsage().filter(
      (record) =>
        !(
          record.kind === nextRecord.kind &&
          record.entryId === nextRecord.entryId
        ),
    ),
  ].slice(0, MAX_SLASH_ENTRY_USAGE_RECORDS);

  if (typeof window === "undefined") {
    return nextRecords;
  }

  try {
    window.localStorage.setItem(
      SLASH_ENTRY_USAGE_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  } catch {
    // ignore write errors
  }

  return nextRecords;
}
