import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function existingFiles(filePaths) {
  return filePaths.filter((filePath) => fs.existsSync(filePath));
}

function expectNoBrandPrefixRule(content, label) {
  expect(content, label).toMatch(
    /Lime`\s*\/\s*`lime_`\s*\/\s*`lime-|产品品牌|品牌前缀/,
  );
  expect(content, label).toMatch(/品牌前缀|新增命名|新命名/);
  expect(content, label).toMatch(
    /不得添加|不要加|禁止把|使用领域名|current 事实源命名|直接使用领域名|无品牌名称保持上游原名，新命名使用短的领域词/,
  );
}

function expectAppServerAgentRule(content, label) {
  expect(content, label).toMatch(/App Server JSON-RPC|JSON-RPC/);
  expect(content, label).toMatch(
    /新增 AI Agent|新增 Agent 逻辑|新增的是 AI Agent|Agent runtime 的唯一产品链|能力缺口只能参考 Codex/,
  );
  expect(content, label).toMatch(
    /agent_runtime_\*|已退役 runtime|Agent runtime/,
  );
  expect(content, label).toMatch(/兼容适配|兼容层|compat/);
}

function expectCurrentRustOwnerRule(content, label) {
  expect(content, label).toMatch(
    /lime-rs\/crates\/\*\*|App Server|RuntimeCore/,
  );
  expect(content, label).toMatch(/current|事实源|Owner|owner|职责/);
  expect(content, label).toMatch(/不得|禁止|只允许|不再|不能/);
}

function expectRustCommandsCleanupRule(content, label) {
  expect(content, label).toContain("lime-rs/src/commands/**");
  expect(content, label).toMatch(
    /已删除|已物理删除|已随 `lime-rs\/src\/\*\*` 删除|旧 (?:Tauri )?(?:command )?wrapper (?:删除)?清理|清理区/,
  );
  expect(content, label).toMatch(
    /不得恢复|不再承接|不得.*新增|不再落|不能.*新增|新增 stub|新增业务逻辑/,
  );
  expect(content, label).toMatch(
    /App Server|RuntimeCore|services|Electron Desktop Host/,
  );
  expect(content, label).toMatch(
    /stub|compat wrapper|thin facade|退场 stub|fail-closed stub|tombstone|blocker|撤注册|删除/,
  );
}

function retiredHostPackageName() {
  return ["@", "ta", "uri-apps"].join("");
}

function retiredHostGlobalName() {
  return ["__TA", "URI__"].join("");
}

function retiredHostInternalsName() {
  return ["__TA", "URI_INTERNALS__"].join("");
}

function retiredHostMockDir() {
  return ["src/lib/", "ta", "uri-mock"].join("");
}

function retiredHostPackagePatternSource() {
  return '["@", "ta", "uri-apps", "\\\\/api"].join("")';
}

function retiredHostGlobalPatternSource() {
  return '["__TA", "URI__"].join("")';
}

