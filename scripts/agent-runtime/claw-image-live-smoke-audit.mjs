import fs from "node:fs";
import path from "node:path";
import {
  APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_GET,
  APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_LIST,
  APP_SERVER_METHOD_SESSION_READ,
  APP_SERVER_METHOD_WORKFLOW_READ,
} from "../lib/chat-fixture/constants.mjs";
import { invokeAppServerFromPage } from "../lib/chat-fixture/rpc.mjs";
import { sanitizeJson, sleep } from "../lib/chat-fixture/utils.mjs";
import { normalizedString } from "./claw-image-live-smoke-common.mjs";
import { IMAGE_WORKFLOW_KEY } from "./claw-image-live-smoke-options.mjs";

function taskPayload(task) {
  const record =
    task?.record && typeof task.record === "object" ? task.record : task;
  return record?.payload && typeof record.payload === "object"
    ? record.payload
    : {};
}

function taskId(task) {
  const record =
    task?.record && typeof task.record === "object" ? task.record : task;
  return normalizedString(
    task?.taskId || task?.task_id || record?.task_id || record?.taskId,
  );
}

function taskPath(task) {
  const record =
    task?.record && typeof task.record === "object" ? task.record : task;
  return normalizedString(
    task?.taskPath ||
      task?.task_path ||
      task?.path ||
      record?.path ||
      record?.task_path,
  );
}

function taskStatus(task) {
  const record =
    task?.record && typeof task.record === "object" ? task.record : task;
  return normalizedString(
    record?.normalized_status ||
      record?.normalizedStatus ||
      record?.status ||
      task?.normalized_status ||
      task?.status,
  );
}

function taskMatchesPrompt(task, prompt, sessionId) {
  const payload = taskPayload(task);
  const rawText = normalizedString(payload.raw_text || payload.rawText);
  const payloadSessionId = normalizedString(
    payload.session_id || payload.sessionId,
  );
  return (
    rawText === prompt &&
    (!sessionId || !payloadSessionId || payloadSessionId === sessionId)
  );
}

function collectStringMatches(value, patterns) {
  const matches = new Set();
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const matched = normalizedString(match[1]);
      if (matched) {
        matches.add(matched);
      }
    }
  }
  return Array.from(matches).slice(0, 20);
}

async function readSessionDiagnostics(page, sessionId, prompt, turnId) {
  if (!sessionId) {
    return null;
  }
  const read = await invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_SESSION_READ,
    { threadId: sessionId, includeTurns: true },
    null,
  );
  const serialized = JSON.stringify(read.result ?? {});
  const thread = read.result?.thread;
  const turn = thread?.turns?.find((entry) => entry.id === turnId);
  return sanitizeJson({
    hasThread: thread?.id === sessionId,
    turn: turn
      ? {
          id: turn.id,
          status: turn.status,
          itemTypes: turn.items.map((item) => item.type),
        }
      : null,
    includesPrompt: prompt ? serialized.includes(prompt) : false,
    includesImageTaskCreateFailed: serialized.includes(
      "image_task.create_failed",
    ),
    includesToolFailed: serialized.includes("tool.failed"),
    includesWorkflowKey: serialized.includes(IMAGE_WORKFLOW_KEY),
    includesRawTaskPath: serialized.includes(".lime/tasks"),
    includesTemplateTaskId: serialized.includes("{task_id}"),
    reasonCodes: collectStringMatches(serialized, [
      /"reasonCode"\s*:\s*"([^"]+)"/g,
      /"reason_code"\s*:\s*"([^"]+)"/g,
      /"failureCategory"\s*:\s*"([^"]+)"/g,
      /"failure_category"\s*:\s*"([^"]+)"/g,
    ]),
    userVisibleErrors: collectStringMatches(serialized, [
      /((?:执行失败|生成失败|创建失败|图片生成缺少|模型未输出最终答复)[^"\\n]{0,160})/g,
    ]),
  });
}

