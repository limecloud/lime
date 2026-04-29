import type { SessionFile } from "@/lib/api/session-files";
import {
  normalizeArtifactProtocolPath,
  resolveArtifactProtocolFilePath,
} from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import {
  resolveContentPostIntent,
  resolveContentPostIntentLabel,
  type ContentPostPublishIntent,
} from "../utils/contentPostSkill";
import type { TaskFile } from "../components/TaskFiles";
import { extractFileNameFromPath } from "./workspacePath";

type ContentPostSource =
  | {
      kind: "task_file";
      file: TaskFile;
    }
  | {
      kind: "session_file";
      file: SessionFile;
    }
  | {
      kind: "artifact";
      artifact: Artifact;
    };

export interface SceneAppExecutionContentPostCompanionEntry {
  key: "cover_meta" | "publish_pack";
  label: string;
  pathLabel: string;
}

export interface SceneAppExecutionContentPostEntry {
  key: ContentPostPublishIntent;
  label: string;
  helperText: string;
  pathLabel: string;
  platformLabel?: string;
  readinessLabel: string;
  readinessTone: "default" | "success" | "watch";
  companionEntries: SceneAppExecutionContentPostCompanionEntry[];
  updatedAt: number;
  source: ContentPostSource;
}

interface ContentPostCandidate extends SceneAppExecutionContentPostEntry {
  sourcePriority: number;
}

const CONTENT_POST_ORDER: ContentPostPublishIntent[] = [
  "publish",
  "preview",
  "upload",
];

const CONTENT_POST_SOURCE_PRIORITY: Record<ContentPostSource["kind"], number> =
  {
    task_file: 3,
    artifact: 2,
    session_file: 1,
  };

const CONTENT_POST_COMPANION_DEFINITIONS: Array<{
  key: SceneAppExecutionContentPostCompanionEntry["key"];
  label: string;
  suffix: string;
}> = [
  {
    key: "cover_meta",
    label: "封面信息",
    suffix: ".cover.json",
  },
  {
    key: "publish_pack",
    label: "发布包",
    suffix: ".publish-pack.json",
  },
];

function readTrimmedString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferIntentFromLabel(
  label: string | null,
): ContentPostPublishIntent | null {
  if (!label) {
    return null;
  }

  if (label === "渠道预览稿") {
    return "preview";
  }
  if (label === "上传稿") {
    return "upload";
  }
  if (label === "发布稿") {
    return "publish";
  }

  return null;
}

function resolveContentPostHelperText(
  intent: ContentPostPublishIntent,
  platformLabel?: string,
): string {
  const platformSuffix = platformLabel ? `，面向 ${platformLabel}` : "";

  switch (intent) {
    case "preview":
      return `继续查看渠道预览稿${platformSuffix}，直接复核首屏摘要、排版层级和封面建议。`;
    case "upload":
      return `继续查看上传稿${platformSuffix}，直接复核正文、素材清单和上传前检查。`;
    case "publish":
    default:
      return `继续查看发布稿${platformSuffix}，直接复核标题、摘要、封面文案和发布备注。`;
  }
}

function resolveContentPostBasePath(pathLabel: string): string | null {
  const normalizedPath = normalizeArtifactProtocolPath(pathLabel);
  if (!normalizedPath) {
    return null;
  }

  return normalizedPath.replace(/\.(md|markdown|txt)$/i, "");
}

function resolveContentPostCompanionEntries(params: {
  pathLabel: string;
  knownPaths: Set<string>;
}): SceneAppExecutionContentPostCompanionEntry[] {
  const basePath = resolveContentPostBasePath(params.pathLabel);
  if (!basePath) {
    return [];
  }

  return CONTENT_POST_COMPANION_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    pathLabel: `${basePath}${definition.suffix}`,
  })).filter((entry) => params.knownPaths.has(entry.pathLabel));
}

function resolveContentPostReadiness(params: {
  intent: ContentPostPublishIntent;
  companionEntries: SceneAppExecutionContentPostCompanionEntry[];
}): Pick<
  SceneAppExecutionContentPostEntry,
  "helperText" | "readinessLabel" | "readinessTone"
> {
  if (params.intent === "preview") {
    return {
      helperText: "优先先看首屏、摘要和封面建议，再决定是否进入正式发布整理。",
      readinessLabel: "优先渠道预览",
      readinessTone: "success",
    };
  }

  if (params.intent === "upload") {
    return {
      helperText:
        "优先先看正文、素材清单和上传前检查，再决定是否直接进入平台后台。",
      readinessLabel: "优先上传整理",
      readinessTone: "success",
    };
  }

  const companionKeys = new Set(
    params.companionEntries.map((entry) => entry.key),
  );
  const hasCoverMeta = companionKeys.has("cover_meta");
  const hasPublishPack = companionKeys.has("publish_pack");

  if (hasCoverMeta && hasPublishPack) {
    return {
      helperText:
        "正文、封面信息和发布包都已就绪，当前更适合继续进入正式发布动作。",
      readinessLabel: "可继续发布",
      readinessTone: "success",
    };
  }

  const missingLabels: string[] = [];
  if (!hasCoverMeta) {
    missingLabels.push("封面信息");
  }
  if (!hasPublishPack) {
    missingLabels.push("发布包");
  }

  return {
    helperText: `当前正文已生成，但还缺${missingLabels.join("、")}，更适合先继续整理发布材料。`,
    readinessLabel: `待补${missingLabels.join("、")}`,
    readinessTone: "watch",
  };
}

