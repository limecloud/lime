import { describe, expect, it } from "vitest";

import {
  buildLayerEnvironmentArgs,
  buildLayerPoolArgs,
  buildVitestCliArgs,
  parseArgs,
  selectLayerEntries,
  shouldUseSingleFork,
} from "./run-vitest-layer.mjs";

describe("run-vitest-layer 参数解析", () => {
  it("应把 Vitest 选项透传给 Vitest，而不是当成文件过滤器", () => {
    expect(parseArgs(["unit", "--run", "--reporter=dot"])).toMatchObject({
      layer: "unit",
      filters: [],
      vitestArgs: ["--reporter=dot"],
    });
  });

  it("应保留普通路径作为当前层文件过滤器", () => {
    expect(parseArgs(["unit", "src/lib/foo.test.ts"])).toMatchObject({
      layer: "unit",
      filters: ["src/lib/foo.test.ts"],
      vitestArgs: [],
    });
  });

  it("应支持带独立取值的 Vitest pool / environment 选项", () => {
    expect(
      parseArgs(["unit", "--pool", "forks", "--environment", "jsdom"]),
    ).toMatchObject({
      layer: "unit",
      filters: [],
      vitestArgs: ["--pool", "forks", "--environment", "jsdom"],
    });
  });

  it("应把 single fork 作为分层运行器选项处理", () => {
    expect(parseArgs(["unit", "--single-fork"])).toMatchObject({
      layer: "unit",
      options: {
        singleFork: true,
      },
      filters: [],
      vitestArgs: [],
    });
  });

  it("显式过滤器命中当前层时返回目标层文件", () => {
    const result = selectLayerEntries(
      [
        { file: "src/lib/foo.unit.test.ts", layer: "unit" },
        { file: "src/lib/foo.boundary.test.ts", layer: "integration" },
      ],
      "unit",
      ["src/lib/foo.unit.test.ts"],
    );

    expect(result).toMatchObject({
      entries: [{ file: "src/lib/foo.unit.test.ts", layer: "unit" }],
      filterMisses: [],
    });
  });

  it("显式过滤器只命中其他层时返回错层失败信息", () => {
    const result = selectLayerEntries(
      [
        {
          file: "scripts/rust-test-layer-classifier.test.mjs",
          layer: "integration",
        },
      ],
      "unit",
      ["scripts/rust-test-layer-classifier.test.mjs"],
    );

    expect(result.entries).toEqual([]);
    expect(result.filterMisses).toEqual([
      {
        filter: "scripts/rust-test-layer-classifier.test.mjs",
        reason: "wrong-layer",
        layers: ["integration"],
      },
    ]);
  });

  it("显式过滤器没有命中任何可运行测试文件时返回失败信息", () => {
    const result = selectLayerEntries(
      [{ file: "src/lib/foo.unit.test.ts", layer: "unit" }],
      "unit",
      ["src/lib/missing.unit.test.ts"],
    );

    expect(result.entries).toEqual([]);
    expect(result.filterMisses).toEqual([
      {
        filter: "src/lib/missing.unit.test.ts",
        reason: "no-runnable-test-file",
        layers: [],
      },
    ]);
  });
});

describe("run-vitest-layer 运行参数", () => {
  it("unit 层默认不强制 single fork", () => {
    expect(shouldUseSingleFork("unit", {}, {})).toBe(false);
    expect(
      buildVitestCliArgs({
        layer: "unit",
        files: ["src/lib/foo.unit.test.ts"],
        env: {},
      }),
    ).not.toContain("--maxWorkers=1");
  });

  it("unit 层默认使用 node 环境", () => {
    expect(buildLayerEnvironmentArgs("unit")).toEqual([
      "--environment",
      "node",
    ]);
    expect(
      buildVitestCliArgs({
        layer: "unit",
        files: ["src/lib/foo.unit.test.ts"],
        env: {},
      }),
    ).toContain("node");
  });

  it("unit 层默认使用 threads pool 提升全量单元测试速度", () => {
    expect(buildLayerPoolArgs("unit", [], {}, {})).toEqual([
      "--pool",
      "threads",
    ]);
    expect(
      buildVitestCliArgs({
        layer: "unit",
        files: ["src/lib/foo.unit.test.ts"],
        env: {},
      }),
    ).toContain("threads");
  });

  it("unit 层可通过环境变量覆盖默认 pool", () => {
    expect(
      buildLayerPoolArgs(
        "unit",
        [],
        {},
        { LIME_VITEST_UNIT_POOL: "vmThreads" },
      ),
    ).toEqual(["--pool", "vmThreads"]);
  });

  it("显式 Vitest pool 会覆盖 unit 默认 threads pool", () => {
    expect(buildLayerPoolArgs("unit", ["--pool=forks"], {}, {})).toEqual([]);
    expect(buildLayerPoolArgs("unit", ["--pool", "forks"], {}, {})).toEqual(
      [],
    );
  });

  it("显式 Vitest environment 会覆盖 unit 默认 node 环境", () => {
    expect(buildLayerEnvironmentArgs("unit", ["--environment", "jsdom"])).toEqual(
      [],
    );
    expect(buildLayerEnvironmentArgs("unit", ["--environment=jsdom"])).toEqual(
      [],
    );
  });

  it("非 unit 层继续默认 single fork", () => {
    expect(shouldUseSingleFork("component", {}, {})).toBe(true);
    expect(
      buildVitestCliArgs({
        layer: "component",
        files: ["src/lib/foo.test.tsx"],
        env: {},
      }),
    ).toContain("--maxWorkers=1");
  });

  it("unit 层可通过选项或环境变量强制 single fork", () => {
    expect(shouldUseSingleFork("unit", { singleFork: true }, {})).toBe(true);
    expect(
      shouldUseSingleFork("unit", {}, { LIME_VITEST_SINGLE_FORK: "1" }),
    ).toBe(true);
    expect(buildLayerPoolArgs("unit", [], { singleFork: true }, {})).toEqual([
      "--pool",
      "forks",
    ]);
  });
});
