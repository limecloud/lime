import type { SkillCatalogSceneEntry } from "@/lib/api/skillCatalog";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";

interface RuntimeSceneCommandLike {
  key?: string | null;
  commandPrefix?: string | null;
  aliases?: string[] | null;
}

interface RuntimeSceneBindingLike {
  sceneKey?: string | null;
  commandPrefix?: string | null;
  aliases?: string[] | null;
}

export function normalizeRuntimeSceneToken(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function buildRuntimeSceneTokenSet(
  values: Array<string | null | undefined>,
): Set<string> {
  return new Set(
    values.map((value) => normalizeRuntimeSceneToken(value)).filter(Boolean),
  );
}

function buildRuntimeSceneBindingTokenSet(
  binding?: RuntimeSceneBindingLike | null,
): Set<string> {
  if (!binding) {
    return new Set();
  }

  return buildRuntimeSceneTokenSet([
    binding.sceneKey,
    binding.commandPrefix,
    ...(binding.aliases ?? []),
  ]);
}

function buildRuntimeSceneCommandTokenSet(
  command: RuntimeSceneCommandLike,
): Set<string> {
  return buildRuntimeSceneTokenSet([
    command.key,
    command.commandPrefix,
    ...(command.aliases ?? []),
  ]);
}

function hasRuntimeSceneTokenIntersection(
  left: Iterable<string>,
  right: Set<string>,
): boolean {
  for (const token of left) {
    if (right.has(token)) {
      return true;
    }
  }

  return false;
}

export function matchesRuntimeSceneEntry(
  entry: SkillCatalogSceneEntry,
  sceneKey: string,
): boolean {
  const normalizedSceneKey = normalizeRuntimeSceneToken(sceneKey);
  if (!normalizedSceneKey) {
    return false;
  }

  return buildRuntimeSceneBindingTokenSet(entry).has(normalizedSceneKey);
}

export function matchesRuntimeSceneCommandToServiceSkill(
  skill: Pick<ServiceSkillItem, "sceneBinding">,
  command: RuntimeSceneCommandLike,
): boolean {
  const bindingTokens = buildRuntimeSceneBindingTokenSet(skill.sceneBinding);
  if (bindingTokens.size === 0) {
    return false;
  }

  return hasRuntimeSceneTokenIntersection(
    buildRuntimeSceneCommandTokenSet(command),
    bindingTokens,
  );
}

export function resolveRuntimeSceneSkillFromEntry(
  serviceSkills: ServiceSkillItem[],
  entry: SkillCatalogSceneEntry,
): ServiceSkillItem | null {
  const entryTokens = buildRuntimeSceneTokenSet([
    entry.linkedSkillId,
    entry.sceneKey,
    entry.commandPrefix,
    ...(entry.aliases ?? []),
  ]);
  if (entryTokens.size === 0) {
    return null;
  }

  return (
    serviceSkills.find((skill) => {
      const skillTokens = buildRuntimeSceneTokenSet([
        skill.id,
        skill.skillKey,
        skill.sceneBinding?.sceneKey,
        skill.sceneBinding?.commandPrefix,
        ...(skill.sceneBinding?.aliases ?? []),
      ]);
      return hasRuntimeSceneTokenIntersection(skillTokens, entryTokens);
    }) || null
  );
}
