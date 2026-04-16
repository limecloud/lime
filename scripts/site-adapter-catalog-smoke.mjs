#!/usr/bin/env node

import process from "node:process";

const DEFAULTS = {
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 60_000,
  intervalMs: 1_000,
  invokeTimeoutMs: 20_000,
};
const INVOKE_RETRY_COUNT = 3;
const INVOKE_RETRY_DELAY_MS = 1_000;

function printHelp() {
  console.log(`
Lime Site Adapter Catalog Smoke

用途:
  验证站点适配器目录最小主链可用：目录状态、列表、推荐与检索结果可读。

用法:
  node scripts/site-adapter-catalog-smoke.mjs [选项]

选项:
  --health-url <url>       DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>       DevBridge invoke 地址，默认 http://127.0.0.1:3030/invoke
  --timeout-ms <ms>        等待健康检查超时，默认 60000
  --interval-ms <ms>       健康检查轮询间隔，默认 1000
  --invoke-timeout-ms <ms> 单次 invoke 超时，默认 20000
  -h, --help               显示帮助
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--health-url" && argv[index + 1]) {
      options.healthUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--invoke-url" && argv[index + 1]) {
      options.invokeUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && argv[index + 1]) {
      options.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && argv[index + 1]) {
      options.intervalMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--invoke-timeout-ms" && argv[index + 1]) {
      options.invokeTimeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms 必须是 >= 1000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  if (
    !Number.isFinite(options.invokeTimeoutMs) ||
    options.invokeTimeoutMs < 1_000
  ) {
    throw new Error("--invoke-timeout-ms 必须是 >= 1000 的数字");
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

async function waitForHealth(options) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const response = await fetch(options.healthUrl, { method: "GET" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      console.log(
        `[smoke:site-adapters] DevBridge 已就绪 (${Date.now() - startedAt}ms)${
          payload?.status ? ` status=${payload.status}` : ""
        }`,
      );
      return;
    } catch (error) {
      lastError = error;
      await sleep(options.intervalMs);
    }
  }

  const detail =
    lastError instanceof Error
      ? lastError.message
      : String(lastError || "unknown error");
  throw new Error(
    `[smoke:site-adapters] DevBridge 未就绪，请先启动 npm run tauri:dev:headless。最后错误: ${detail}`,
  );
}

async function invoke(options, cmd, args) {
  console.log(`[smoke:site-adapters] invoke ${cmd}`);
  for (let attempt = 1; attempt <= INVOKE_RETRY_COUNT; attempt += 1) {
    let response;
    try {
      response = await fetch(options.invokeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ cmd, args }),
        signal: AbortSignal.timeout(options.invokeTimeoutMs),
      });
    } catch (error) {
      const isTimeout = error?.name === "TimeoutError";
      const isFetchFailed =
        error instanceof TypeError && error.message === "fetch failed";
      if ((isTimeout || isFetchFailed) && attempt < INVOKE_RETRY_COUNT) {
        console.warn(
          `[smoke:site-adapters] ${cmd} 第 ${attempt} 次请求失败，${INVOKE_RETRY_DELAY_MS}ms 后重试: ${
            isTimeout ? "timeout" : error.message
          }`,
        );
        await sleep(INVOKE_RETRY_DELAY_MS);
        continue;
      }
      if (isTimeout) {
        throw new Error(
          `[smoke:site-adapters] ${cmd} 超时，${options.invokeTimeoutMs}ms 内未收到 DevBridge 响应`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      throw new Error(String(payload.error));
    }

    return payload?.result;
  }
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  await waitForHealth(options);

  const status = await invoke(options, "site_get_adapter_catalog_status");
  assert(status && typeof status === "object", "site_get_adapter_catalog_status 返回为空");
  assert(
    typeof status.adapter_count === "number" && status.adapter_count >= 0,
    "site_get_adapter_catalog_status 缺少 adapter_count",
  );
  assert(
    status.source_kind === "bundled" || status.source_kind === "server_synced",
    "site_get_adapter_catalog_status 返回了未知 source_kind",
  );

  const adapters = await invoke(options, "site_list_adapters");
  assert(Array.isArray(adapters), "site_list_adapters 返回不是数组");
  assert(adapters.length > 0, "site_list_adapters 返回为空");

  const adapter = adapters[0];
  assert(
    typeof adapter?.name === "string" && adapter.name.trim(),
    "site_list_adapters 首项缺少 name",
  );
  assert(
    typeof adapter?.domain === "string" && adapter.domain.trim(),
    "site_list_adapters 首项缺少 domain",
  );

  const recommendations = await invoke(options, "site_recommend_adapters", {
    request: {
      limit: 3,
    },
  });
  assert(Array.isArray(recommendations), "site_recommend_adapters 返回不是数组");
  if (recommendations.length > 0) {
    const recommendation = recommendations[0];
    assert(
      typeof recommendation?.adapter?.name === "string" &&
        recommendation.adapter.name.trim(),
      "site_recommend_adapters 首项缺少 adapter.name",
    );
    assert(
      typeof recommendation?.reason === "string" && recommendation.reason.trim(),
      "site_recommend_adapters 首项缺少 reason",
    );
    assert(
      typeof recommendation?.entry_url === "string" &&
        recommendation.entry_url.trim(),
      "site_recommend_adapters 首项缺少 entry_url",
    );
  }

  const searchResults = await invoke(options, "site_search_adapters", {
    request: {
      query: adapter.name,
    },
  });
  assert(Array.isArray(searchResults), "site_search_adapters 返回不是数组");
  assert(
    searchResults.some((item) => item?.name === adapter.name),
    "site_search_adapters 未返回刚刚列出的适配器",
  );

  console.log(
    `[smoke:site-adapters] 通过 adapters=${adapters.length} source=${status.source_kind} recommended=${recommendations.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
