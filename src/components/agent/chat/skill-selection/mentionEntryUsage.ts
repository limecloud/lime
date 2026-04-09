import type { ServiceSkillSlotValues } from "../service-skills/types";

export type MentionEntryUsageKind = "builtin_command";

export interface MentionEntryUsageRecord {
  kind: MentionEntryUsageKind;
  entryId: string;
  usedAt: number;
  replayText?: string;
  slotValues?: ServiceSkillSlotValues;
}

export interface RecordMentionEntryUsageInput {
  kind: MentionEntryUsageKind;
  entryId: string;
  usedAt?: number;
  replayText?: string;
  slotValues?: ServiceSkillSlotValues;
}

const MENTION_ENTRY_USAGE_STORAGE_KEY = "lime:mention-entry-usage:v1";
const MAX_MENTION_ENTRY_USAGE_RECORDS = 12;
const MAX_MENTION_ENTRY_REPLAY_TEXT_LENGTH = 400;

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeMentionEntrySlotValues(
  value: unknown,
): ServiceSkillSlotValues | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const nextValues = Object.fromEntries(
    Object.entries(value)
      .map(([key, slotValue]) => [key.trim(), normalizeOptionalText(slotValue)])
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );

  return Object.keys(nextValues).length > 0 ? nextValues : undefined;
}

export function getMentionEntryUsageRecordKey(
  kind: MentionEntryUsageKind,
  entryId: string,
): string {
  return `${kind}:${entryId}`;
}

function readMentionEntryUsageRecord(
  value: unknown,
): MentionEntryUsageRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<MentionEntryUsageRecord>;
  if (
    record.kind !== "builtin_command" ||
    typeof record.entryId !== "string" ||
    record.entryId.length === 0 ||
    typeof record.usedAt !== "number" ||
    !Number.isFinite(record.usedAt) ||
    (record.replayText !== undefined && typeof record.replayText !== "string")
  ) {
    return null;
  }

  const slotValues = normalizeMentionEntrySlotValues(record.slotValues);

  return {
    kind: record.kind,
    entryId: record.entryId,
    usedAt: record.usedAt,
    replayText: normalizeMentionEntryReplayText(record.replayText),
    ...(slotValues ? { slotValues } : {}),
  };
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
      .map((record) => readMentionEntryUsageRecord(record))
      .filter((record): record is MentionEntryUsageRecord => Boolean(record))
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, MAX_MENTION_ENTRY_USAGE_RECORDS);
  } catch {
    return [];
  }
}

export function getMentionEntryUsageMap(): Map<
  string,
  MentionEntryUsageRecord
> {
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
  const slotValues = normalizeMentionEntrySlotValues(input.slotValues);
  const nextRecord: MentionEntryUsageRecord = {
    kind: input.kind,
    entryId: input.entryId,
    usedAt: input.usedAt ?? Date.now(),
    replayText: normalizeMentionEntryReplayText(input.replayText),
    ...(slotValues ? { slotValues } : {}),
  };

  const nextRecords = [
    nextRecord,
    ...listMentionEntryUsage().filter(
      (record) =>
        !(
          record.kind === nextRecord.kind &&
          record.entryId === nextRecord.entryId
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
