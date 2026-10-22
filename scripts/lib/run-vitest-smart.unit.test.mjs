import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildBatches,
  buildRelatedModeInvocation,
  buildVitestCommandArgs,
  findFirstResumableBatchIndex,
  markSkippedBatches,
  parseSmartArgs,
  selectBatchIndexesForRun,
  shouldPersistRunState,
  updateRunState,
} from "../run-vitest-smart.mjs";

function withResumeFixture(
  { batches, files, allowLive = false, nestedCandidate = false },
  check,
) {
  const fixtureRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lime-vitest-resume-")),
  );
  const directory = nestedCandidate
    ? path.join(fixtureRoot, ".lime", "candidate")
    : fixtureRoot;
  const scriptsDirectory = path.join(directory, "scripts");
  const stateFile = path.join(directory, "state.json");
  const callsFile = path.join(directory, "calls.jsonl");
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const timestamp = "2026-10-13T22:00:00.000Z";
  try {
    fs.mkdirSync(path.join(scriptsDirectory, "lib"), { recursive: true });
    for (const relative of [
      "../run-vitest-smart.mjs",
      "live-provider-smoke-gate.mjs",
      "vitest-test-file-filter.mjs",
    ]) {
      fs.copyFileSync(
        path.resolve(sourceDirectory, relative),
        path.join(
          scriptsDirectory,
          relative.startsWith("../")
            ? path.basename(relative)
            : `lib/${relative}`,
        ),
      );
    }
    fs.mkdirSync(path.join(directory, "node_modules/vitest"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(directory, "node_modules/vitest/vitest.mjs"),
      `
import fs from "node:fs";
import path from "node:path";
if (process.argv[2] === "list") {
  console.log(JSON.stringify(JSON.parse(fs.readFileSync("files.json", "utf8")).map((file) => path.resolve(file))));
} else {
  const files = process.argv.slice(2).filter((arg) => /\\.(test|spec)\\.[cm]?[jt]sx?$/.test(arg));
  fs.appendFileSync("calls.jsonl", JSON.stringify(files.map((file) => path.relative(process.cwd(), file))) + "\\n");
}
`,
    );
    for (const file of files) {
      const destination = path.join(directory, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, 'import { it } from "vitest";\n');
    }
    fs.writeFileSync(path.join(directory, "files.json"), JSON.stringify(files));
    const failedBatch = batches.findIndex((batch) => batch.status === "failed");
    const state = {
      schema_version: 1,
      runner: "vitest-smart",
      repo_root: directory,
      batch_size: 2,
      include_live_provider_tests: false,
      skipped_live_provider_test_count: 0,
      status: failedBatch >= 0 ? "failed" : "passed",
      started_at: timestamp,
      updated_at: timestamp,
      completed_at: timestamp,
      failed_batch: failedBatch >= 0 ? failedBatch + 1 : null,
      batches: batches.map((batch, index) => ({
        index: index + 1,
        started_at: batch.status === "pending" ? null : timestamp,
        completed_at: batch.status === "pending" ? null : timestamp,
        exit_status:
          batch.status === "passed" ? 0 : batch.status === "failed" ? 1 : null,
        ...batch,
      })),
    };
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    check({
      state,
      stateText: () => fs.readFileSync(stateFile, "utf8"),
      savedState: () => JSON.parse(fs.readFileSync(stateFile, "utf8")),
      calls: () =>
        fs.existsSync(callsFile)
          ? fs
              .readFileSync(callsFile, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [],
      run: () =>
        spawnSync(
          process.execPath,
          [path.join(scriptsDirectory, "run-vitest-smart.mjs"), "--resume"],
          {
            cwd: directory,
            encoding: "utf8",
            env: {
              ...process.env,
              LIME_VITEST_SMART_STATE: stateFile,
              LIME_VITEST_BATCH_SIZE: "2",
              LIME_ALLOW_LIVE_PROVIDER_SMOKE: allowLive ? "1" : "",
              LIME_REAL_API_TEST: "",
            },
          },
        ),
    });
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe("run-vitest-smart", () => {
  it("冻结候选位于祖先 .lime 时仍收集真实测试，排除候选自身证据", () => {
    withResumeFixture(
      {
        batches: [],
        files: ["src/current.test.ts", ".lime/qc/foreign.test.ts"],
        nestedCandidate: true,
      },
      ({ run, calls, savedState }) => {
        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(calls()).toEqual([["src/current.test.ts"]]);
        expect(savedState().status).toBe("passed");
        expect(savedState().batches).toHaveLength(1);
      },
    );
  });

  it("resume 保留已通过批次，从原失败处继续并执行追加的新测试", () => {
    const files = [
      "src/passed.test.ts",
      "src/failed.test.ts",
      "src/later-passed.test.ts",
      "src/pending.test.ts",
      "src/new.test.ts",
    ];
    withResumeFixture(
      {
        files,
        batches: [
          { status: "passed", files: [files[0]] },
          { status: "failed", files: [files[1]] },
          { status: "passed", files: [files[2]] },
          { status: "pending", files: [files[3]] },
        ],
      },
      ({ run, calls, savedState, state }) => {
        expect(run().status).toBe(0);
        expect(calls()).toEqual([[files[1]], [files[3]], [files[4]]]);
        const saved = savedState();
        expect(saved.batches[0]).toEqual(state.batches[0]);
        expect(saved.batches[2]).toEqual(state.batches[2]);
        expect(saved.batches.map((batch) => batch.files)).toEqual([
          ...state.batches.map((batch) => batch.files),
          [files[4]],
        ]);
        expect(saved).toMatchObject({
          status: "passed",
          failed_batch: null,
          started_at: state.started_at,
        });
      },
    );
  });

  it("resume 追加的新测试复用独立串行批次与普通分批规则", () => {
    const files = [
      "src/passed.test.ts",
      "src/new-a.test.ts",
      "scripts/lib/harness-eval-history-window.test.ts",
      "src/new-b.test.ts",
    ];
    withResumeFixture(
      { files, batches: [{ status: "passed", files: [files[0]] }] },
      ({ run, calls, savedState }) => {
        expect(run().status).toBe(0);
        expect(calls()).toEqual([[files[2]], [files[1], files[3]]]);
        expect(savedState().batches.map((batch) => batch.index)).toEqual([
          1, 2, 3,
        ]);
      },
    );
  });

  it("resume 没有新增测试且全部通过时不重跑或改写状态", () => {
    const files = ["src/passed.test.ts"];
    withResumeFixture(
      { files, batches: [{ status: "passed", files }] },
      ({ run, calls, stateText }) => {
        const original = stateText();
        expect(run().status).toBe(0);
        expect(calls()).toEqual([]);
        expect(stateText()).toBe(original);
      },
    );
  });

  it("resume 没有新增测试时保持原批次文件和失败续跑位置", () => {
    const files = ["src/passed.test.ts", "src/failed.test.ts"];
    withResumeFixture(
      {
        files,
        batches: files.map((file, index) => ({
          status: index === 0 ? "passed" : "failed",
          files: [file],
        })),
      },
      ({ run, calls, savedState, state }) => {
        expect(run().status).toBe(0);
        expect(calls()).toEqual([[files[1]]]);
        expect(savedState().batches.map((batch) => batch.files)).toEqual(
          state.batches.map((batch) => batch.files),
        );
        expect(savedState().batches[0]).toEqual(state.batches[0]);
      },
    );
  });

  it("resume 全部旧批次通过后仍执行新增测试，重复续跑不会再次追加", () => {
    const files = ["src/passed.test.ts", "src/new.test.ts"];
    withResumeFixture(
      { files, batches: [{ status: "passed", files: [files[0]] }] },
      ({ run, calls, savedState, stateText, state }) => {
        expect(run().status).toBe(0);
        expect(calls()).toEqual([[files[1]]]);
        expect(savedState().batches[0]).toEqual(state.batches[0]);
        const completed = stateText();
        expect(run().status).toBe(0);
        expect(calls()).toEqual([[files[1]]]);
        expect(stateText()).toBe(completed);
      },
    );
  });

  it.each([false, true])(
    "resume 发现新测试继续遵守 live Provider 过滤（allowLive=%s）",
    (allowLive) => {
      const files = [
        "src/passed.test.ts",
        "src/new.test.ts",
        "src/provider.live.test.ts",
      ];
      withResumeFixture(
        {
          files,
          allowLive,
          batches: [{ status: "passed", files: [files[0]] }],
        },
        ({ run, calls, savedState }) => {
          expect(run().status).toBe(0);
          expect(calls()).toEqual([allowLive ? files.slice(1) : [files[1]]]);
          expect(savedState().skipped_live_provider_test_count).toBe(
            allowLive ? 0 : 1,
          );
        },
      );
    },
  );

  it("应解析可恢复批次参数并过滤重复 --run", () => {
    const parsed = parseSmartArgs([
      "--run",
      "--resume",
      "--from-batch",
      "12",
      "--only-batch=15",
      "--json",
    ]);

    expect(parsed.passthroughArgs).toEqual([]);
    expect(parsed.options).toMatchObject({
      fromBatch: 12,
      json: true,
      onlyBatch: 15,
      resume: true,
    });
  });

  it("应保留普通 Vitest 文件过滤参数的原有透传行为", () => {
    const parsed = parseSmartArgs([
      "src/foo.test.ts",
      "--testNamePattern",
      "bar",
    ]);

    expect(parsed.options.related).toBe(false);
    expect(parsed.options.changed).toBe(false);
    expect(parsed.passthroughArgs).toEqual([
      "src/foo.test.ts",
      "--testNamePattern",
      "bar",
    ]);
  });

  it("应按上次失败、运行中或未完成批次恢复", () => {
    expect(
      findFirstResumableBatchIndex({
        batches: [
          { index: 1, status: "passed" },
          { index: 2, status: "failed" },
          { index: 3, status: "pending" },
        ],
      }),
    ).toBe(1);

    expect(
      findFirstResumableBatchIndex({
        batches: [
          { index: 1, status: "passed" },
          { index: 2, status: "running" },
          { index: 3, status: "pending" },
        ],
      }),
    ).toBe(1);
  });

  it("应支持从指定批次或只跑指定批次", () => {
    expect(
      selectBatchIndexesForRun({
        totalBatches: 5,
        fromBatch: 3,
        onlyBatch: null,
      }),
    ).toEqual([2, 3, 4]);

    expect(
      selectBatchIndexesForRun({
        totalBatches: 5,
        fromBatch: null,
        onlyBatch: 4,
      }),
    ).toEqual([3]);
  });

  it("targeted 与 list 模式不得持久化默认 resume state", () => {
    expect(shouldPersistRunState({ onlyBatch: 4, listBatches: false })).toBe(
      false,
    );
    expect(shouldPersistRunState({ onlyBatch: null, listBatches: true })).toBe(
      false,
    );
    expect(shouldPersistRunState({ onlyBatch: null, listBatches: false })).toBe(
      true,
    );

    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "lime-vitest-smart-state-"),
    );
    const stateFile = path.join(directory, "last-run.json");
    const sentinel = '{"status":"failed","failed_batch":40}\n';
    fs.writeFileSync(stateFile, sentinel);

    const nextState = updateRunState(
      { status: "running", batches: [] },
      { persist: false, stateFile },
    );

    expect(nextState).toMatchObject({ status: "running", batches: [] });
    expect(nextState.updated_at).toEqual(expect.any(String));
    expect(fs.readFileSync(stateFile, "utf8")).toBe(sentinel);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("应把 from-batch 前面的批次标记为 skipped，避免 resume 回到第 1 批", () => {
    const state = {
      batches: [
        { index: 1, status: "pending" },
        { index: 2, status: "pending" },
        { index: 3, status: "pending" },
      ],
    };

    const nextState = markSkippedBatches(state, [1, 2]);

    expect(nextState.batches).toEqual([
      { index: 1, status: "skipped" },
      { index: 2, status: "pending" },
      { index: 3, status: "pending" },
    ]);
    expect(findFirstResumableBatchIndex(nextState)).toBe(1);
  });

  it("related 模式应使用 Vitest related 命令而不是把 related 当文件过滤", () => {
    const args = buildVitestCommandArgs(["src/foo.ts"], {
      command: "related",
    });

    expect(args).toEqual(
      expect.arrayContaining(["related", "--run", "src/foo.ts"]),
    );
    expect(args.indexOf("related")).toBeLessThan(args.indexOf("src/foo.ts"));
  });

  it("related 模式跑前端源码时默认排除 Electron main 源码扫描", () => {
    expect(
      buildRelatedModeInvocation(["src/components/agent/chat/index.tsx"]),
    ).toEqual({
      command: "related",
      args: ["--exclude", "electron/**", "src/components/agent/chat/index.tsx"],
    });
  });

  it("related 模式输入 Electron 源码时直接运行相邻测试", () => {
    expect(
      buildRelatedModeInvocation(["electron/hostCommands.ts", "--bail=1"]),
    ).toEqual({
      command: "run",
      args: ["electron/hostCommands.test.ts", "--bail=1"],
    });
  });

  it("related 模式输入 Electron 测试文件时直接运行该测试", () => {
    expect(buildRelatedModeInvocation(["electron/preload.test.ts"])).toEqual({
      command: "run",
      args: ["electron/preload.test.ts"],
    });
  });

  it("应保持串行测试独立成批，其它测试按批次大小聚合", () => {
    const batches = buildBatches([
      "scripts/lib/harness-eval-history-window.test.ts",
      "src/example/a.test.ts",
      "src/example/b.test.ts",
    ]);

    expect(batches[0]).toEqual([
      "scripts/lib/harness-eval-history-window.test.ts",
    ]);
    expect(batches[1]).toEqual([
      "src/example/a.test.ts",
      "src/example/b.test.ts",
    ]);
  });

  it("AgentChatPage 集成测试必须使用独立进程批次", () => {
    const batches = buildBatches([
      "src/components/agent/chat/index.taskTabs02.test.tsx",
      "src/components/agent/chat/index.workbench01.test.tsx",
      "src/example/regular.test.ts",
    ]);

    expect(batches).toEqual([
      ["src/components/agent/chat/index.taskTabs02.test.tsx"],
      ["src/components/agent/chat/index.workbench01.test.tsx"],
      ["src/example/regular.test.ts"],
    ]);
  });
});
