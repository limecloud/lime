import type {
  KnowledgePackDetail,
  KnowledgePackSummary,
} from "@/lib/api/knowledge";
import {
  COMPAT_KNOWLEDGE_BUILDER_SKILL_NAME,
  PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_NAME,
} from "./knowledgePromptBuilder";

type KnowledgeBuilderSkillKind = "agent-skill" | "lime-compat-compiler";
type KnowledgeBuilderFamily = "persona" | "data";
export type KnowledgePackActivation =
  | "explicit"
  | "implicit"
  | "resolver-driven";

export interface KnowledgeRequestCompanionPack {
  name: string;
  activation?: KnowledgePackActivation;
}

interface KnowledgeBuilderResolution {
  skillName: string;
  skillKind: KnowledgeBuilderSkillKind;
  normalizedPackType: string | null;
  limeTemplate: string | null;
  family: KnowledgeBuilderFamily;
  runtimeMode: KnowledgeBuilderFamily;
  bundlePath?: string;
  deprecated: boolean;
}

const BUILTIN_DATA_BUILDER_SKILLS: Record<string, string> = {
  "content-operations": "content-operations-knowledge-builder",
  "private-domain-operations": "private-domain-operations-knowledge-builder",
  "live-commerce-operations": "live-commerce-operations-knowledge-builder",
  "campaign-operations": "campaign-operations-knowledge-builder",
  "brand-product": "brand-product-knowledge-builder",
  "organization-knowhow": "organization-knowhow-knowledge-builder",
  "growth-strategy": "growth-strategy-knowledge-builder",
};

const BUILTIN_PERSONA_BUILDER_SKILLS: Record<string, string> = {
  "brand-persona": "brand-persona-knowledge-builder",
};

const PERSONA_PACK_TYPES = new Set([
  "personal-profile",
  "brand-persona",
  "founder-persona",
]);

function normalizeBuilderPackType(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return { packType: null, limeTemplate: null };
  }
  if (normalized === "personal-ip" || normalized === "personal-profile") {
    return { packType: "personal-profile", limeTemplate: "personal-ip" };
  }
  if (normalized === "custom:lime-growth-strategy") {
    return { packType: "growth-strategy", limeTemplate: "growth-strategy" };
  }
  if (normalized === "organization-know-how") {
    return {
      packType: "organization-knowhow",
      limeTemplate: "organization-knowhow",
    };
  }
  return { packType: normalized, limeTemplate: normalized };
}

export function resolveKnowledgeBuilderSkill(params: {
  packType?: string | null;
}): KnowledgeBuilderResolution {
  const normalized = normalizeBuilderPackType(params.packType);
  if (
    normalized.packType === "personal-profile" &&
    normalized.limeTemplate === "personal-ip"
  ) {
    return {
      skillName: PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_NAME,
      skillKind: "agent-skill",
      normalizedPackType: normalized.packType,
      limeTemplate: normalized.limeTemplate,
      family: "persona",
      runtimeMode: "persona",
      bundlePath:
        "src-tauri/resources/default-skills/personal-ip-knowledge-builder",
      deprecated: false,
    };
  }

  const builtinPersonaSkillName = normalized.packType
    ? BUILTIN_PERSONA_BUILDER_SKILLS[normalized.packType]
    : undefined;
  if (builtinPersonaSkillName) {
    return {
      skillName: builtinPersonaSkillName,
      skillKind: "agent-skill",
      normalizedPackType: normalized.packType,
      limeTemplate: normalized.limeTemplate,
      family: "persona",
      runtimeMode: "persona",
      bundlePath: `src-tauri/resources/default-skills/${builtinPersonaSkillName}`,
      deprecated: false,
    };
  }

  const builtinDataSkillName = normalized.packType
    ? BUILTIN_DATA_BUILDER_SKILLS[normalized.packType]
    : undefined;

  if (builtinDataSkillName) {
    return {
      skillName: builtinDataSkillName,
      skillKind: "agent-skill",
      normalizedPackType: normalized.packType,
      limeTemplate: normalized.limeTemplate,
      family: "data",
      runtimeMode: "data",
      bundlePath: `src-tauri/resources/default-skills/${builtinDataSkillName}`,
      deprecated: false,
    };
  }

  return {
    skillName: COMPAT_KNOWLEDGE_BUILDER_SKILL_NAME,
    skillKind: "lime-compat-compiler",
    normalizedPackType: normalized.packType,
    limeTemplate: normalized.limeTemplate,
    family: "data",
    runtimeMode: "data",
    deprecated: true,
  };
}

