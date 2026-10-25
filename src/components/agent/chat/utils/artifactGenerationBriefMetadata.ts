export interface GenerationBriefVoiceBoundaryInput extends Record<
  string,
  unknown
> {
  voice_source?: string | null;
  voiceSource?: string | null;
  voice_guard?: string | null;
  voiceGuard?: string | null;

  expert_persona_scope?: string | null;
  expertPersonaScope?: string | null;
  formal_artifact_voice_source?: string | null;
  formalArtifactVoiceSource?: string | null;
  creator_voice_id?: string | null;
  creatorVoiceId?: string | null;
  brand_voice_id?: string | null;
  brandVoiceId?: string | null;
  evidence_pack_id?: string | null;
  evidencePackId?: string | null;
  evidence_source?: string | null;
  evidenceSource?: string | null;
  evidence_refs?: string[] | null;
  evidenceRefs?: string[] | null;

  inherits_expert_persona?: boolean | null;
  inheritsExpertPersona?: boolean | null;
}

const STRING_FIELD_ALIASES = [
  ["voice_source", ["voice_source", "voiceSource"]],
  ["voice_guard", ["voice_guard", "voiceGuard"]],
  ["expert_persona_scope", ["expert_persona_scope", "expertPersonaScope"]],
  [
    "formal_artifact_voice_source",
    ["formal_artifact_voice_source", "formalArtifactVoiceSource"],
  ],
  ["creator_voice_id", ["creator_voice_id", "creatorVoiceId"]],
  ["brand_voice_id", ["brand_voice_id", "brandVoiceId"]],
  ["evidence_pack_id", ["evidence_pack_id", "evidencePackId"]],
  ["evidence_source", ["evidence_source", "evidenceSource"]],
] as const;

const BOOLEAN_FIELD_ALIASES = [
  [
    "inherits_expert_persona",
    ["inherits_expert_persona", "inheritsExpertPersona"],
  ],
] as const;

const STRING_ARRAY_FIELD_ALIASES = [
  ["evidence_refs", ["evidence_refs", "evidenceRefs"]],
] as const;

