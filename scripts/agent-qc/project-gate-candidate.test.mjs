import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECT_GATE_EXCLUDES,
  assertProjectGateTrackersReady,
  captureGitReferenceCommit,
  captureProjectGateSurfaceContract,
  captureProjectGateSnapshot,
  compareProjectGateSnapshots,
  formatProjectGateRunId,
  isExcludedProjectGatePath,
  normalizeExcludes,
  parseGitNameStatus,
  validateProjectGateCandidateDescriptor,
} from "../lib/project-gate-candidate-core.mjs";

function makeRepo() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "project-gate-candidate-"),
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Gate Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "gate@example.invalid"], {
    cwd: root,
  });
  fs.mkdirSync(path.join(root, "internal", "exec-plans"), { recursive: true });
  fs.writeFileSync(path.join(root, "tracked.txt"), "tracked-v1\n", "utf8");
  fs.writeFileSync(
    path.join(
      root,
      "internal",
      "exec-plans",
      "project-gate-a-b-acceptance-plan.md",
    ),
    "mutable plan v1\n",
    "utf8",
  );
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "--no-gpg-sign", "-m", "fixture"], {
    cwd: root,
  });
  return root;
}

function writeTracker(root, status) {
  const trackerPath = path.join(
    root,
    "internal",
    "roadmap",
    "codeximport",
    "implementation-tracker.md",
  );
  fs.mkdirSync(path.dirname(trackerPath), { recursive: true });
  fs.writeFileSync(
    trackerPath,
    `---\nstatus: ${status}\n---\n\n# Tracker\n`,
    "utf8",
  );
}

function surfaceContractDescriptor() {
  return {
    path: "internal/test/project-gate-surfaces.manifest.json",
    schema_version: 1,
    surface_count: 34,
    priority_counts: { P0: 17, P1: 17 },
    digest: "e".repeat(64),
  };
}

