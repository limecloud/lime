import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { isVitestRunnableTestFile } from "./vitest-test-file-filter.mjs";

describe("vitest-test-file-filter", () => {
  it("证据目录相对当前仓库判断，不误排祖先目录名中的 .lime", () => {
    const candidate = path.resolve(".lime/gui-candidates/isolated");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(candidate);
    try {
      expect(
        isVitestRunnableTestFile(path.join(candidate, "src/Foo.test.ts"), ""),
      ).toBe(true);
      expect(
        isVitestRunnableTestFile(
          path.join(candidate, ".lime/qc/external.spec.mjs"),
          "",
        ),
      ).toBe(false);
    } finally {
      cwd.mockRestore();
    }
  });

  it("应保留真实 Vitest 测试文件", () => {
    expect(isVitestRunnableTestFile("src/Foo.test.tsx")).toBe(true);
    expect(isVitestRunnableTestFile("src/Foo.unit.test.ts")).toBe(true);
  });

  it("应排除测试夹具支持文件", () => {
    expect(isVitestRunnableTestFile("src/Foo.testFixtures.tsx")).toBe(false);
    expect(isVitestRunnableTestFile("src/Foo.test-fixture.tsx")).toBe(false);
    expect(isVitestRunnableTestFile("src/Foo.test_fixtures.ts")).toBe(false);
  });

  it("应排除本地 .lime 证据目录里的外部测试产物", () => {
    expect(
      isVitestRunnableTestFile(
        ".lime/qc/playwright-cli/codex-rendering.spec.mjs",
      ),
    ).toBe(false);
    expect(
      isVitestRunnableTestFile(
        "/repo/.lime/qc/playwright-cli/codex-rendering.spec.mjs",
      ),
    ).toBe(false);
  });

  it("应排除 node:test 专用 package 自测文件", () => {
    expect(
      isVitestRunnableTestFile(
        "packages/agent-runtime-ui/tests/ui.test.mjs",
        'import test from "node:test";\n',
      ),
    ).toBe(false);
  });

  it("应排除执行计划冻结源码，保留现役源码测试", () => {
    expect(
      isVitestRunnableTestFile(
        "internal/exec-plans/artifacts/browser/frozen-source/src/Foo.test.tsx",
        'import { it } from "vitest";',
      ),
    ).toBe(false);
    expect(
      isVitestRunnableTestFile(
        "src/Foo.test.tsx",
        'import { it } from "vitest";',
      ),
    ).toBe(true);
  });

  it("应保留同时支持 Vitest 的 package 测试文件", () => {
    expect(
      isVitestRunnableTestFile(
        "packages/plugin-runtime/tests/projection-export.test.mjs",
        "const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');\n",
      ),
    ).toBe(true);
  });
});
