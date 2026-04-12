export interface TeamMemoryEntry {
  key: string;
  content: string;
  updatedAt: number;
}

export interface TeamMemorySnapshot {
  repoScope: string;
  entries: Record<string, TeamMemoryEntry>;
}

export interface TeamMemoryShadowRequestMetadataEntry {
  key: string;
  content: string;
  updated_at: number;
}

export interface TeamMemoryShadowRequestMetadata {
  repo_scope: string;
  entries: TeamMemoryShadowRequestMetadataEntry[];
}

export interface TeamMemorySyncPlan {
  repoScope: string;
  changedKeys: string[];
  deferredKeys: string[];
  skippedSecretKeys: string[];
  payloadBytes: number;
  checksumByKey: Record<string, string>;
  entries: Record<string, TeamMemoryEntry>;
}

export interface TeamMemoryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TeamMemorySnapshotStorageLike extends TeamMemoryStorageLike {
  key(index: number): string | null;
  length: number;
}

const TEAM_MEMORY_STORAGE_PREFIX = "lime:team-memory:";
const TEAM_MEMORY_REQUEST_PRIORITY: Record<string, number> = {
  "team.selection": 0,
  "team.subagents": 1,
  "team.parent_context": 2,
};
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["api_key", /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/i],
  ["access_token", /\baccess[_-]?token\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/i],
  [
    "refresh_token",
    /\brefresh[_-]?token\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/i,
  ],
  ["bearer", /\bbearer\s+[A-Za-z0-9._-]{12,}/i],
  ["openai", /\bsk-[A-Za-z0-9]{16,}\b/i],
];

function normalizeEntry(entry: TeamMemoryEntry): TeamMemoryEntry {
  return {
    key: entry.key.trim(),
    content: entry.content,
    updatedAt: entry.updatedAt,
  };
}

export function normalizeTeamMemoryRepoScope(repoScope: string): string {
  const normalized = repoScope.replace(/\\/g, "/").trim().replace(/\/+$/u, "");
  if (/^[A-Z]:\//.test(normalized)) {
    return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

export function getTeamMemoryStorageKey(repoScope: string): string {
  return `${TEAM_MEMORY_STORAGE_PREFIX}${normalizeTeamMemoryRepoScope(repoScope)}`;
}

function compareRequestEntries(
  left: TeamMemoryEntry,
  right: TeamMemoryEntry,
): number {
  const leftPriority = TEAM_MEMORY_REQUEST_PRIORITY[left.key] ?? 99;
  const rightPriority = TEAM_MEMORY_REQUEST_PRIORITY[right.key] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.key.localeCompare(right.key);
}

export function buildTeamMemoryShadowRequestMetadata(
  snapshot?: TeamMemorySnapshot | null,
): TeamMemoryShadowRequestMetadata | undefined {
  if (!snapshot) {
    return undefined;
  }

  const entries = Object.values(snapshot.entries)
    .map((entry) => ({
      key: entry.key.trim(),
      content: entry.content.trim(),
      updated_at: entry.updatedAt,
    }))
    .filter(
      (entry) =>
        entry.key.length > 0 &&
        entry.content.length > 0 &&
        Number.isFinite(entry.updated_at),
    )
    .sort((left, right) =>
      compareRequestEntries(
        {
          key: left.key,
          content: left.content,
          updatedAt: left.updated_at,
        },
        {
          key: right.key,
          content: right.content,
          updatedAt: right.updated_at,
        },
      ),
    );

  if (entries.length === 0) {
    return undefined;
  }

  return {
    repo_scope: normalizeTeamMemoryRepoScope(snapshot.repoScope),
    entries,
  };
}

export function scanTeamMemorySecrets(content: string): string[] {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(content)).map(
    ([label]) => label,
  );
}

export function readTeamMemorySnapshot(
  storage: TeamMemoryStorageLike,
  repoScope: string,
): TeamMemorySnapshot | null {
  const raw = storage.getItem(getTeamMemoryStorageKey(repoScope));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as TeamMemorySnapshot;
    return {
      repoScope: normalizeTeamMemoryRepoScope(parsed.repoScope || repoScope),
      entries: Object.fromEntries(
        Object.entries(parsed.entries || {}).map(([key, entry]) => [
          key,
          normalizeEntry(entry),
        ]),
      ),
    };
  } catch {
    return null;
  }
}

export function writeTeamMemorySnapshot(
  storage: TeamMemoryStorageLike,
  snapshot: TeamMemorySnapshot,
): void {
  storage.setItem(
    getTeamMemoryStorageKey(snapshot.repoScope),
    JSON.stringify({
      repoScope: normalizeTeamMemoryRepoScope(snapshot.repoScope),
      entries: Object.fromEntries(
        Object.entries(snapshot.entries).map(([key, entry]) => [
          key,
          normalizeEntry(entry),
        ]),
      ),
    }),
  );
}

export function listTeamMemorySnapshots(
  storage: TeamMemorySnapshotStorageLike,
): TeamMemorySnapshot[] {
  const snapshots: TeamMemorySnapshot[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (!storageKey || !storageKey.startsWith(TEAM_MEMORY_STORAGE_PREFIX)) {
      continue;
    }

    const repoScope = storageKey.slice(TEAM_MEMORY_STORAGE_PREFIX.length);
    const snapshot = readTeamMemorySnapshot(storage, repoScope);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  snapshots.sort((left, right) => {
    const leftUpdatedAt = Math.max(
      0,
      ...Object.values(left.entries).map((entry) => entry.updatedAt),
    );
    const rightUpdatedAt = Math.max(
      0,
      ...Object.values(right.entries).map((entry) => entry.updatedAt),
    );
    return rightUpdatedAt - leftUpdatedAt;
  });

  return snapshots;
}

async function sha256Hex(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashTeamMemoryContent(content: string): Promise<string> {
  return `sha256:${await sha256Hex(content)}`;
}

export async function buildTeamMemorySyncPlan(
  snapshot: TeamMemorySnapshot,
  serverChecksums: Record<string, string>,
  maxBodyBytes = 200_000,
): Promise<TeamMemorySyncPlan> {
  const checksumByKey: Record<string, string> = {};
  const changedKeys: string[] = [];
  const deferredKeys: string[] = [];
  const skippedSecretKeys: string[] = [];
  const entries: Record<string, TeamMemoryEntry> = {};

  let payloadBytes = 0;
  const orderedEntries = Object.values(snapshot.entries).sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  for (const entry of orderedEntries) {
    const secretHits = scanTeamMemorySecrets(entry.content);
    if (secretHits.length > 0) {
      skippedSecretKeys.push(entry.key);
      continue;
    }

    const checksum = await hashTeamMemoryContent(entry.content);
    checksumByKey[entry.key] = checksum;

    if (serverChecksums[entry.key] === checksum) {
      continue;
    }

    const nextEntry = normalizeEntry(entry);
    const nextPayloadBytes = payloadBytes + JSON.stringify(nextEntry).length;
    if (nextPayloadBytes > maxBodyBytes) {
      deferredKeys.push(entry.key);
      continue;
    }

    entries[entry.key] = nextEntry;
    changedKeys.push(entry.key);
    payloadBytes = nextPayloadBytes;
  }

  return {
    repoScope: normalizeTeamMemoryRepoScope(snapshot.repoScope),
    changedKeys,
    deferredKeys,
    skippedSecretKeys,
    payloadBytes,
    checksumByKey,
    entries,
  };
}
