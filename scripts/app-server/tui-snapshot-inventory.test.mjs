import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "internal/exec-plans/tui-codex-snapshot-inventory.json",
    ),
    "utf8",
  ),
);

describe("Codex TUI snapshot inventory", () => {
  it("classifies every recorded snapshot with a stable relative path and hash", () => {
    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
    const pathSetHash = createHash("sha256")
      .update(
        inventory.entries
          .map((entry) => entry.path.replace(/^src\//u, ""))
          .join("\n") + "\n",
      )
      .digest("hex");
    expect(inventory.sourcePathSetSha256).toBe(pathSetHash);
    expect(inventory.snapshotCount).toBe(inventory.entries.length);
    expect(inventory.snapshotCount).toBeGreaterThan(0);
    expect(new Set(inventory.entries.map((entry) => entry.path)).size).toBe(
      inventory.snapshotCount,
    );
    for (const entry of inventory.entries) {
      expect(entry.path).not.toMatch(/^\//u);
      expect(entry.module).toMatch(/^[a-z][a-z0-9_]*$/u);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(["direct", "merge", "contract", "defer", "dead"]).toContain(
        entry.classification,
      );
      expect(inventory.rules.some((rule) => rule.id === entry.rule)).toBe(true);
    }
  });

  it("keeps migration counts consistent with classified evidence", () => {
    const actualCounts = Object.fromEntries(
      ["direct", "merge", "contract", "defer", "dead"].map((classification) => [
        classification,
        inventory.entries.filter(
          (entry) => entry.classification === classification,
        ).length,
      ]),
    );
    expect(actualCounts).toEqual(inventory.counts);
    expect(
      inventory.entries.find((entry) =>
        entry.path.includes("hook_blocked_failed_feedback_history"),
      )?.classification,
    ).toBe("merge");
  });
});
