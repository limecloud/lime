import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importCodexSkills } from "./externalAgentImport";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("importCodexSkills", () => {
  it("copies Codex skills once and never overwrites existing Lime skills", async () => {
    root = await mkdtemp(path.join(tmpdir(), "lime-import-"));
    const skill = path.join(root, ".codex", "skills", "reviewer");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "# Reviewer\n", "utf8");

    const first = await importCodexSkills({ home: root });
    expect(first.imported).toEqual(["reviewer"]);
    expect(
      await readFile(path.join(root, ".lime", "skills", "reviewer", "SKILL.md"), "utf8"),
    ).toContain("Reviewer");

    const second = await importCodexSkills({ home: root });
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual(["reviewer"]);
  });
});
