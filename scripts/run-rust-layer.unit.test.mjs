import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  countExecutedTestsFromCargoOutput,
  expandWithWorkspaceDependents,
  findCargoTestFilters,
  parseArgs,
  resolveRustTestEnv,
  resolveRustPathSelection,
  shouldFailOnZeroExecutedTests,
  withRustTestConfig,
} from "./run-rust-layer.mjs";

function createFixtureRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lime-rust-runner-"));
  function writeFile(relPath, content) {
    const target = path.join(tempRoot, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  writeFile(
    "lime-rs/Cargo.toml",
    `
[workspace]
members = ["crates/*"]
exclude = ["crates/agent-rust"]
`,
  );
  writeFile(
    "lime-rs/crates/core/Cargo.toml",
    `
[package]
name = "lime-core"
version = "0.0.0"
`,
  );
  writeFile(
    "lime-rs/crates/agent/Cargo.toml",
    `
[package]
name = "lime-agent"
version = "0.0.0"
`,
  );
  writeFile(
    "lime-rs/crates/app-server/Cargo.toml",
    `
[package]
name = "app-server"
version = "0.0.0"
`,
  );
  writeFile(
    "lime-rs/crates/agent-rust/Cargo.toml",
    `
[package]
name = "agent-rust"
version = "0.0.0"
`,
  );

  return tempRoot;
}

describe("run-rust-layer unit helpers", () => {
  it.each([false, true])("临时配置隔离用户状态并在异常=%s 后清理", (fail) => {
    const env = { PATH: "/bin", LIME_CONFIG_PATH: " " };
    let firstPath;
    const run = () =>
      withRustTestConfig(env, (isolated) => {
        firstPath = isolated.LIME_CONFIG_PATH;
        expect(fs.readFileSync(firstPath, "utf8")).toBe("{}\n");
        withRustTestConfig(env, (second) => {
          expect(second.LIME_CONFIG_PATH).not.toBe(firstPath);
          fs.writeFileSync(second.LIME_CONFIG_PATH, "second fixture\n");
          expect(fs.readFileSync(firstPath, "utf8")).toBe("{}\n");
        });
        if (fail) throw Error("cargo fixture failed");
        return 101;
      });
    if (fail) expect(run).toThrow("cargo fixture failed");
    else expect(run()).toBe(101);
    expect(fs.existsSync(path.dirname(firstPath))).toBe(false);
    expect(env.LIME_CONFIG_PATH).toBe(" ");
  });

  it("保留调用方显式指定的配置且不删除文件", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "rust-explicit-config-"),
    );
    const configPath = path.join(root, "config.yaml");
    fs.writeFileSync(configPath, "fixture sentinel\n");
    try {
      const env = { LIME_CONFIG_PATH: configPath };
      expect(
        withRustTestConfig(env, (actual) => {
          expect(actual).toBe(env);
          return 0;
        }),
      ).toBe(0);
      expect(fs.readFileSync(configPath, "utf8")).toBe("fixture sentinel\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([0, 101])("管道完整保留大日志及最终状态 %s", (status) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rust-output-"));
    const stdout =
      "test output\n".repeat(32_768) +
      "test result: ok. 885 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n";
    const stderr = "compiler output\n".repeat(16_384) + "COMPILER_OUTPUT_END\n";
    const loader = path.join(tempRoot, "cargo-fixture.mjs");
    try {
      fs.writeFileSync(
        loader,
        `
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, ...args) => {
  if (command !== "cargo") return original(command, ...args);
  const configPath = args[1].env.LIME_CONFIG_PATH;
  if (!configPath || fs.readFileSync(configPath, "utf8") !== "{}\\n")
    throw Error("Cargo must receive the isolated configuration");
  return { status: ${status}, stdout: ${JSON.stringify(stdout)}, stderr: ${JSON.stringify(stderr)} };
};
syncBuiltinESMExports();
`,
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(loader).href,
          path.resolve("scripts/run-rust-layer.mjs"),
          "unit",
          "runtime::",
        ],
        {
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, LIME_CONFIG_PATH: "" },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect(result.stdout.length).toBeGreaterThanOrEqual(stdout.length);
      expect(result.stdout.endsWith(stdout)).toBe(true);
      expect(result.stderr.length).toBe(stderr.length);
      expect(result.stderr.endsWith("COMPILER_OUTPUT_END\n")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("macOS 默认使用 8 MiB test worker 栈并保留显式覆盖", () => {
    expect(resolveRustTestEnv({ PATH: "/bin" }, "darwin")).toEqual({
      PATH: "/bin",
      RUST_MIN_STACK: "8388608",
    });
    expect(
      resolveRustTestEnv(
        { PATH: "/bin", RUST_MIN_STACK: "16777216" },
        "darwin",
      ),
    ).toEqual({
      PATH: "/bin",
      RUST_MIN_STACK: "16777216",
    });
    expect(resolveRustTestEnv({ PATH: "/bin" }, "linux")).toEqual({
      PATH: "/bin",
    });
  });

  it("解析 --changed 和 --related runner 参数", () => {
    expect(
      parseArgs(["unit", "--changed", "origin/main", "request_tool_policy"]),
    ).toMatchObject({
      layer: "unit",
      options: {
        changed: true,
        changedRef: "origin/main",
      },
      cargoArgs: ["request_tool_policy"],
    });
    expect(
      parseArgs(["unit", "--changed", "request_tool_policy"]),
    ).toMatchObject({
      options: {
        changed: true,
        changedRef: "HEAD",
      },
      cargoArgs: ["request_tool_policy"],
    });
    expect(
      parseArgs([
        "unit",
        "--related",
        "lime-rs/crates/agent/src/lib.rs",
        "lime-rs/crates/core/src/lib.rs",
        "--",
        "--nocapture",
      ]),
    ).toMatchObject({
      options: {
        related: true,
        relatedPaths: [
          "lime-rs/crates/agent/src/lib.rs",
          "lime-rs/crates/core/src/lib.rs",
        ],
      },
      testArgs: ["--nocapture"],
    });
  });

  it("按 Rust 文件路径映射 workspace crate 并扩展反向依赖", () => {
    const repoRoot = createFixtureRepo();
    try {
      const graph = new Map([
        ["lime-core", new Set()],
        ["lime-agent", new Set(["lime-core"])],
        ["app-server", new Set(["lime-agent"])],
      ]);

      expect(
        resolveRustPathSelection(["lime-rs/crates/core/src/lib.rs"], {
          dependencyGraph: graph,
          repoRoot,
        }),
      ).toMatchObject({
        directPackages: ["lime-core"],
        packages: ["app-server", "lime-agent", "lime-core"],
        addedDependents: ["app-server", "lime-agent"],
        workspaceWide: false,
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("根 manifest 和 lockfile 变更扩大到 workspace", () => {
    const repoRoot = createFixtureRepo();
    try {
      expect(
        resolveRustPathSelection(["lime-rs/Cargo.toml"], { repoRoot }),
      ).toMatchObject({
        workspaceWide: true,
        workspaceReasons: ["lime-rs/Cargo.toml"],
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("vendored Rust 依赖变更扩大到 workspace", () => {
    const repoRoot = createFixtureRepo();
    try {
      fs.mkdirSync(
        path.join(repoRoot, "lime-rs/vendor/agent-rust/crates/agent/src"),
        { recursive: true },
      );
      fs.writeFileSync(
        path.join(
          repoRoot,
          "lime-rs/vendor/agent-rust/crates/agent/src/agent.rs",
        ),
        "",
      );

      expect(
        resolveRustPathSelection(
          ["lime-rs/vendor/agent-rust/crates/agent/src/agent.rs"],
          { repoRoot },
        ),
      ).toMatchObject({
        errors: [],
        rustPaths: ["lime-rs/vendor/agent-rust/crates/agent/src/agent.rs"],
        workspaceReasons: [
          "lime-rs/vendor/agent-rust/crates/agent/src/agent.rs (vendored Rust dependency)",
        ],
        workspaceWide: true,
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("excluded subcrate 路径失败而不是静默空跑", () => {
    const repoRoot = createFixtureRepo();
    try {
      const selection = resolveRustPathSelection(
        ["lime-rs/crates/agent-rust/src/lib.rs"],
        { repoRoot },
      );
      expect(selection.errors.join("\n")).toContain("workspace exclude");
      expect(selection.packages).toEqual([]);
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("excluded subcrate 元数据路径不阻断 workspace 边界校验", () => {
    const repoRoot = createFixtureRepo();
    try {
      expect(
        resolveRustPathSelection(
          ["lime-rs/Cargo.lock", "lime-rs/crates/agent-rust/Cargo.lock"],
          { repoRoot },
        ),
      ).toMatchObject({
        rustPaths: ["lime-rs/Cargo.lock"],
        skippedPaths: ["lime-rs/crates/agent-rust/Cargo.lock"],
        workspaceWide: true,
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("excluded subcrate 元数据路径单独出现时跳过 Rust 层而不是空跑失败", () => {
    const repoRoot = createFixtureRepo();
    try {
      expect(
        resolveRustPathSelection(["lime-rs/crates/agent-rust/Cargo.lock"], {
          repoRoot,
        }),
      ).toMatchObject({
        errors: [],
        rustPaths: [],
        skippedPaths: ["lime-rs/crates/agent-rust/Cargo.lock"],
        packages: [],
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("非 Rust 路径在 Rust changed scope 中可跳过", () => {
    const repoRoot = createFixtureRepo();
    try {
      expect(
        resolveRustPathSelection(["src/components/App.tsx"], { repoRoot }),
      ).toMatchObject({
        rustPaths: [],
        skippedPaths: ["src/components/App.tsx"],
        packages: [],
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("已删除的 unmanaged root Rust 路径可跳过，避免迁移后阻断 changed scope", () => {
    const repoRoot = createFixtureRepo();
    try {
      expect(
        resolveRustPathSelection(["lime-rs/tests/deleted_live_test.rs"], {
          repoRoot,
        }),
      ).toMatchObject({
        errors: [],
        rustPaths: [],
        skippedPaths: ["lime-rs/tests/deleted_live_test.rs"],
        packages: [],
      });
    } finally {
      fs.rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  it("可独立扩展 workspace 反向依赖图", () => {
    expect(
      expandWithWorkspaceDependents(
        new Set(["lime-core"]),
        new Map([
          ["lime-core", new Set()],
          ["lime-agent", new Set(["lime-core"])],
          ["app-server", new Set(["lime-agent"])],
        ]),
      ),
    ).toEqual({
      packages: ["app-server", "lime-agent", "lime-core"],
      addedDependents: ["app-server", "lime-agent"],
      missingPackages: [],
    });
  });

  it("识别 Cargo package 参数后的测试过滤器", () => {
    expect(
      findCargoTestFilters(["-p", "lime-agent", "request_tool_policy"]),
    ).toEqual(["request_tool_policy"]);
  });

  it("不会把 Cargo 选项值当成测试过滤器", () => {
    expect(
      findCargoTestFilters([
        "--package=lime-agent",
        "--features",
        "offline-fixtures",
        "--workspace",
      ]),
    ).toEqual([]);
  });

  it("统计 Cargo 输出里真实执行过的测试数量", () => {
    expect(
      countExecutedTestsFromCargoOutput(`
running 1 test
test workspace_support::tests::sanitize_project_dir_name_should_replace_invalid_chars ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 1551 filtered out; finished in 0.01s
`),
    ).toBe(1);
  });

  it("过滤器空跑时统计为 0 个执行测试", () => {
    expect(
      countExecutedTestsFromCargoOutput(`
running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1552 filtered out; finished in 0.00s
`),
    ).toBe(0);
  });

  it("只在带测试过滤器且非 --list 时启用空跑失败保护", () => {
    expect(
      shouldFailOnZeroExecutedTests(
        ["-p", "lime-agent", "request_tool_policy"],
        [],
      ),
    ).toBe(true);
    expect(shouldFailOnZeroExecutedTests(["--workspace"], [])).toBe(false);
    expect(
      shouldFailOnZeroExecutedTests(["request_tool_policy"], ["--list"]),
    ).toBe(false);
  });
});
