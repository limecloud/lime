import type {
  ArtifactAttachSourceOperation,
  ArtifactCreateOperation,
  ArtifactDocumentOperation,
  ArtifactDocumentOperationName,
  ArtifactFailOperation,
  ArtifactFinalizeVersionOperation,
  ArtifactOpsEnvelope,
  ArtifactRemoveBlockOperation,
  ArtifactReorderBlocksOperation,
  ArtifactSetMetaOperation,
  ArtifactUpsertBlockOperation,
} from "./types";
import {
  parseArtifactDocumentValue,
} from "./parser";

const ARTIFACT_OPERATION_NAMES = new Set<ArtifactDocumentOperationName>([
  "artifact.create",
  "artifact.set_meta",
  "artifact.upsert_block",
  "artifact.reorder_blocks",
  "artifact.remove_block",
  "artifact.attach_source",
  "artifact.finalize_version",
  "artifact.fail",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));

  return items.length > 0 ? items : undefined;
}

function stripOptionalJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) {
    return trimmed;
  }

  return lines.slice(1, -1).join("\n").trim();
}

function normalizeOperation(
  value: unknown,
): ArtifactDocumentOperation | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const op = normalizeText(record.op) as ArtifactDocumentOperationName | undefined;
  if (!op || !ARTIFACT_OPERATION_NAMES.has(op)) {
    return null;
  }

  switch (op) {
    case "artifact.create":
      return {
        op,
        ...(parseArtifactDocumentValue(record.document)
          ? { document: parseArtifactDocumentValue(record.document)! }
          : asRecord(record.document)
            ? { document: record.document as ArtifactCreateOperation["document"] }
            : {}),
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
        ...(normalizeText(record.kind)
          ? { kind: normalizeText(record.kind) as ArtifactCreateOperation["kind"] }
          : {}),
        ...(normalizeText(record.status)
          ? { status: normalizeText(record.status) as ArtifactCreateOperation["status"] }
          : {}),
        ...(normalizeText(record.summary)
          ? { summary: normalizeText(record.summary) }
          : {}),
        ...(asRecord(record.metadata)
          ? { metadata: record.metadata as Record<string, unknown> }
          : {}),
      };
    case "artifact.set_meta":
      return {
        op,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
        ...(normalizeText(record.kind)
          ? { kind: normalizeText(record.kind) as ArtifactSetMetaOperation["kind"] }
          : {}),
        ...(normalizeText(record.status)
          ? { status: normalizeText(record.status) as ArtifactSetMetaOperation["status"] }
          : {}),
        ...(normalizeText(record.summary)
          ? { summary: normalizeText(record.summary) }
          : {}),
        ...(asRecord(record.metadata)
          ? { metadata: record.metadata as Record<string, unknown> }
          : {}),
      };
    case "artifact.upsert_block": {
      const block = asRecord(record.block);
      if (!block || !normalizeText(block.id) || !normalizeText(block.type)) {
        return null;
      }
      return {
        op,
        block: block as ArtifactUpsertBlockOperation["block"],
        ...(normalizeText(record.beforeBlockId)
          ? { beforeBlockId: normalizeText(record.beforeBlockId) }
          : {}),
        ...(normalizeText(record.afterBlockId)
          ? { afterBlockId: normalizeText(record.afterBlockId) }
          : {}),
      };
    }
    case "artifact.reorder_blocks": {
      const blockIds = normalizeStringArray(record.blockIds);
      if (!blockIds) {
        return null;
      }
      return {
        op,
        blockIds,
      } satisfies ArtifactReorderBlocksOperation;
    }
    case "artifact.remove_block": {
      const blockId = normalizeText(record.blockId);
      if (!blockId) {
        return null;
      }
      return {
        op,
        blockId,
      } satisfies ArtifactRemoveBlockOperation;
    }
    case "artifact.attach_source": {
      const blockId = normalizeText(record.blockId);
      const source = asRecord(record.source);
      if (!blockId || !source) {
        return null;
      }
      return {
        op,
        blockId,
        source: source as ArtifactAttachSourceOperation["source"],
        ...(asRecord(record.sourceLink)
          ? { sourceLink: record.sourceLink as ArtifactAttachSourceOperation["sourceLink"] }
          : {}),
      };
    }
    case "artifact.finalize_version":
      return {
        op,
        ...(normalizeText(record.summary)
          ? { summary: normalizeText(record.summary) }
          : {}),
        ...(normalizeText(record.status)
          ? { status: normalizeText(record.status) as ArtifactFinalizeVersionOperation["status"] }
          : {}),
      };
    case "artifact.fail": {
      const reason = normalizeText(record.reason);
      if (!reason) {
        return null;
      }
      return {
        op,
        reason,
      } satisfies ArtifactFailOperation;
    }
    default:
      return null;
  }
}

export function parseArtifactOpsValue(value: unknown): ArtifactOpsEnvelope | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  if (normalizeText(record.type) !== "artifact_ops") {
    return null;
  }

  const ops = Array.isArray(record.ops)
    ? record.ops
        .map((item) => normalizeOperation(item))
        .filter((item): item is ArtifactDocumentOperation => Boolean(item))
    : [];

  if (ops.length === 0) {
    return null;
  }

  return {
    type: "artifact_ops",
    ...(normalizeText(record.artifactId)
      ? { artifactId: normalizeText(record.artifactId) }
      : {}),
    ops,
  };
}

export function parseArtifactOpsString(raw: string): ArtifactOpsEnvelope | null {
  const normalized = stripOptionalJsonFence(raw);
  if (!normalized) {
    return null;
  }

  try {
    return parseArtifactOpsValue(JSON.parse(normalized));
  } catch {
    return null;
  }
}
