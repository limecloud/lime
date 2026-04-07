import {
  resolveArtifactDocumentCurrentVersionDiff,
  resolveArtifactDocumentSourceLinks,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";
import {
  resolveArtifactProtocolDocumentPayload,
  resolveArtifactProtocolFilePath,
} from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import type { AgentThreadItem } from "../types";

export interface ArtifactTimelineOpenTarget {
  artifactId?: string;
  filePath: string;
  content: string;
  timelineItemId: string;
  blockId?: string;
}

export interface ArtifactTimelineLink {
  itemId: string;
  blockId: string;
  label: string;
  filePath: string;
  artifactId?: string;
  updatedAt?: string;
  sequence: number;
}

interface ResolvedTimelineArtifactNavigation {
  rootTarget: ArtifactTimelineOpenTarget;
  blockTargets: ArtifactTimelineOpenTarget[];
  artifactDocumentId?: string;
  title?: string;
  updatedAt?: string;
  sequence: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

function readString(
  record: Record<string, unknown> | null,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = normalizeText(record?.[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readStringArray(
  record: Record<string, unknown> | null,
  keys: string[],
): string[] {
  const values: string[] = [];

  for (const key of keys) {
    const rawValue = record?.[key];
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        const normalized = normalizeText(item);
        if (normalized) {
          values.push(normalized);
        }
      }
      continue;
    }

    const normalized = normalizeText(rawValue);
    if (normalized) {
      values.push(normalized);
    }
  }

  return values;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function buildStepLabel(sequence: number): string {
  return `步骤 ${String(sequence).padStart(2, "0")}`;
}

function resolveDocumentBlockIds(
  document: ArtifactDocumentV1 | null,
  includeSourceLinks: boolean,
): string[] {
  if (!document) {
    return [];
  }

  const diffBlockIds =
    resolveArtifactDocumentCurrentVersionDiff(document)
      ?.changedBlocks.map((block) => normalizeText(block.blockId))
      .filter((blockId): blockId is string => Boolean(blockId)) || [];
  if (diffBlockIds.length > 0) {
    return dedupeStrings(diffBlockIds);
  }

  if (!includeSourceLinks) {
    return [];
  }

  return dedupeStrings(
    resolveArtifactDocumentSourceLinks(document)
      .map((link) => normalizeText(link.blockId))
      .filter((blockId): blockId is string => Boolean(blockId)),
  );
}

export function resolveTimelineArtifactNavigation(
  item: AgentThreadItem,
  options?: {
    includeSourceLinks?: boolean;
  },
): ResolvedTimelineArtifactNavigation | null {
  if (item.type !== "file_artifact") {
    return null;
  }

  const metadata = asRecord(item.metadata);
  const artifactId = readString(metadata, ["artifact_id", "artifactId"]);
  const filePath = normalizePath(item.path);
  const content = typeof item.content === "string" ? item.content : "";
  const document = resolveArtifactProtocolDocumentPayload({
    content,
    metadata: metadata || undefined,
  });
  const explicitBlockIds = readStringArray(metadata, [
    "artifact_block_id",
    "artifactBlockId",
    "block_id",
    "blockId",
    "target_block_id",
    "targetBlockId",
    "artifact_target_block_id",
    "artifactTargetBlockId",
  ]);
  const blockIds =
    explicitBlockIds.length > 0
      ? dedupeStrings(explicitBlockIds)
      : resolveDocumentBlockIds(document, options?.includeSourceLinks === true);
  const rootTarget: ArtifactTimelineOpenTarget = {
    artifactId,
    filePath,
    content,
    timelineItemId: item.id,
  };

  return {
    rootTarget,
    blockTargets: blockIds.map((blockId) => ({
      ...rootTarget,
      blockId,
    })),
    artifactDocumentId: document?.artifactId,
    title: document?.title,
    updatedAt: item.updated_at,
    sequence: item.sequence,
  };
}

export function buildArtifactTimelineLinkIndex(params: {
  artifact: Artifact;
  items: AgentThreadItem[];
}): Record<string, ArtifactTimelineLink[]> {
  const artifactPath = normalizePath(
    resolveArtifactProtocolFilePath(params.artifact),
  );
  const document = resolveArtifactProtocolDocumentPayload({
    content: params.artifact.content,
    metadata: params.artifact.meta,
  });
  const artifactIds = new Set(
    [
      normalizeText(params.artifact.id),
      normalizeText(document?.artifactId),
      normalizeText(asRecord(params.artifact.meta)?.artifactId),
    ].filter((value): value is string => Boolean(value)),
  );
  const result = new Map<string, ArtifactTimelineLink[]>();

  for (const item of params.items) {
    const navigation = resolveTimelineArtifactNavigation(item, {
      includeSourceLinks: true,
    });
    if (!navigation) {
      continue;
    }

    const matchesByPath =
      navigation.rootTarget.filePath.length > 0 &&
      navigation.rootTarget.filePath === artifactPath;
    const matchesByArtifactId =
      (navigation.rootTarget.artifactId &&
        artifactIds.has(navigation.rootTarget.artifactId)) ||
      (navigation.artifactDocumentId &&
        artifactIds.has(navigation.artifactDocumentId));

    if (!matchesByPath && !matchesByArtifactId) {
      continue;
    }

    for (const target of navigation.blockTargets) {
      if (!target.blockId) {
        continue;
      }
      const current = result.get(target.blockId) || [];
      current.push({
        itemId: navigation.rootTarget.timelineItemId,
        blockId: target.blockId,
        label: navigation.title || buildStepLabel(navigation.sequence),
        filePath: navigation.rootTarget.filePath,
        artifactId: navigation.rootTarget.artifactId,
        updatedAt: navigation.updatedAt,
        sequence: navigation.sequence,
      });
      result.set(target.blockId, current);
    }
  }

  return Object.fromEntries(
    Array.from(result.entries()).map(([blockId, links]) => [
      blockId,
      [...links].sort((left, right) => right.sequence - left.sequence),
    ]),
  );
}
