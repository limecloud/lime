import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildProjectGateCoverage,
  readProjectGateSurfaceManifest,
} from "../lib/project-gate-coverage-core.mjs";
import { captureProjectGateSurfaceContract } from "../lib/project-gate-candidate-core.mjs";

const manifest = readProjectGateSurfaceManifest(
  path.resolve("internal/test/project-gate-surfaces.manifest.json"),
);
const RUN_ID = "candidate-test-run";

function evidence({
  surfaceId,
  proof,
  complete = true,
  result = "pass",
  file = `${surfaceId}-${proof}.json`,
}) {
  const failed = result === "pass" ? [] : ["scenarioFailed"];
  return {
    file,
    value: {
      schemaVersion: 1,
      candidateRunId: RUN_ID,
      surfaceProof: { surfaceId, proof, complete },
      result,
      assertions: {
        total: 3,
        passed: result === "pass" ? 3 : 2,
        failed,
      },
      ...(result === "pass"
        ? {}
        : {
            failureClass: "product",
            nextAction: "fix the owning surface and rerun",
          }),
    },
  };
}

describe("project Gate coverage", () => {
  it("keeps an empty candidate at 0/34", () => {
    const coverage = buildProjectGateCoverage({
      candidateRunId: RUN_ID,
      manifest,
      evidenceRecords: [],
    });

    expect(coverage.status).toBe("incomplete");
    expect(coverage.completion).toMatchObject({
      complete: 0,
      total: 34,
      percent: 0,
      priorityCounts: { P0: 17, P1: 17 },
    });
    expect(
      coverage.surfaces.every((surface) => surface.status === "unstarted"),
    ).toBe(true);
  });

  it("counts only explicit complete proofs and preserves partial observations", () => {
    const coverage = buildProjectGateCoverage({
      candidateRunId: RUN_ID,
      manifest,
      evidenceRecords: [
        evidence({ surfaceId: "SHELL-01", proof: "gate-a" }),
        evidence({
          surfaceId: "SHELL-01",
          proof: "gate-b-f",
          complete: false,
          file: "shell-partial.json",
        }),
      ],
    });
    const shell = coverage.surfaces.find(
      (surface) => surface.id === "SHELL-01",
    );

    expect(shell).toMatchObject({
      status: "gate-a-only",
      completedProofs: ["gate-a"],
      missingProofs: ["gate-b-f"],
    });
    expect(coverage.evidence).toEqual({
      recognized: 2,
      counting: 1,
      failed: 0,
    });
  });

  it("marks a missing-proof surface blocked when a failure has an owner action", () => {
    const coverage = buildProjectGateCoverage({
      candidateRunId: RUN_ID,
      manifest,
      evidenceRecords: [
        evidence({
          surfaceId: "AGENT-01",
          proof: "gate-b-r",
          complete: false,
          result: "fail",
        }),
      ],
    });
    const agent = coverage.surfaces.find(
      (surface) => surface.id === "AGENT-01",
    );

    expect(agent.status).toBe("blocked");
    expect(agent.failedEvidence).toEqual([
      expect.objectContaining({ proof: "gate-b-r", result: "fail" }),
    ]);
  });

  it("reaches 34/34 only when every manifest proof is explicitly complete", () => {
    const evidenceRecords = manifest.surfaces.flatMap((surface) =>
      surface.requiredProofs.map((proof) =>
        evidence({ surfaceId: surface.id, proof }),
      ),
    );
    const coverage = buildProjectGateCoverage({
      candidateRunId: RUN_ID,
      manifest,
      evidenceRecords,
    });

    expect(coverage.status).toBe("complete");
    expect(coverage.completion).toMatchObject({
      complete: 34,
      total: 34,
      percent: 100,
      completeByPriority: { P0: 17, P1: 17 },
    });
  });

  it("fails closed on candidate drift and invalid complete assertions", () => {
    expect(() =>
      buildProjectGateCoverage({
        candidateRunId: RUN_ID,
        manifest,
        evidenceRecords: [
          {
            ...evidence({ surfaceId: "SHELL-01", proof: "gate-a" }),
            value: {
              ...evidence({ surfaceId: "SHELL-01", proof: "gate-a" }).value,
              candidateRunId: "other-candidate",
            },
          },
        ],
      }),
    ).toThrow(/candidateRunId 不匹配/);

    const invalid = evidence({ surfaceId: "SHELL-01", proof: "gate-a" });
    invalid.value.assertions.passed = 2;
    expect(() =>
      buildProjectGateCoverage({
        candidateRunId: RUN_ID,
        manifest,
        evidenceRecords: [invalid],
      }),
    ).toThrow(/pass evidence 必须全部 assertions 通过/);
  });

  it("keeps the manifest fixture at the frozen 34-surface denominator", () => {
    const raw = JSON.parse(
      fs.readFileSync(
        "internal/test/project-gate-surfaces.manifest.json",
        "utf8",
      ),
    );
    expect(raw.surfaces).toHaveLength(34);
  });

  it("keeps CLI progress reporting separate from strict completion", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "project-gate-coverage-"),
    );
    try {
      const candidatePath = path.join(tempRoot, "candidate.json");
      const progressPath = path.join(tempRoot, "coverage-progress.json");
      const strictPath = path.join(tempRoot, "coverage-strict.json");
      const surfaceContract = captureProjectGateSurfaceContract({
        repoRoot: process.cwd(),
      });
      fs.writeFileSync(
        candidatePath,
        `${JSON.stringify({
          schema_version: 3,
          run_id: RUN_ID,
          product_snapshot_digest: "a".repeat(64),
          git_diff_digest: "b".repeat(64),
          git_head: "c".repeat(40),
          reference_commit: "d".repeat(40),
          blocking_trackers: [{ path: "tracker.md", status: "ready" }],
          surface_contract: surfaceContract,
          changed_paths: [],
          digest_excludes: [".lime/qc/project-gates"],
          stability: { stable: true },
        })}\n`,
      );
      const script = path.resolve("scripts/agent-qc/project-gate-coverage.mjs");
      const sharedArgs = [
        script,
        "--candidate",
        candidatePath,
        "--repo-root",
        process.cwd(),
        "--evidence-root",
        tempRoot,
      ];
      const progress = spawnSync(
        process.execPath,
        [...sharedArgs, "--output", progressPath, "--progress-only"],
        { encoding: "utf8" },
      );
      const strict = spawnSync(
        process.execPath,
        [...sharedArgs, "--output", strictPath],
        { encoding: "utf8" },
      );

      expect(progress.status, progress.stderr).toBe(0);
      expect(strict.status, strict.stderr).toBe(1);
      expect(JSON.parse(fs.readFileSync(progressPath, "utf8"))).toMatchObject({
        status: "incomplete",
        completion: { complete: 0, total: 34, percent: 0 },
      });
      expect(JSON.parse(fs.readFileSync(strictPath, "utf8"))).toMatchObject({
        status: "incomplete",
        completion: { complete: 0, total: 34, percent: 0 },
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