function normalizeVoiceSource(value: unknown): string | undefined {
  if (
    value === "creator_voice" ||
    value === "brand_voice" ||
    value === "none"
  ) {
    return value;
  }
  return typeof value === "string" && value.trim().length > 0
    ? "none"
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function hasGenerationBriefMetadata(
  metadata?: Record<string, unknown> | null,
): boolean {
  const source = asRecord(metadata);
  if (!source) {
    return false;
  }

  const artifact = asRecord(source.artifact);
  return Boolean(
    asRecord(source.generation_brief) ||
    asRecord(source.generationBrief) ||
    asRecord(artifact?.generation_brief) ||
    asRecord(artifact?.generationBrief),
  );
}

function readTrimmedString(
  source: Record<string, unknown>,
  aliases: readonly string[],
): string | undefined {
  for (const alias of aliases) {
    const value = source[alias];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readBoolean(
  source: Record<string, unknown>,
  aliases: readonly string[],
): boolean | undefined {
  for (const alias of aliases) {
    const value = source[alias];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function readStringArray(
  source: Record<string, unknown>,
  aliases: readonly string[],
): string[] | undefined {
  for (const alias of aliases) {
    const value = source[alias];
    if (!Array.isArray(value)) {
      continue;
    }
    const items = value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    if (items.length > 0) {
      return items.map((item) => item.trim());
    }
  }
  return undefined;
}

function removeKnownAliases(metadata: Record<string, unknown>): void {
  for (const [, aliases] of [
    ...STRING_FIELD_ALIASES,
    ...BOOLEAN_FIELD_ALIASES,
    ...STRING_ARRAY_FIELD_ALIASES,
  ]) {
    aliases.forEach((alias) => {
      delete metadata[alias];
    });
  }
}

function removeStaleVoiceIdentityFields(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const voiceSource = normalizeVoiceSource(metadata.voice_source);
  if (voiceSource) {
    metadata.voice_source = voiceSource;
  } else {
    delete metadata.voice_source;
  }

  switch (voiceSource) {
    case "creator_voice":
      delete metadata.brand_voice_id;
      break;
    case "brand_voice":
      delete metadata.creator_voice_id;
      break;
    case "none":
    default:
      delete metadata.creator_voice_id;
      delete metadata.brand_voice_id;
      break;
  }

  return metadata;
}

export function buildGenerationBriefMetadata(
  input?: GenerationBriefVoiceBoundaryInput | null,
): Record<string, unknown> | undefined {
  const source = asRecord(input);
  if (!source) {
    return undefined;
  }

  const metadata = Object.entries(source).reduce<Record<string, unknown>>(
    (next, [key, value]) => {
      if (value !== undefined && value !== null) {
        next[key] = value;
      }
      return next;
    },
    {},
  );
  removeKnownAliases(metadata);

  for (const [field, aliases] of STRING_FIELD_ALIASES) {
    const value = readTrimmedString(source, aliases);
    if (value) {
      metadata[field] = value;
    }
  }

  for (const [field, aliases] of BOOLEAN_FIELD_ALIASES) {
    const value = readBoolean(source, aliases);
    if (value !== undefined) {
      metadata[field] = value;
    }
  }

  for (const [field, aliases] of STRING_ARRAY_FIELD_ALIASES) {
    const value = readStringArray(source, aliases);
    if (value) {
      metadata[field] = value;
    }
  }

  removeStaleVoiceIdentityFields(metadata);

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildMergedGenerationBriefMetadata(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  let hasExplicitSource = false;
  const metadata = sources.reduce<Record<string, unknown>>((next, source) => {
    if (source) {
      hasExplicitSource = true;
    }
    const normalized = buildGenerationBriefMetadata(source);
    return normalized ? { ...next, ...normalized } : next;
  }, {});

  removeStaleVoiceIdentityFields(metadata);

  return hasExplicitSource || Object.keys(metadata).length > 0
    ? metadata
    : undefined;
}

export function mergeRequestMetadataWithArtifact(
  base?: Record<string, unknown>,
  overlay?: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = {
    ...(base || {}),
    ...(overlay || {}),
  };
  const baseArtifact = asRecord(base?.artifact);
  const overlayArtifact = asRecord(overlay?.artifact);
  const generationBrief = buildMergedGenerationBriefMetadata(
    asRecord(base?.generation_brief),
    asRecord(base?.generationBrief),
    asRecord(baseArtifact?.generation_brief),
    asRecord(baseArtifact?.generationBrief),
    asRecord(overlay?.generation_brief),
    asRecord(overlay?.generationBrief),
    asRecord(overlayArtifact?.generation_brief),
    asRecord(overlayArtifact?.generationBrief),
  );

  if (baseArtifact || overlayArtifact) {
    metadata.artifact = {
      ...(baseArtifact || {}),
      ...(overlayArtifact || {}),
    };
  }

  if (generationBrief) {
    delete metadata.generation_brief;
    delete metadata.generationBrief;
    const artifact = {
      ...(asRecord(metadata.artifact) || {}),
    };
    delete artifact.generation_brief;
    delete artifact.generationBrief;
    artifact.generation_brief = generationBrief;
    metadata.artifact = artifact;
  }

  return metadata;
}

export function mergeGenerationBriefIntoArtifactMetadata(
  requestMetadata?: Record<string, unknown>,
  generationBrief?: GenerationBriefVoiceBoundaryInput | null,
): Record<string, unknown> {
  const source = requestMetadata || {};
  const artifact = asRecord(source.artifact);
  const normalizedExisting = buildMergedGenerationBriefMetadata(
    asRecord(source.generation_brief),
    asRecord(source.generationBrief),
    asRecord(artifact?.generation_brief),
    asRecord(artifact?.generationBrief),
  );
  const normalizedInput = buildMergedGenerationBriefMetadata(
    asRecord(generationBrief),
  );
  const hasGenerationBrief =
    normalizedExisting !== undefined || normalizedInput !== undefined;
  const normalizedGenerationBrief = hasGenerationBrief
    ? removeStaleVoiceIdentityFields({
        ...(normalizedExisting || {}),
        ...(normalizedInput || {}),
      })
    : undefined;

  const metadata = { ...source };
  if (!normalizedGenerationBrief) {
    return metadata;
  }

  delete metadata.generation_brief;
  delete metadata.generationBrief;

  const nextArtifact = {
    ...(artifact || {}),
  };
  delete nextArtifact.generation_brief;
  delete nextArtifact.generationBrief;
  nextArtifact.generation_brief = normalizedGenerationBrief;
  metadata.artifact = nextArtifact;

  return metadata;
}