describe("project Gate candidate snapshot", () => {
  it("fails before snapshot when output or exclusion escapes the repository", () => {
    const script = path.resolve("scripts/agent-qc/project-gate-candidate.mjs");
    const outputResult = spawnSync(
      process.execPath,
      [script, "--output", path.join(os.tmpdir(), "candidate.json")],
      { encoding: "utf8" },
    );
    expect(outputResult.status).toBe(1);
    expect(outputResult.stderr).toContain(
      "--output 必须位于 digest exclusion 内",
    );

    const exclusionResult = spawnSync(
      process.execPath,
      [script, "--exclude", "../outside", "--snapshot-only"],
      { encoding: "utf8" },
    );
    expect(exclusionResult.status).toBe(1);
    expect(exclusionResult.stderr).toContain("--exclude 必须是仓库内相对路径");
  });

  it("parses modified, deleted, and renamed Git name-status records", () => {
    const input = Buffer.from(
      "M\0src/a.ts\0D\0src/b.ts\0R100\0src/old.ts\0src/new.ts\0",
      "utf8",
    );
    expect(parseGitNameStatus(input)).toEqual([
      { status: "M", path: "src/a.ts", previousPath: null },
      { status: "D", path: "src/b.ts", previousPath: null },
      {
        status: "R100",
        path: "src/new.ts",
        previousPath: "src/old.ts",
      },
    ]);
  });

  it("uses exact path-or-descendant exclusions", () => {
    const excludes = normalizeExcludes([
      ...DEFAULT_PROJECT_GATE_EXCLUDES,
      "./internal/research/gate-summary.md",
    ]);
    expect(
      isExcludedProjectGatePath(
        ".lime/qc/project-gates/run/candidate.json",
        excludes,
      ),
    ).toBe(true);
    expect(
      isExcludedProjectGatePath(
        "internal/research/refactor/v2/13-evidence/project-gates/run.md",
        excludes,
      ),
    ).toBe(true);
    expect(
      isExcludedProjectGatePath(
        "internal/research/gate-summary.md.backup",
        excludes,
      ),
    ).toBe(false);
  });

  it("ignores mutable Gate evidence but detects tracked and untracked product changes", () => {
    const root = makeRepo();
    const baseline = captureProjectGateSnapshot({ repoRoot: root });

    fs.writeFileSync(
      path.join(
        root,
        "internal",
        "exec-plans",
        "project-gate-a-b-acceptance-plan.md",
      ),
      "mutable plan v2\n",
      "utf8",
    );
    const planOnly = captureProjectGateSnapshot({ repoRoot: root });
    expect(planOnly.product_snapshot_digest).toBe(
      baseline.product_snapshot_digest,
    );
    expect(planOnly.git_diff_digest).toBe(baseline.git_diff_digest);
    expect(planOnly.changed_paths).toEqual([]);

    const candidatePath = path.join(
      root,
      ".lime",
      "qc",
      "project-gates",
      "candidate-test",
      "candidate.json",
    );
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    fs.writeFileSync(
      candidatePath,
      JSON.stringify({
        schema_version: 3,
        run_id: "candidate-test",
        ...planOnly,
        reference_commit: "d".repeat(40),
        blocking_trackers: [
          {
            path: "internal/roadmap/codeximport/implementation-tracker.md",
            status: "ready-for-gate",
          },
        ],
        surface_contract: surfaceContractDescriptor(),
        stability: { stable: true },
      }),
      "utf8",
    );
    const verifyResult = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/agent-qc/project-gate-candidate.mjs"),
        "--repo-root",
        root,
        "--verify-candidate",
        candidatePath,
      ],
      { encoding: "utf8" },
    );
    expect(verifyResult.status).toBe(0);
    expect(JSON.parse(verifyResult.stdout)).toMatchObject({
      status: "match",
      run_id: "candidate-test",
    });

    fs.writeFileSync(path.join(root, "tracked.txt"), "tracked-v2\n", "utf8");
    fs.writeFileSync(path.join(root, "untracked.txt"), "new\n", "utf8");
    const changed = captureProjectGateSnapshot({ repoRoot: root });
    expect(changed.product_snapshot_digest).not.toBe(
      baseline.product_snapshot_digest,
    );
    expect(changed.changed_paths).toEqual(["tracked.txt", "untracked.txt"]);
    expect(changed.snapshot_file_count).toBe(2);
  }, 45_000);

  it("pins a clean reference commit and rejects dirty reference state", () => {
    const referenceRoot = makeRepo();
    const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: referenceRoot,
      encoding: "utf8",
    }).trim();
    expect(captureGitReferenceCommit(referenceRoot)).toBe(expectedCommit);

    fs.writeFileSync(
      path.join(referenceRoot, "untracked-reference.txt"),
      "dirty\n",
      "utf8",
    );
    expect(() => captureGitReferenceCommit(referenceRoot)).toThrow(
      "参考源码仓库存在未提交改动",
    );
  }, 20_000);

  it.each(["flag", "env"])(
    "%s selects the reference repository at the CLI boundary",
    (source) => {
      const root = makeRepo(),
        reference = makeRepo();
      const manifest = "internal/test/project-gate-surfaces.manifest.json";
      fs.mkdirSync(path.dirname(path.join(root, manifest)), {
        recursive: true,
      });
      fs.copyFileSync(path.resolve(manifest), path.join(root, manifest));
      fs.writeFileSync(
        path.join(reference, "dirty.txt"),
        "uncommitted reference\n",
      );
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("scripts/agent-qc/project-gate-candidate.mjs"),
          "--repo-root",
          root,
          "--snapshot-only",
          ...(source === "flag" ? ["--reference-repo", reference] : []),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            LIME_REFERENCE_REPO: source === "env" ? reference : "",
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("参考源码仓库存在未提交改动");
      expect(result.stdout).toBe("");
    },
    20_000,
  );

  it("blocks candidate generation until the import owner tracker is ready", () => {
    const root = makeRepo();
    writeTracker(root, "active");
    expect(() => assertProjectGateTrackersReady({ repoRoot: root })).toThrow(
      "candidate blocker 未退出",
    );

    writeTracker(root, "ready-for-gate");
    expect(assertProjectGateTrackersReady({ repoRoot: root })).toEqual([
      {
        path: "internal/roadmap/codeximport/implementation-tracker.md",
        status: "ready-for-gate",
      },
    ]);

    writeTracker(root, "paused");
    expect(() => assertProjectGateTrackersReady({ repoRoot: root })).toThrow(
      "status=paused",
    );
  });

  it("pins the 34-surface Gate contract and rejects denominator drift", () => {
    const baseline = captureProjectGateSurfaceContract();
    expect(baseline).toMatchObject({
      path: "internal/test/project-gate-surfaces.manifest.json",
      schema_version: 1,
      surface_count: 34,
      priority_counts: { P0: 17, P1: 17 },
    });

    const root = makeRepo();
    const targetPath = path.join(
      root,
      "internal",
      "test",
      "project-gate-surfaces.manifest.json",
    );
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve("internal/test/project-gate-surfaces.manifest.json"),
        "utf8",
      ),
    );
    fs.writeFileSync(targetPath, JSON.stringify(manifest), "utf8");
    expect(captureProjectGateSurfaceContract({ repoRoot: root })).toMatchObject(
      {
        surface_count: 34,
        priority_counts: { P0: 17, P1: 17 },
      },
    );

    manifest.surfaces[0].priority = "P1";
    fs.writeFileSync(targetPath, JSON.stringify(manifest), "utf8");
    expect(() => captureProjectGateSurfaceContract({ repoRoot: root })).toThrow(
      "priority 分母漂移",
    );
  });

  it("compares all freeze invariants and creates the canonical run-id", () => {
    const snapshot = {
      product_snapshot_digest: "a".repeat(64),
      git_diff_digest: "b".repeat(64),
      git_head: "c".repeat(40),
      changed_paths: ["src/a.ts"],
      digest_excludes: [".lime/qc/project-gates"],
    };
    expect(
      compareProjectGateSnapshots(snapshot, { ...snapshot }),
    ).toMatchObject({ stable: true });
    expect(
      compareProjectGateSnapshots(snapshot, {
        ...snapshot,
        changed_paths: ["src/b.ts"],
      }),
    ).toMatchObject({ stable: false, changedPathsMatch: false });
    expect(
      formatProjectGateRunId(
        new Date("2026-07-16T01:02:03.456Z"),
        snapshot.product_snapshot_digest,
      ),
    ).toBe("20260716T010203Z-aaaaaaaaaaaa");
    expect(() =>
      validateProjectGateCandidateDescriptor({
        schema_version: 3,
        run_id: "candidate-test",
        ...snapshot,
        reference_commit: "d".repeat(40),
        blocking_trackers: [
          {
            path: "internal/roadmap/codeximport/implementation-tracker.md",
            status: "completed",
          },
        ],
        surface_contract: surfaceContractDescriptor(),
        stability: { stable: false },
      }),
    ).toThrow("未通过双 snapshot 稳定性检查");
  });
});
