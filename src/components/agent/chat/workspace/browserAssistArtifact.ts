import type { Artifact } from "@/lib/artifact/types";
import { mergeArtifacts } from "../utils/messageArtifacts";

export const GENERAL_BROWSER_ASSIST_ARTIFACT_ID = "browser-assist:general";

function shouldPreserveGeneralArtifact(artifact: Artifact): boolean {
  return artifact.meta.persistOutsideMessages === true;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readFirstString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return undefined;
}

export function resolveBrowserAssistArtifactScopeKey(
  artifact: Pick<Artifact, "type" | "meta"> | null | undefined,
): string | null {
  if (!artifact || artifact.type !== "browser_assist") {
    return null;
  }

  const meta = asRecord(artifact.meta);
  return (
    readFirstString(meta ? [meta] : [], [
      "browserAssistScopeKey",
      "browser_assist_scope_key",
    ]) || null
  );
}

export function buildBrowserAssistArtifact(params: {
  scopeKey: string;
  profileKey: string;
  browserSessionId: string;
  url: string;
  title?: string;
  targetId?: string;
  transportKind?: string;
  lifecycleState?: string;
  controlMode?: string;
}): Artifact {
  const now = Date.now();

  return {
    id: GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
    type: "browser_assist",
    title: params.title?.trim() || "浏览器协助",
    content: "",
    status: "complete",
    error: undefined,
    meta: {
      persistOutsideMessages: true,
      browserAssistScopeKey: params.scopeKey,
      profileKey: params.profileKey,
      sessionId: params.browserSessionId,
      url: params.url,
      launchState: "ready",
      launchHint: undefined,
      launchError: undefined,
      ...(params.targetId ? { targetId: params.targetId } : {}),
      ...(params.transportKind ? { transportKind: params.transportKind } : {}),
      ...(params.lifecycleState
        ? { lifecycleState: params.lifecycleState }
        : {}),
      ...(params.controlMode ? { controlMode: params.controlMode } : {}),
    },
    position: { start: 0, end: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export function buildPendingBrowserAssistArtifact(params: {
  scopeKey: string;
  profileKey: string;
  url: string;
  title?: string;
}): Artifact {
  const now = Date.now();

  return {
    id: GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
    type: "browser_assist",
    title: params.title?.trim() || "浏览器协助",
    content: "",
    status: "pending",
    error: undefined,
    meta: {
      persistOutsideMessages: true,
      browserAssistScopeKey: params.scopeKey,
      profileKey: params.profileKey,
      url: params.url,
      launchState: "launching",
      launchHint:
        "正在启动 Chrome、连接调试通道并等待首帧画面，通常需要 3–8 秒。",
      launchError: undefined,
    },
    position: { start: 0, end: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export function buildFailedBrowserAssistArtifact(params: {
  scopeKey: string;
  profileKey: string;
  url: string;
  title?: string;
  error: string;
}): Artifact {
  const now = Date.now();

  return {
    id: GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
    type: "browser_assist",
    title: params.title?.trim() || "浏览器协助",
    content: "",
    status: "error",
    error: params.error,
    meta: {
      persistOutsideMessages: true,
      browserAssistScopeKey: params.scopeKey,
      profileKey: params.profileKey,
      url: params.url,
      launchState: "failed",
      launchHint: undefined,
      launchError: params.error,
    },
    position: { start: 0, end: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeMessageArtifactsIntoStore(
  messageArtifacts: Artifact[],
  currentArtifacts: Artifact[],
  browserAssistScopeKey: string | null,
): Artifact[] {
  const preservedArtifacts = currentArtifacts.filter(
    (artifact) =>
      shouldPreserveGeneralArtifact(artifact) &&
      (artifact.type !== "browser_assist" ||
        resolveBrowserAssistArtifactScopeKey(artifact) ===
          browserAssistScopeKey),
  );

  if (messageArtifacts.length === 0) {
    return mergeArtifacts(preservedArtifacts);
  }

  const currentArtifactsById = new Map(
    currentArtifacts.map((artifact) => [artifact.id, artifact]),
  );

  return mergeArtifacts([
    ...messageArtifacts.map((artifact) => {
      const existing = currentArtifactsById.get(artifact.id);
      if (!existing) {
        return artifact;
      }

      const shouldReuseExistingContent =
        existing.content.length > 0 &&
        (artifact.content.length === 0 ||
          (artifact.status === "streaming" &&
            artifact.content.length < existing.content.length &&
            existing.content.startsWith(artifact.content)));

      return {
        ...existing,
        ...artifact,
        content: shouldReuseExistingContent
          ? existing.content
          : artifact.content,
        meta: {
          ...existing.meta,
          ...artifact.meta,
        },
        createdAt: Math.min(existing.createdAt, artifact.createdAt),
        updatedAt: Math.max(existing.updatedAt, artifact.updatedAt),
      };
    }),
    ...preservedArtifacts,
  ]);
}