describe("Electron current repository rules guard", () => {
  it("keeps root and aiprompts rules on Electron/App Server current", () => {
    const docs = [
      "AGENTS.md",
      "internal/aiprompts/README.md",
      "internal/aiprompts/commands.md",
      "internal/aiprompts/governance.md",
      "internal/aiprompts/quality-workflow.md",
    ];

    for (const filePath of docs) {
      const content = readFile(filePath);

      expect(content, filePath).toMatch(/Electron/);
      expect(content, filePath).toMatch(/App Server/);
    }

    expectNoBrandPrefixRule(readFile("AGENTS.md"), "AGENTS.md");
    expectAppServerAgentRule(readFile("AGENTS.md"), "AGENTS.md");
    expectNoBrandPrefixRule(
      readFile("internal/aiprompts/README.md"),
      "internal/aiprompts/README.md",
    );
    expectAppServerAgentRule(
      readFile("internal/aiprompts/README.md"),
      "internal/aiprompts/README.md",
    );
    expectCurrentRustOwnerRule(readFile("AGENTS.md"), "AGENTS.md");
    expectCurrentRustOwnerRule(
      readFile("internal/aiprompts/README.md"),
      "internal/aiprompts/README.md",
    );
    expectCurrentRustOwnerRule(
      readFile("internal/aiprompts/commands.md"),
      "internal/aiprompts/commands.md",
    );
    expectCurrentRustOwnerRule(
      readFile("internal/README.md"),
      "internal/README.md",
    );
  });

  it("keeps App Server roadmap aware that Rust commands are cleanup-only", () => {
    const docs = [
      "internal/roadmap/appserver/README.md",
      "internal/roadmap/appserver/architecture.md",
      "internal/roadmap/appserver/frontend-electron-migration.md",
      "internal/roadmap/appserver/service-extraction.md",
      "internal/roadmap/appserver/testing-migration.md",
      "internal/roadmap/appserver/implementation-plan.md",
    ];

    for (const filePath of docs) {
      expectRustCommandsCleanupRule(readFile(filePath), filePath);
    }
  });

  it("keeps execution plan entrypoints aware that Rust commands are cleanup-only", () => {
    const docs = [
      "internal/exec-plans/README.md",
      "internal/exec-plans/production-command-current-migration-plan.md",
      ...existingFiles([
        "internal/exec-plans/tauri-wrapper-quick-cleanup-queue.md",
        "internal/exec-plans/tauri-wrapper-command-inventory.md",
      ]),
    ];

    for (const filePath of docs) {
      expectRustCommandsCleanupRule(readFile(filePath), filePath);
    }
  });

  it("keeps governance, quality, docs, and skill references aware of Rust commands cleanup", () => {
    const detailedDocs = [
      "docs/README.md",
      ...existingFiles([
        ".codex/skills/lime-command-boundary/references/commands.md",
        ".codex/skills/lime-governance/references/governance.md",
        ".codex/skills/lime-quality-workflow/references/quality-workflow.md",
      ]),
    ];

    for (const filePath of detailedDocs) {
      expectRustCommandsCleanupRule(readFile(filePath), filePath);
    }

    for (const filePath of [
      "internal/aiprompts/governance.md",
      "internal/aiprompts/quality-workflow.md",
      "internal/aiprompts/commands.md",
    ]) {
      expectCurrentRustOwnerRule(readFile(filePath), filePath);
    }
  });

  it("keeps boundary and governance skills explicit about their current rules", () => {
    const skillFiles = existingFiles([
      ".codex/skills/lime-command-boundary/SKILL.md",
      ".codex/skills/lime-governance/SKILL.md",
    ]);

    for (const filePath of skillFiles) {
      const content = readFile(filePath);

      expectNoBrandPrefixRule(content, filePath);
      expectAppServerAgentRule(content, filePath);
      expect(content, filePath).toMatch(/Electron/);
      expect(content, filePath).toMatch(/App Server/);
    }
  });

  it("keeps GUI and quality skills linked to authoritative current rules", () => {
    for (const filePath of [
      ".codex/skills/lime-design-language/SKILL.md",
      ".codex/skills/lime-quality-workflow/SKILL.md",
    ]) {
      const content = readFile(filePath);
      const references = Array.from(
        content.matchAll(/\]\(([^)]+\.md)\)/g),
        (match) => path.normalize(path.join(path.dirname(filePath), match[1])),
      );
      for (const source of [
        "internal/aiprompts/architecture.md",
        "internal/aiprompts/commands.md",
        "internal/aiprompts/quality-workflow.md",
        "internal/aiprompts/design-language.md",
      ]) {
        expect(references, filePath).toContain(source);
        expect(fs.existsSync(source), source).toBe(true);
      }
      expect(content, filePath).toContain("Thread/Turn/Item");
      expect(content, filePath).toContain("App Server");
      expect(content, filePath).toMatch(/测试.*护栏|护栏.*测试/);
    }

    const quality = readFile(".codex/skills/lime-quality-workflow/SKILL.md");
    expect(quality).toContain(
      "Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection",
    );
    expect(quality).toContain("Desktop、CLI 和 TUI 共用协议");
    expect(quality).toContain("生产 mock fallback 命中必须为零");
    expect(quality).toContain("npm run test:contracts");
    expect(quality).toContain("npm run verify:gui-smoke");
    expect(quality).toContain("npm run verify:local");
    expect(quality).toContain("npm run test:resume");
    expect(quality).toContain("internal/aiprompts/governance.md");

    const design = readFile(".codex/skills/lime-design-language/SKILL.md");
    expect(design).toContain("视觉主题、多模型支持");
    expect(design).toContain("专家广场、消息渠道");
    expect(design).not.toContain("主题、多模型支持、首页 Banner");
    expect(design).toContain("reverse-engineer-anything");
    expect(design).toContain("不能由 TUI 布局推断 GUI");
  });

  it("keeps testing rules on Electron current evidence", () => {
    const content = readFile("internal/aiprompts/quality-workflow.md");

    expect(content).toContain("全量检查不能替代真实 GUI 或跨层证据");
    expect(content).toContain("Gate A 不能替代 Gate B");
    expect(content).toContain("Electron");
    expect(content).toContain("App Server JSON-RPC");
    expect(content).toContain("src/lib/desktop-host/");
    expect(content).toContain("npm run verify:gui-smoke");
    expect(content).toContain("不得把它们作为可交付的生产链证据");
  });

  it("keeps Vitest smoke runner aliases on desktop-host current naming", () => {
    const content = readFile("scripts/lib/vitest-smoke-runner.mjs");

    expect(content).toContain("desktopHostAliasPatterns");
    expect(content).toContain("desktopHostDir");
    expect(content).toContain("src/lib/desktop-host");
    expect(content).not.toContain(["Ta", "uriAliasPatterns"].join(""));
    expect(content).not.toContain(["ta", "uriMockDir"].join(""));
    expect(content).not.toContain(retiredHostMockDir());
    expect(content).not.toContain("lime-vitest-smoke-");
  });

  it("keeps Vitest layer classifier from treating legacy desktop host API as desktop-host current", () => {
    const content = readFile("scripts/lib/vitest-layer-classifier.mjs");

    expect(content).toContain('reason: "desktop-host-api"');
    expect(content).toContain("desktop-host|DesktopHost");
    expect(content).toContain('reason: "legacy-desktop-host-api"');
    expect(content).toContain(retiredHostPackagePatternSource());
    expect(content).toContain(retiredHostGlobalPatternSource());
    expect(content).not.toContain(retiredHostPackageName());
    expect(content).not.toContain(retiredHostGlobalName());
    expect(content).not.toContain(
      `reason: "desktop-host-api", pattern: /${retiredHostPackageName()}`,
    );
  });

  it("keeps renderer HTML entrypoint free of retired desktop host probes", () => {
    const content = readFile("index.html");

    expect(content).not.toContain(retiredHostPackageName());
    expect(content).not.toContain(retiredHostGlobalName());
    expect(content).not.toContain(retiredHostInternalsName());
    expect(content).not.toContain(retiredHostMockDir());
    expect(content).not.toContain("SC_DISABLE_SPEEDY");
  });

  it("keeps renderer HTML entrypoint covered by the native startup shell", () => {
    const content = readFile("index.html");

    expect(content).toContain("data-lime-native-startup");
    expect(content).toContain("data-lime-startup-shell");
    expect(content).toContain("data-lime-startup-logo");
    expect(content).toContain('params.get("nativeStartup") === "1"');
    expect(content).toContain("index-startup-progress-shift");
    expect(content).toContain("animation: index-startup-progress-shift");
  });
});
