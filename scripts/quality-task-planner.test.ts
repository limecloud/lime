import { describe, expect, it } from "vitest";

import { detectTasks } from "./quality-task-planner.mjs";

describe("quality-task-planner", () => {
  it("应把 harness cleanup/report 主链文件归到 bridge/contracts 风险", () => {
    const tasks = detectTasks([
      "scripts/lib/generated-slop-report-core.mjs",
      "scripts/check-generated-slop-report.mjs",
      "scripts/harness-eval-history-record.mjs",
    ]);

    expect(tasks.bridge).toBe(true);
    expect(tasks.bridgeReasons).toContain("harness_cleanup_contract");
    expect(tasks.docsOnly).toBe(false);
  });

  it("应把 harness dashboard 渲染文件归到 bridge/contracts 风险", () => {
    const tasks = detectTasks(["scripts/lib/harness-dashboard-core.mjs"]);

    expect(tasks.bridge).toBe(true);
    expect(tasks.bridgeReasons).toContain("harness_cleanup_contract");
    expect(tasks.docsOnly).toBe(false);
  });

  it("应把 DevBridge 主链改动标记为 bridge runtime 风险", () => {
    const tasks = detectTasks(["src/lib/dev-bridge/safeInvoke.ts"]);

    expect(tasks.bridge).toBe(true);
    expect(tasks.bridgeReasons).toContain("bridge_runtime");
    expect(tasks.docsOnly).toBe(false);
  });
});
