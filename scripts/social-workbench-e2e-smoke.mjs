#!/usr/bin/env node

/**
 * 主题工作台社媒链路联调脚本
 *
 * 用法示例：
 *   node scripts/social-workbench-e2e-smoke.mjs --session-id <session_id>
 *   node scripts/social-workbench-e2e-smoke.mjs --session-id <session_id> --content-id <content_id>
 *
 * 前置条件：
 *   1. Lime 已运行（Dev Bridge: http://127.0.0.1:3030/invoke）
 *   2. 该 session 已在 UI 中实际触发过社媒生成
 */

const BRIDGE_URL = "http://127.0.0.1:3030/invoke";

function printUsage() {
  console.log(`
用法:
  node scripts/social-workbench-e2e-smoke.mjs --session-id <id> [--content-id <id>] [--expected-provider <id>] [--expected-model <id>] [--timeout-ms <ms>] [--interval-ms <ms>]

参数:
  --session-id   必填，会话 ID
  --content-id   可选，文稿 ID（用于校验版本状态）
  --expected-provider 可选，期望命中的 provider（校验 run metadata 中的 requested_provider / provider_override）
  --expected-model 可选，期望命中的模型（校验 run metadata 中的 requested_model / model_override）
  --timeout-ms   可选，等待终态超时（默认 60000）
  --interval-ms  可选，轮询间隔（默认 1000）
  --help         显示帮助
`);
}

function parseArgs(argv) {
  const result = {
    sessionId: "",
    contentId: "",
    expectedProvider: "",
    expectedModel: "",
    timeoutMs: 60_000,
    intervalMs: 1_000,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    if (token === "--session-id") {
      result.sessionId = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--content-id") {
      result.contentId = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--expected-provider") {
      result.expectedProvider = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--expected-model") {
      result.expectedModel = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        result.timeoutMs = value;
      }
      i += 1;
      continue;
    }
    if (token === "--interval-ms") {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        result.intervalMs = value;
      }
      i += 1;
    }
  }

  return result;
}

