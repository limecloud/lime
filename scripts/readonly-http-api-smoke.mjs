#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { buildReadonlyHttpApiCreateRequest } from "./lib/readonly-http-api-draft-template.mjs";

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
Read-Only HTTP API Capability Draft Smoke

用途:
  用临时 workspace 验证 P6 第一刀：只读 HTTP API draft 必须声明网络只读权限。
  该 smoke 只走 capability_draft_create -> capability_draft_verify，不发真实 HTTP 请求、不注册、不进入 runtime。

用法:
  node scripts/readonly-http-api-smoke.mjs [选项]

选项:
  --health-url <url>     DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>     DevBridge invoke 地址，默认 http://127.0.0.1:3030/invoke
  --timeout-ms <ms>      等待 DevBridge 超时，默认 120000
  --interval-ms <ms>     轮询间隔，默认 1000
  --workspace-root <dir> 指定 smoke workspace；默认创建临时目录
  --cleanup              成功或失败后删除本脚本创建的临时 workspace
  --json                 只输出 JSON summary
  -h, --help             显示帮助
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

function collectEvidenceKeys(check) {
  return pickArray(check, "evidence")
    .map((item) => pickString(item, "key"))
    .filter(Boolean);
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
        console.log(`[readonly-http-api:p6-smoke] DevBridge 已就绪 (${Date.now() - startedAt}ms)`);
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

function buildCreateRequest(workspaceRoot, permissionSummary, options = {}) {
  return buildReadonlyHttpApiCreateRequest(
    workspaceRoot,
    permissionSummary,
    options,
  );
}

async function prepareWorkspace(options) {
  if (options.workspaceRoot) {
    await fs.mkdir(options.workspaceRoot, { recursive: true });
    return { workspaceRoot: options.workspaceRoot, createdTemp: false };
  }
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lime-readonly-http-api-p6-"));
  return { workspaceRoot, createdTemp: true };
}

async function createAndVerify(options, workspaceRoot, permissionSummary, draftOptions = {}) {
  const draft = await invoke(options.invokeUrl, "capability_draft_create", {
    request: buildCreateRequest(workspaceRoot, permissionSummary, draftOptions),
  });
  const draftId = pickString(draft, "draftId", "draft_id");
  assert(draftId, "capability_draft_create 未返回 draftId");

  const verification = await invoke(options.invokeUrl, "capability_draft_verify", {
    request: { workspaceRoot, draftId },
  });
  const verificationStatus = pickString(
    verification?.draft,
    "verificationStatus",
    "verification_status",
  );
  const checks = pickArray(verification?.report, "checks");
  const failedChecks = checks.filter((check) => pickString(check, "status") === "failed");
  return { draftId, verificationStatus, checks, failedChecks };
}

async function runSmoke(options) {
  await waitForHealth(options);
  const workspace = await prepareWorkspace(options);
  const startedAt = new Date().toISOString();

  try {
    const positive = await createAndVerify(options, workspace.workspaceRoot, [
      "Level 0 只读发现",
      "允许只读 HTTP API GET 请求，不做外部写操作",
    ]);
    assert(
      positive.verificationStatus === "verified_pending_registration",
      `正向 draft 未进入 pending registration: ${positive.verificationStatus}`,
    );
    assert(
      positive.failedChecks.length === 0,
      `正向 draft 存在失败项: ${JSON.stringify(positive.failedChecks)}`,
    );
    const positiveDryRunExecutionCheck = positive.checks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture_dry_run_execute",
    );
    assert(
      positiveDryRunExecutionCheck,
      "正向 draft 未返回 readonly_http_fixture_dry_run_execute check",
    );
    const positiveDryRunExecuteEvidenceKeys = collectEvidenceKeys(positiveDryRunExecutionCheck);
    for (const key of [
      "scriptPath",
      "expectedOutputPath",
      "durationMs",
      "actualSha256",
      "expectedSha256",
      "stdoutPreview",
    ]) {
      assert(
        positiveDryRunExecuteEvidenceKeys.includes(key),
        `正向 dry-run execute 缺少 evidence key: ${key}`,
      );
    }
    const positivePreflightCheck = positive.checks.find(
      (check) => pickString(check, "id") === "readonly_http_execution_preflight",
    );
    assert(
      positivePreflightCheck,
      "正向 draft 未返回 readonly_http_execution_preflight check",
    );
    const positivePreflightEvidenceKeys = collectEvidenceKeys(positivePreflightCheck);
    for (const key of [
      "preflightMode",
      "endpointSource",
      "method",
      "credentialReferenceId",
      "evidenceSchema",
    ]) {
      assert(
        positivePreflightEvidenceKeys.includes(key),
        `正向 execution preflight 缺少 evidence key: ${key}`,
      );
    }

    const negative = await createAndVerify(options, workspace.workspaceRoot, ["Level 0 只读发现"]);
    assert(
      negative.verificationStatus === "verification_failed",
      `负向 draft 未失败: ${negative.verificationStatus}`,
    );
    const riskCheck = negative.failedChecks.find(
      (check) => pickString(check, "id") === "static_risk_scan",
    );
    assert(riskCheck, "负向 draft 未命中 static_risk_scan");
    assert(
      String(riskCheck.message ?? "").includes("网络只读权限"),
      `负向 draft 风险信息不包含网络只读权限: ${String(riskCheck.message ?? "")}`,
    );

    const missingFixture = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeFixture: false },
    );
    assert(
      missingFixture.verificationStatus === "verification_failed",
      `缺 fixture draft 未失败: ${missingFixture.verificationStatus}`,
    );
    const fixtureCheck = missingFixture.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture",
    );
    assert(fixtureCheck, "缺 fixture draft 未命中 readonly_http_fixture");
    assert(
      String(fixtureCheck.message ?? "").includes("fixture"),
      `缺 fixture draft 风险信息不包含 fixture: ${String(fixtureCheck.message ?? "")}`,
    );

    const missingExpectedOutput = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeExpectedOutput: false },
    );
    assert(
      missingExpectedOutput.verificationStatus === "verification_failed",
      `缺 expected output draft 未失败: ${missingExpectedOutput.verificationStatus}`,
    );
    const expectedOutputCheck = missingExpectedOutput.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_expected_output",
    );
    assert(expectedOutputCheck, "缺 expected output draft 未命中 readonly_http_expected_output");
    assert(
      String(expectedOutputCheck.message ?? "").includes("expected output"),
      `缺 expected output draft 风险信息不包含 expected output: ${String(
        expectedOutputCheck.message ?? "",
      )}`,
    );

    const missingFixtureInput = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeFixtureInput: false },
    );
    assert(
      missingFixtureInput.verificationStatus === "verification_failed",
      `缺 fixture input draft 未失败: ${missingFixtureInput.verificationStatus}`,
    );
    const fixtureInputCheck = missingFixtureInput.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture_input",
    );
    assert(fixtureInputCheck, "缺 fixture input draft 未命中 readonly_http_fixture_input");
    assert(
      String(fixtureInputCheck.message ?? "").includes("fixture"),
      `缺 fixture input draft 风险信息不包含 fixture: ${String(
        fixtureInputCheck.message ?? "",
      )}`,
    );

    const missingDryRunEntry = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeDryRunEntry: false },
    );
    assert(
      missingDryRunEntry.verificationStatus === "verification_failed",
      `缺 fixture dry-run 入口 draft 未失败: ${missingDryRunEntry.verificationStatus}`,
    );
    const dryRunCheck = missingDryRunEntry.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture_dry_run",
    );
    assert(dryRunCheck, "缺 fixture dry-run 入口 draft 未命中 readonly_http_fixture_dry_run");
    assert(
      String(dryRunCheck.message ?? "").includes("dry-run"),
      `缺 fixture dry-run 入口 draft 风险信息不包含 dry-run: ${String(
        dryRunCheck.message ?? "",
      )}`,
    );

    const missingDryRunExpectedOutputBinding = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeDryRunExpectedOutputBinding: false },
    );
    assert(
      missingDryRunExpectedOutputBinding.verificationStatus === "verification_failed",
      `dry-run 未绑定 expected output draft 未失败: ${missingDryRunExpectedOutputBinding.verificationStatus}`,
    );
    const dryRunExpectedOutputBindingCheck = missingDryRunExpectedOutputBinding.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture_dry_run_expected_output",
    );
    assert(
      dryRunExpectedOutputBindingCheck,
      "dry-run 未绑定 expected output draft 未命中 readonly_http_fixture_dry_run_expected_output",
    );
    assert(
      String(dryRunExpectedOutputBindingCheck.message ?? "").includes("expected output"),
      `dry-run 未绑定 expected output draft 风险信息不包含 expected output: ${String(
        dryRunExpectedOutputBindingCheck.message ?? "",
      )}`,
    );

    const mismatchedDryRun = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeDryRunMismatch: true },
    );
    assert(
      mismatchedDryRun.verificationStatus === "verification_failed",
      `dry-run actual/expected 不一致 draft 未失败: ${mismatchedDryRun.verificationStatus}`,
    );
    const dryRunExecutionCheck = mismatchedDryRun.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture_dry_run_execute",
    );
    assert(
      dryRunExecutionCheck,
      "dry-run actual/expected 不一致 draft 未命中 readonly_http_fixture_dry_run_execute",
    );
    assert(
      String(dryRunExecutionCheck.message ?? "").includes("dry-run"),
      `dry-run actual/expected 不一致 draft 风险信息不包含 dry-run: ${String(
        dryRunExecutionCheck.message ?? "",
      )}`,
    );

    const networkedDryRun = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeNetworkedDryRun: true },
    );
    assert(
      networkedDryRun.verificationStatus === "verification_failed",
      `真实联网 dry-run draft 未失败: ${networkedDryRun.verificationStatus}`,
    );
    const dryRunOfflineCheck = networkedDryRun.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_fixture_dry_run_offline",
    );
    assert(dryRunOfflineCheck, "真实联网 dry-run draft 未命中 readonly_http_fixture_dry_run_offline");
    assert(
      String(dryRunOfflineCheck.message ?? "").includes("真实联网"),
      `真实联网 dry-run draft 风险信息不包含真实联网: ${String(
        dryRunOfflineCheck.message ?? "",
      )}`,
    );

    const credentialDraft = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeCredentialHeader: true },
    );
    assert(
      credentialDraft.verificationStatus === "verification_failed",
      `凭证字段 draft 未失败: ${credentialDraft.verificationStatus}`,
    );
    const credentialCheck = credentialDraft.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_no_credentials",
    );
    assert(credentialCheck, "凭证字段 draft 未命中 readonly_http_no_credentials");
    assert(
      String(credentialCheck.message ?? "").includes("凭证"),
      `凭证字段 draft 风险信息不包含凭证: ${String(credentialCheck.message ?? "")}`,
    );

    const missingSessionAuthorization = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeSessionAuthorization: false },
    );
    assert(
      missingSessionAuthorization.verificationStatus === "verification_failed",
      `缺 session authorization policy draft 未失败: ${missingSessionAuthorization.verificationStatus}`,
    );
    const sessionAuthorizationCheck = missingSessionAuthorization.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_session_authorization",
    );
    assert(
      sessionAuthorizationCheck,
      "缺 session authorization policy draft 未命中 readonly_http_session_authorization",
    );
    assert(
      String(sessionAuthorizationCheck.message ?? "").includes("authorization") ||
        String(sessionAuthorizationCheck.message ?? "").includes("授权"),
      `缺 session authorization policy draft 风险信息不包含授权: ${String(
        sessionAuthorizationCheck.message ?? "",
      )}`,
    );

    const missingCredentialReference = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeCredentialReference: false },
    );
    assert(
      missingCredentialReference.verificationStatus === "verification_failed",
      `缺 credential_reference draft 未失败: ${missingCredentialReference.verificationStatus}`,
    );
    const credentialReferenceCheck = missingCredentialReference.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_credential_reference",
    );
    assert(
      credentialReferenceCheck,
      "缺 credential_reference draft 未命中 readonly_http_credential_reference",
    );
    assert(
      String(credentialReferenceCheck.message ?? "").includes("credential_reference") ||
        String(credentialReferenceCheck.message ?? "").includes("凭证引用"),
      `缺 credential_reference draft 风险信息不包含凭证引用: ${String(
        credentialReferenceCheck.message ?? "",
      )}`,
    );

    const missingExecutionPreflight = await createAndVerify(
      options,
      workspace.workspaceRoot,
      ["Level 0 只读发现", "允许只读 HTTP API GET 请求，不做外部写操作"],
      { includeExecutionPreflight: false },
    );
    assert(
      missingExecutionPreflight.verificationStatus === "verification_failed",
      `缺 execution_preflight draft 未失败: ${missingExecutionPreflight.verificationStatus}`,
    );
    const executionPreflightCheck = missingExecutionPreflight.failedChecks.find(
      (check) => pickString(check, "id") === "readonly_http_execution_preflight",
    );
    assert(
      executionPreflightCheck,
      "缺 execution_preflight draft 未命中 readonly_http_execution_preflight",
    );
    assert(
      String(executionPreflightCheck.message ?? "").includes("execution_preflight") ||
        String(executionPreflightCheck.message ?? "").includes("preflight"),
      `缺 execution_preflight draft 风险信息不包含 preflight: ${String(
        executionPreflightCheck.message ?? "",
      )}`,
    );

    const summary = {
      status: "passed",
      startedAt,
      finishedAt: new Date().toISOString(),
      workspaceRoot: workspace.workspaceRoot,
      positiveDraftId: positive.draftId,
      positiveVerificationStatus: positive.verificationStatus,
      positiveDryRunExecuteEvidenceKeys,
      positivePreflightEvidenceKeys,
      negativeDraftId: negative.draftId,
      negativeVerificationStatus: negative.verificationStatus,
      negativeFailedCheck: pickString(riskCheck, "id"),
      missingFixtureDraftId: missingFixture.draftId,
      missingFixtureVerificationStatus: missingFixture.verificationStatus,
      missingFixtureFailedCheck: pickString(fixtureCheck, "id"),
      missingExpectedOutputDraftId: missingExpectedOutput.draftId,
      missingExpectedOutputVerificationStatus: missingExpectedOutput.verificationStatus,
      missingExpectedOutputFailedCheck: pickString(expectedOutputCheck, "id"),
      missingFixtureInputDraftId: missingFixtureInput.draftId,
      missingFixtureInputVerificationStatus: missingFixtureInput.verificationStatus,
      missingFixtureInputFailedCheck: pickString(fixtureInputCheck, "id"),
      missingDryRunEntryDraftId: missingDryRunEntry.draftId,
      missingDryRunEntryVerificationStatus: missingDryRunEntry.verificationStatus,
      missingDryRunEntryFailedCheck: pickString(dryRunCheck, "id"),
      missingDryRunExpectedOutputBindingDraftId: missingDryRunExpectedOutputBinding.draftId,
      missingDryRunExpectedOutputBindingVerificationStatus:
        missingDryRunExpectedOutputBinding.verificationStatus,
      missingDryRunExpectedOutputBindingFailedCheck: pickString(
        dryRunExpectedOutputBindingCheck,
        "id",
      ),
      mismatchedDryRunDraftId: mismatchedDryRun.draftId,
      mismatchedDryRunVerificationStatus: mismatchedDryRun.verificationStatus,
      mismatchedDryRunFailedCheck: pickString(dryRunExecutionCheck, "id"),
      networkedDryRunDraftId: networkedDryRun.draftId,
      networkedDryRunVerificationStatus: networkedDryRun.verificationStatus,
      networkedDryRunFailedCheck: pickString(dryRunOfflineCheck, "id"),
      credentialDraftId: credentialDraft.draftId,
      credentialVerificationStatus: credentialDraft.verificationStatus,
      credentialFailedCheck: pickString(credentialCheck, "id"),
      missingSessionAuthorizationDraftId: missingSessionAuthorization.draftId,
      missingSessionAuthorizationVerificationStatus:
        missingSessionAuthorization.verificationStatus,
      missingSessionAuthorizationFailedCheck: pickString(sessionAuthorizationCheck, "id"),
      missingCredentialReferenceDraftId: missingCredentialReference.draftId,
      missingCredentialReferenceVerificationStatus:
        missingCredentialReference.verificationStatus,
      missingCredentialReferenceFailedCheck: pickString(credentialReferenceCheck, "id"),
      missingExecutionPreflightDraftId: missingExecutionPreflight.draftId,
      missingExecutionPreflightVerificationStatus:
        missingExecutionPreflight.verificationStatus,
      missingExecutionPreflightFailedCheck: pickString(executionPreflightCheck, "id"),
      cleanup: options.cleanup && workspace.createdTemp,
    };

    if (options.cleanup && workspace.createdTemp) {
      await fs.rm(workspace.workspaceRoot, { recursive: true, force: true });
    }
    return summary;
  } catch (error) {
    error.workspaceRoot = workspace.workspaceRoot;
    if (options.cleanup && workspace.createdTemp) {
      await fs.rm(workspace.workspaceRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const summary = await runSmoke(options);
    if (options.json) {
      console.log(JSON.stringify(summary));
    } else {
      console.log("[readonly-http-api:p6-smoke] 通过");
      console.log(JSON.stringify(summary, null, 2));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[readonly-http-api:p6-smoke] 失败: ${detail}`);
    if (error?.workspaceRoot) {
      console.error(`[readonly-http-api:p6-smoke] workspaceRoot: ${error.workspaceRoot}`);
    }
    process.exit(1);
  }
}

await main();
