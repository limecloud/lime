import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";

export type ServiceSkillRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceled"
  | "timeout";

export interface ServiceSkillRun {
  id: string;
  tenantId?: string;
  userId?: string;
  runType?: "scene" | "service_skill";
  sceneId?: string;
  sceneTemplateId?: string;
  releaseId?: string;
  serviceSkillId?: string;
  serviceSkillKey?: string;
  executorKind?: string;
  status: ServiceSkillRunStatus;
  inputSummary?: string;
  outputSummary?: string;
  outputText?: string;
  errorCode?: string;
  errorMessage?: string;
  billingServiceKey?: string;
  fallbackApplied?: boolean;
  fallbackKind?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SceneRunResponseEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseServiceSkillRun(value: unknown): ServiceSkillRun | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeText(value.id);
  const status = normalizeText(value.status) as
    | ServiceSkillRunStatus
    | undefined;
  if (!id || !status) {
    return null;
  }

  return {
    id,
    tenantId: normalizeText(value.tenantId),
    userId: normalizeText(value.userId),
    runType: normalizeText(value.runType) as
      | ServiceSkillRun["runType"]
      | undefined,
    sceneId: normalizeText(value.sceneId),
    sceneTemplateId: normalizeText(value.sceneTemplateId),
    releaseId: normalizeText(value.releaseId),
    serviceSkillId: normalizeText(value.serviceSkillId),
    serviceSkillKey: normalizeText(value.serviceSkillKey),
    executorKind: normalizeText(value.executorKind),
    status,
    inputSummary: normalizeText(value.inputSummary),
    outputSummary: normalizeText(value.outputSummary),
    outputText: normalizeText(value.outputText),
    errorCode: normalizeText(value.errorCode),
    errorMessage: normalizeText(value.errorMessage),
    billingServiceKey: normalizeText(value.billingServiceKey),
    fallbackApplied:
      typeof value.fallbackApplied === "boolean"
        ? value.fallbackApplied
        : undefined,
    fallbackKind: normalizeText(value.fallbackKind),
    startedAt: normalizeText(value.startedAt),
    finishedAt: normalizeText(value.finishedAt),
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
  };
}

async function requestSceneEnvelope<T>(
  path: string,
  init?: globalThis.RequestInit,
): Promise<T> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    throw new Error("缺少 OEM 云端配置，请先注入 base_url 与 tenant_id。");
  }
  if (!hasOemCloudSession(runtime)) {
    throw new Error("缺少 OEM 云端 Session Token，请先完成登录或注入会话。");
  }

  const response = await fetch(`${runtime.sceneBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${runtime.sessionToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  let payload: SceneRunResponseEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as SceneRunResponseEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.message?.trim() || `请求失败 (${response.status})`,
    );
  }

  if (
    !payload ||
    (payload.code !== undefined && payload.code >= 400) ||
    payload.data === undefined
  ) {
    throw new Error(payload?.message?.trim() || "响应格式非法");
  }

  return payload.data;
}

export async function createServiceSkillRun(
  serviceSkillId: string,
  input: string,
): Promise<ServiceSkillRun> {
  const normalizedSkillId = serviceSkillId.trim();
  if (!normalizedSkillId) {
    throw new Error("service skill id 不能为空");
  }

  const normalizedInput = input.trim();
  if (!normalizedInput) {
    throw new Error("运行输入不能为空");
  }

  const run = parseServiceSkillRun(
    await requestSceneEnvelope<unknown>(
      `/v1/service-skills/${encodeURIComponent(normalizedSkillId)}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          input: normalizedInput,
        }),
      },
    ),
  );

  if (!run) {
    throw new Error("服务端返回的运行记录格式非法");
  }

  return run;
}

export async function getServiceSkillRun(
  runId: string,
): Promise<ServiceSkillRun> {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    throw new Error("run id 不能为空");
  }

  const run = parseServiceSkillRun(
    await requestSceneEnvelope<unknown>(
      `/v1/service-skills/runs/${encodeURIComponent(normalizedRunId)}`,
      {
        method: "GET",
      },
    ),
  );

  if (!run) {
    throw new Error("服务端返回的运行记录格式非法");
  }

  return run;
}

export function isTerminalServiceSkillRunStatus(
  status: ServiceSkillRunStatus,
): boolean {
  return (
    status === "success" ||
    status === "failed" ||
    status === "canceled" ||
    status === "timeout"
  );
}
