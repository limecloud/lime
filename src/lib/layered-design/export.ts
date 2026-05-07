import {
  isImageDesignLayer,
  sortDesignLayers,
} from "./document";
import {
  evaluateLayeredDesignAnalyzerModelSlotConfigReadiness,
  normalizeLayeredDesignAnalyzerModelSlotConfig,
  type LayeredDesignAnalyzerModelSlotConfig,
  type LayeredDesignAnalyzerModelSlotConfigInput,
  type LayeredDesignAnalyzerModelSlotConfigReadiness,
} from "./analyzerModelSlotConfig";
import type {
  LayeredDesignAnalyzerModelSlotExecutionEvidence,
} from "./analyzerModelSlotRuntime";
import {
  createLayeredDesignAnalyzerProviderCapabilityGateRequirements,
  evaluateLayeredDesignAnalyzerProviderCapabilityGate,
  type LayeredDesignAnalyzerProviderCapability,
  type LayeredDesignAnalyzerProviderCapabilityGateReport,
} from "./providerCapabilities";
import { createLayeredDesignTrialPsdFile } from "./psd";
import type {
  DesignLayer,
  GeneratedDesignAssetKind,
  GeneratedDesignAsset,
  LayeredDesignDocument,
  LayeredDesignExtractionAnalysis,
  ShapeLayer,
  TextLayer,
} from "./types";
import { createStoredZipArchive, type StoredZipEntry } from "./zip";

export const LAYERED_DESIGN_EXPORT_SCHEMA_VERSION = "2026-05-05.export.p1";
export const LAYERED_DESIGN_PSD_LIKE_EXPORT_SCHEMA_VERSION =
  "2026-05-06.psd-like.p1";

export interface LayeredDesignExportFile {
  filename: string;
  downloadName: string;
  mimeType: string;
  content: string;
}

export interface LayeredDesignExportBinaryFile {
  filename: string;
  downloadName: string;
  mimeType: string;
  content: Uint8Array;
}

export interface LayeredDesignExportAssetFile {
  assetId: string;
  filename: string;
  downloadName: string;
  mimeType: string;
  src: string;
  kind: GeneratedDesignAsset["kind"];
  width: number;
  height: number;
  embeddedDataUrl: boolean;
}

export interface LayeredDesignExportManifestAsset {
  id: string;
  kind: GeneratedDesignAsset["kind"];
  source: "file" | "reference" | "missing";
  filename?: string;
  originalSrc?: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  provider?: string;
  modelId?: string;
}

export interface LayeredDesignExportManifest {
  schemaVersion: typeof LAYERED_DESIGN_EXPORT_SCHEMA_VERSION;
  documentId: string;
  title: string;
  exportedAt: string;
  designFile: string;
  psdLikeManifestFile: string;
  trialPsdFile: string;
  previewSvgFile: string;
  previewPngFile: string;
  analysis?: LayeredDesignExportAnalysisSummary;
  evidence?: LayeredDesignExportEvidenceSummary;
  analyzerModelSlots?: LayeredDesignExportAnalyzerModelSlotSummary[];
  assets: LayeredDesignExportManifestAsset[];
}

export interface LayeredDesignExportAnalysisSummary {
  analyzer: LayeredDesignExtractionAnalysis["analyzer"];
  outputs: LayeredDesignExtractionAnalysis["outputs"];
  providerCapabilities?: LayeredDesignAnalyzerProviderCapability[];
  capabilityGate?: LayeredDesignAnalyzerProviderCapabilityGateReport;
}

export interface LayeredDesignExportAnalyzerModelSlotSummary {
  config: LayeredDesignAnalyzerModelSlotConfig;
  readiness: LayeredDesignAnalyzerModelSlotConfigReadiness;
}

export interface LayeredDesignExportModelSlotExecutionSource {
  kind: "asset" | "layer";
  id: string;
  assetKind?: GeneratedDesignAsset["kind"];
  layerType?: DesignLayer["type"];
}

export interface LayeredDesignExportModelSlotExecutionSummary
  extends LayeredDesignAnalyzerModelSlotExecutionEvidence {
  sources: LayeredDesignExportModelSlotExecutionSource[];
}

export interface LayeredDesignExportEvidenceSummary {
  modelSlotExecutions?: LayeredDesignExportModelSlotExecutionSummary[];
}

