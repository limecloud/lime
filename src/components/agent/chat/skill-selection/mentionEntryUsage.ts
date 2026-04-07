export type MentionEntryUsageKind = "builtin_command";

export interface MentionEntryUsageRecord {
  kind: MentionEntryUsageKind;
  entryId: string;
  usedAt: number;
  replayText?: string;
}

export interface RecordMentionEntryUsageInput {
  kind: MentionEntryUsageKind;
  entryId: string;
  usedAt?: number;
  replayText?: string;
}

const MENTION_ENTRY_USAGE_STORAGE_KEY = "lime:mention-entry-usage:v1";
const MAX_MENTION_ENTRY_USAGE_RECORDS = 12;
const MAX_MENTION_ENTRY_REPLAY_TEXT_LENGTH = 400;

export function getMentionEntryUsageRecordKey(
  kind: MentionEntryUsageKind,
  entryId: string,
): string {
  return `${kind}:${entryId}`;
}

function isValidMentionEntryUsageRecord(
  value: unknown,
): value is MentionEntryUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<MentionEntryUsageRecord>;
  return (
    record.kind === "builtin_command" &&
    typeof record.entryId === "string" &&
    record.entryId.length > 0 &&
    typeof record.usedAt === "number" &&
    Number.isFinite(record.usedAt) &&
    (record.replayText === undefined || typeof record.replayText === "string")
  );
}

function normalizeMentionEntryReplayText(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, MAX_MENTION_ENTRY_REPLAY_TEXT_LENGTH).trim();
}

export function listMentionEntryUsage(): MentionEntryUsageRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MENTION_ENTRY_USAGE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidMentionEntryUsageRecord)
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, MAX_MENTION_ENTRY_USAGE_RECORDS);
  } catch {
    return [];
  }
}

export function getMentionEntryUsageMap(): Map<string, MentionEntryUsageRecord> {
  return new Map(
    listMentionEntryUsage().map((record) => [
      getMentionEntryUsageRecordKey(record.kind, record.entryId),
      record,
    ]),
  );
}

export function recordMentionEntryUsage(
  input: RecordMentionEntryUsageInput,
): MentionEntryUsageRecord[] {
  const nextRecord: MentionEntryUsageRecord = {
    kind: input.kind,
    entryId: input.entryId,
    usedAt: input.usedAt ?? Date.now(),
    replayText: normalizeMentionEntryReplayText(input.replayText),
  };

  const nextRecords = [
    nextRecord,
    ...listMentionEntryUsage().filter(
      (record) =>
        !(
          record.kind === nextRecord.kind && record.entryId === nextRecord.entryId
        ),
    ),
  ].slice(0, MAX_MENTION_ENTRY_USAGE_RECORDS);

  if (typeof window === "undefined") {
    return nextRecords;
  }

  try {
    window.localStorage.setItem(
      MENTION_ENTRY_USAGE_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  } catch {
    // ignore write errors
  }

  return nextRecords;
}
