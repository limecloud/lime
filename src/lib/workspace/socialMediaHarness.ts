/**
 * @file 社媒 harness 语义工具
 * @description 为社媒内容工作台提供阶段、产物与版本链的统一语义映射
 * @module lib/workspace/socialMediaHarness
 */

import type { PlatformType } from "@/components/workspace/document/types";

type SocialMediaPlatform = Exclude<PlatformType, "markdown">;

export type SocialMediaHarnessStage =
  | "briefing"
  | "drafting"
  | "polishing"
  | "adapting"
  | "publish_prep";

export type SocialMediaArtifactType =
  | "brief"
  | "draft"
  | "polished"
  | "platform_variant"
  | "cover_meta"
  | "publish_package"
  | "asset";

export interface SocialMediaArtifactDescriptor {
  artifactId: string;
  artifactType: SocialMediaArtifactType;
  stage: SocialMediaHarnessStage;
  stageLabel: string;
  versionLabel: string;
  sourceFileName: string;
  branchKey: string;
  platform?: SocialMediaPlatform;
  isAuxiliary: boolean;
}

interface ResolveSocialMediaArtifactOptions {
  fileName: string;
  gateKey?: "topic_select" | "write_mode" | "publish_confirm" | "idle";
  runTitle?: string;
}

const PLATFORM_LABELS: Record<Exclude<PlatformType, "markdown">, string> = {
  xiaohongshu: "小红书",
  wechat: "公众号",
  zhihu: "知乎",
};

function isSocialMediaPlatform(value?: PlatformType): value is SocialMediaPlatform {
  return value === "xiaohongshu" || value === "wechat" || value === "zhihu";
}

const GATE_STAGE_MAP: Record<
  NonNullable<ResolveSocialMediaArtifactOptions["gateKey"]>,
  SocialMediaHarnessStage
> = {
  topic_select: "briefing",
  write_mode: "drafting",
  publish_confirm: "publish_prep",
  idle: "drafting",
};

function normalizePath(fileName: string): string {
  return fileName.replace(/\\/g, "/").trim();
}

function getBaseName(fileName: string): string {
  const normalized = normalizePath(fileName);
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function stripKnownSuffix(fileName: string): string {
  return getBaseName(fileName)
    .replace(/\.publish-pack\.json$/i, "")
    .replace(/\.cover\.json$/i, "")
    .replace(/\.[^.]+$/i, "");
}

function toBranchKey(fileName: string): string {
  const normalized = stripKnownSuffix(fileName)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "artifact";
}

function inferPlatformFromText(text: string): SocialMediaPlatform | undefined {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("xiaohongshu") ||
    normalized.includes("xhs") ||
    text.includes("小红书")
  ) {
    return "xiaohongshu";
  }
  if (
    normalized.includes("wechat") ||
    normalized.includes("weixin") ||
    normalized.includes("gzh") ||
    text.includes("公众号") ||
    text.includes("微信")
  ) {
    return "wechat";
  }
  if (normalized.includes("zhihu") || text.includes("知乎")) {
    return "zhihu";
  }
  return undefined;
}

function resolveExplicitArtifactType(
  normalizedFileName: string,
  platform?: SocialMediaPlatform,
): SocialMediaArtifactType | null {
  const baseName = getBaseName(normalizedFileName).toLowerCase();

  if (baseName.endsWith(".publish-pack.json")) {
    return "publish_package";
  }
  if (baseName.endsWith(".cover.json")) {
    return "cover_meta";
  }
  if (!baseName.endsWith(".md")) {
    return "asset";
  }
  if (baseName === "brief.md" || baseName.includes("brief")) {
    return "brief";
  }
  if (baseName === "draft.md" || baseName.includes("draft")) {
    return "draft";
  }
  if (
    baseName === "article.md" ||
    baseName.includes("article") ||
    baseName.includes("final")
  ) {
    return "polished";
  }
  if (baseName === "adapted.md" || baseName.includes("adapt")) {
    return "platform_variant";
  }
  if (platform) {
    return "platform_variant";
  }
  return null;
}

function inferArtifactTypeFromGate(
  gateKey: ResolveSocialMediaArtifactOptions["gateKey"],
  platform?: SocialMediaPlatform,
): SocialMediaArtifactType {
  if (gateKey === "topic_select") {
    return "brief";
  }
  if (gateKey === "publish_confirm") {
    return platform ? "platform_variant" : "polished";
  }
  return "draft";
}

function resolveStageForArtifact(
  artifactType: SocialMediaArtifactType,
  gateKey?: ResolveSocialMediaArtifactOptions["gateKey"],
): SocialMediaHarnessStage {
  switch (artifactType) {
    case "brief":
      return "briefing";
    case "draft":
      return "drafting";
    case "polished":
      return "polishing";
    case "platform_variant":
      return "adapting";
    case "cover_meta":
    case "publish_package":
      return "publish_prep";
    default:
      return GATE_STAGE_MAP[gateKey || "idle"] || "drafting";
  }
}

function resolveStageLabel(stage: SocialMediaHarnessStage): string {
  switch (stage) {
    case "briefing":
      return "需求澄清";
    case "drafting":
      return "初稿创作";
    case "polishing":
      return "润色优化";
    case "adapting":
      return "平台适配";
    case "publish_prep":
      return "发布准备";
    default:
      return "社媒创作";
  }
}

function resolveVersionLabel(
  artifactType: SocialMediaArtifactType,
  platform?: SocialMediaPlatform,
): string {
  switch (artifactType) {
    case "brief":
      return "需求简报";
    case "draft":
      return "社媒初稿";
    case "polished":
      return "润色成稿";
    case "platform_variant":
      return isSocialMediaPlatform(platform)
        ? `平台适配 · ${PLATFORM_LABELS[platform]}`
        : "平台适配";
    case "cover_meta":
      return "封面配置";
    case "publish_package":
      return "发布包";
    default:
      return "社媒产物";
  }
}

export function resolveSocialMediaArtifactDescriptor(
  options: ResolveSocialMediaArtifactOptions,
): SocialMediaArtifactDescriptor {
  const normalizedFileName = normalizePath(options.fileName);
  const platform = inferPlatformFromText(
    `${normalizedFileName} ${options.runTitle || ""}`,
  );
  const artifactType =
    resolveExplicitArtifactType(normalizedFileName, platform) ||
    inferArtifactTypeFromGate(options.gateKey, platform);
  const stage = resolveStageForArtifact(artifactType, options.gateKey);
  const branchKey = toBranchKey(normalizedFileName);
  const artifactSuffix = platform ? `${branchKey}:${platform}` : branchKey;

  return {
    artifactId: `social-media:${artifactType}:${artifactSuffix}`,
    artifactType,
    stage,
    stageLabel: resolveStageLabel(stage),
    versionLabel: resolveVersionLabel(artifactType, platform),
    sourceFileName: normalizedFileName,
    branchKey,
    platform,
    isAuxiliary:
      artifactType === "cover_meta" ||
      artifactType === "publish_package" ||
      artifactType === "asset",
  };
}