export type LayeredDesignPsdLikeLayerRole =
  | "raster_image"
  | "editable_text"
  | "vector_shape"
  | "group"
  | "missing_asset";

export interface LayeredDesignPsdLikeAssetReference {
  id: string;
  kind?: GeneratedDesignAssetKind;
  source: LayeredDesignExportManifestAsset["source"];
  filename?: string;
  originalSrc?: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  provider?: string;
  modelId?: string;
}

export interface LayeredDesignPsdLikeLayer {
  id: string;
  name: string;
  type: DesignLayer["type"];
  source: DesignLayer["source"];
  role: LayeredDesignPsdLikeLayerRole;
  visible: boolean;
  locked: boolean;
  blendMode: DesignLayer["blendMode"];
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    zIndex: number;
  };
  asset?: LayeredDesignPsdLikeAssetReference;
  text?: {
    text: string;
    fontFamily?: string;
    fontSize: number;
    color: string;
    align: TextLayer["align"];
    lineHeight?: number;
    letterSpacing?: number;
  };
  shape?: {
    shape: ShapeLayer["shape"];
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  };
  children?: string[];
}

export interface LayeredDesignPsdLikeManifest {
  schemaVersion: typeof LAYERED_DESIGN_PSD_LIKE_EXPORT_SCHEMA_VERSION;
  projectionKind: "psd-like-layer-stack";
  source: {
    factSource: "LayeredDesignDocument";
    documentSchemaVersion: LayeredDesignDocument["schemaVersion"];
    documentId: string;
    designFile: string;
  };
  exportedAt: string;
  canvas: LayeredDesignDocument["canvas"];
  preview: {
    svgFile: string;
    pngFile: string;
  };
  compatibility: {
    truePsd: false;
    layerOrder: "back_to_front";
    editableText: true;
    rasterImageLayers: true;
    vectorShapeProjection: "basic_svg_shape_semantics";
    groupHierarchy: "reference_only";
  };
  layers: LayeredDesignPsdLikeLayer[];
}

export interface LayeredDesignExportBundle {
  manifest: LayeredDesignExportManifest;
  psdLikeManifest: LayeredDesignPsdLikeManifest;
  designFile: LayeredDesignExportFile;
  manifestFile: LayeredDesignExportFile;
  psdLikeManifestFile: LayeredDesignExportFile;
  trialPsdFile: LayeredDesignExportBinaryFile;
  previewSvgFile: LayeredDesignExportFile;
  previewPngFile: Omit<LayeredDesignExportFile, "content">;
  assetFiles: LayeredDesignExportAssetFile[];
}

export interface LayeredDesignExportZipFile {
  filename: string;
  downloadName: string;
  mimeType: "application/zip";
  content: Uint8Array;
}

export type LayeredDesignProjectExportFileEncoding = "utf8" | "base64";

export interface LayeredDesignProjectExportFile {
  relativePath: string;
  mimeType: string;
  encoding: LayeredDesignProjectExportFileEncoding;
  content: string;
}

export interface CreateLayeredDesignExportBundleOptions {
  exportedAt?: string;
  baseName?: string;
  analyzerModelSlotConfigs?: readonly LayeredDesignAnalyzerModelSlotConfigInput[];
}

export interface CreateLayeredDesignExportZipFileOptions {
  previewPngDataUrl: string;
  downloadName?: string;
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function normalizeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeOpacity(value: number): number {
  return Math.max(0, Math.min(1, normalizeNumber(value, 1)));
}

function sanitizeFilePart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

function resolveExportBaseName(
  document: LayeredDesignDocument,
  explicitBaseName?: string,
): string {
  return sanitizeFilePart(
    explicitBaseName || document.title || document.id,
    sanitizeFilePart(document.id, "layered-design"),
  );
}

function resolveAssetMimeType(src: string): string {
  if (!src) {
    return "application/octet-stream";
  }

  const dataUrlMatch = /^data:([^;,]+)[;,]/i.exec(src);
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1].toLowerCase();
  }

  const extensionMatch = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src);
  const extension = extensionMatch?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";

  return "image/png";
}

function resolveAssetExtension(src: string): string {
  const mimeType = resolveAssetMimeType(src);
  return MIME_EXTENSION_MAP[mimeType] ?? "png";
}

