import { describe, expect, it } from "vitest";

import { detectTasks } from "./quality-task-planner.mjs";

describe("quality-task-planner", () => {
  it("Agent QC 文档不应进入 GitHub Actions bridge/contracts 验证", () => {
    const tasks = detectTasks([
      "internal/tests/agent-ops-qc.md",
      "internal/tests/agent-qc-p0-scenarios.md",
      "internal/tests/lime-agent-qc-rollout-plan.md",
      "internal/test/agent-qc-scenarios.manifest.json",
      "internal/test/agent-qc-evidence.schema.json",
      "internal/test/agent-qc-gui-flows.manifest.json",
    ]);

    expect(tasks.bridge).toBe(false);
    expect(tasks.bridgeReasons).not.toContain("agent_qc_contract");
    expect(tasks.docsOnly).toBe(true);
  });

  it("Agent QC 本地脚本不应触发 bridge/contracts 原因", () => {
    const tasks = detectTasks([
      "scripts/lib/agent-qc-completion-audit-core.mjs",
      "scripts/lib/agent-qc-evidence-core.mjs",
      "scripts/lib/agent-qc-gui-flow-core.mjs",
      "scripts/lib/agent-qc-qcloop-job-core.mjs",
      "scripts/lib/agent-qc-release-summary-core.mjs",
    ]);

    expect(tasks.bridge).toBe(false);
    expect(tasks.bridgeReasons).not.toContain("agent_qc_contract");
    expect(tasks.docsOnly).toBe(false);
  });

  it("应把 harness cleanup/report 主链文件归到 bridge/contracts 风险", () => {
    const tasks = detectTasks([
      "scripts/lib/generated-slop-report-core.mjs",
      "scripts/check-generated-slop-report.mjs",
      "scripts/harness/eval-history-record.mjs",
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

  it("临时 Windows 测试包 workflow 单独变更不应触发质量全量", () => {
    const tasks = detectTasks([".github/workflows/build-windows-test.yml"]);

    expect(tasks.workflow).toBe(false);
    expect(tasks.integrity).toBe(false);
    expect(tasks.i18n).toBe(false);
    expect(tasks.i18nHardcoded).toBe(false);
    expect(tasks.i18nUnused).toBe(false);
    expect(tasks.frontend).toBe(false);
    expect(tasks.bridge).toBe(false);
    expect(tasks.guiSmoke).toBe(false);
  });

  it("临时测试包 workflow 搭配前端改动时不应升级成 workflow 全量", () => {
    const tasks = detectTasks([
      ".github/workflows/build-windows-test.yml",
      "src/components/api-key-provider/ApiKeyProviderSection.tsx",
    ]);

    expect(tasks.workflow).toBe(false);
    expect(tasks.frontend).toBe(true);
    expect(tasks.guiSmoke).toBe(true);
    expect(tasks.bridge).toBe(false);
    expect(tasks.bridgeReasons).not.toContain("workflow_full_suite");
  });

  it("正式工作流变更仍应触发 workflow 全量质量门禁", () => {
    const tasks = detectTasks([".github/workflows/release.yml"]);

    expect(tasks.workflow).toBe(true);
    expect(tasks.integrity).toBe(true);
    expect(tasks.i18n).toBe(true);
    expect(tasks.i18nHardcoded).toBe(true);
    expect(tasks.i18nUnused).toBe(true);
    expect(tasks.frontend).toBe(true);
    expect(tasks.bridge).toBe(true);
    expect(tasks.guiSmoke).toBe(true);
    expect(tasks.bridgeReasons).toContain("workflow_full_suite");
  });

  it("i18n resource 改动应触发翻译资源结构校验", () => {
    const tasks = detectTasks(["src/i18n/resources/en-US/agent.json"]);

    expect(tasks.i18n).toBe(true);
    expect(tasks.i18nHardcoded).toBe(false);
    expect(tasks.i18nUnused).toBe(true);
    expect(tasks.frontend).toBe(true);
    expect(tasks.docsOnly).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:translation-pr-pack:json -- --output internal/roadmap/i18n/evidence/translation-pr-pack.json",
      "npm run i18n:bundle-report:json -- --output internal/roadmap/i18n/evidence/bundle-strategy-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("i18n workflow 脚本改动应触发翻译结构校验并推荐 PR pack", () => {
    const tasks = detectTasks(["scripts/i18n/i18n-translation-pr-pack.ts"]);

    expect(tasks.i18n).toBe(true);
    expect(tasks.i18nHardcoded).toBe(false);
    expect(tasks.i18nUnused).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.docsOnly).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:translation-pr-pack:json -- --output internal/roadmap/i18n/evidence/translation-pr-pack.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("patch retirement 相关脚本改动应触发 GUI smoke 并推荐 gate", () => {
    const tasks = detectTasks(["scripts/i18n/i18n-patch-retirement-gate.mjs"]);

    expect(tasks.guiSmoke).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:patch-retirement-gate -- --check",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("bundle strategy 脚本改动应触发 i18n 校验并推荐刷新 bundle evidence", () => {
    const tasks = detectTasks(["scripts/i18n/i18n-bundle-report.ts"]);

    expect(tasks.i18n).toBe(true);
    expect(tasks.i18nHardcoded).toBe(false);
    expect(tasks.i18nUnused).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.guiSmoke).toBe(false);
    expect(tasks.docsOnly).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:bundle-report:json -- --output internal/roadmap/i18n/evidence/bundle-strategy-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("bundle loader 边界改动应推荐刷新 bundle evidence", () => {
    const tasks = detectTasks(["src/i18n/loadNamespace.ts"]);

    expect(tasks.i18n).toBe(true);
    expect(tasks.i18nHardcoded).toBe(false);
    expect(tasks.i18nUnused).toBe(true);
    expect(tasks.frontend).toBe(true);
    expect(tasks.guiSmoke).toBe(false);
    expect(tasks.docsOnly).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:bundle-report:json -- --output internal/roadmap/i18n/evidence/bundle-strategy-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("发布材料文档改动应在 docs-only 下推荐刷新 release docs evidence", () => {
    const tasks = detectTasks(["docs/content/02.user-guide/9.mcp.md"]);

    expect(tasks.docsOnly).toBe(true);
    expect(tasks.docs).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:docs-locale-manifest:json -- --output internal/roadmap/i18n/evidence/docs-locale-build-manifest.json",
      "npm run i18n:release-docs-report:json -- --output internal/roadmap/i18n/evidence/release-docs-workflow-inventory.json",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("release docs 翻译范围 manifest 改动应推荐刷新 release docs evidence", () => {
    const tasks = detectTasks([
      "internal/roadmap/i18n/release-docs-translation-scope.json",
    ]);

    expect(tasks.docsOnly).toBe(true);
    expect(tasks.docs).toBe(true);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:docs-locale-manifest:json -- --output internal/roadmap/i18n/evidence/docs-locale-build-manifest.json",
      "npm run i18n:release-docs-report:json -- --output internal/roadmap/i18n/evidence/release-docs-workflow-inventory.json",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("release docs companion 改动应保持 docs-only 并推荐刷新 evidence", () => {
    const tasks = detectTasks([
      "internal/roadmap/i18n/companions/docs-content-index.en.md",
    ]);

    expect(tasks.docsOnly).toBe(true);
    expect(tasks.docs).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:docs-locale-manifest:json -- --output internal/roadmap/i18n/evidence/docs-locale-build-manifest.json",
      "npm run i18n:release-docs-report:json -- --output internal/roadmap/i18n/evidence/release-docs-workflow-inventory.json",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("Chrome extension i18n surface 改动应推荐刷新 extension evidence", () => {
    const tasks = detectTasks(["extensions/lime-chrome/computer-use.html"]);

    expect(tasks.docsOnly).toBe(false);
    expect(tasks.frontend).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:chrome-extension-report:json -- --output internal/roadmap/i18n/evidence/chrome-extension-workflow-inventory.json",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("Electron installer / app metadata 改动应推荐刷新 app metadata evidence", () => {
    const tasks = detectTasks(["forge.config.mjs"]);

    expect(tasks.integrity).toBe(true);
    expect(tasks.rust).toBe(false);
    expect(tasks.guiSmoke).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:app-metadata-locale-manifest:json -- --output internal/roadmap/i18n/evidence/app-metadata-locale-build-manifest.json",
      "npm run i18n:app-metadata-report:json -- --output internal/roadmap/i18n/evidence/app-metadata-workflow-inventory.json",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("Electron host 改动应触发 bridge 与 GUI smoke current 门禁", () => {
    const tasks = detectTasks(["electron/ipcChannels.ts"]);

    expect(tasks.bridge).toBe(true);
    expect(tasks.bridgeReasons).toContain("bridge_runtime");
    expect(tasks.guiSmoke).toBe(true);
    expect(tasks.rust).toBe(false);
  });

  it("desktop-host mock 改动应触发 bridge 与 GUI smoke current 门禁", () => {
    const tasks = detectTasks(["src/lib/desktop-host/core.ts"]);

    expect(tasks.bridge).toBe(true);
    expect(tasks.bridgeReasons).toContain("bridge_runtime");
    expect(tasks.guiSmoke).toBe(true);
  });

  it("app metadata 翻译范围 manifest 改动应保持 docs-only 并推荐刷新 evidence", () => {
    const tasks = detectTasks([
      "internal/roadmap/i18n/app-metadata-translation-scope.json",
    ]);

    expect(tasks.docsOnly).toBe(true);
    expect(tasks.docs).toBe(true);
    expect(tasks.rust).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:app-metadata-locale-manifest:json -- --output internal/roadmap/i18n/evidence/app-metadata-locale-build-manifest.json",
      "npm run i18n:app-metadata-report:json -- --output internal/roadmap/i18n/evidence/app-metadata-workflow-inventory.json",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("RTL 主路径 surface 改动应推荐 readiness inventory 与 RTL smoke", () => {
    const tasks = detectTasks(["src/components/settings-v2/_layout/index.tsx"]);

    expect(tasks.frontend).toBe(true);
    expect(tasks.guiSmoke).toBe(true);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:rtl-readiness-report:json -- --output internal/roadmap/i18n/evidence/rtl-readiness-inventory.json",
      "npm run i18n:rtl-smoke",
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("P4 readiness 聚合脚本改动应推荐刷新 P4 总 evidence", () => {
    const tasks = detectTasks(["scripts/i18n/i18n-p4-readiness-report.ts"]);

    expect(tasks.i18n).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.docsOnly).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:p4-readiness-report:json -- --output internal/roadmap/i18n/evidence/p4-readiness-report.json",
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("roadmap readiness 聚合脚本改动应推荐刷新全路线图 evidence", () => {
    const tasks = detectTasks([
      "scripts/i18n/i18n-roadmap-readiness-report.ts",
    ]);

    expect(tasks.i18n).toBe(true);
    expect(tasks.frontend).toBe(false);
    expect(tasks.docsOnly).toBe(false);
    expect(tasks.recommendedCommands).toEqual([
      "npm run i18n:roadmap-readiness-report:json -- --output internal/roadmap/i18n/evidence/roadmap-readiness-report.json",
    ]);
  });

  it("前端源码改动应触发硬编码文案扫描", () => {
    const tasks = detectTasks(["src/components/settings/LanguagePicker.tsx"]);

    expect(tasks.i18nHardcoded).toBe(true);
    expect(tasks.i18n).toBe(false);
    expect(tasks.i18nUnused).toBe(true);
    expect(tasks.frontend).toBe(true);
  });

  it("文档-only 项目资料改动不应强推产品 E2E", () => {
    const tasks = detectTasks(["internal/roadmap/knowledge/prd-v3.md"]);

    expect(tasks.docsOnly).toBe(true);
    expect(tasks.recommendedCommands).toEqual([]);
  });
});
