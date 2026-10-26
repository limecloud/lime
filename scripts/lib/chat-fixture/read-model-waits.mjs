import {
  APP_SERVER_METHOD_SESSION_READ,
  ASSISTANT_DONE_TEXT,
  RECOVERY_PROMPT,
} from "./constants.mjs";
import { invokeAppServerFromPage } from "./rpc.mjs";
import { readModelLatestTurnStatus } from "./read-model-core.mjs";
import { sanitizeJson, sleep } from "./utils.mjs";

function requireThreadId(options, explicitThreadId) {
  const threadId = explicitThreadId?.trim() || options.threadId?.trim();
  if (!threadId) {
    throw new Error("聊天夹具 缺少 canonical threadId");
  }
  return threadId;
}

export async function waitForSessionReadCompleted(
  page,
  options,
  requestLog,
  {
    threadId,
    prompt = RECOVERY_PROMPT,
    doneText = ASSISTANT_DONE_TEXT,
    summaryText = "会话恢复测试正在运行",
  } = {},
) {
  const canonicalThreadId = requireThreadId(options, threadId);
  const startedAt = Date.now();
  let lastRead = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const read = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_SESSION_READ,
      {
        threadId: canonicalThreadId,
        includeTurns: true,
      },
      requestLog,
    );
    lastRead = read.result;
    const serialized = JSON.stringify(read.result || {});
    if (
      readModelLatestTurnStatus(read.result) === "completed" &&
      serialized.includes(prompt) &&
      (serialized.includes(doneText) || serialized.includes(summaryText))
    ) {
      return read.result;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `App Server read model 未完成输入闭环: ${JSON.stringify(
      sanitizeJson(lastRead),
    )}`,
  );
}

export async function waitForSessionReadCanceled(
  page,
  options,
  requestLog,
  {
    threadId,
    prompt = RECOVERY_PROMPT,
    partialText = "",
    requireContent = true,
  } = {},
) {
  const canonicalThreadId = requireThreadId(options, threadId);
  const startedAt = Date.now();
  let lastRead = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const read = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_SESSION_READ,
      {
        threadId: canonicalThreadId,
        includeTurns: true,
      },
      requestLog,
    );
    lastRead = read.result;
    const latestTurnStatus = readModelLatestTurnStatus(read.result);
    const serialized = JSON.stringify(read.result || {});
    if (
      latestTurnStatus === "interrupted" &&
      (!requireContent ||
        (serialized.includes(prompt) &&
          (!partialText || serialized.includes(partialText))))
    ) {
      return read.result;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `App Server read model 未完成取消闭环: ${JSON.stringify(
      sanitizeJson(lastRead),
    )}`,
  );
}
