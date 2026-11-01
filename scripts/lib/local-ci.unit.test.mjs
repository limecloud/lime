import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { commandExitStatus, frontendTestArgs } from "../local-ci.mjs";

function state(statuses) {
  return {
    schema_version: 1,
    runner: "vitest-smart",
    batches: statuses.map((status, index) => ({ index: index + 1, status })),
  };
}

describe("local CI frontend continuation", () => {
  it.each(["failed", "interrupted", "running", "pending"])(
    "resumes %s work without discarding passed batches",
    (status) => {
      const snapshot = state(["passed", status, "pending"]);
      const before = structuredClone(snapshot);
      expect(frontendTestArgs(snapshot)).toEqual(["test", "--", "--resume"]);
      expect(snapshot).toEqual(before);
    },
  );

  it("starts a fresh run when there is no unfinished batch", () => {
    expect(frontendTestArgs(null)).toEqual(["test"]);
    expect(frontendTestArgs(state(["passed", "skipped"]))).toEqual(["test"]);
  });

  it("rejects invalid state instead of silently replacing continuation evidence", () => {
    expect(() => frontendTestArgs({ batches: [] })).toThrow("续跑状态无效");
    expect(() =>
      frontendTestArgs({ ...state(["pending"]), schema_version: 2 }),
    ).toThrow("续跑状态无效");
  });
});

describe("local CI child completion", () => {
  it("retains actual successful and failed process exit codes", () => {
    for (const status of [0, 7]) {
      const result = spawnSync(process.execPath, ["-e", `process.exit(${status})`]);
      expect(commandExitStatus(result)).toBe(status);
    }
  });

  it("rejects a real signal termination instead of reporting success", () => {
    const result = spawnSync(process.execPath, [
      "-e",
      'process.kill(process.pid, "SIGTERM")',
    ]);
    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(() => commandExitStatus(result)).toThrow("SIGTERM");
  });

  it("rejects spawn errors and missing completion state", () => {
    const error = new Error("spawn failed");
    expect(() => commandExitStatus({ error, status: null })).toThrow(error);
    expect(() => commandExitStatus({ status: null })).toThrow("未返回退出状态");
  });
});
