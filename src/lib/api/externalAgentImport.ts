import { safeInvoke } from "@/lib/dev-bridge";

export interface CodexSkillImportResult {
  imported: string[];
  skipped: string[];
  detected: number;
}

export async function importCodexSkills(): Promise<CodexSkillImportResult> {
  const result = await safeInvoke<unknown>("import_codex_skills");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("import_codex_skills returned an invalid result");
  }
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.imported) || !Array.isArray(record.skipped)) {
    throw new Error("import_codex_skills returned an invalid result");
  }
  return {
    imported: record.imported.filter(
      (item): item is string => typeof item === "string",
    ),
    skipped: record.skipped.filter(
      (item): item is string => typeof item === "string",
    ),
    detected: typeof record.detected === "number" ? record.detected : 0,
  };
}