function resolveIntentFromMetadata(
  metadata?: Record<string, unknown>,
): ContentPostPublishIntent | null {
  const explicitIntent = resolveContentPostIntent(
    readTrimmedString(metadata, "contentPostIntent"),
    readTrimmedString(metadata, "contentPostEntrySource"),
  );
  if (explicitIntent) {
    return explicitIntent;
  }

  return inferIntentFromLabel(readTrimmedString(metadata, "contentPostLabel"));
}

function buildCandidate(params: {
  pathLabel: string;
  metadata?: Record<string, unknown>;
  updatedAt: number;
  source: ContentPostSource;
  knownPaths: Set<string>;
}): ContentPostCandidate | null {
  const normalizedPath = normalizeArtifactProtocolPath(params.pathLabel);
  if (!normalizedPath || !/^content-posts\/.+\.md$/i.test(normalizedPath)) {
    return null;
  }

  const intent = resolveIntentFromMetadata(params.metadata);
  if (!intent) {
    return null;
  }

  const label =
    readTrimmedString(params.metadata, "contentPostLabel") ||
    resolveContentPostIntentLabel(intent);
  const platformLabel =
    readTrimmedString(params.metadata, "contentPostPlatformLabel") || undefined;
  const companionEntries = resolveContentPostCompanionEntries({
    pathLabel: normalizedPath,
    knownPaths: params.knownPaths,
  });
  const readiness = resolveContentPostReadiness({
    intent,
    companionEntries,
  });

  return {
    key: intent,
    label,
    helperText:
      platformLabel && intent !== "publish"
        ? resolveContentPostHelperText(intent, platformLabel)
        : readiness.helperText,
    pathLabel: normalizedPath || extractFileNameFromPath(params.pathLabel),
    platformLabel,
    readinessLabel: readiness.readinessLabel,
    readinessTone: readiness.readinessTone,
    companionEntries,
    updatedAt: params.updatedAt,
    source: params.source,
    sourcePriority: CONTENT_POST_SOURCE_PRIORITY[params.source.kind],
  };
}

function pickBetterCandidate(
  current: ContentPostCandidate | undefined,
  next: ContentPostCandidate,
): ContentPostCandidate {
  if (!current) {
    return next;
  }

  if (next.updatedAt !== current.updatedAt) {
    return next.updatedAt > current.updatedAt ? next : current;
  }

  if (next.sourcePriority !== current.sourcePriority) {
    return next.sourcePriority > current.sourcePriority ? next : current;
  }

  return current;
}

export function buildSceneAppExecutionContentPostEntries(params: {
  taskFiles: TaskFile[];
  sessionFiles: SessionFile[];
  artifacts: Artifact[];
}): SceneAppExecutionContentPostEntry[] {
  const knownPaths = new Set<string>();
  for (const file of params.taskFiles) {
    const normalizedPath = normalizeArtifactProtocolPath(file.name);
    if (normalizedPath) {
      knownPaths.add(normalizedPath);
    }
  }
  for (const file of params.sessionFiles) {
    const normalizedPath = normalizeArtifactProtocolPath(file.name);
    if (normalizedPath) {
      knownPaths.add(normalizedPath);
    }
  }
  for (const artifact of params.artifacts) {
    const normalizedPath = normalizeArtifactProtocolPath(
      resolveArtifactProtocolFilePath(artifact),
    );
    if (normalizedPath) {
      knownPaths.add(normalizedPath);
    }
  }

  const latestByIntent = new Map<
    ContentPostPublishIntent,
    ContentPostCandidate
  >();

  for (const file of params.taskFiles) {
    const candidate = buildCandidate({
      pathLabel: file.name,
      metadata: file.metadata,
      updatedAt: file.updatedAt,
      knownPaths,
      source: {
        kind: "task_file",
        file,
      },
    });
    if (candidate) {
      latestByIntent.set(
        candidate.key,
        pickBetterCandidate(latestByIntent.get(candidate.key), candidate),
      );
    }
  }

  for (const artifact of params.artifacts) {
    const candidate = buildCandidate({
      pathLabel: resolveArtifactProtocolFilePath(artifact),
      metadata: artifact.meta,
      updatedAt: artifact.updatedAt,
      knownPaths,
      source: {
        kind: "artifact",
        artifact,
      },
    });
    if (candidate) {
      latestByIntent.set(
        candidate.key,
        pickBetterCandidate(latestByIntent.get(candidate.key), candidate),
      );
    }
  }

  for (const file of params.sessionFiles) {
    const candidate = buildCandidate({
      pathLabel: file.name,
      metadata: file.metadata,
      updatedAt: file.updatedAt,
      knownPaths,
      source: {
        kind: "session_file",
        file,
      },
    });
    if (candidate) {
      latestByIntent.set(
        candidate.key,
        pickBetterCandidate(latestByIntent.get(candidate.key), candidate),
      );
    }
  }

  return CONTENT_POST_ORDER.map((intent) => latestByIntent.get(intent) ?? null)
    .filter((entry): entry is ContentPostCandidate => Boolean(entry))
    .map(({ sourcePriority: _sourcePriority, ...entry }) => entry);
}