const textEncoder = new TextEncoder();

function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, "");
  if (typeof atob === "function") {
    const binary = atob(normalized);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    return output;
  }

  const bufferConstructor = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(value: string, encoding: "base64"): Uint8Array;
      };
    }
  ).Buffer;
  if (bufferConstructor) {
    return Uint8Array.from(bufferConstructor.from(normalized, "base64"));
  }

  throw new Error("当前环境不支持 base64 资产解码");
}

function encodeBase64(content: Uint8Array): string {
  if (typeof btoa === "function") {
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < content.byteLength; offset += chunkSize) {
      binary += String.fromCharCode(
        ...content.slice(offset, offset + chunkSize),
      );
    }
    return btoa(binary);
  }

  const bufferConstructor = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(value: Uint8Array): {
          toString(encoding: "base64"): string;
        };
      };
    }
  ).Buffer;
  if (bufferConstructor) {
    return bufferConstructor.from(content).toString("base64");
  }

  throw new Error("当前环境不支持 base64 资产编码");
}

function decodeDataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("导出资产必须是 data URL");
  }

  const metadata = dataUrl.slice(5, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (metadata.includes(";base64")) {
    return decodeBase64(payload);
  }

  return encodeUtf8(decodeURIComponent(payload));
}

function getLayerCenter(layer: DesignLayer): { x: number; y: number } {
  return {
    x: normalizeNumber(layer.x) + normalizeNumber(layer.width) / 2,
    y: normalizeNumber(layer.y) + normalizeNumber(layer.height) / 2,
  };
}

function renderTransformAttribute(layer: DesignLayer): string {
  const rotation = normalizeNumber(layer.rotation);
  if (rotation === 0) {
    return "";
  }

  const center = getLayerCenter(layer);
  return ` transform="rotate(${rotation} ${center.x} ${center.y})"`;
}

function renderImageLayerSvg(
  layer: DesignLayer,
  asset: GeneratedDesignAsset | null,
): string {
  const common = `x="${normalizeNumber(layer.x)}" y="${normalizeNumber(
    layer.y,
  )}" width="${Math.max(1, normalizeNumber(layer.width, 1))}" height="${Math.max(
    1,
    normalizeNumber(layer.height, 1),
  )}" opacity="${normalizeOpacity(layer.opacity)}"${renderTransformAttribute(
    layer,
  )}`;

  if (asset?.src) {
    return `<image ${common} href="${escapeXmlAttribute(
      asset.src,
    )}" preserveAspectRatio="xMidYMid slice" />`;
  }

  const labelX = normalizeNumber(layer.x) + normalizeNumber(layer.width) / 2;
  const labelY = normalizeNumber(layer.y) + normalizeNumber(layer.height) / 2;

  return `<g${renderTransformAttribute(layer)} opacity="${normalizeOpacity(
    layer.opacity,
  )}"><rect x="${normalizeNumber(layer.x)}" y="${normalizeNumber(
    layer.y,
  )}" width="${Math.max(1, normalizeNumber(layer.width, 1))}" height="${Math.max(
    1,
    normalizeNumber(layer.height, 1),
  )}" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="12 10" /><text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="22" fill="#64748b">${escapeXmlText(
    layer.name,
  )}</text></g>`;
}

function renderTextLayerSvg(layer: TextLayer): string {
  const anchor =
    layer.align === "center" ? "middle" : layer.align === "right" ? "end" : "start";
  const textX =
    layer.align === "center"
      ? layer.x + layer.width / 2
      : layer.align === "right"
        ? layer.x + layer.width
        : layer.x;
  const textY = layer.y + layer.height / 2;
  const fontFamily = layer.fontFamily || "Arial, sans-serif";

  return `<text x="${normalizeNumber(textX)}" y="${normalizeNumber(
    textY,
  )}" opacity="${normalizeOpacity(layer.opacity)}"${renderTransformAttribute(
    layer,
  )} text-anchor="${anchor}" dominant-baseline="middle" font-family="${escapeXmlAttribute(
    fontFamily,
  )}" font-size="${Math.max(1, normalizeNumber(layer.fontSize, 24))}" fill="${escapeXmlAttribute(
    layer.color,
  )}" letter-spacing="${normalizeNumber(
    layer.letterSpacing ?? 0,
  )}" style="white-space: pre-wrap">${escapeXmlText(layer.text)}</text>`;
}

