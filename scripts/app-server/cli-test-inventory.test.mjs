import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "internal/exec-plans/cli-codex-test-inventory.json",
    ),
    "utf8",
  ),
);

describe("Codex CLI test inventory", () => {
  it("records every upstream Rust test with stable source evidence", () => {
    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.sourceCommit).toBe(
      "970111f6cb62cc02fe36a82ea7d71b37a2889c97",
    );
    expect(inventory.sourceFileCount).toBe(78);
    expect(inventory.testCount).toBe(574);
    expect(inventory.entries).toHaveLength(inventory.testCount);
    expect(inventory.sourcePathSetSha256).toBe(
      "67c5a11ff6e35c17e7718d4b19fc4efe1d6af6265dbec650d87da9b3f12c8892",
    );
    expect(inventory.sourceTreeSha256).toBe(
      "2f8731dfb510142bae03701d9aee82510ff563ab154961692e4e2eefcec0e76a",
    );

    const identities = inventory.entries.map(
      (entry) => `${entry.path}::${entry.testName}`,
    );
    expect(new Set(identities).size).toBe(inventory.testCount);
    for (const entry of inventory.entries) {
      expect(entry.path).not.toMatch(/^\//u);
      expect(entry.testName).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/u);
      expect(entry.sourceLine).toBeGreaterThan(0);
      expect(entry.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect([
        "direct",
        "contract",
        "product-specific",
        "cloud-deferred",
        "missing",
      ]).toContain(entry.classification);
      expect([
        "covered",
        "partial",
        "pending",
        "deferred",
        "excluded",
      ]).toContain(entry.status);
      expect(inventory.rules.some((rule) => rule.id === entry.rule)).toBe(true);
      expect(entry.rationale.length).toBeGreaterThan(20);
    }
  });

  it("keeps incomplete alignment explicit instead of claiming surface parity", () => {
    const actualCounts = Object.fromEntries(
      [
        "direct",
        "contract",
        "product-specific",
        "cloud-deferred",
        "missing",
      ].map((classification) => [
        classification,
        inventory.entries.filter(
          (entry) => entry.classification === classification,
        ).length,
      ]),
    );
    expect(actualCounts).toEqual(inventory.counts);
    expect(inventory.statusCounts.partial).toBeGreaterThan(0);
    expect(inventory.statusCounts.deferred).toBeGreaterThan(0);
    expect(inventory.statusCounts.excluded).toBeGreaterThan(0);
  });
});
