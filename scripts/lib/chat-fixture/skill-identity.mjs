import fs from "node:fs";

import path from "node:path";

export function canonicalSkillFilePath(skillPath) {
  if (typeof skillPath !== "string" || !path.isAbsolute(skillPath))
    throw new Error("Skill identity requires an absolute filesystem path");
  const canonical = fs.realpathSync(skillPath);
  if (
    path.basename(canonical) !== "SKILL.md" ||
    !fs.statSync(canonical).isFile()
  )
    throw new Error("Skill identity requires an existing SKILL.md file");
  return canonical;
}

export function isExpectedSkillIdentity(observed, expected) {
  try {
    return (
      typeof expected?.name === "string" &&
      expected.name.length > 0 &&
      observed?.name === expected.name &&
      canonicalSkillFilePath(expected.path) === expected.path &&
      canonicalSkillFilePath(observed.path) === expected.path
    );
  } catch {
    // Missing, invalid or foreign files cannot establish fixture identity.
    return false;
  }
}

export function canonicalSkillProjection(value, expected) {
  if (Array.isArray(value))
    return value.map((part) => canonicalSkillProjection(part, expected));
  if (!value || typeof value !== "object") return value;
  if (value.type === "skill") {
    if (!isExpectedSkillIdentity(value, expected))
      throw new Error("Skill projection does not match the fixture file");
    return { ...value, path: expected.path };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, part]) => [
      key,
      canonicalSkillProjection(part, expected),
    ]),
  );
}
