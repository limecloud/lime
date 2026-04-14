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
  console.log(`\n[smoke:agent-runtime-tool-surface] > ${label}`);
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
    const error = new Error(`[smoke:agent-runtime-tool-surface] ${label} 失败`);
    error.exitCode = result.status;
    throw error;
  }
}

function main() {
  runVitest("runtime tool surface 派生与页级提示", [
    "src/components/agent/chat/utils/runtimeToolAvailability.test.ts",
    "src/components/agent/chat/components/AgentRuntimeStrip.test.tsx",
    "src/components/agent/chat/components/EmptyState.test.tsx",
    "src/components/agent/chat/components/HarnessStatusPanel.test.tsx",
    "--hookTimeout=60000",
    "-t",
    "runtime tool surface",
  ]);

  runVitest("runtime inventory 主链透传", [
    "src/components/agent/chat/workspace/useWorkspaceHarnessInventoryRuntime.test.tsx",
    "src/components/agent/chat/components/EmptyStateComposerPanel.test.tsx",
    "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts",
  ]);

  console.log("\n[smoke:agent-runtime-tool-surface] 通过");
}

main();
