import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";

export interface CodexSettingsSnapshot {
  approvalPolicy?: string;
  sandboxMode?: string;
  projects: string[];
}

export async function readCodexSettings({
  home = homedir(),
}: {
  home?: string;
} = {}): Promise<CodexSettingsSnapshot | null> {
  let source: string;
  try {
    source = await readFile(path.join(home, ".codex", "config.toml"), "utf8");
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
  const projects =
    parsed.projects && typeof parsed.projects === "object"
      ? Object.keys(parsed.projects as Record<string, unknown>)
      : [];
  return {
    approvalPolicy:
      typeof parsed.approval_policy === "string"
        ? parsed.approval_policy
        : undefined,
    sandboxMode:
      typeof parsed.sandbox_mode === "string" ? parsed.sandbox_mode : undefined,
    projects,
  };
}
