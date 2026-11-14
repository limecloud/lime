import { safeInvoke } from "@/lib/dev-bridge";

export interface CodexSettingsSnapshot {
  approvalPolicy?: string;
  sandboxMode?: string;
  projects: string[];
}

export async function readCodexSettings(): Promise<CodexSettingsSnapshot | null> {
  const result = await safeInvoke<unknown>("read_codex_settings");
  if (result === null) return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("read_codex_settings returned an invalid result");
  }
  const record = result as Record<string, unknown>;
  return {
    approvalPolicy:
      typeof record.approvalPolicy === "string"
        ? record.approvalPolicy
        : undefined,
    sandboxMode:
      typeof record.sandboxMode === "string"
        ? record.sandboxMode
        : undefined,
    projects: Array.isArray(record.projects)
      ? record.projects.filter(
          (project): project is string => typeof project === "string",
        )
      : [],
  };
}
