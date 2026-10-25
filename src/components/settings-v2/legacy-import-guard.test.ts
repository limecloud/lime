/* global process */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SETTINGS_V2_DIR = join(process.cwd(), "src/components/settings-v2");

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }

    if (!fullPath.endsWith(".ts") && !fullPath.endsWith(".tsx")) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe("settings-v2 legacy import guard", () => {
  it("不恢复独立 MCP 面板、私有事件投影和外部应用同步设置", () => {
    const root = process.cwd();
    for (const path of [
      "src/components/mcp",
      "src/components/mcp/McpPage.tsx",
      "src/components/mcp/McpPanel.tsx",
      "src/hooks/useMcp.ts",
      "src/hooks/useMcpServers.ts",
      "src/hooks/useMcpEvents.ts",
      "src/lib/mcp/eventStreamProjection.ts",
      "lime-rs/crates/services/src/mcp_sync.rs",
      "lime-rs/crates/app-server-protocol/schema/json/v0/McpServerImportFromAppParams.json",
      "lime-rs/crates/app-server-protocol/schema/json/v0/McpServerImportFromAppResponse.json",
    ])
      expect(existsSync(join(root, path))).toBe(false);
    const files = collectTsFiles(SETTINGS_V2_DIR).filter(
      (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
    );
    expect(
      files.filter((file) =>
        /SettingsTabs\.McpServer\b|components\/mcp\/|importFromApp|syncAllToLive/.test(
          readFileSync(file, "utf8"),
        ),
      ),
    ).toEqual([]);
    for (const locale of ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])
      expect(
        readFileSync(
          join(root, "src/i18n/resources", locale, "settings.json"),
          "utf8",
        ),
      ).not.toContain('"settings.mcpPage.');
  });
  it("不恢复已替换的技能设置包装和额外高级入口", () => {
    expect(existsSync(join(SETTINGS_V2_DIR, "agent/skills/index.tsx"))).toBe(
      false,
    );
    const files = collectTsFiles(SETTINGS_V2_DIR).filter(
      (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
    );
    expect(
      files.filter((file) =>
        /ExtensionsSettings|SettingsTabs\.Skills\b|["'][^"']*agent\/skills["']/.test(
          readFileSync(file, "utf8"),
        ),
      ),
    ).toEqual([]);
    for (const locale of ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]) {
      const resource = readFileSync(
        join(process.cwd(), "src/i18n/resources", locale, "settings.json"),
        "utf8",
      );
      expect(resource).not.toContain('"advancedEntry"');
    }
  });

  it("不应引用旧 settings 目录实现", () => {
    const files = collectTsFiles(SETTINGS_V2_DIR);
    const offenders: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");

      if (
        content.match(/from\s+["'][^"']*\/components\/settings\/[^"']*["']/) ||
        content.match(/from\s+["'][^"']*(?:\.\.\/)+settings\/[^"']*["']/)
      ) {
        offenders.push(relative(process.cwd(), filePath));
      }
    }

    expect(offenders).toEqual([]);
  });
});