export async function waitForLiveImageTask(
  page,
  options,
  workspace,
  prompt,
  sessionId,
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const listResult = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_LIST,
      {
        projectRootPath: workspace.rootPath,
        taskType: "image_generate",
        limit: 50,
      },
      null,
    );
    const tasks = Array.isArray(listResult?.result?.tasks)
      ? listResult.result.tasks
      : [];
    const matched = tasks.find((task) =>
      taskMatchesPrompt(task, prompt, sessionId),
    );
    lastSnapshot = sanitizeJson({
      taskCount: tasks.length,
      matchedTaskId: taskId(matched),
      prompt,
      sessionId,
      taskIds: tasks.map(taskId).filter(Boolean),
    });
    if (matched) {
      return sanitizeJson({
        taskId: taskId(matched),
        taskPath: taskPath(matched),
        status: taskStatus(matched),
        payload: {
          providerId:
            taskPayload(matched).provider_id ?? taskPayload(matched).providerId,
          model: taskPayload(matched).model,
          entrySource:
            taskPayload(matched).entry_source ??
            taskPayload(matched).entrySource,
          sessionId:
            taskPayload(matched).session_id ?? taskPayload(matched).sessionId,
          turnId: taskPayload(matched).turn_id ?? taskPayload(matched).turnId,
        },
        raw: matched,
      });
    }
    await sleep(options.intervalMs);
  }
  const sessionDiagnostics = await readSessionDiagnostics(
    page,
    sessionId,
    prompt,
  ).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  throw new Error(
    `未找到 live @配图 task artifact: ${JSON.stringify({
      ...lastSnapshot,
      sessionDiagnostics,
    })}`,
  );
}

export async function waitForLiveImageTaskTerminal(
  page,
  options,
  workspace,
  taskRef,
) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const getResult = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_GET,
      {
        projectRootPath: workspace.rootPath,
        taskRef: taskRef.taskId,
      },
      null,
    );
    const record =
      getResult.result?.record && typeof getResult.result.record === "object"
        ? getResult.result.record
        : getResult.result;
    const images = Array.isArray(record?.result?.images)
      ? record.result.images
      : [];
    const attempts = Array.isArray(record?.attempts) ? record.attempts : [];
    const latestAttempt = attempts.at(-1) ?? null;
    lastSnapshot = sanitizeJson({
      taskId: taskRef.taskId,
      status: normalizedString(record?.status),
      normalizedStatus: normalizedString(record?.normalized_status),
      imageCount: images.length,
      attemptCount: attempts.length,
      latestAttemptStatus: latestAttempt?.status ?? null,
      latestAttemptLogsRef: latestAttempt?.logs_ref ?? null,
      taskPath: taskPath(getResult.result) || taskRef.taskPath,
    });
    if (
      lastSnapshot.normalizedStatus === "succeeded" &&
      lastSnapshot.imageCount > 0
    ) {
      return lastSnapshot;
    }
    if (
      ["failed", "cancelled", "canceled"].includes(
        lastSnapshot.normalizedStatus,
      )
    ) {
      throw new Error(
        `live image task 进入失败终态: ${JSON.stringify(lastSnapshot)}`,
      );
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `live image task 未进入成功终态: ${JSON.stringify(lastSnapshot)}`,
  );
}