export function resolveKnowledgePackRuntimeMode(
  pack?: KnowledgePackSummary | KnowledgePackDetail | null,
): KnowledgeBuilderFamily {
  const runtimeMode = pack?.metadata.runtime?.mode?.trim();
  if (runtimeMode === "persona" || runtimeMode === "data") {
    return runtimeMode;
  }

  const normalized = normalizeBuilderPackType(pack?.metadata.type);
  return normalized.packType && PERSONA_PACK_TYPES.has(normalized.packType)
    ? "persona"
    : "data";
}

export function resolveKnowledgeRequestCompanionPacks(params: {
  primaryPackName: string;
  packs: KnowledgePackSummary[];
  explicitPackNames?: string[];
}): KnowledgeRequestCompanionPack[] {
  const primaryPackName = params.primaryPackName.trim();
  if (!primaryPackName) {
    return [];
  }

  const primaryPack = params.packs.find(
    (pack) => pack.metadata.name === primaryPackName,
  );
  if (!primaryPack) {
    return [];
  }
  const primaryRuntimeMode = resolveKnowledgePackRuntimeMode(primaryPack);
  const companionPacks: KnowledgeRequestCompanionPack[] = [];

  if (primaryRuntimeMode !== "persona") {
    const personaPacks = params.packs.filter(
      (pack) =>
        pack.metadata.name !== primaryPackName &&
        pack.metadata.status === "ready" &&
        resolveKnowledgePackRuntimeMode(pack) === "persona",
    );
    const personaPack =
      personaPacks.find((pack) => pack.defaultForWorkspace) ?? personaPacks[0];
    if (personaPack) {
      companionPacks.push({
        name: personaPack.metadata.name,
        activation: "implicit",
      });
    }
  }

  const knownCompanionNames = new Set([
    primaryPackName,
    ...companionPacks.map((pack) => pack.name),
  ]);
  for (const explicitPackName of params.explicitPackNames ?? []) {
    const normalizedName = explicitPackName.trim();
    if (!normalizedName || knownCompanionNames.has(normalizedName)) {
      continue;
    }
    const explicitPack = params.packs.find(
      (pack) => pack.metadata.name === normalizedName,
    );
    if (
      !explicitPack ||
      explicitPack.metadata.status !== "ready" ||
      resolveKnowledgePackRuntimeMode(explicitPack) !== "data"
    ) {
      continue;
    }
    companionPacks.push({
      name: explicitPack.metadata.name,
      activation: "explicit",
    });
    knownCompanionNames.add(explicitPack.metadata.name);
  }

  return companionPacks;
}

export function buildKnowledgeRequestMetadata(params: {
  workingDir: string;
  packName: string;
  pack?: KnowledgePackSummary | KnowledgePackDetail | null;
  packs?: KnowledgeRequestCompanionPack[];
  source?: "knowledge_page" | "inputbar";
}) {
  const companionPacks = (params.packs ?? [])
    .map((pack) => ({
      name: pack.name.trim(),
      activation: pack.activation,
    }))
    .filter((pack) => pack.name && pack.name !== params.packName.trim());

  return {
    knowledge_pack: {
      pack_name: params.packName,
      working_dir: params.workingDir,
      source: params.source ?? "knowledge_page",
      ...(params.pack
        ? {
            status: params.pack.metadata.status,
            grounding: params.pack.metadata.grounding ?? "recommended",
          }
        : {}),
      ...(companionPacks.length ? { packs: companionPacks } : {}),
    },
  };
}

export function buildKnowledgeBuilderMetadata(params: {
  workingDir: string;
  packName: string;
  source: "knowledge_page" | "inputbar";
  packType?: string | null;
}) {
  const builder = resolveKnowledgeBuilderSkill({ packType: params.packType });
  return {
    knowledge_builder: {
      kind: builder.skillKind,
      skill_name: builder.skillName,
      pack_type: builder.normalizedPackType,
      lime_template: builder.limeTemplate,
      family: builder.family,
      runtime_mode: builder.runtimeMode,
      pack_name: params.packName,
      working_dir: params.workingDir,
      source: params.source,
      deprecated: builder.deprecated,
      ...(builder.bundlePath ? { bundle_path: builder.bundlePath } : {}),
    },
  };
}