async function invoke(cmd, args) {
  const response = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ cmd, args }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(String(payload.error));
  }

  return payload.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseRunMetadata(raw) {
  if (!raw) {
    return null;
  }
  if (typeof raw === "object") {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function pickMetadataString(metadata, keys) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = normalizeNonEmptyString(metadata[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function pickArtifactPaths(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const paths = metadata.artifact_paths;
  if (!Array.isArray(paths)) {
    return [];
  }
  return paths.filter((item) => typeof item === "string" && item.trim());
}

function pickPathBySuffix(paths, suffix) {
  return paths.find((item) => item.toLowerCase().endsWith(suffix)) || "";
}

async function waitTerminalState(sessionId, timeoutMs, intervalMs) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await invoke("execution_run_get_theme_workbench_state", {
      sessionId,
      limit: 10,
    });
    latest = state;

    const terminal = state?.latest_terminal;
    if (terminal && state?.run_state !== "auto_running") {
      return state;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `等待主题工作台终态超时（${timeoutMs}ms），最后状态: ${JSON.stringify(latest)}`,
  );
}

async function verifySessionArtifacts(sessionId, artifactPaths) {
  const files = await invoke("session_files_list_files", { sessionId });
  const fileNames = Array.isArray(files)
    ? files.map((item) => item?.name).filter((item) => typeof item === "string")
    : [];

  const missing = artifactPaths.filter((path) => !fileNames.includes(path));
  assert(
    missing.length === 0,
    `会话文件缺失产物: ${missing.join(", ")}`,
  );

  const articlePath = pickPathBySuffix(artifactPaths, ".md");
  const coverPath = pickPathBySuffix(artifactPaths, ".cover.json");
  const publishPackPath = pickPathBySuffix(artifactPaths, ".publish-pack.json");

  assert(articlePath, "缺少主稿路径（*.md）");
  assert(coverPath, "缺少封面元数据路径（*.cover.json）");
  assert(publishPackPath, "缺少发布包路径（*.publish-pack.json）");

  const articleContent = await invoke("session_files_read_file", {
    sessionId,
    fileName: articlePath,
  });
  assert(typeof articleContent === "string", "主稿内容读取失败");
  assert(articleContent.includes("![封面图]("), "主稿缺少封面图占位/链接");
  assert(articleContent.includes("## 配图说明"), "主稿缺少配图说明章节");

  const coverContent = await invoke("session_files_read_file", {
    sessionId,
    fileName: coverPath,
  });
  const coverJson = JSON.parse(String(coverContent));
  assert(typeof coverJson.cover_url === "string", "cover.json 缺少 cover_url");
  assert(typeof coverJson.status === "string", "cover.json 缺少 status");

  const publishPackContent = await invoke("session_files_read_file", {
    sessionId,
    fileName: publishPackPath,
  });
  const publishPackJson = JSON.parse(String(publishPackContent));
  assert(
    publishPackJson.article_path === articlePath,
    "publish-pack.json article_path 与主稿路径不一致",
  );
  assert(
    publishPackJson.cover_meta_path === coverPath,
    "publish-pack.json cover_meta_path 与封面元数据路径不一致",
  );

  return {
    articlePath,
    coverPath,
    publishPackPath,
  };
}

async function verifyContentVersionState(contentId, expectedRunId, timeoutMs, intervalMs) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await invoke("content_get_theme_workbench_document_state", {
      id: contentId,
    });
    latest = state;

    if (state && Array.isArray(state.versions)) {
      const matched = state.versions.find((item) => item?.id === expectedRunId);
      if (matched) {
        return {
          currentVersionId: state.current_version_id,
          matchedStatus: matched.status || null,
        };
      }
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `未在文稿版本状态中找到 run_id=${expectedRunId}，最后状态: ${JSON.stringify(latest)}`,
  );
}

function verifyRunModelSelection(metadata, expectedProvider, expectedModel) {
  const requestedProvider = pickMetadataString(metadata, [
    "requested_provider",
    "provider_override",
    "provider_id",
    "provider",
  ]);
  const requestedModel = pickMetadataString(metadata, [
    "requested_model",
    "model_override",
    "model_name",
    "model",
  ]);
  const resolvedProvider = pickMetadataString(metadata, [
    "resolved_provider",
    "runtime_provider",
    "provider_name",
  ]);
  const resolvedModel = pickMetadataString(metadata, [
    "resolved_model",
    "runtime_model",
  ]);

  if (expectedProvider) {
    assert(
      requestedProvider === expectedProvider,
      `Provider 不匹配: expected=${expectedProvider}, actual_requested=${requestedProvider || "<empty>"}, actual_resolved=${resolvedProvider || "<empty>"}`,
    );
  }

  if (expectedModel) {
    assert(
      requestedModel === expectedModel,
      `模型不匹配: expected=${expectedModel}, actual_requested=${requestedModel || "<empty>"}, actual_resolved=${resolvedModel || "<empty>"}`,
    );
  }

  return {
    requestedProvider,
    requestedModel,
    resolvedProvider,
    resolvedModel,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.sessionId) {
    printUsage();
    throw new Error("缺少必填参数 --session-id");
  }

  console.log(`[Smoke] 开始校验 session: ${args.sessionId}`);

  const diagnostics = await invoke("get_server_diagnostics");
  assert(
    diagnostics && typeof diagnostics.running === "boolean",
    "get_server_diagnostics 返回格式异常",
  );
  console.log("[Smoke] Dev Bridge 可用");

  const runState = await waitTerminalState(
    args.sessionId,
    args.timeoutMs,
    args.intervalMs,
  );
  const terminal = runState.latest_terminal;
  assert(terminal, "未获取到 latest_terminal");
  console.log(
    `[Smoke] 终态: status=${terminal.status}, run_id=${terminal.run_id}, gate=${terminal.gate_key}`,
  );

  const runDetail = await invoke("execution_run_get", {
    runId: terminal.run_id,
  });
  assert(runDetail, "execution_run_get 返回为空");

  const metadata = parseRunMetadata(runDetail.metadata);
  assert(metadata, "运行 metadata 为空或不可解析");
  assert(
    metadata.workflow === "social_content_pipeline_v1",
    `workflow 不匹配: ${metadata.workflow}`,
  );

  const modelSelection = verifyRunModelSelection(
    metadata,
    args.expectedProvider,
    args.expectedModel,
  );
  console.log(
    `[Smoke] 模型轨迹: requested=${modelSelection.requestedProvider || "<empty>"} / ${modelSelection.requestedModel || "<empty>"}, resolved=${modelSelection.resolvedProvider || "<empty>"} / ${modelSelection.resolvedModel || "<empty>"}`,
  );

  const stages = Array.isArray(metadata.stages) ? metadata.stages : [];
  assert(stages.length >= 3, `stages 不完整: ${JSON.stringify(stages)}`);
  assert(stages.includes("topic_select"), "stages 缺少 topic_select");
  assert(stages.includes("write_mode"), "stages 缺少 write_mode");
  assert(stages.includes("publish_confirm"), "stages 缺少 publish_confirm");

  const artifactPaths = pickArtifactPaths(metadata);
  assert(
    artifactPaths.length >= 3,
    `artifact_paths 不完整: ${JSON.stringify(artifactPaths)}`,
  );
  console.log("[Smoke] 产物路径:", artifactPaths.join(", "));

  const artifactSummary = await verifySessionArtifacts(args.sessionId, artifactPaths);
  console.log(
    `[Smoke] 会话产物校验通过: ${artifactSummary.articlePath}, ${artifactSummary.coverPath}, ${artifactSummary.publishPackPath}`,
  );

  if (args.contentId) {
    const contentVersion = await verifyContentVersionState(
      args.contentId,
      terminal.run_id,
      args.timeoutMs,
      args.intervalMs,
    );
    console.log(
      `[Smoke] 文稿版本校验通过: current=${contentVersion.currentVersionId}, status=${contentVersion.matchedStatus || "unknown"}`,
    );
  } else {
    console.log("[Smoke] 跳过文稿版本校验（未提供 --content-id）");
  }

  console.log("[Smoke] ✅ 主题工作台社媒链路校验通过");
}

main().catch((error) => {
  console.error("[Smoke] ❌ 校验失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
