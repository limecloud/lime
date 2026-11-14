import { access, cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export interface CodexSkillImportResult {
  imported: string[];
  skipped: string[];
  detected: number;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function importCodexSkills({
  home = homedir(),
}: {
  home?: string;
} = {}): Promise<CodexSkillImportResult> {
  const sourceRoot = path.join(home, ".codex", "skills");
  const targetRoot = path.join(home, ".lime", "skills");
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return { imported: [], skipped: [], detected: 0 };
  }
  const skills = entries.filter((entry) => entry.isDirectory());
  const imported: string[] = [];
  const skipped: string[] = [];
  await mkdir(targetRoot, { recursive: true });
  for (const entry of skills) {
    const source = path.join(sourceRoot, entry.name);
    if (!(await exists(path.join(source, "SKILL.md")))) continue;
    const target = path.join(targetRoot, entry.name);
    if (await exists(target)) {
      skipped.push(entry.name);
      continue;
    }
    await cp(source, target, { recursive: true, errorOnExist: true });
    imported.push(entry.name);
  }
  return { imported, skipped, detected: imported.length + skipped.length };
}
