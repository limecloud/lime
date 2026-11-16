import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd());
const rustRoot = path.join(repoRoot, "lime-rs");
const retiredOrchestratorRoot = path.join(
  rustRoot,
  "crates",
  "core",
  "src",
  "orchestrator",
);

const retiredOrchestratorReference =
  /\b(?:lime_core::(?:orchestrator|FallbackPolicy|ServiceTier)|crate::orchestrator|ModelOrchestrator|FallbackHandler|DynamicPoolBuilder|ModelSelector|TierPool|AvailableModel)\b/;

function listRustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "target" ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        return [];
      }
      return listRustFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith(".rs") ? [absolutePath] : [];
  });
}

describe("core orchestrator owner boundary", () => {
  it("keeps the retired duplicate model orchestrator directory deleted", () => {
    expect(existsSync(retiredOrchestratorRoot)).toBe(false);
  });

  it("does not re-export the retired module from the core crate root", () => {
    const coreLib = readFileSync(
      path.join(rustRoot, "crates", "core", "src", "lib.rs"),
      "utf8",
    );

    expect(coreLib).not.toMatch(/pub\s+mod\s+orchestrator\b/);
  });

  it("does not allow the retired orchestrator module or API to return", () => {
    const references = listRustFiles(rustRoot)
      .filter((absolutePath) =>
        retiredOrchestratorReference.test(readFileSync(absolutePath, "utf8")),
      )
      .map((absolutePath) =>
        path.relative(repoRoot, absolutePath).split(path.sep).join("/"),
      )
      .sort();

    expect(references).toEqual([]);
  });
});
