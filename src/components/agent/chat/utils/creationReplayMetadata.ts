import type { MemoryCategory } from "@/lib/memory/memoryReferenceTypes";

const CREATION_REPLAY_VERSION = 1;
const DEFAULT_MAX_ITEMS = 6;

interface CreationReplaySource extends Record<string, unknown> {
  page: "memory_store";
  project_id?: string;
  entry_id?: string;
}

interface MemoryEntryCreationReplayData extends Record<string, unknown> {
  category: MemoryCategory;
  title?: string;
  summary?: string;
  content_excerpt?: string;
  tags?: string[];
}

export interface MemoryEntryCreationReplayMetadata {
  version: typeof CREATION_REPLAY_VERSION;
  kind: "memory_entry";
  source: CreationReplaySource;
  data: MemoryEntryCreationReplayData;
}

export type CreationReplayMetadata = MemoryEntryCreationReplayMetadata;

export type CreationReplayRequestMetadata = Record<string, unknown> & {
  harness: {
    creation_replay: CreationReplayMetadata;
  };
};

export interface MemoryEntryCreationReplayInput {
  id?: string;
  projectId?: string;
  category: MemoryCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeInlineText(value);
  if (!normalized) {
    return undefined;
  }

  return truncateText(normalized, maxLength);
}

function normalizeOptionalList(
  value: string[] | undefined,
  maxItems = DEFAULT_MAX_ITEMS,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => normalizeOptionalText(item, 120))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);

  return normalized.length > 0 ? normalized : undefined;
}

function isMemoryCategory(value: string | undefined): value is MemoryCategory {
  return (
    value === "identity" ||
    value === "context" ||
    value === "preference" ||
    value === "experience" ||
    value === "activity"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readText(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return normalizeOptionalText(
    typeof value?.[key] === "string" ? (value[key] as string) : undefined,
    4_000,
  );
}

function readTextList(
  value: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const raw = value?.[key];
  if (!Array.isArray(raw)) {
    return undefined;
  }

  return normalizeOptionalList(
    raw.filter((item): item is string => typeof item === "string"),
    12,
  );
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T;
}

function buildCreationReplayRequestMetadata(
  metadata: CreationReplayMetadata,
): CreationReplayRequestMetadata {
  return {
    harness: {
      creation_replay: metadata,
    },
  };
}

export function buildMemoryEntryCreationReplayRequestMetadata(
  entry: MemoryEntryCreationReplayInput,
): CreationReplayRequestMetadata {
  const metadata: MemoryEntryCreationReplayMetadata = {
    version: CREATION_REPLAY_VERSION,
    kind: "memory_entry",
    source: compactRecord({
      page: "memory_store",
      project_id: normalizeOptionalText(entry.projectId, 80),
      entry_id: normalizeOptionalText(entry.id, 80),
    } satisfies CreationReplaySource) as CreationReplaySource,
    data: compactRecord({
      category: entry.category,
      title: normalizeOptionalText(entry.title, 80),
      summary: normalizeOptionalText(entry.summary, 180),
      content_excerpt: normalizeOptionalText(entry.content, 220),
      tags: normalizeOptionalList(entry.tags, 6),
    } satisfies MemoryEntryCreationReplayData) as MemoryEntryCreationReplayData,
  };

  return buildCreationReplayRequestMetadata(metadata);
}

export function extractCreationReplayMetadata(
  requestMetadata?: Record<string, unknown>,
): CreationReplayMetadata | undefined {
  const harness = asRecord(requestMetadata?.harness);
  const rawReplay = asRecord(
    harness?.creation_replay ?? harness?.creationReplay,
  );
  if (!rawReplay) {
    return undefined;
  }

  const source = asRecord(rawReplay.source);
  const data = asRecord(rawReplay.data);
  const kind = readText(rawReplay, "kind");
  const page = readText(source, "page");
  const version: typeof CREATION_REPLAY_VERSION = CREATION_REPLAY_VERSION;

  const category = readText(data, "category");
  if (
    kind === "memory_entry" &&
    page === "memory_store" &&
    data &&
    isMemoryCategory(category)
  ) {
    return {
      version,
      kind,
      source: compactRecord<CreationReplaySource>({
        page,
        project_id: readText(source, "project_id"),
        entry_id: readText(source, "entry_id"),
      }),
      data: compactRecord<MemoryEntryCreationReplayData>({
        category,
        title: readText(data, "title"),
        summary: readText(data, "summary"),
        content_excerpt: readText(data, "content_excerpt"),
        tags: readTextList(data, "tags"),
      }),
    };
  }

  return undefined;
}