function renderShapeLayerSvg(layer: ShapeLayer): string {
  const common = `opacity="${normalizeOpacity(
    layer.opacity,
  )}"${renderTransformAttribute(layer)} fill="${escapeXmlAttribute(
    layer.fill ?? "rgba(15, 23, 42, 0.08)",
  )}" stroke="${escapeXmlAttribute(layer.stroke ?? "none")}" stroke-width="${normalizeNumber(
    layer.strokeWidth ?? 0,
  )}"`;

  if (layer.shape === "ellipse") {
    return `<ellipse cx="${layer.x + layer.width / 2}" cy="${
      layer.y + layer.height / 2
    }" rx="${Math.max(1, layer.width / 2)}" ry="${Math.max(
      1,
      layer.height / 2,
    )}" ${common} />`;
  }

  if (layer.shape === "line") {
    return `<line x1="${layer.x}" y1="${layer.y}" x2="${layer.x + layer.width}" y2="${
      layer.y + layer.height
    }" opacity="${normalizeOpacity(layer.opacity)}"${renderTransformAttribute(
      layer,
    )} stroke="${escapeXmlAttribute(
      layer.stroke ?? layer.fill ?? "#0f172a",
    )}" stroke-width="${Math.max(1, normalizeNumber(layer.strokeWidth ?? 2))}" />`;
  }

  const radius = layer.shape === "round_rect" ? 24 : 0;
  return `<rect x="${layer.x}" y="${layer.y}" width="${Math.max(
    1,
    layer.width,
  )}" height="${Math.max(1, layer.height)}" rx="${radius}" ry="${radius}" ${common} />`;
}

function renderLayerSvg(
  layer: DesignLayer,
  assets: GeneratedDesignAsset[],
): string {
  if (!layer.visible) {
    return "";
  }

  if (isImageDesignLayer(layer)) {
    const asset = assets.find((item) => item.id === layer.assetId) ?? null;
    return renderImageLayerSvg(layer, asset);
  }

  if (layer.type === "text") {
    return renderTextLayerSvg(layer);
  }

  if (layer.type === "shape") {
    return renderShapeLayerSvg(layer);
  }

  return "";
}

export function renderLayeredDesignDocumentToSvg(
  document: LayeredDesignDocument,
): string {
  const width = Math.max(1, normalizeNumber(document.canvas.width, 1));
  const height = Math.max(1, normalizeNumber(document.canvas.height, 1));
  const backgroundColor = document.canvas.backgroundColor ?? "#ffffff";
  const body = sortDesignLayers(document.layers)
    .map((layer) => renderLayerSvg(layer, document.assets))
    .filter(Boolean)
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXmlAttribute(
    document.title,
  )}">
  <rect width="100%" height="100%" fill="${escapeXmlAttribute(backgroundColor)}" />
  ${body}
</svg>`;
}

export function createLayeredDesignPreviewSvgDataUrl(
  document: LayeredDesignDocument,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    renderLayeredDesignDocumentToSvg(document),
  )}`;
}

function createPsdLikeAssetReference(
  assetId: string,
  asset: GeneratedDesignAsset | undefined,
  manifestAsset: LayeredDesignExportManifestAsset | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): LayeredDesignPsdLikeAssetReference {
  return {
    id: assetId,
    kind: asset?.kind,
    source: manifestAsset?.source ?? "missing",
    filename: manifestAsset?.filename,
    originalSrc: manifestAsset?.originalSrc,
    width: asset?.width ?? fallbackWidth,
    height: asset?.height ?? fallbackHeight,
    hasAlpha: asset?.hasAlpha ?? false,
    provider: asset?.provider,
    modelId: asset?.modelId,
  };
}

function resolvePsdLikeLayerRole(
  layer: DesignLayer,
  asset?: GeneratedDesignAsset,
): LayeredDesignPsdLikeLayerRole {
  if (isImageDesignLayer(layer)) {
    return asset ? "raster_image" : "missing_asset";
  }
  if (layer.type === "text") {
    return "editable_text";
  }
  if (layer.type === "shape") {
    return "vector_shape";
  }
  return "group";
}