export function summarizeTaskAuditLog(workspace, taskTerminal) {
  const taskFileRef = normalizedString(taskTerminal.taskPath);
  const taskFile = path.isAbsolute(taskFileRef)
    ? taskFileRef
    : taskFileRef
      ? path.join(workspace.rootPath, taskFileRef)
      : "";
  if (!taskFile || !fs.existsSync(taskFile)) {
    return {
      taskFile: taskFileRef,
      exists: false,
      logExists: false,
    };
  }
  const record = JSON.parse(fs.readFileSync(taskFile, "utf8"));
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  const latestAttempt = attempts.at(-1) ?? null;
  const logsRef = normalizedString(
    latestAttempt?.logs_ref || latestAttempt?.logsRef,
  );
  const logsPath = path.isAbsolute(logsRef)
    ? logsRef
    : logsRef
      ? path.join(workspace.rootPath, logsRef)
      : "";
  const rawLog =
    logsPath && fs.existsSync(logsPath)
      ? fs.readFileSync(logsPath, "utf8")
      : "";
  const events = rawLog
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const rawLower = rawLog.toLowerCase();
  return sanitizeJson({
    taskFile: taskFileRef,
    exists: true,
    logsRef,
    logsPath,
    logExists: Boolean(rawLog),
    lineCount: events.length,
    eventNames: events.map((event) => event.event).filter(Boolean),
    hasWorkerLoaded: events.some((event) => event.event === "worker_loaded"),
    hasTaskSucceeded: events.some((event) => event.event === "task_succeeded"),
    hasNoSensitiveTokens:
      !rawLower.includes("sk-") &&
      !rawLower.includes("authorization") &&
      !rawLower.includes("bearer "),
  });
}

function workflowRunId(run) {
  return normalizedString(run?.workflowRunId || run?.workflow_run_id);
}

function workflowStepId(step) {
  return normalizedString(step?.stepId || step?.step_id);
}

export async function readWorkflowAudit(page, sessionId, turnId, taskId) {
  const workflowRead = await invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_WORKFLOW_READ,
    { sessionId },
    null,
  );
  const result = workflowRead.result ?? {};
  const workflow = result.workflow ?? {};
  const workflowRuns = Array.isArray(result.workflowRuns)
    ? result.workflowRuns
    : Array.isArray(result.workflow_runs)
      ? result.workflow_runs
      : Array.isArray(workflow.workflowRuns)
        ? workflow.workflowRuns
        : [];
  const workflowSteps = Array.isArray(result.workflowSteps)
    ? result.workflowSteps
    : Array.isArray(result.workflow_steps)
      ? result.workflow_steps
      : Array.isArray(workflow.workflowSteps)
        ? workflow.workflowSteps
        : [];
  const expectedRunId = turnId ? `image-command-run-${turnId}` : "";
  const matchedRun =
    workflowRuns.find((run) => workflowRunId(run) === expectedRunId) ||
    workflowRuns.find(
      (run) =>
        normalizedString(run.workflowKey || run.workflow_key) ===
        IMAGE_WORKFLOW_KEY,
    ) ||
    null;
  const matchedRunId = workflowRunId(matchedRun);
  const matchedSteps = workflowSteps.filter(
    (step) =>
      normalizedString(step.workflowRunId || step.workflow_run_id) ===
      matchedRunId,
  );
  const serialized = JSON.stringify(result);
  return sanitizeJson({
    sessionId,
    turnId,
    taskId,
    runCount: workflowRuns.length,
    stepCount: workflowSteps.length,
    expectedRunId,
    matchedRun: matchedRun
      ? {
          workflowRunId: matchedRunId,
          workflowKey: normalizedString(
            matchedRun.workflowKey || matchedRun.workflow_key,
          ),
          status: normalizedString(matchedRun.status),
          taskId: normalizedString(matchedRun.taskId || matchedRun.task_id),
          turnId: normalizedString(matchedRun.turnId || matchedRun.turn_id),
        }
      : null,
    matchedStepIds: matchedSteps.map(workflowStepId).filter(Boolean),
    containsPrompt:
      serialized.includes("@配图") || serialized.includes("画一张"),
    containsTaskPath: serialized.includes(".lime/tasks"),
    taskIdMatches:
      Boolean(taskId) &&
      normalizedString(matchedRun?.taskId || matchedRun?.task_id) === taskId,
  });
}

export async function readSessionSummary(page, sessionId, prompt, turnId) {
  const diagnostics = await readSessionDiagnostics(
    page,
    sessionId,
    prompt,
    turnId,
  );
  return sanitizeJson(diagnostics);
}
