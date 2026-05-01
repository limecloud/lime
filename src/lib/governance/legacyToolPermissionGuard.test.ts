/* global process */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const AGENT_LIB_RS = join(REPO_ROOT, "src-tauri/crates/agent/src/lib.rs");
const LEGACY_PERMISSION_FIXTURE_RS = join(
  REPO_ROOT,
  "src-tauri/crates/agent/tests/legacy_permission_surfaces.rs",
);
const RUST_SCAN_ROOTS = [
  join(REPO_ROOT, "src-tauri/src"),
  join(REPO_ROOT, "src-tauri/crates"),
];
const EXCLUDED_RUST_FILES = new Set([
  "src-tauri/crates/agent/src/tool_permissions.rs",
  "src-tauri/crates/agent/src/shell_security.rs",
]);
const EXCLUDED_RUST_DIRS = new Set(["target", "aster-rust"]);

function collectRustFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (EXCLUDED_RUST_DIRS.has(entry)) {
        continue;
      }
      files.push(...collectRustFiles(fullPath));
      continue;
    }

    if (!fullPath.endsWith(".rs")) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe("legacy tool permission guard", () => {
  it("lime-agent 不应继续把旧权限模块挂回 lib.rs 编译图", () => {
    const content = readFileSync(AGENT_LIB_RS, "utf8");
    expect(content).not.toContain("pub mod shell_security;");
    expect(content).not.toContain("pub mod tool_permissions;");
    expect(content).not.toContain("pub use shell_security::");
    expect(content).not.toContain("pub use tool_permissions::");
    expect(content).not.toContain("mod shell_security;");
    expect(content).not.toContain("mod tool_permissions;");
  });

  it("旧权限模块只允许通过独立测试夹具加载", () => {
    const content = readFileSync(LEGACY_PERMISSION_FIXTURE_RS, "utf8");

    expect(content).toContain('#[path = "../src/tool_permissions.rs"]');
    expect(content).toContain("mod tool_permissions;");
    expect(content).toContain('#[path = "../src/shell_security.rs"]');
    expect(content).toContain("mod shell_security;");
  });

  it("上层 Rust 模块不应依赖 dead-candidate 旧权限表面", () => {
    const offenders: string[] = [];
    const patterns = [
      "lime_agent::shell_security::",
      "lime_agent::tool_permissions::",
      "lime_agent::ShellSecurityChecker",
      "lime_agent::DynamicPermissionCheck",
      "lime_agent::PermissionBehavior",
    ];

    for (const root of RUST_SCAN_ROOTS) {
      const files = collectRustFiles(root);

      for (const filePath of files) {
        const relativePath = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
        if (EXCLUDED_RUST_FILES.has(relativePath)) {
          continue;
        }

        const content = readFileSync(filePath, "utf8");
        if (patterns.some((pattern) => content.includes(pattern))) {
          offenders.push(relativePath);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
