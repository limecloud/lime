import {
  createImageLayer,
  createLayeredDesignDocument,
  createShapeLayer,
  createTextLayer,
} from "./document";
import type {
  GeneratedDesignAsset,
  LayeredDesignDocument,
  TextLayer,
} from "./types";

export interface CreateLayeredDesignSeedDocumentParams {
  prompt: string;
  id?: string;
  title?: string;
  createdAt?: string;
}

const DEFAULT_CANVAS_WIDTH = 1080;
const DEFAULT_CANVAS_HEIGHT = 1440;

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function createSlug(value: string): string {
  const asciiSlug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  if (asciiSlug) {
    return asciiSlug;
  }

  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `design-${hash.toString(16)}`;
}

function inferTitle(prompt: string): string {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return "AI 图层化设计";
  }

  return normalized.replace(/^(@海报|@配图|@poster)\s*/i, "").slice(0, 36);
}

function createSeedAsset(params: {
  id: string;
  kind: GeneratedDesignAsset["kind"];
  prompt: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  createdAt: string;
}): GeneratedDesignAsset {
  return {
    id: params.id,
    kind: params.kind,
    src: "",
    width: params.width,
    height: params.height,
    hasAlpha: params.hasAlpha,
    prompt: params.prompt,
    params: {
      plannedOnly: true,
    },
    createdAt: params.createdAt,
  };
}

function createHeadlineText(title: string): TextLayer {
  return createTextLayer({
    id: "headline-text",
    name: "主标题",
    type: "text",
    text: title,
    x: 120,
    y: 132,
    width: 840,
    height: 128,
    fontSize: 58,
    color: "#f8fafc",
    align: "center",
    zIndex: 40,
    source: "planned",
  });
}

export function createLayeredDesignSeedDocument({
  prompt,
  id,
  title,
  createdAt,
}: CreateLayeredDesignSeedDocumentParams): LayeredDesignDocument {
  const normalizedPrompt = normalizePrompt(prompt);
  const inferredTitle = title?.trim() || inferTitle(normalizedPrompt);
  const slug = id || createSlug(inferredTitle || normalizedPrompt);
  const timestamp = createdAt || new Date().toISOString();

  const backgroundAssetId = `${slug}-asset-background`;
  const subjectAssetId = `${slug}-asset-subject`;
  const effectAssetId = `${slug}-asset-effect`;

  return createLayeredDesignDocument({
    id: slug,
    title: inferredTitle,
    status: "draft",
    canvas: {
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
      backgroundColor: "#0f172a",
      safeArea: {
        x: 72,
        y: 96,
        width: DEFAULT_CANVAS_WIDTH - 144,
        height: DEFAULT_CANVAS_HEIGHT - 192,
      },
    },
    assets: [
      createSeedAsset({
        id: backgroundAssetId,
        kind: "background",
        prompt: `${normalizedPrompt}｜背景层，无文字、无人物、无 Logo`,
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT,
        hasAlpha: false,
        createdAt: timestamp,
      }),
      createSeedAsset({
        id: subjectAssetId,
        kind: "subject",
        prompt: `${normalizedPrompt}｜主体层，透明背景或可抠图主体`,
        width: 760,
        height: 980,
        hasAlpha: true,
        createdAt: timestamp,
      }),
      createSeedAsset({
        id: effectAssetId,
        kind: "effect",
        prompt: `${normalizedPrompt}｜氛围光效层，透明背景`,
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT,
        hasAlpha: true,
        createdAt: timestamp,
      }),
    ],
    layers: [
      createImageLayer({
        id: "background-image",
        name: "背景",
        type: "image",
        assetId: backgroundAssetId,
        x: 0,
        y: 0,
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT,
        zIndex: 0,
        alphaMode: "none",
        prompt: `${normalizedPrompt}｜背景层`,
        source: "planned",
      }),
      createImageLayer({
        id: "subject-image",
        name: "主体",
        type: "image",
        assetId: subjectAssetId,
        x: 160,
        y: 308,
        width: 760,
        height: 930,
        zIndex: 20,
        alphaMode: "embedded",
        prompt: `${normalizedPrompt}｜主体层`,
        source: "planned",
      }),
      createImageLayer({
        id: "atmosphere-effect",
        name: "氛围特效",
        type: "effect",
        assetId: effectAssetId,
        x: 0,
        y: 0,
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT,
        opacity: 0.72,
        zIndex: 30,
        blendMode: "screen",
        alphaMode: "embedded",
        prompt: `${normalizedPrompt}｜光效层`,
        source: "planned",
      }),
      createHeadlineText(inferredTitle),
      createTextLayer({
        id: "subtitle-text",
        name: "副标题",
        type: "text",
        text: "这里放可编辑副标题",
        x: 180,
        y: 1160,
        width: 720,
        height: 72,
        fontSize: 32,
        color: "#cbd5e1",
        align: "center",
        zIndex: 45,
        source: "planned",
      }),
      createShapeLayer({
        id: "cta-shape",
        name: "CTA 按钮底",
        type: "shape",
        shape: "round_rect",
        x: 322,
        y: 1268,
        width: 436,
        height: 84,
        fill: "#f8fafc",
        zIndex: 50,
        source: "planned",
      }),
      createTextLayer({
        id: "cta-text",
        name: "CTA 文案",
        type: "text",
        text: "立即查看",
        x: 322,
        y: 1275,
        width: 436,
        height: 70,
        fontSize: 30,
        color: "#0f172a",
        align: "center",
        zIndex: 55,
        source: "planned",
      }),
    ],
    editHistory: [
      {
        id: "seed-created",
        type: "created",
        actor: "assistant",
        summary: "根据用户 prompt 创建本地图层计划 seed，尚未调用图片模型。",
        createdAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
