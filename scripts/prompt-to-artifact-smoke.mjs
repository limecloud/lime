#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULTS = {
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 120_000,
  intervalMs: 1_000,
  workspaceRoot: "",
  cleanup: false,
  json: false,
};

function printHelp() {
  console.log(`
Prompt-to-Artifact Smoke

用途:
  用临时 workspace 走通 read-only Capability Draft -> verification -> registration -> discovery -> binding readiness。
  该 smoke 只验证 P5 第一刀的 prompt-to-artifact 前半链，不执行外部 CLI、不联网、不创建长期自动化。

用法:
  node scripts/prompt-to-artifact-smoke.mjs [选项]

选项:
  --health-url <url>     DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>     DevBridge invoke 地址，默认 http://127.0.0.1:3030/invoke
  --timeout-ms <ms>      等待 DevBridge 超时，默认 120000
  --interval-ms <ms>     轮询间隔，默认 1000
  --workspace-root <dir> 指定 smoke workspace；默认创建临时目录
  --cleanup              成功或失败后删除本脚本创建的临时 workspace
  --json                 只输出 JSON summary
  -h, --help             显示帮助

示例:
  node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 120000
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--health-url" && argv[index + 1]) {
      options.healthUrl = String(argv[++index]).trim();
      continue;
    }
    if (arg === "--invoke-url" && argv[index + 1]) {
      options.invokeUrl = String(argv[++index]).trim();
      continue;
    }
    if (arg === "--timeout-ms" && argv[index + 1]) {
      options.timeoutMs = Number(argv[++index]);
      continue;
    }
    if (arg === "--interval-ms" && argv[index + 1]) {
      options.intervalMs = Number(argv[++index]);
      continue;
    }
    if (arg === "--workspace-root" && argv[index + 1]) {
      options.workspaceRoot = path.resolve(String(argv[++index]).trim());
      continue;
    }
    if (arg === "--cleanup") {
      options.cleanup = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`未知参数: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms 必须是 >= 1000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pickString(target, ...keys) {
  for (const key of keys) {
    const value = target?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function pickArray(target, ...keys) {
  for (const key of keys) {
    const value = target?.[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

async function checkHealth(url) {
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return text ? JSON.parse(text) : null;
}

async function waitForHealth(options) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const payload = await checkHealth(options.healthUrl);
      if (!options.json) {
        console.log(`[prompt-to-artifact:p5-smoke] DevBridge 已就绪 (${Date.now() - startedAt}ms)`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      await sleep(options.intervalMs);
    }
  }
  throw new Error(
    `DevBridge 未就绪，请先启动 npm run tauri:dev:headless。最后错误: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function invoke(invokeUrl, cmd, args = {}) {
  const response = await fetch(invokeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  if (!response.ok) {
    throw new Error(`${cmd} HTTP ${response.status}: ${response.statusText}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`${cmd} failed: ${payload.error}`);
  }
  return payload?.result;
}

function buildGeneratedFiles() {
  return [
    {
      relativePath: "SKILL.md",
      content: [
        "---",
        "name: 只读 CLI 每日报告",
        "description: 把只读 CLI 或 fixture 输出整理成 Markdown 趋势摘要。",
        "---",
        "",
        "# 只读 CLI 每日报告",
        "",
        "## 何时使用",
        "当用户需要把本地只读 CLI 输出、日志片段或 fixture 数据整理为每日趋势报告时使用。",
        "",
        "## 输入",
        "- topic: 报告主题。",
        "- fixture_path: 可选，只读 fixture 路径。",
        "",
        "## 执行步骤",
        "1. 读取用户提供的只读 CLI 输出或 fixture 内容。",
        "2. 提炼趋势、异常、代表样例和下一步建议。",
        "3. 生成 Markdown 报告。",
        "",
        "## 输出",
        "- markdown_report: Markdown 趋势摘要。",
        "",
        "## 权限边界",
        "只读读取用户提供内容；不安装依赖，不联网，不发布，不删除文件。",
      ].join("\n"),
    },
    {
      relativePath: "contract/input.schema.json",
      content: JSON.stringify(
        {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string" },
            fixture_path: { type: "string" },
          },
          additionalProperties: false,
        },
        null,
        2,
      ),
    },
    {
      relativePath: "contract/output.schema.json",
      content: JSON.stringify(
        {
          type: "object",
          required: ["markdown_report"],
          properties: {
            markdown_report: { type: "string" },
            evidence_notes: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
        null,
        2,
      ),
    },
    {
      relativePath: "examples/input.sample.json",
      content: JSON.stringify(
        {
          topic: "AI Agent adoption",
          fixture_path: "tests/fixture.json",
        },
        null,
        2,
      ),
    },
    {
      relativePath: "tests/fixture.json",
      content: JSON.stringify(
        {
          rows: [
            { label: "Agent workflow", mentions: 42 },
            { label: "Human approval", mentions: 18 },
            { label: "Evidence audit", mentions: 12 },
          ],
        },
        null,
        2,
      ),
    },
    {
      relativePath: "scripts/README.md",
      content: [
        "# Wrapper 说明",
        "",
        "P5 第一刀不执行真实 CLI。后续接入真实只读 CLI 时，必须继续保持只读参数、fixture dry-run 和人工确认边界。",
      ].join("\n"),
    },
  ];
}

async function prepareWorkspace(options) {
  if (options.workspaceRoot) {
    await fs.mkdir(options.workspaceRoot, { recursive: true });
    return { workspaceRoot: options.workspaceRoot, createdTemp: false };
  }
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lime-prompt-artifact-p5-"));
  return { workspaceRoot, createdTemp: true };
}

async function runSmoke(options) {
  await waitForHealth(options);
  const workspace = await prepareWorkspace(options);
  const startedAt = new Date().toISOString();

  try {
    const createRequest = {
      workspaceRoot: workspace.workspaceRoot,
      name: "只读 CLI 每日报告",
      description: "把只读 CLI 或 fixture 输出整理成 Markdown 趋势摘要。",
      userGoal:
        "每天 9 点读取只读 CLI 或 fixture 输出，生成 Markdown 趋势摘要，失败时提示我检查配置。",
      sourceKind: "cli",
      sourceRefs: ["docs/exec-plans/skill-forge-prompt-to-artifact-p5-plan.md"],
      permissionSummary: ["Level 0 只读发现", "Level 1 draft-scoped write"],
      generatedFiles: buildGeneratedFiles(),
    };

    const draft = await invoke(options.invokeUrl, "capability_draft_create", {
      request: createRequest,
    });
    const draftId = pickString(draft, "draftId", "draft_id");
    assert(draftId, "capability_draft_create 未返回 draftId");

    const verification = await invoke(options.invokeUrl, "capability_draft_verify", {
      request: { workspaceRoot: workspace.workspaceRoot, draftId },
    });
    const verificationStatus = pickString(
      verification?.draft,
      "verificationStatus",
      "verification_status",
    );
    assert(
      verificationStatus === "verified_pending_registration",
      `verification 未进入 pending registration: ${verificationStatus}`,
    );
    const failedChecks = pickArray(verification?.report, "checks").filter(
      (check) => pickString(check, "status") === "failed",
    );
    assert(failedChecks.length === 0, `verification 存在失败项: ${JSON.stringify(failedChecks)}`);

    const registration = await invoke(options.invokeUrl, "capability_draft_register", {
      request: { workspaceRoot: workspace.workspaceRoot, draftId },
    });
    const registeredSkillDirectory = pickString(
      registration?.registration,
      "registeredSkillDirectory",
      "registered_skill_directory",
    );
    assert(registeredSkillDirectory, "registration 未返回 registeredSkillDirectory");

    const registeredSkills = await invoke(
      options.invokeUrl,
      "capability_draft_list_registered_skills",
      { request: { workspaceRoot: workspace.workspaceRoot } },
    );
    assert(Array.isArray(registeredSkills), "registered skills 返回不是数组");
    const registeredSkill = registeredSkills.find(
      (skill) =>
        pickString(skill, "registeredSkillDirectory", "registered_skill_directory") ===
          registeredSkillDirectory || pickString(skill, "name") === "只读 CLI 每日报告",
    );
    assert(registeredSkill, "registered discovery 未找到刚注册的 skill");
    assert(
      registeredSkill.launchEnabled === false || registeredSkill.launch_enabled === false,
      "registered discovery 不应默认 launchEnabled=true",
    );

    const bindingSnapshot = await invoke(
      options.invokeUrl,
      "agent_runtime_list_workspace_skill_bindings",
      {
        request: {
          workspaceRoot: workspace.workspaceRoot,
          caller: "assistant",
          workbench: true,
        },
      },
    );
    const bindings = pickArray(bindingSnapshot, "bindings");
    const binding = bindings.find(
      (item) => pickString(item, "registered_skill_directory", "registeredSkillDirectory") === registeredSkillDirectory,
    );
    assert(binding, "runtime binding readiness 未找到刚注册的 skill");
    assert(
      pickString(binding, "binding_status", "bindingStatus") === "ready_for_manual_enable",
      `binding 未 ready_for_manual_enable: ${pickString(binding, "binding_status", "bindingStatus")}`,
    );
    assert(binding.launch_enabled === false || binding.launchEnabled === false, "binding 不应默认 launch enabled");
    assert(binding.tool_runtime_visible === false || binding.toolRuntimeVisible === false, "binding 不应默认 tool runtime visible");

    const summary = {
      status: "passed",
      startedAt,
      finishedAt: new Date().toISOString(),
      workspaceRoot: workspace.workspaceRoot,
      draftId,
      verificationStatus,
      verificationReportId: pickString(
        verification?.report,
        "reportId",
        "report_id",
      ),
      registeredSkillDirectory,
      registeredSkillName: pickString(registeredSkill, "name"),
      bindingStatus: pickString(binding, "binding_status", "bindingStatus"),
      nextGate: pickString(binding, "next_gate", "nextGate"),
      cleanup: options.cleanup && workspace.createdTemp,
    };

    if (!options.json) {
      console.log("[prompt-to-artifact:p5-smoke] 通过");
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(JSON.stringify(summary));
    }

    return { summary, workspace };
  } catch (error) {
    error.workspaceRoot = workspace.workspaceRoot;
    throw error;
  } finally {
    if (options.cleanup && workspace.createdTemp) {
      await fs.rm(workspace.workspaceRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }
  const options = parseArgs(process.argv.slice(2));
  await runSmoke(options);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[prompt-to-artifact:p5-smoke] 失败: ${detail}`);
  if (error?.workspaceRoot) {
    console.error(`[prompt-to-artifact:p5-smoke] workspaceRoot: ${error.workspaceRoot}`);
  }
  process.exit(1);
});