export function createLayeredDesignPsdLikeManifest(
  document: LayeredDesignDocument,
  manifestAssets: LayeredDesignExportManifestAsset[],
  options: {
    exportedAt: string;
    designFile: string;
    previewSvgFile: string;
    previewPngFile: string;
  },
): LayeredDesignPsdLikeManifest {
  const manifestAssetById = new Map(
    manifestAssets.map((asset) => [asset.id, asset]),
  );

  return {
    schemaVersion: LAYERED_DESIGN_PSD_LIKE_EXPORT_SCHEMA_VERSION,
    projectionKind: "psd-like-layer-stack",
    source: {
      factSource: "LayeredDesignDocument",
      documentSchemaVersion: document.schemaVersion,
      documentId: document.id,
      designFile: options.designFile,
    },
    exportedAt: options.exportedAt,
    canvas: { ...document.canvas },
    preview: {
      svgFile: options.previewSvgFile,
      pngFile: options.previewPngFile,
    },
    compatibility: {
      truePsd: false,
      layerOrder: "back_to_front",
      editableText: true,
      rasterImageLayers: true,
      vectorShapeProjection: "basic_svg_shape_semantics",
      groupHierarchy: "reference_only",
    },
    layers: sortDesignLayers(document.layers).map((layer) => {
      const asset =
        isImageDesignLayer(layer) && layer.assetId
          ? document.assets.find((item) => item.id === layer.assetId)
          : undefined;

      return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        source: layer.source,
        role: resolvePsdLikeLayerRole(layer, asset),
        visible: layer.visible,
        locked: layer.locked,
        blendMode: layer.blendMode ?? "normal",
        transform: {
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
        },
        ...(isImageDesignLayer(layer)
          ? {
              asset: createPsdLikeAssetReference(
                layer.assetId,
                asset,
                manifestAssetById.get(layer.assetId),
                layer.width,
                layer.height,
              ),
            }
          : {}),
        ...(layer.type === "text"
          ? {
              text: {
                text: layer.text,
                fontFamily: layer.fontFamily,
                fontSize: layer.fontSize,
                color: layer.color,
                align: layer.align,
                lineHeight: layer.lineHeight,
                letterSpacing: layer.letterSpacing,
              },
            }
          : {}),
        ...(layer.type === "shape"
          ? {
              shape: {
                shape: layer.shape,
                fill: layer.fill,
                stroke: layer.stroke,
                strokeWidth: layer.strokeWidth,
              },
            }
          : {}),
        ...(layer.type === "group" ? { children: [...layer.children] } : {}),
      };
    }),
  };
}

function createExportAnalysisSummary(
  document: LayeredDesignDocument,
): LayeredDesignExportAnalysisSummary | undefined {
  const analysis = document.extraction?.analysis;
  if (!analysis) {
    return undefined;
  }

  const providerCapabilities = analysis.providerCapabilities ?? [];
  const requirements =
    createLayeredDesignAnalyzerProviderCapabilityGateRequirements({
      requireSubjectMatting: analysis.outputs.candidateMask,
      requireCleanPlate: analysis.outputs.cleanPlate,
      requireTextOcr: analysis.outputs.ocrText,
    });
  const capabilityGate =
    providerCapabilities.length > 0 || requirements.length > 0
      ? evaluateLayeredDesignAnalyzerProviderCapabilityGate(
          providerCapabilities,
          requirements,
        )
      : undefined;

  return {
    analyzer: { ...analysis.analyzer },
    outputs: { ...analysis.outputs },
    ...(providerCapabilities.length > 0
      ? {
          providerCapabilities: providerCapabilities.map((capability) => ({
            ...capability,
            supports: { ...capability.supports },
            ...(capability.limits ? { limits: { ...capability.limits } } : {}),
            ...(capability.quality
              ? { quality: { ...capability.quality } }
              : {}),
          })),
        }
      : {}),
    ...(capabilityGate ? { capabilityGate } : {}),
  };
}

