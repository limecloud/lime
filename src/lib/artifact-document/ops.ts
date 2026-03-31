import type {
  ArtifactBeginEnvelope,
  ArtifactAttachSourceOperation,
  ArtifactBlockRemoveEnvelope,
  ArtifactBlockUpsertEnvelope,
  ArtifactCreateOperation,
  ArtifactCompleteEnvelope,
  ArtifactDocumentIncrementalEnvelope,
  ArtifactDocumentIncrementalEnvelopeType,
  ArtifactDocumentOperation,
  ArtifactDocumentOperationName,
  ArtifactDocumentSource,
  ArtifactDocumentStatus,
  ArtifactFailOperation,
  ArtifactFinalizeVersionOperation,
  ArtifactIncrementalFailEnvelope,
  ArtifactMetaPatchEnvelope,
  ArtifactOperationCandidateEnvelope,
  ArtifactOpsEnvelope,
  ArtifactRemoveBlockOperation,
  ArtifactReorderBlocksOperation,
  ArtifactRewritePatchEnvelope,
  ArtifactSourceUpsertEnvelope,
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

const ARTIFACT_INCREMENTAL_ENVELOPE_TYPES = new Set<ArtifactDocumentIncrementalEnvelopeType>([
  "artifact.begin",
  "artifact.meta.patch",
  "artifact.source.upsert",
  "artifact.block.upsert",
  "artifact.block.remove",
  "artifact.complete",
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

function normalizeSourceValue(value: unknown): ArtifactDocumentSource | null {
  const source = asRecord(value);
  if (!source || !normalizeText(source.id) || !normalizeText(source.label)) {
    return null;
  }

  return source as ArtifactDocumentSource;
}

function normalizeSourceArray(value: unknown): ArtifactDocumentSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources = value
    .map((item) => normalizeSourceValue(item))
    .filter((item): item is ArtifactDocumentSource => Boolean(item));

  return sources.length > 0 ? sources : undefined;
}

function normalizeBlockValue(
  value: unknown,
): ArtifactBlockUpsertEnvelope["block"] | null {
  const block = asRecord(value);
  if (!block || !normalizeText(block.id) || !normalizeText(block.type)) {
    return null;
  }

  return block as ArtifactBlockUpsertEnvelope["block"];
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

function normalizeIncrementalEnvelope(
  value: unknown,
): ArtifactDocumentIncrementalEnvelope | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const type = normalizeText(record.type) as
    | ArtifactDocumentIncrementalEnvelopeType
    | undefined;
  if (!type || !ARTIFACT_INCREMENTAL_ENVELOPE_TYPES.has(type)) {
    return null;
  }

  const artifactId = normalizeText(record.artifactId);
  if (!artifactId) {
    return null;
  }

  switch (type) {
    case "artifact.begin": {
      const kind = normalizeText(record.kind);
      const title = normalizeText(record.title);
      if (!kind || !title) {
        return null;
      }
      return {
        type,
        artifactId,
        kind: kind as ArtifactBeginEnvelope["kind"],
        title,
      };
    }
    case "artifact.meta.patch": {
      const patch = asRecord(record.patch);
      if (!patch) {
        return null;
      }
      return {
        type,
        artifactId,
        patch,
      } satisfies ArtifactMetaPatchEnvelope;
    }
    case "artifact.source.upsert": {
      const source = normalizeSourceValue(record.source);
      if (!source) {
        return null;
      }
      return {
        type,
        artifactId,
        source,
      } satisfies ArtifactSourceUpsertEnvelope;
    }
    case "artifact.block.upsert": {
      const block = normalizeBlockValue(record.block);
      if (!block) {
        return null;
      }
      return {
        type,
        artifactId,
        block,
      };
    }
    case "artifact.block.remove": {
      const blockId = normalizeText(record.blockId);
      if (!blockId) {
        return null;
      }
      return {
        type,
        artifactId,
        blockId,
      } satisfies ArtifactBlockRemoveEnvelope;
    }
    case "artifact.complete":
      return {
        type,
        artifactId,
        ...(normalizeText(record.summary) ? { summary: normalizeText(record.summary) } : {}),
      } satisfies ArtifactCompleteEnvelope;
    case "artifact.fail": {
      const reason = normalizeText(record.reason);
      if (!reason) {
        return null;
      }
      return {
        type,
        artifactId,
        reason,
      } satisfies ArtifactIncrementalFailEnvelope;
    }
    default:
      return null;
  }
}

export function parseArtifactRewritePatchValue(
  value: unknown,
): ArtifactRewritePatchEnvelope | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const type = normalizeText(record.type);
  const targetBlockId =
    normalizeText(record.targetBlockId) ||
    normalizeText(record.target_block_id);
  if (type && type !== "artifact_rewrite_patch") {
    return null;
  }
  if (!type && !targetBlockId) {
    return null;
  }

  const artifactId =
    normalizeText(record.artifactId) || normalizeText(record.artifact_id);
  const block = normalizeBlockValue(record.block);
  if (!artifactId || !block) {
    return null;
  }

  const source = normalizeSourceValue(record.source);
  const sources = normalizeSourceArray(record.sources);
  const status = normalizeText(record.status) as
    | ArtifactDocumentStatus
    | undefined;

  return {
    type: "artifact_rewrite_patch",
    artifactId,
    targetBlockId: targetBlockId || block.id,
    block,
    ...(source ? { source } : {}),
    ...(sources ? { sources } : {}),
    ...(normalizeText(record.summary) ? { summary: normalizeText(record.summary) } : {}),
    ...(status ? { status } : {}),
  };
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

export function parseArtifactIncrementalValue(
  value: unknown,
): ArtifactDocumentIncrementalEnvelope | null {
  return normalizeIncrementalEnvelope(value);
}

export function parseArtifactOperationCandidateValue(
  value: unknown,
): ArtifactOperationCandidateEnvelope | null {
  return (
    parseArtifactIncrementalValue(value) ||
    parseArtifactRewritePatchValue(value) ||
    parseArtifactOpsValue(value)
  );
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

export function parseArtifactIncrementalString(
  raw: string,
): ArtifactDocumentIncrementalEnvelope | null {
  const normalized = stripOptionalJsonFence(raw);
  if (!normalized) {
    return null;
  }

  try {
    return parseArtifactIncrementalValue(JSON.parse(normalized));
  } catch {
    return null;
  }
}

export function parseArtifactRewritePatchString(
  raw: string,
): ArtifactRewritePatchEnvelope | null {
  const normalized = stripOptionalJsonFence(raw);
  if (!normalized) {
    return null;
  }

  try {
    return parseArtifactRewritePatchValue(JSON.parse(normalized));
  } catch {
    return null;
  }
}

export function parseArtifactOperationCandidateString(
  raw: string,
): ArtifactOperationCandidateEnvelope | null {
  const normalized = stripOptionalJsonFence(raw);
  if (!normalized) {
    return null;
  }

  try {
    return parseArtifactOperationCandidateValue(JSON.parse(normalized));
  } catch {
    return null;
  }
}
