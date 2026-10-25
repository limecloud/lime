/* global process */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PROTOCOL_GUARD_DIRS = [
  join(process.cwd(), "src/components/agent/chat"),
] as const;
const RETIRED_COMPONENT_DIRS = [
  join(process.cwd(), "src/components/smart-input"),
] as const;
const API_PROTOCOL_GUARD_DIR = join(process.cwd(), "src/lib/api");
const RETIRED_AGENT_CHAT_FILES = [
  join(
    process.cwd(),
    "src/components/agent/chat/utils/freshFactualSearchPolicy.ts",
  ),
] as const;

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

    if (fullPath.endsWith(".test.ts") || fullPath.endsWith(".test.tsx")) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "artifact protocol 旧浅层 path fallback",
    pattern: /args\.path\s*\|\|\s*args\.file_path\s*\|\|\s*args\.filePath/,
  },
  {
    label: "artifact protocol 私有键名单",
    pattern:
      /\[\s*"path",\s*"file_path",\s*"filePath",[\s\S]{0,400}"artifact_paths",\s*"artifactPaths"[\s\S]{0,400}"source_file_name",\s*"sourceFileName"\s*\]/m,
  },
  {
    label: "filesystem event protocol 私有键名单",
    pattern:
      /\[\s*"path",\s*"file_path",\s*"filePath",[\s\S]{0,400}"file_name",\s*"fileName",\s*"filename"[\s\S]{0,400}"new_path",\s*"newPath"[\s\S]{0,400}"files"\s*\]/m,
  },
  {
    label: "filesystem event 目录位置 hint 旧 readString fallback",
    pattern:
      /readString\(\s*(?:args|metadata)\s*,\s*\["directory",\s*"cwd"\]\s*\)/,
  },
  {
    label: "filesystem event 输出位置 hint 旧 readString fallback",
    pattern:
      /readString\(\s*(?:args|metadata)\s*,\s*\["output_file",\s*"offload_file"\]\s*\)/,
  },
  {
    label: "Agent Chat 旧 provider model Tauri 命令",
    pattern: /"get_(?:all_)?provider_models"/,
  },
  {
    label: "Agent Chat 硬编码 Provider 模型配置",
    pattern: /\bPROVIDER_CONFIG\b/,
  },
  {
    label: "Agent Chat 前端关键词强制搜索策略",
    pattern:
      /freshFactualSearchPolicy|requiresFreshFactualWebSearch|fresh-factual-tool-required/,
  },
  {
    label: "Agent Chat route shell 重建 key 序列化",
    pattern: /serializeLocalConversationPageInstanceKey/,
  },
  {
    label: "Agent Chat 内部工作区强制重挂载 key",
    pattern: /forcedMountKey/,
  },
];

describe("agent chat protocol fact source guard", () => {
  it("不应重新引入 smart-input 独立浮窗组件目录", () => {
    const existing = RETIRED_COMPONENT_DIRS.filter((dir) => existsSync(dir));
    expect(existing).toEqual([]);
  });

  it("不应在聊天工作台代码中重新引入私有协议键名单", () => {
    const files = PROTOCOL_GUARD_DIRS.flatMap((dir) => collectTsFiles(dir));
    const offenders: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");

      for (const { label, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(`${relative(process.cwd(), filePath)} -> ${label}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("旧前端关键词搜索策略文件保持 deleted", () => {
    const existing = RETIRED_AGENT_CHAT_FILES.filter((filePath) =>
      existsSync(filePath),
    );
    expect(existing.map((filePath) => relative(process.cwd(), filePath))).toEqual(
      [],
    );
  });

  it("不应重新直接 import agentStream 旧协议出口", () => {
    const files = PROTOCOL_GUARD_DIRS.flatMap((dir) => collectTsFiles(dir));
    const offenders: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");
      if (content.includes("@/lib/api/agentStream")) {
        offenders.push(relative(process.cwd(), filePath));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("agentStream compat 壳不应回流到 src/lib/api", () => {
    expect(existsSync(join(API_PROTOCOL_GUARD_DIR, "agentStream.ts"))).toBe(
      false,
    );
  });

  it("src/lib/api 不应重新 import agentStream compat 壳", () => {
    const files = collectTsFiles(API_PROTOCOL_GUARD_DIR);
    const offenders: string[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");
      if (
        content.includes("./agentStream") ||
        content.includes("./agentStream")
      ) {
        offenders.push(relative(process.cwd(), filePath));
      }
    }

    expect(offenders).toEqual([]);
  });
});
