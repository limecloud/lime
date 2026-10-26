import fs from "node:fs";

import path from "node:path";
import { canonicalSkillFilePath } from "./skill-identity.mjs";
import { assert } from "./utils.mjs";

export function writeCapabilityReportSkillPackage(skillDirectory) {
  const skillFilePath = path.join(skillDirectory, "SKILL.md");
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(
    skillFilePath,
    [
      "---",
      "name: Capability Report",
      "description: Fixture skill for rich Composer input evidence.",
      "allowed-tools: Read",
      "---",
      "",
      "# Capability Report",
      "",
      "Use this fixture skill only to prove the selected skill identity survives rich input.",
      "",
    ].join("\n"),
  );
  return { skillFilePath: canonicalSkillFilePath(skillFilePath) };
}

export function ensureUserVisibleCapabilityReportSkill(runtimeEnv) {
  const home = runtimeEnv?.env?.HOME;
  assert(home, "富文本草稿夹具 缺少临时 HOME");
  const skillDirectory = path.join(
    home,
    ".agents",
    "skills",
    "capability-report",
  );
  const { skillFilePath } = writeCapabilityReportSkillPackage(skillDirectory);
  return {
    skillDirectory,
    skillFilePath,
    skillIdentity: {
      name: path.basename(skillDirectory),
      key: "user:capability-report",
      displayName: "Capability Report",
      path: skillFilePath,
    },
  };
}