function createExportAnalyzerModelSlotSummaries(
  configs: readonly LayeredDesignAnalyzerModelSlotConfigInput[] | undefined,
): LayeredDesignExportAnalyzerModelSlotSummary[] | undefined {
  if (!configs || configs.length === 0) {
    return undefined;
  }

  return configs.map((input) => ({
    config: normalizeLayeredDesignAnalyzerModelSlotConfig(input),
    readiness: evaluateLayeredDesignAnalyzerModelSlotConfigReadiness(input),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0
    ? field
    : undefined;
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function readModelSlotExecutionEvidence(
  params: Record<string, unknown> | undefined,
): LayeredDesignAnalyzerModelSlotExecutionEvidence | undefined {
  const raw = params?.modelSlotExecution;
  if (!isRecord(raw)) {
    return undefined;
  }

  const slotId = readOptionalString(raw, "slotId");
  const slotKind = readOptionalString(raw, "slotKind");
  const providerLabel = readOptionalString(raw, "providerLabel");
  const modelId = readOptionalString(raw, "modelId");
  const execution = readOptionalString(raw, "execution");
  const fallbackStrategy = readOptionalString(raw, "fallbackStrategy");
  const status = readOptionalString(raw, "status");
  const attempt = readNumber(raw, "attempt");
  const maxAttempts = readNumber(raw, "maxAttempts");
  const timeoutMs = readNumber(raw, "timeoutMs");
  const fallbackUsed = readBoolean(raw, "fallbackUsed");

  if (
    !slotId ||
    !slotKind ||
    !providerLabel ||
    !modelId ||
    !execution ||
    !fallbackStrategy ||
    !status ||
    attempt === undefined ||
    maxAttempts === undefined ||
    timeoutMs === undefined ||
    fallbackUsed === undefined
  ) {
    return undefined;
  }

  return {
    slotId,
    slotKind:
      slotKind as LayeredDesignAnalyzerModelSlotExecutionEvidence["slotKind"],
    providerLabel,
    modelId,
    execution:
      execution as LayeredDesignAnalyzerModelSlotExecutionEvidence["execution"],
    attempt,
    maxAttempts,
    timeoutMs,
    fallbackStrategy:
      fallbackStrategy as LayeredDesignAnalyzerModelSlotExecutionEvidence["fallbackStrategy"],
    fallbackUsed,
    status:
      status as LayeredDesignAnalyzerModelSlotExecutionEvidence["status"],
    ...(readOptionalString(raw, "providerId")
      ? { providerId: readOptionalString(raw, "providerId") }
      : {}),
    ...(readOptionalString(raw, "modelVersion")
      ? { modelVersion: readOptionalString(raw, "modelVersion") }
      : {}),
  };
}

function createModelSlotExecutionKey(
  evidence: LayeredDesignAnalyzerModelSlotExecutionEvidence,
): string {
  return JSON.stringify({
    slotId: evidence.slotId,
    slotKind: evidence.slotKind,
    providerLabel: evidence.providerLabel,
    modelId: evidence.modelId,
    execution: evidence.execution,
    attempt: evidence.attempt,
    maxAttempts: evidence.maxAttempts,
    timeoutMs: evidence.timeoutMs,
    fallbackStrategy: evidence.fallbackStrategy,
    fallbackUsed: evidence.fallbackUsed,
    status: evidence.status,
    providerId: evidence.providerId,
    modelVersion: evidence.modelVersion,
  });
}

function collectLayeredDesignModelSlotExecutions(
  document: LayeredDesignDocument,
): LayeredDesignExportModelSlotExecutionSummary[] {
  const executions = new Map<
    string,
    LayeredDesignExportModelSlotExecutionSummary
  >();
  const addExecution = (
    evidence: LayeredDesignAnalyzerModelSlotExecutionEvidence | undefined,
    source: LayeredDesignExportModelSlotExecutionSource,
  ) => {
    if (!evidence) {
      return;
    }

    const key = createModelSlotExecutionKey(evidence);
    const existing = executions.get(key);
    if (existing) {
      existing.sources.push(source);
      return;
    }

    executions.set(key, {
      ...evidence,
      sources: [source],
    });
  };

  for (const asset of document.assets) {
    addExecution(readModelSlotExecutionEvidence(asset.params), {
      kind: "asset",
      id: asset.id,
      assetKind: asset.kind,
    });
  }

  for (const layer of document.layers) {
    addExecution(readModelSlotExecutionEvidence(layer.params), {
      kind: "layer",
      id: layer.id,
      layerType: layer.type,
    });
  }

  return Array.from(executions.values());
}

function createExportEvidenceSummary(
  document: LayeredDesignDocument,
): LayeredDesignExportEvidenceSummary | undefined {
  const modelSlotExecutions = collectLayeredDesignModelSlotExecutions(document);
  if (modelSlotExecutions.length === 0) {
    return undefined;
  }

  return {
    modelSlotExecutions,
  };
}

export function createLayeredDesignExportBundle(
  document: LayeredDesignDocument,
  options: CreateLayeredDesignExportBundleOptions = {},
): LayeredDesignExportBundle {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const baseName = resolveExportBaseName(document, options.baseName);
  const designFilename = "design.json";
  const manifestFilename = "export-manifest.json";
  const psdLikeManifestFilename = "psd-like-manifest.json";
  const trialPsdFilename = "trial.psd";
  const previewSvgFilename = "preview.svg";
  const previewPngFilename = "preview.png";
  const exportedDocument: LayeredDesignDocument = {
    ...document,
    status: "exported",
    updatedAt: exportedAt,
  };

  const assetFiles = document.assets
    .filter((asset) => asset.src.trim().startsWith("data:"))
    .map((asset): LayeredDesignExportAssetFile => {
      const extension = resolveAssetExtension(asset.src);
      const safeAssetId = sanitizeFilePart(asset.id, "asset");
      const filename = `assets/${safeAssetId}.${extension}`;

      return {
        assetId: asset.id,
        filename,
        downloadName: `${baseName}.${safeAssetId}.${extension}`,
        mimeType: resolveAssetMimeType(asset.src),
        src: asset.src,
        kind: asset.kind,
        width: asset.width,
        height: asset.height,
        embeddedDataUrl: asset.src.startsWith("data:"),
      };
    });

  const manifestAssets = document.assets.map((asset) => {
    const assetFile = assetFiles.find((item) => item.assetId === asset.id);
    return {
      id: asset.id,
      kind: asset.kind,
      source: asset.src ? (assetFile ? "file" : "reference") : "missing",
      filename: assetFile?.filename,
      originalSrc: asset.src && !assetFile?.embeddedDataUrl ? asset.src : undefined,
      width: asset.width,
      height: asset.height,
      hasAlpha: asset.hasAlpha,
      provider: asset.provider,
      modelId: asset.modelId,
    } satisfies LayeredDesignExportManifestAsset;
  });
  const analysisSummary = createExportAnalysisSummary(document);
  const evidenceSummary = createExportEvidenceSummary(document);
  const analyzerModelSlots = createExportAnalyzerModelSlotSummaries(
    options.analyzerModelSlotConfigs,
  );

  const manifest: LayeredDesignExportManifest = {
    schemaVersion: LAYERED_DESIGN_EXPORT_SCHEMA_VERSION,
    documentId: document.id,
    title: document.title,
    exportedAt,
    designFile: designFilename,
    psdLikeManifestFile: psdLikeManifestFilename,
    trialPsdFile: trialPsdFilename,
    previewSvgFile: previewSvgFilename,
    previewPngFile: previewPngFilename,
    ...(analysisSummary ? { analysis: analysisSummary } : {}),
    ...(evidenceSummary ? { evidence: evidenceSummary } : {}),
    ...(analyzerModelSlots ? { analyzerModelSlots } : {}),
    assets: manifestAssets,
  };
  const psdLikeManifest = createLayeredDesignPsdLikeManifest(
    document,
    manifestAssets,
    {
      exportedAt,
      designFile: designFilename,
      previewSvgFile: previewSvgFilename,
      previewPngFile: previewPngFilename,
    },
  );

  const previewSvg = renderLayeredDesignDocumentToSvg(document);
  const trialPsd = createLayeredDesignTrialPsdFile(document);

  return {
    manifest,
    psdLikeManifest,
    designFile: {
      filename: designFilename,
      downloadName: `${baseName}.design.json`,
      mimeType: "application/json",
      content: JSON.stringify(exportedDocument, null, 2),
    },
    manifestFile: {
      filename: manifestFilename,
      downloadName: `${baseName}.export-manifest.json`,
      mimeType: "application/json",
      content: JSON.stringify(manifest, null, 2),
    },
    psdLikeManifestFile: {
      filename: psdLikeManifestFilename,
      downloadName: `${baseName}.psd-like-manifest.json`,
      mimeType: "application/json",
      content: JSON.stringify(psdLikeManifest, null, 2),
    },
    trialPsdFile: {
      filename: trialPsdFilename,
      downloadName: `${baseName}.trial.psd`,
      mimeType: "image/vnd.adobe.photoshop",
      content: trialPsd,
    },
    previewSvgFile: {
      filename: previewSvgFilename,
      downloadName: `${baseName}.preview.svg`,
      mimeType: "image/svg+xml",
      content: previewSvg,
    },
    previewPngFile: {
      filename: previewPngFilename,
      downloadName: `${baseName}.preview.png`,
      mimeType: "image/png",
    },
    assetFiles,
  };
}

function resolveZipDownloadName(
  bundle: LayeredDesignExportBundle,
  explicitDownloadName?: string,
): string {
  if (explicitDownloadName?.trim()) {
    return explicitDownloadName.trim();
  }

  const designSuffix = ".design.json";
  const designDownloadName = bundle.designFile.downloadName;
  const baseName = designDownloadName.endsWith(designSuffix)
    ? designDownloadName.slice(0, -designSuffix.length)
    : sanitizeFilePart(
        bundle.manifest.title,
        sanitizeFilePart(bundle.manifest.documentId, "layered-design"),
      );

  return `${baseName}.layered-design.zip`;
}

export function createLayeredDesignExportZipFile(
  bundle: LayeredDesignExportBundle,
  options: CreateLayeredDesignExportZipFileOptions,
): LayeredDesignExportZipFile {
  const entries: StoredZipEntry[] = [
    {
      path: bundle.designFile.filename,
      content: encodeUtf8(bundle.designFile.content),
    },
    {
      path: bundle.manifestFile.filename,
      content: encodeUtf8(bundle.manifestFile.content),
    },
    {
      path: bundle.psdLikeManifestFile.filename,
      content: encodeUtf8(bundle.psdLikeManifestFile.content),
    },
    {
      path: bundle.trialPsdFile.filename,
      content: bundle.trialPsdFile.content,
    },
    {
      path: bundle.previewSvgFile.filename,
      content: encodeUtf8(bundle.previewSvgFile.content),
    },
    {
      path: bundle.previewPngFile.filename,
      content: decodeDataUrlToBytes(options.previewPngDataUrl),
    },
    ...bundle.assetFiles.map(
      (assetFile): StoredZipEntry => ({
        path: assetFile.filename,
        content: decodeDataUrlToBytes(assetFile.src),
      }),
    ),
  ];
  const downloadName = resolveZipDownloadName(bundle, options.downloadName);

  return {
    filename: "layered-design-export.zip",
    downloadName,
    mimeType: "application/zip",
    content: createStoredZipArchive(entries),
  };
}

export function createLayeredDesignProjectExportFiles(
  bundle: LayeredDesignExportBundle,
  options: CreateLayeredDesignExportZipFileOptions,
): LayeredDesignProjectExportFile[] {
  return [
    {
      relativePath: "design.json",
      mimeType: bundle.designFile.mimeType,
      encoding: "utf8",
      content: bundle.designFile.content,
    },
    {
      relativePath: "export-manifest.json",
      mimeType: bundle.manifestFile.mimeType,
      encoding: "utf8",
      content: bundle.manifestFile.content,
    },
    {
      relativePath: "psd-like-manifest.json",
      mimeType: bundle.psdLikeManifestFile.mimeType,
      encoding: "utf8",
      content: bundle.psdLikeManifestFile.content,
    },
    {
      relativePath: "trial.psd",
      mimeType: bundle.trialPsdFile.mimeType,
      encoding: "base64",
      content: encodeBase64(bundle.trialPsdFile.content),
    },
    {
      relativePath: "preview.svg",
      mimeType: bundle.previewSvgFile.mimeType,
      encoding: "utf8",
      content: bundle.previewSvgFile.content,
    },
    {
      relativePath: "preview.png",
      mimeType: "image/png",
      encoding: "base64",
      content: encodeBase64(decodeDataUrlToBytes(options.previewPngDataUrl)),
    },
    ...bundle.assetFiles.map((file) => ({
      relativePath: file.filename,
      mimeType: file.mimeType,
      encoding: "base64" as const,
      content: encodeBase64(decodeDataUrlToBytes(file.src)),
    })),
  ];
}
