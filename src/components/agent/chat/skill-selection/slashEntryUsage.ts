export type SlashEntryUsageKind = "command" | "scene" | "skill";

export interface SlashEntryUsageRecord {
  kind: SlashEntryUsageKind;
  entryId: string;
  usedAt: number;
  replayText?: string;
}

export interface RecordSlashEntryUsageInput {
  kind: SlashEntryUsageKind;
  entryId: string;
  usedAt?: number;
  replayText?: string;
}

const SLASH_ENTRY_USAGE_STORAGE_KEY = "lime:slash-entry-usage:v1";
const MAX_SLASH_ENTRY_USAGE_RECORDS = 12;
const MAX_SLASH_ENTRY_REPLAY_TEXT_LENGTH = 400;
export const SLASH_ENTRY_USAGE_CHANGED_EVENT =
  "lime:slash-entry-usage-changed";

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
    Number.isFinite(record.usedAt) &&
    (record.replayText === undefined || typeof record.replayText === "string")
  );
}

function normalizeSlashEntryReplayText(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, MAX_SLASH_ENTRY_REPLAY_TEXT_LENGTH).trim();
}

function emitSlashEntryUsageChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(SLASH_ENTRY_USAGE_CHANGED_EVENT));
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

export function subscribeSlashEntryUsageChanged(
  callback: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const customEventHandler = () => {
    callback();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SLASH_ENTRY_USAGE_STORAGE_KEY) {
      return;
    }
    callback();
  };

  window.addEventListener(
    SLASH_ENTRY_USAGE_CHANGED_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      SLASH_ENTRY_USAGE_CHANGED_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
}

export function recordSlashEntryUsage(
  input: RecordSlashEntryUsageInput,
): SlashEntryUsageRecord[] {
  const nextRecord: SlashEntryUsageRecord = {
    kind: input.kind,
    entryId: input.entryId,
    usedAt: input.usedAt ?? Date.now(),
    replayText: normalizeSlashEntryReplayText(input.replayText),
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
    emitSlashEntryUsageChanged();
  } catch {
    // ignore write errors
  }

  return nextRecords;
}
