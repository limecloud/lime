import {
  isImageDesignLayer,
  sortDesignLayers,
} from "./document";
import type {
  DesignLayer,
  GeneratedDesignAsset,
  LayeredDesignDocument,
  ShapeLayer,
  TextLayer,
} from "./types";

export const LAYERED_DESIGN_EXPORT_SCHEMA_VERSION = "2026-05-05.export.p1";

export interface LayeredDesignExportFile {
  filename: string;
  downloadName: string;
  mimeType: string;
  content: string;
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
  previewSvgFile: string;
  previewPngFile: string;
  assets: LayeredDesignExportManifestAsset[];
}

export interface LayeredDesignExportBundle {
  manifest: LayeredDesignExportManifest;
  designFile: LayeredDesignExportFile;
  manifestFile: LayeredDesignExportFile;
  previewSvgFile: LayeredDesignExportFile;
  previewPngFile: Omit<LayeredDesignExportFile, "content">;
  assetFiles: LayeredDesignExportAssetFile[];
}

export interface CreateLayeredDesignExportBundleOptions {
  exportedAt?: string;
  baseName?: string;
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

export function createLayeredDesignExportBundle(
  document: LayeredDesignDocument,
  options: CreateLayeredDesignExportBundleOptions = {},
): LayeredDesignExportBundle {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const baseName = resolveExportBaseName(document, options.baseName);
  const designFilename = "design.json";
  const manifestFilename = "export-manifest.json";
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

  const manifest: LayeredDesignExportManifest = {
    schemaVersion: LAYERED_DESIGN_EXPORT_SCHEMA_VERSION,
    documentId: document.id,
    title: document.title,
    exportedAt,
    designFile: designFilename,
    previewSvgFile: previewSvgFilename,
    previewPngFile: previewPngFilename,
    assets: document.assets.map((asset) => {
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
      };
    }),
  };

  const previewSvg = renderLayeredDesignDocumentToSvg(document);

  return {
    manifest,
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
