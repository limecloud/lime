#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runVitest(label, args) {
  console.log(`\n[smoke:agent-service-skill-entry] > ${label}`);
  const result = spawnSync(
    npmCommand,
    ["exec", "--", "vitest", "run", ...args],
    {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const error = new Error(
      `[smoke:agent-service-skill-entry] ${label} 失败`,
    );
    error.exitCode = result.status;
    throw error;
  }
}

function main() {
  runVitest("服务技能入口路由与挂起参数", [
    "src/components/skills/SkillsWorkspacePage.test.tsx",
    "src/components/agent/chat/workspace/useWorkspaceServiceSkillEntryActions.test.tsx",
    "src/components/agent/chat/index.shell-routing.test.tsx",
    "src/components/AppPageContent.test.tsx",
  ]);

  runVitest("Agent 对话内 A2UI 挂起主链", [
    "src/components/agent/chat/index.test.tsx",
    "--hookTimeout=60000",
    "-t",
    "AgentChatPage 服务技能 A2UI|AgentChatPage legacy 问卷 A2UI",
  ]);

  console.log("\n[smoke:agent-service-skill-entry] 通过");
}

main();
