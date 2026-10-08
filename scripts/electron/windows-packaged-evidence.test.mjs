import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  buildWindowsPackagedEvidenceSummary,
  parseArgs,
  validateWindowsPackagedEvidence,
} from "./windows-packaged-evidence.mjs";

const roots = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

function createFixture() {
  const root = mkdtempSync(
    path.join(tmpdir(), "lime-windows-packaged-evidence-"),
  );
  roots.push(root);
  const version = "1.2.3";
  const candidateSha = "a".repeat(40);
  const packageRoot = path.join(root, "lime");
  const appDirectory = path.join(packageRoot, `app-${version}`);
  const executable = path.join(appDirectory, "Lime.exe");
  const resourcesRoot = path.join(appDirectory, "resources");
  const resourceFiles = {
    "app-server": "app-server.exe",
    "code-mode-host": "code-mode-host.exe",
    "windows-sandbox-setup": "windows-sandbox-setup.exe",
    "windows-sandbox-runner": "windows-sandbox-runner.exe",
    "windows-native-host": "windows-native-host.exe",
  };
  mkdirSync(resourcesRoot, { recursive: true });
  writeFileSync(executable, "lime executable");
  for (const [id, fileName] of Object.entries(resourceFiles)) {
    const relativePath =
      id === "windows-native-host"
        ? "native/windows/windows-native-host.exe"
        : `app-server/win32-x64/${fileName}`;
    const filePath = path.join(resourcesRoot, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${id} binary\0`);
  }
  const resources = Object.entries(resourceFiles).map(([id]) => {
    const relativePath =
      id === "windows-native-host"
        ? "native/windows/windows-native-host.exe"
        : `app-server/win32-x64/${resourceFiles[id]}`;
    const filePath = path.join(resourcesRoot, relativePath);
    return {
      id,
      path: relativePath,
      sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
      required: true,
    };
  });
  writeFileSync(
    path.join(resourcesRoot, "desktop-resources.manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      applicationId: "com.limecloud.lime",
      version,
      platform: "win32",
      arch: "x64",
      platformKey: "win32-x64",
      resources,
    }),
  );

  const candidateRunId = "windows-run-1";
  const squirrelSummary = {
    scenarioId: "PLT-02-windows-squirrel-rc",
    result: "pass",
    candidateRunId,
    candidateSha,
    platform: { os: "win32", arch: "x64", appVersion: version },
    evidence: {
      installation: {
        executable,
        appDirectory,
        packageRoot,
        updateExecutable: path.join(packageRoot, "Update.exe"),
      },
    },
  };
  const codeModeSummary = {
    status: "pass",
    candidateRunId,
    candidateSha,
    packagedExecutable: true,
    packagedExecutablePath: executable,
    processes: {
      appServerPid: 101,
      codeModeHostParentPid: 101,
      appServerCommand: `"${path.join(resourcesRoot, "app-server/win32-x64/app-server.exe")}" --stdio`,
      codeModeHostCommand: path.join(
        resourcesRoot,
        "app-server/win32-x64/code-mode-host.exe",
      ),
    },
  };
  const nativeHostSummary = {
    result: "passed",
    evidenceLevel: "gate-b",
    platform: "win32",
    arch: "x64",
    candidateRunId,
    candidateSha,
    electronExecutable: executable,
    helper: {
      path: path.join(resourcesRoot, "native/windows/windows-native-host.exe"),
      resourcesRoot,
      readOnly: true,
      digestMatches: true,
    },
  };
  return {
    version,
    candidateSha,
    executable,
    resourcesRoot,
    squirrelSummary,
    codeModeSummary,
    nativeHostSummary,
  };
}

describe("Windows packaged evidence identity", () => {
  it.each([
    {
      name: "原 tag 与成功构建",
      sha: "a".repeat(40),
      build: "success",
      passed: true,
    },
    { name: "错误 SHA", sha: "b".repeat(40), build: "success", passed: false },
    {
      name: "失败的原构建",
      sha: "a".repeat(40),
      build: "failure",
      passed: false,
    },
  ])("实际补验 shell 校验 $name", ({ sha, build, passed }) => {
    const root = mkdtempSync(path.join(tmpdir(), "lime recovery identity "));
    roots.push(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ version: "1.2.3" }),
    );
    writeFileSync(
      path.join(root, "fixture-run.json"),
      JSON.stringify({
        head_sha: sha,
        head_branch: "v1.2.3",
        event: "push",
        path: ".github/workflows/release.yml",
      }),
    );
    writeFileSync(
      path.join(root, "fixture-jobs.json"),
      JSON.stringify({
        jobs: [{ name: "Build Electron Windows-x64", conclusion: build }],
      }),
    );
    const workflow = YAML.parse(
      readFileSync(".github/workflows/build-windows-test.yml", "utf8"),
    );
    const step = workflow.jobs["verify-release-windows"].steps.find(
      (step) => step.name === "Validate original release identity",
    );
    const shell = `
git() { printf '%s\\n' "$FIXTURE_TAG_SHA"; }
gh() { case "$2" in */jobs*) cat fixture-jobs.json;; *) cat fixture-run.json;; esac; }
${step.run}`;
    const result = spawnSync("bash", ["-c", shell], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        FIXTURE_TAG_SHA: "a".repeat(40),
        RELEASE_RUN_ID: "12345",
        GITHUB_REPOSITORY: "limecloud/lime",
        GITHUB_ENV: path.join(root, "github-env"),
        GITHUB_RUN_ID: "56789",
        GITHUB_RUN_ATTEMPT: "1",
      },
    });
    expect(result.status, result.stderr).toBe(passed ? 0 : 1);
    if (passed) {
      expect(readFileSync(path.join(root, "github-env"), "utf8")).toContain(
        `LIME_CANDIDATE_SHA=${"a".repeat(40)}`,
      );
    }
  });

  it("通过真实 CLI 入口显示帮助并把缺失证据写为失败", () => {
    const script = path.resolve(
      "scripts/electron/windows-packaged-evidence.mjs",
    );
    const help = spawnSync(process.execPath, [script, "--help"], {
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain(
      "Usage: node scripts/electron/windows-packaged-evidence.mjs",
    );
    const root = mkdtempSync(path.join(tmpdir(), "lime packaged evidence "));
    roots.push(root);
    const output = path.join(root, "failed summary.json");
    const missing = spawnSync(process.execPath, [script, "--output", output], {
      encoding: "utf8",
    });
    expect(missing.status).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      result: "failed",
      failures: [{ name: "arguments" }],
    });
  });

  it("解析 camelCase 参数并要求三个 summary", () => {
    expect(
      parseArgs([
        "--version",
        "v1.2.3",
        "--candidate-sha",
        "A".repeat(40),
        "--squirrel-summary",
        "squirrel.json",
        "--code-mode-summary",
        "code.json",
        "--native-host-summary",
        "native.json",
        "--output",
        "result.json",
      ]),
    ).toMatchObject({
      version: "1.2.3",
      candidateSha: "a".repeat(40),
      squirrelSummary: path.resolve("squirrel.json"),
      codeModeSummary: path.resolve("code.json"),
      nativeHostSummary: path.resolve("native.json"),
      output: path.resolve("result.json"),
    });
    expect(() => parseArgs(["--version", "1.2.3"])).toThrow(
      "--candidate-sha is required",
    );
  });

  it("把同一 Squirrel 安装、sidecar 进程和 native helper 收口为 passed", () => {
    const fixture = createFixture();
    const summary = validateWindowsPackagedEvidence(fixture);

    expect(summary.result).toBe("passed");
    expect(summary.candidate).toEqual({
      version: fixture.version,
      sha: fixture.candidateSha,
      runId: "windows-run-1",
      executable: fixture.executable,
      resourcesRoot: fixture.resourcesRoot,
    });
    expect(summary.checks.map((check) => check.name)).toEqual([
      "squirrel-summary",
      "installed-resource-manifest",
      "code-mode-summary",
      "native-host-summary",
    ]);
  });

  it("候选 run、安装路径或开发 sidecar 不一致时 fail closed", () => {
    const fixture = createFixture();
    fixture.codeModeSummary = {
      ...fixture.codeModeSummary,
      candidateRunId: "stale-run",
      candidateSha: "b".repeat(40),
      packagedExecutablePath: path.join(
        path.dirname(fixture.executable),
        "old-Lime.exe",
      ),
      processes: {
        ...fixture.codeModeSummary.processes,
        appServerCommand: "/repo/lime-rs/target/debug/app-server --stdio",
      },
    };

    const summary = buildWindowsPackagedEvidenceSummary(fixture);
    expect(summary.result).toBe("failed");
    expect(summary.failures.map((failure) => failure.name)).toEqual([
      "code-mode-summary",
    ]);
    expect(
      summary.checks.find((check) => check.name === "code-mode-summary"),
    ).toMatchObject({
      status: "failed",
    });
  });

  it("缺少 Gate B 文件仍输出结构化失败结果", () => {
    const fixture = createFixture();
    const summary = buildWindowsPackagedEvidenceSummary({
      version: fixture.version,
      candidateSha: fixture.candidateSha,
      squirrelSummary: fixture.squirrelSummary,
      codeModeSummary: null,
      nativeHostSummary: null,
      fileExists: (filePath) =>
        filePath === fixture.executable ||
        filePath.endsWith("desktop-resources.manifest.json"),
      readFile: (filePath) => {
        if (filePath.endsWith("desktop-resources.manifest.json")) {
          return readFileSync(filePath);
        }
        return Buffer.from("binary");
      },
    });

    expect(summary.result).toBe("failed");
    expect(summary.failures.map((failure) => failure.name)).toEqual([
      "installed-resource-manifest",
      "code-mode-summary",
      "native-host-summary",
    ]);
  });
});
