import type { Skill } from "@/lib/api/skills";

interface BuildInstalledSkillCapabilityDescriptionOptions {
  includePromise?: boolean;
  includeRequiredInputs?: boolean;
  includeOutputHint?: boolean;
}

const FALLBACK_REQUIRED_INPUTS = "对话里继续补充目标与约束";
const FALLBACK_OUTPUT_HINT = "带着该 Skill 进入生成";
const DEFAULT_PROMISE = "当你需要复用这个 Skill 时使用。";

function readInstalledSkillMetadata(
  skill: Pick<Skill, "metadata">,
  key: string,
): string | null {
  const value = skill.metadata?.[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveInstalledSkillPromise(
  skill: Pick<Skill, "description" | "metadata">,
): string {
  const description = skill.description?.trim();

  return (
    readInstalledSkillMetadata(skill, "lime_when_to_use") ??
    readInstalledSkillMetadata(skill, "when_to_use") ??
    (description && description.length > 0 ? description : null) ??
    DEFAULT_PROMISE
  );
}

export function summarizeInstalledSkillRequiredInputs(
  skill: Pick<Skill, "metadata">,
): string {
  return (
    readInstalledSkillMetadata(skill, "lime_argument_hint") ??
    readInstalledSkillMetadata(skill, "argument_hint") ??
    FALLBACK_REQUIRED_INPUTS
  );
}

export function getInstalledSkillOutputHint(
  skill: Pick<Skill, "metadata">,
): string {
  return (
    readInstalledSkillMetadata(skill, "lime_output_hint") ??
    readInstalledSkillMetadata(skill, "output_hint") ??
    FALLBACK_OUTPUT_HINT
  );
}

export function buildInstalledSkillCapabilityDescription(
  skill: Pick<Skill, "description" | "metadata">,
  options: BuildInstalledSkillCapabilityDescriptionOptions = {},
): string {
  const segments: string[] = [];

  if (options.includePromise ?? true) {
    segments.push(resolveInstalledSkillPromise(skill));
  }

  if (options.includeRequiredInputs ?? true) {
    segments.push(`需要：${summarizeInstalledSkillRequiredInputs(skill)}`);
  }

  if (options.includeOutputHint ?? true) {
    segments.push(`交付：${getInstalledSkillOutputHint(skill)}`);
  }

  return segments.join(" · ");
}
