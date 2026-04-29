import type {
  RecordServiceSkillUsageInput,
  ServiceSkillSlotValues,
  ServiceSkillUsageRecord,
} from "./types";

const SERVICE_SKILL_USAGE_STORAGE_KEY = "lime:service-skill-usage:v1";
const MAX_SERVICE_SKILL_USAGE_RECORDS = 12;
export const SERVICE_SKILL_USAGE_CHANGED_EVENT =
  "lime:service-skill-usage-changed";

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeServiceSkillSlotValues(
  value: unknown,
): ServiceSkillSlotValues | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const nextValues = Object.fromEntries(
    Object.entries(value)
      .map(([key, slotValue]) => [key.trim(), normalizeOptionalText(slotValue)])
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0] && entry[1]),
      ),
  );

  return Object.keys(nextValues).length > 0 ? nextValues : undefined;
}

function readUsageRecord(value: unknown): ServiceSkillUsageRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<ServiceSkillUsageRecord>;
  const skillId = normalizeOptionalText(record.skillId);
  const runnerType = normalizeOptionalText(record.runnerType);
  if (
    !skillId ||
    !runnerType ||
    typeof record.usedAt !== "number" ||
    !Number.isFinite(record.usedAt)
  ) {
    return null;
  }

  const slotValues = normalizeServiceSkillSlotValues(record.slotValues);
  const launchUserInput = normalizeOptionalText(record.launchUserInput);

  return {
    skillId,
    usedAt: record.usedAt,
    runnerType: runnerType as ServiceSkillUsageRecord["runnerType"],
    ...(slotValues ? { slotValues } : {}),
    ...(launchUserInput ? { launchUserInput } : {}),
  };
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
      .map((record) => readUsageRecord(record))
      .filter((record): record is ServiceSkillUsageRecord => Boolean(record))
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

function emitServiceSkillUsageChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(SERVICE_SKILL_USAGE_CHANGED_EVENT));
}

export function subscribeServiceSkillUsageChanged(
  callback: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const customEventHandler = () => {
    callback();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SERVICE_SKILL_USAGE_STORAGE_KEY) {
      return;
    }
    callback();
  };

  window.addEventListener(
    SERVICE_SKILL_USAGE_CHANGED_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      SERVICE_SKILL_USAGE_CHANGED_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
}

export function recordServiceSkillUsage(
  input: RecordServiceSkillUsageInput,
): ServiceSkillUsageRecord[] {
  const slotValues = normalizeServiceSkillSlotValues(input.slotValues);
  const launchUserInput = normalizeOptionalText(input.launchUserInput);
  const nextRecord: ServiceSkillUsageRecord = {
    skillId: input.skillId,
    usedAt: input.usedAt ?? Date.now(),
    runnerType: input.runnerType,
    ...(slotValues ? { slotValues } : {}),
    ...(launchUserInput ? { launchUserInput } : {}),
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
    emitServiceSkillUsageChanged();
  } catch {
    // ignore write errors
  }

  return nextRecords;
}
