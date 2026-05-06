import React, { memo, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  applyLayeredDesignImageTaskOutput,
  createLayeredDesignArtifactFromFlatImage,
  createLayeredDesignAssetGenerationPlan,
  createLayeredDesignExportBundle,
  createLayeredDesignProjectExportFiles,
  createLayeredDesignExportZipFile,
  createLayeredDesignFlatImageHeuristicSeed,
  createLayeredDesignImageTaskArtifacts,
  createLayeredDesignPreviewSvgDataUrl,
  createSingleLayerAssetGenerationRequest,
  isImageDesignLayer,
  listPendingLayeredDesignImageTasks,
  normalizeLayeredDesignDocument,
  recordLayeredDesignImageTaskSubmissions,
  refreshLayeredDesignImageTaskResults,
  sortDesignLayers,
  updateLayerLock,
  updateLayeredDesignExtractionSelection,
  updateLayerTransform,
  updateLayerVisibility,
} from "@/lib/layered-design";
import {
  readLayeredDesignProjectExport,
  saveLayeredDesignProjectExport,
} from "@/lib/api/layeredDesignProject";
import type {
  DesignLayer,
  GeneratedDesignAsset,
  GroupLayer,
  ImageLayer,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionCleanPlateInput,
  LayeredDesignExportZipFile,
  ShapeLayer,
  TextLayer,
} from "@/lib/layered-design";
import {
  createDesignCanvasStateFromContent,
  type DesignCanvasProps,
  type DesignCanvasState,
} from "./types";

const Shell = styled.div`
  display: grid;
  grid-template-columns: minmax(190px, 240px) minmax(0, 1fr) minmax(230px, 280px);
  height: 100%;
  min-height: 0;
  width: 100%;
  background: hsl(var(--background));
  color: hsl(var(--foreground));

  @media (max-width: 1080px) {
    grid-template-columns: minmax(160px, 200px) minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(360px, 1fr) auto;
  }
`;

const Rail = styled.aside`
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--card));
`;

const Inspector = styled.aside`
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid hsl(var(--border));
  background: hsl(var(--card));

  @media (max-width: 1080px) {
    grid-column: 1 / -1;
    border-left: none;
    border-top: 1px solid hsl(var(--border));
  }
`;

const PanelHeader = styled.div`
  padding: 14px 16px 12px;
  border-bottom: 1px solid hsl(var(--border));
`;

const Eyebrow = styled.div`
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.2;
`;

const Title = styled.h2`
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 650;
`;

const LayerList = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 12px;
`;

const LayerButton = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "hsl(var(--foreground))" : "hsl(var(--border))"};
  border-radius: 14px;
  background: ${({ $selected }) =>
    $selected ? "hsl(var(--accent))" : "hsl(var(--background))"};
  color: hsl(var(--foreground));
  cursor: pointer;
  padding: 9px 10px;
  text-align: left;
`;

const LayerIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: hsl(var(--muted));
  font-size: 13px;
`;

const LayerName = styled.span`
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const LayerMeta = styled.span`
  color: hsl(var(--muted-foreground));
  font-size: 11px;
`;

const StageColumn = styled.main`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background:
    radial-gradient(circle at 18% 12%, rgba(14, 165, 233, 0.1), transparent 28%),
    linear-gradient(180deg, hsl(var(--muted)) 0%, hsl(var(--background)) 62%);
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 58px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  padding: 10px 14px;
`;

const ToolbarTitle = styled.div`
  min-width: 0;
`;

const ToolbarHeading = styled.div`
  overflow: hidden;
  font-size: 15px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ToolbarMeta = styled.div`
  margin-top: 2px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
`;

const ToolbarActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
`;

const Button = styled.button<{ $primary?: boolean }>`
  border: 1px solid
    ${({ $primary }) =>
      $primary ? "hsl(var(--foreground))" : "hsl(var(--border))"};
  border-radius: 999px;
  background: ${({ $primary }) =>
    $primary ? "hsl(var(--foreground))" : "hsl(var(--background))"};
  color: ${({ $primary }) =>
    $primary ? "hsl(var(--background))" : "hsl(var(--foreground))"};
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 11px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const StageViewport = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 28px;
`;

const StageFrame = styled.div<{
  $aspectRatio: string;
  $backgroundColor: string;
  $zoom: number;
}>`
  position: relative;
  width: min(100%, ${({ $zoom }) => Math.round(760 * $zoom)}px);
  aspect-ratio: ${({ $aspectRatio }) => $aspectRatio};
  border: 1px solid hsl(var(--border));
  border-radius: 22px;
  background: ${({ $backgroundColor }) => $backgroundColor};
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.16);
  overflow: hidden;
`;

const CanvasLayer = styled.button<{ $selected: boolean; $locked: boolean }>`
  position: absolute;
  display: block;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "rgba(15, 23, 42, 0.95)" : "rgba(148, 163, 184, 0.2)"};
  border-radius: 10px;
  background: transparent;
  cursor: ${({ $locked }) => ($locked ? "not-allowed" : "pointer")};
  outline: none;
  overflow: hidden;
  padding: 0;
  box-shadow: ${({ $selected }) =>
    $selected ? "0 0 0 3px rgba(14, 165, 233, 0.18)" : "none"};
`;

const EmptyAsset = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.08) 25%, transparent 25%) 0 0 /
      18px 18px,
    linear-gradient(135deg, transparent 75%, rgba(15, 23, 42, 0.08) 75%) 0 0 /
      18px 18px,
    #f8fafc;
  color: #64748b;
  font-size: 12px;
`;

const Image = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const TextLayerContent = styled.div<{
  $align: TextLayer["align"];
  $color: string;
  $fontSize: number;
}>`
  display: flex;
  align-items: center;
  justify-content: ${({ $align }) =>
    $align === "center"
      ? "center"
      : $align === "right"
        ? "flex-end"
        : "flex-start"};
  width: 100%;
  height: 100%;
  color: ${({ $color }) => $color};
  font-size: ${({ $fontSize }) => Math.max(10, Math.min(52, $fontSize))}px;
  font-weight: 700;
  line-height: 1.1;
  padding: 6px;
  text-align: ${({ $align }) => $align};
`;

const ShapeLayerContent = styled.div<{
  $shape: ShapeLayer["shape"];
  $fill?: string;
  $stroke?: string;
  $strokeWidth?: number;
}>`
  width: 100%;
  height: 100%;
  border: ${({ $stroke, $strokeWidth }) =>
    $stroke ? `${$strokeWidth ?? 1}px solid ${$stroke}` : "none"};
  border-radius: ${({ $shape }) =>
    $shape === "ellipse" ? "999px" : $shape === "round_rect" ? "18px" : "0"};
  background: ${({ $fill }) => $fill ?? "rgba(15, 23, 42, 0.08)"};
`;

const InspectorBody = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
  padding: 14px;
`;

const PropertyCard = styled.div`
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--background));
  padding: 12px;
`;

const PropertyTitle = styled.div`
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 650;
`;

const PropertyGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const PropertyItem = styled.div`
  border-radius: 12px;
  background: hsl(var(--muted));
  padding: 8px;
`;

const PropertyLabel = styled.div`
  color: hsl(var(--muted-foreground));
  font-size: 11px;
`;

const PropertyValue = styled.div`
  margin-top: 2px;
  font-size: 13px;
  font-weight: 650;
`;

const ActionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const Hint = styled.p`
  margin: 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.55;
`;

const CandidateList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CandidateButton = styled.button<{ $selected: boolean }>`
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 4px;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "hsl(var(--foreground))" : "hsl(var(--border))"};
  border-radius: 14px;
  background: ${({ $selected }) =>
    $selected ? "hsl(var(--accent))" : "hsl(var(--background))"};
  color: hsl(var(--foreground));
  cursor: pointer;
  padding: 10px;
  text-align: left;
`;

const CandidateMeta = styled.span`
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  line-height: 1.45;
`;

const GenerationNotice = styled.div<{
  $tone: "info" | "success" | "warning" | "error";
}>`
  border-bottom: 1px solid hsl(var(--border));
  background: ${({ $tone }) =>
    $tone === "success"
      ? "rgba(16, 185, 129, 0.1)"
      : $tone === "warning"
        ? "rgba(245, 158, 11, 0.12)"
        : $tone === "error"
          ? "rgba(244, 63, 94, 0.1)"
          : "rgba(14, 165, 233, 0.1)"};
  color: hsl(var(--foreground));
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 14px;
`;

const layerTypeLabels: Record<DesignLayer["type"], string> = {
  image: "图片",
  effect: "特效",
  text: "文字",
  shape: "形状",
  group: "分组",
};

function findLayerAsset(
  layer: DesignLayer,
  assets: GeneratedDesignAsset[],
): GeneratedDesignAsset | null {
  if (!isImageDesignLayer(layer)) {
    return null;
  }

  return assets.find((asset) => asset.id === layer.assetId) ?? null;
}

function resolveLayerIcon(layer: DesignLayer): string {
  switch (layer.type) {
    case "image":
      return "图";
    case "effect":
      return "效";
    case "text":
      return "字";
    case "shape":
      return "形";
    case "group":
      return "组";
  }
}

function renderLayerContent(
  layer: DesignLayer,
  assets: GeneratedDesignAsset[],
) {
  if (isImageDesignLayer(layer)) {
    return renderImageLayer(layer, assets);
  }

  switch (layer.type) {
    case "text":
      return renderTextLayer(layer);
    case "shape":
      return renderShapeLayer(layer);
    case "group":
      return renderGroupLayer(layer);
  }
}

function renderImageLayer(
  layer: ImageLayer,
  assets: GeneratedDesignAsset[],
) {
  const asset = findLayerAsset(layer, assets);
  if (!asset?.src) {
    return <EmptyAsset>{layer.name}</EmptyAsset>;
  }

  return <Image src={asset.src} alt={layer.name} draggable={false} />;
}

function renderTextLayer(layer: TextLayer) {
  return (
    <TextLayerContent
      $align={layer.align}
      $color={layer.color}
      $fontSize={layer.fontSize}
    >
      {layer.text}
    </TextLayerContent>
  );
}

function renderShapeLayer(layer: ShapeLayer) {
  return (
    <ShapeLayerContent
      $shape={layer.shape}
      $fill={layer.fill}
      $stroke={layer.stroke}
      $strokeWidth={layer.strokeWidth}
    />
  );
}

function renderGroupLayer(layer: GroupLayer) {
  return <EmptyAsset>{layer.children.length} 个子图层</EmptyAsset>;
}

function buildLayerStyle(
  layer: DesignLayer,
  canvasWidth: number,
  canvasHeight: number,
): React.CSSProperties {
  const safeWidth = Math.max(1, canvasWidth);
  const safeHeight = Math.max(1, canvasHeight);

  return {
    left: `${(layer.x / safeWidth) * 100}%`,
    top: `${(layer.y / safeHeight) * 100}%`,
    width: `${(layer.width / safeWidth) * 100}%`,
    height: `${(layer.height / safeHeight) * 100}%`,
    opacity: layer.opacity,
    transform: `rotate(${layer.rotation}deg)`,
    zIndex: layer.zIndex,
    display: layer.visible ? "block" : "none",
  };
}

function clickDownloadAnchor(anchor: HTMLAnchorElement) {
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function downloadBinaryFile(file: LayeredDesignExportZipFile) {
  const content = new ArrayBuffer(file.content.byteLength);
  new Uint8Array(content).set(file.content);
  const blob = new Blob([content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = file.downloadName;
  clickDownloadAnchor(anchor);
  URL.revokeObjectURL(url);
}

async function renderSvgDataUrlToPngDataUrl(
  svgDataUrl: string,
  width: number,
  height: number,
): Promise<string> {
  const image = new window.Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("SVG 预览无法转换为 PNG"));
    image.src = svgDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前环境不支持 Canvas PNG 导出");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const reader = new FileReader();

  return await new Promise<string>((resolve, reject) => {
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== "string" || !result.startsWith("data:image/")) {
        reject(new Error("读取图片失败：未获得有效 data URL"));
        return;
      }

      resolve(result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("读取图片失败"));
    };
    reader.readAsDataURL(file);
  });
}

async function readImageDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  const image = new window.Image();

  return await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          reject(new Error("读取图片尺寸失败"));
          return;
        }

        resolve({
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        });
      };
      image.onerror = () => reject(new Error("读取图片尺寸失败"));
      image.src = dataUrl;
    },
  );
}

export const DesignCanvas: React.FC<DesignCanvasProps> = memo(
  ({
    state,
    onStateChange,
    onBackHome,
    onClose,
    projectRootPath,
    projectId,
    contentId,
    createImageTaskArtifact,
    getImageTaskArtifact,
    readProjectExport = readLayeredDesignProjectExport,
    saveProjectExport = saveLayeredDesignProjectExport,
  }) => {
    const document = state.document;
    const [generationBusyTarget, setGenerationBusyTarget] = useState<
      "all" | "selected" | "refresh" | null
    >(null);
    const [generationStatus, setGenerationStatus] = useState<{
      tone: "info" | "success" | "warning" | "error";
      message: string;
    } | null>(null);
    const [exportBusy, setExportBusy] = useState(false);
    const [restoreBusy, setRestoreBusy] = useState(false);
    const flatImageInputRef = useRef<HTMLInputElement | null>(null);
    const visibleLayers = useMemo(
      () => sortDesignLayers(document.layers).filter((layer) => layer.visible),
      [document.layers],
    );
    const panelLayers = useMemo(
      () => sortDesignLayers(document.layers).slice().reverse(),
      [document.layers],
    );
    const selectedLayer =
      document.layers.find((layer) => layer.id === state.selectedLayerId) ??
      panelLayers[0] ??
      null;
    const extraction = document.extraction ?? null;
    const selectedAsset = selectedLayer
      ? findLayerAsset(selectedLayer, document.assets)
      : null;
    const selectedImageLayer =
      selectedLayer && isImageDesignLayer(selectedLayer) ? selectedLayer : null;
    const imageGenerationRequests = useMemo(
      () => createLayeredDesignAssetGenerationPlan(document),
      [document],
    );
    const pendingImageTasks = useMemo(
      () => listPendingLayeredDesignImageTasks(document),
      [document],
    );
    const imageLayerCount = useMemo(
      () => document.layers.filter(isImageDesignLayer).length,
      [document.layers],
    );
    const aspectRatio = `${Math.max(1, document.canvas.width)} / ${Math.max(
      1,
      document.canvas.height,
    )}`;
    const backgroundColor = document.canvas.backgroundColor ?? "#ffffff";
    const normalizedProjectRootPath = projectRootPath?.trim();
    const canSubmitImageTasks =
      Boolean(normalizedProjectRootPath) && generationBusyTarget === null;
    const canRefreshImageTasks =
      canSubmitImageTasks && pendingImageTasks.length > 0;

    const emitState = (nextState: DesignCanvasState) => {
      onStateChange(nextState);
    };

    const emitDocument = (
      nextDocument: DesignCanvasState["document"],
      selectedLayerId = selectedLayer?.id,
    ) => {
      emitState({
        ...state,
        document: nextDocument,
        selectedLayerId,
      });
    };

    const submitImageLayerGeneration = async (
      target: "all" | "selected",
    ) => {
      const workspaceRoot = normalizedProjectRootPath;
      if (!workspaceRoot) {
        setGenerationStatus({
          tone: "warning",
          message: "绑定工作区后才能提交图层图片任务。",
        });
        return;
      }

      const requests =
        target === "all"
          ? imageGenerationRequests
          : selectedImageLayer
            ? [
                createSingleLayerAssetGenerationRequest(
                  document,
                  selectedImageLayer.id,
                ),
              ]
            : [];

      if (requests.length === 0) {
        setGenerationStatus({
          tone: "warning",
          message:
            target === "all"
              ? "当前没有待生成的图片图层。"
              : "请选择图片或特效图层后再重生成。",
        });
        return;
      }

      setGenerationBusyTarget(target);
      setGenerationStatus({
        tone: "info",
        message: `正在提交 ${requests.length} 个图层图片任务...`,
      });

      try {
        const submissions = await createLayeredDesignImageTaskArtifacts({
          document,
          requests,
          projectRootPath: workspaceRoot,
          projectId: projectId ?? undefined,
          contentId: contentId ?? document.id,
          createTaskArtifact: createImageTaskArtifact,
        });
        let nextDocument = recordLayeredDesignImageTaskSubmissions(
          document,
          submissions,
        );
        let appliedCount = 0;

        for (const submission of submissions) {
          const appliedDocument = applyLayeredDesignImageTaskOutput(
            nextDocument,
            submission.generationRequest,
            submission.output,
          );
          if (appliedDocument) {
            nextDocument = appliedDocument;
            appliedCount += 1;
          }
        }

        emitDocument(nextDocument, selectedLayer?.id);
        setGenerationStatus({
          tone: "success",
          message:
            appliedCount > 0
              ? `已提交 ${submissions.length} 个图片任务，并写回 ${appliedCount} 个已完成结果。`
              : `已提交 ${submissions.length} 个图片任务，等待任务完成后写回图层资产。`,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "提交图层图片任务失败。",
        });
      } finally {
        setGenerationBusyTarget(null);
      }
    };

    const refreshSubmittedImageTasks = async () => {
      const workspaceRoot = normalizedProjectRootPath;
      if (!workspaceRoot) {
        setGenerationStatus({
          tone: "warning",
          message: "绑定工作区后才能刷新图层图片任务。",
        });
        return;
      }

      if (pendingImageTasks.length === 0) {
        setGenerationStatus({
          tone: "warning",
          message: "当前没有等待写回的图层图片任务。",
        });
        return;
      }

      setGenerationBusyTarget("refresh");
      setGenerationStatus({
        tone: "info",
        message: `正在刷新 ${pendingImageTasks.length} 个图层图片任务...`,
      });

      try {
        const result = await refreshLayeredDesignImageTaskResults({
          document,
          projectRootPath: workspaceRoot,
          getTaskArtifact: getImageTaskArtifact,
        });

        emitDocument(result.document, selectedLayer?.id);
        setGenerationStatus({
          tone:
            result.failedCount > 0
              ? "warning"
              : result.appliedCount > 0
                ? "success"
                : "info",
          message:
            result.appliedCount > 0
              ? `已刷新 ${result.refreshedCount} 个图片任务，并写回 ${result.appliedCount} 个图层结果。`
              : result.failedCount > 0
                ? `已刷新 ${result.refreshedCount} 个图片任务，${result.failedCount} 个失败，${result.pendingCount} 个仍在生成。`
                : `已刷新 ${result.refreshedCount} 个图片任务，${result.pendingCount} 个仍在生成。`,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "刷新图层图片任务失败。",
        });
      } finally {
        setGenerationBusyTarget(null);
      }
    };

    const selectLayer = (layerId: string) => {
      emitState({
        ...state,
        selectedLayerId: layerId,
      });
    };

    const updateZoom = (delta: number) => {
      emitState({
        ...state,
        zoom: Math.min(1.2, Math.max(0.42, state.zoom + delta)),
      });
    };

    const moveSelectedLayer = (xDelta: number, yDelta: number) => {
      if (!selectedLayer || selectedLayer.locked) return;
      emitDocument(
        updateLayerTransform(document, {
          layerId: selectedLayer.id,
          transform: {
            x: selectedLayer.x + xDelta,
            y: selectedLayer.y + yDelta,
          },
        }),
      );
    };

    const changeSelectedZIndex = (delta: number) => {
      if (!selectedLayer || selectedLayer.locked) return;
      emitDocument(
        updateLayerTransform(document, {
          layerId: selectedLayer.id,
          transform: {
            zIndex: selectedLayer.zIndex + delta,
          },
        }),
      );
    };

    const toggleSelectedVisibility = () => {
      if (!selectedLayer) return;
      emitDocument(
        updateLayerVisibility(document, {
          layerId: selectedLayer.id,
          visible: !selectedLayer.visible,
        }),
      );
    };

    const toggleSelectedLock = () => {
      if (!selectedLayer) return;
      emitDocument(
        updateLayerLock(document, {
          layerId: selectedLayer.id,
          locked: !selectedLayer.locked,
        }),
      );
    };

    const exportDesignProject = async () => {
      setExportBusy(true);
      setGenerationStatus({
        tone: "info",
        message: normalizedProjectRootPath
          ? "正在保存 design.json、psd-like-manifest.json、assets/ 和 preview.* 到项目工程目录..."
          : "未绑定工作区，正在打包 design.json、psd-like-manifest.json、assets/ 和 preview.* ZIP 工程包...",
      });

      try {
        const bundle = createLayeredDesignExportBundle(document);
        const svgDataUrl = createLayeredDesignPreviewSvgDataUrl(document);
        const pngDataUrl = await renderSvgDataUrlToPngDataUrl(
          svgDataUrl,
          document.canvas.width,
          document.canvas.height,
        );

        if (normalizedProjectRootPath) {
          const output = await saveProjectExport({
            projectRootPath: normalizedProjectRootPath,
            documentId: document.id,
            title: document.title,
            directoryName: `${document.id}.layered-design`,
            files: createLayeredDesignProjectExportFiles(bundle, {
              previewPngDataUrl: pngDataUrl,
            }),
          });

          setGenerationStatus({
            tone: "success",
            message: `已保存图层设计工程：${output.exportDirectoryRelativePath}（${output.fileCount} 个文件，${output.assetCount} 个 assets）。`,
          });
          return;
        }

        const zipFile = createLayeredDesignExportZipFile(bundle, {
          previewPngDataUrl: pngDataUrl,
        });

        downloadBinaryFile(zipFile);

        setGenerationStatus({
          tone: "success",
          message: `已下载 ZIP 工程包：包含 design.json、export-manifest.json、psd-like-manifest.json、preview.svg、preview.png 和 ${bundle.assetFiles.length} 个内嵌 assets；远程 assets 保留引用。`,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error ? error.message : "导出图层设计工程失败。",
        });
      } finally {
        setExportBusy(false);
      }
    };

    const openLatestProjectExport = async () => {
      const workspaceRoot = normalizedProjectRootPath;
      if (!workspaceRoot) {
        setGenerationStatus({
          tone: "warning",
          message: "绑定工作区后才能打开已保存的图层设计工程。",
        });
        return;
      }

      setRestoreBusy(true);
      setGenerationStatus({
        tone: "info",
        message: "正在从项目目录读取最近保存的图层设计工程...",
      });

      try {
        const output = await readProjectExport({
          projectRootPath: workspaceRoot,
        });
        const restoredDocument = normalizeLayeredDesignDocument(
          JSON.parse(output.designJson),
        );
        const restoredLayers = sortDesignLayers(restoredDocument.layers);

        emitState({
          ...state,
          document: restoredDocument,
          selectedLayerId:
            restoredLayers[restoredLayers.length - 1]?.id ??
            restoredLayers[0]?.id,
        });
        setGenerationStatus({
          tone: "success",
          message: `已打开图层设计工程：${output.exportDirectoryRelativePath}（${output.fileCount} 个文件，${output.assetCount} 个 assets）。`,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error ? error.message : "打开图层设计工程失败。",
        });
      } finally {
        setRestoreBusy(false);
      }
    };

    const openFlatImagePicker = () => {
      flatImageInputRef.current?.click();
    };

    const toggleExtractionCandidate = (candidateId: string) => {
      if (!extraction) {
        return;
      }

      const selectedCandidateIds = extraction.candidates
        .filter((candidate) =>
          candidate.id === candidateId
            ? !candidate.selected
            : candidate.selected,
        )
        .map((candidate) => candidate.id);

      emitDocument(
        updateLayeredDesignExtractionSelection(document, {
          selectedCandidateIds,
        }),
      );
    };

    const importFlatImage = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (!file.type.startsWith("image/")) {
        setGenerationStatus({
          tone: "warning",
          message: "请选择 PNG、JPEG、WEBP、GIF 等图片文件。",
        });
        return;
      }

      setGenerationStatus({
        tone: "info",
        message: "正在载入扁平图并创建可编辑 draft...",
      });

      try {
        const importedAt = new Date().toISOString();
        const dataUrl = await readFileAsDataUrl(file);
        const { width, height } = await readImageDimensions(dataUrl);
        let candidates: LayeredDesignExtractionCandidateInput[] | undefined;
        let cleanPlate: LayeredDesignExtractionCleanPlateInput | undefined;
        let importedMessage =
          "已载入扁平图 draft；当前先以原图背景进入编辑，后续可继续补候选层与 clean plate。";

        try {
          const heuristicSeed = await createLayeredDesignFlatImageHeuristicSeed({
            image: {
              src: dataUrl,
              width,
              height,
              mimeType: file.type,
            },
            createdAt: importedAt,
          });
          candidates = heuristicSeed.candidates;
          cleanPlate = heuristicSeed.cleanPlate;
          const autoSelectedCount = candidates.filter((candidate) => {
            const confidence =
              typeof candidate.confidence === "number"
                ? candidate.confidence
                : 0;
            return candidate.selected ?? confidence >= 0.6;
          }).length;
          importedMessage = `已载入扁平图 draft，并生成 ${autoSelectedCount}/${candidates.length} 个本地 heuristic 候选层；当前仍未执行 clean plate。`;
        } catch {
          importedMessage =
            "已载入扁平图 draft；本地 heuristic seed 不可用，当前先以原图背景进入编辑。";
        }

        const artifact = createLayeredDesignArtifactFromFlatImage({
          image: {
            src: dataUrl,
            width,
            height,
            fileName: file.name,
            mimeType: file.type,
          },
          ...(candidates ? { candidates } : {}),
          ...(cleanPlate ? { cleanPlate } : {}),
          documentCreatedAt: importedAt,
        });
        const nextState = createDesignCanvasStateFromContent(artifact.content);

        emitState(nextState);
        setGenerationStatus({
          tone: "success",
          message: importedMessage,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error ? error.message : "载入扁平图 draft 失败。",
        });
      }
    };

    return (
      <Shell data-testid="design-canvas">
        <Rail aria-label="图层列表">
          <PanelHeader>
            <Eyebrow>LayeredDesignDocument</Eyebrow>
            <Title>图层</Title>
          </PanelHeader>
          <LayerList>
            {panelLayers.map((layer) => (
              <LayerButton
                key={layer.id}
                type="button"
                $selected={layer.id === selectedLayer?.id}
                onClick={() => selectLayer(layer.id)}
              >
                <LayerIcon>{resolveLayerIcon(layer)}</LayerIcon>
                <span>
                  <LayerName>{layer.name}</LayerName>
                  <LayerMeta>
                    {layerTypeLabels[layer.type]} / z {layer.zIndex}
                    {!layer.visible ? " / 已隐藏" : ""}
                    {layer.locked ? " / 已锁定" : ""}
                  </LayerMeta>
                </span>
                <LayerMeta>{layer.visible ? "显示" : "隐藏"}</LayerMeta>
              </LayerButton>
            ))}
          </LayerList>
        </Rail>

        <StageColumn>
          <input
            ref={flatImageInputRef}
            data-testid="design-canvas-flat-image-input"
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void importFlatImage(event);
            }}
          />
          <Toolbar>
            <ToolbarTitle>
              <ToolbarHeading>{document.title}</ToolbarHeading>
              <ToolbarMeta>
                {document.canvas.width} x {document.canvas.height} /{" "}
                {document.layers.length} 个图层 / {imageLayerCount} 个图片层 /{" "}
                {document.status}
              </ToolbarMeta>
            </ToolbarTitle>
            <ToolbarActions>
              <Button type="button" onClick={openFlatImagePicker}>
                上传扁平图
              </Button>
              <Button
                type="button"
                $primary
                onClick={() => void submitImageLayerGeneration("all")}
                disabled={
                  !canSubmitImageTasks || imageGenerationRequests.length === 0
                }
                title={
                  normalizedProjectRootPath
                    ? "为所有待生成图片层创建图片任务"
                    : "绑定工作区后可生成图层资产"
                }
              >
                {generationBusyTarget === "all"
                  ? "提交中..."
                  : "生成全部图片层"}
              </Button>
              <Button
                type="button"
                onClick={() => void refreshSubmittedImageTasks()}
                disabled={!canRefreshImageTasks}
                title={
                  normalizedProjectRootPath
                    ? "刷新已提交图片任务，并把完成结果写回图层"
                    : "绑定工作区后可刷新图层任务结果"
                }
              >
                {generationBusyTarget === "refresh"
                  ? "刷新中..."
                  : "刷新生成结果"}
              </Button>
              <Button type="button" onClick={() => updateZoom(-0.08)}>
                缩小
              </Button>
              <Button type="button" onClick={() => updateZoom(0.08)}>
                放大
              </Button>
              <Button
                type="button"
                onClick={() => void exportDesignProject()}
                disabled={exportBusy}
              >
                {exportBusy ? "导出中..." : "导出设计工程"}
              </Button>
              <Button
                type="button"
                onClick={() => void openLatestProjectExport()}
                disabled={!normalizedProjectRootPath || restoreBusy}
                title={
                  normalizedProjectRootPath
                    ? "从项目工程目录打开最近保存的图层设计"
                    : "绑定工作区后可打开已保存工程"
                }
              >
                {restoreBusy ? "打开中..." : "打开最近工程"}
              </Button>
              <Button type="button" onClick={() => (onBackHome ?? onClose)?.()}>
                返回
              </Button>
            </ToolbarActions>
          </Toolbar>
          {generationStatus ? (
            <GenerationNotice $tone={generationStatus.tone}>
              {generationStatus.message}
            </GenerationNotice>
          ) : null}

          <StageViewport>
            <StageFrame
              $aspectRatio={aspectRatio}
              $backgroundColor={backgroundColor}
              $zoom={state.zoom}
              aria-label="设计画布预览"
            >
              {visibleLayers.map((layer) => (
                <CanvasLayer
                  key={layer.id}
                  type="button"
                  $selected={layer.id === selectedLayer?.id}
                  $locked={layer.locked}
                  style={buildLayerStyle(
                    layer,
                    document.canvas.width,
                    document.canvas.height,
                  )}
                  onClick={() => selectLayer(layer.id)}
                  aria-label={`选择图层 ${layer.name}`}
                >
                  {renderLayerContent(layer, document.assets)}
                </CanvasLayer>
              ))}
            </StageFrame>
          </StageViewport>
        </StageColumn>

        <Inspector aria-label="图层属性">
          <PanelHeader>
            <Eyebrow>属性</Eyebrow>
            <Title>{selectedLayer?.name ?? "未选择图层"}</Title>
          </PanelHeader>
          <InspectorBody>
            {selectedLayer ? (
              <>
                <PropertyCard>
                  <PropertyTitle>位置与尺寸</PropertyTitle>
                  <PropertyGrid>
                    <PropertyItem>
                      <PropertyLabel>X</PropertyLabel>
                      <PropertyValue>{Math.round(selectedLayer.x)}</PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>Y</PropertyLabel>
                      <PropertyValue>{Math.round(selectedLayer.y)}</PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>宽</PropertyLabel>
                      <PropertyValue>
                        {Math.round(selectedLayer.width)}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>高</PropertyLabel>
                      <PropertyValue>
                        {Math.round(selectedLayer.height)}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>透明度</PropertyLabel>
                      <PropertyValue>
                        {Math.round(selectedLayer.opacity * 100)}%
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>层级</PropertyLabel>
                      <PropertyValue>{selectedLayer.zIndex}</PropertyValue>
                    </PropertyItem>
                  </PropertyGrid>
                </PropertyCard>

                <PropertyCard>
                  <PropertyTitle>图层动作</PropertyTitle>
                  <ActionGrid>
                    <Button
                      type="button"
                      $primary={Boolean(selectedImageLayer)}
                      onClick={() => void submitImageLayerGeneration("selected")}
                      disabled={
                        !canSubmitImageTasks ||
                        !selectedImageLayer ||
                        selectedLayer.locked
                      }
                      title={
                        selectedImageLayer
                          ? "为当前图片层重新提交生成任务"
                          : "只有图片或特效图层支持重生成"
                      }
                    >
                      {generationBusyTarget === "selected"
                        ? "提交中..."
                        : "重生成当前层"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => moveSelectedLayer(-10, 0)}
                      disabled={selectedLayer.locked}
                    >
                      左移
                    </Button>
                    <Button
                      type="button"
                      onClick={() => moveSelectedLayer(10, 0)}
                      disabled={selectedLayer.locked}
                    >
                      右移
                    </Button>
                    <Button
                      type="button"
                      onClick={() => moveSelectedLayer(0, -10)}
                      disabled={selectedLayer.locked}
                    >
                      上移
                    </Button>
                    <Button
                      type="button"
                      onClick={() => moveSelectedLayer(0, 10)}
                      disabled={selectedLayer.locked}
                    >
                      下移
                    </Button>
                    <Button
                      type="button"
                      onClick={() => changeSelectedZIndex(1)}
                      disabled={selectedLayer.locked}
                    >
                      上层
                    </Button>
                    <Button
                      type="button"
                      onClick={() => changeSelectedZIndex(-1)}
                      disabled={selectedLayer.locked}
                    >
                      下层
                    </Button>
                    <Button type="button" onClick={toggleSelectedVisibility}>
                      {selectedLayer.visible ? "隐藏" : "显示"}
                    </Button>
                    <Button type="button" onClick={toggleSelectedLock}>
                      {selectedLayer.locked ? "解锁" : "锁定"}
                    </Button>
                  </ActionGrid>
                </PropertyCard>

                <PropertyCard>
                  <PropertyTitle>拆层候选</PropertyTitle>
                  {extraction ? (
                    <>
                      <Hint>
                        当前来源：扁平图拆层 draft；已选
                        {
                          extraction.candidates.filter((candidate) =>
                            candidate.selected,
                          ).length
                        }
                        /{extraction.candidates.length} 个候选层。clean plate：
                        {extraction.cleanPlate.status}
                        {extraction.cleanPlate.message
                          ? `（${extraction.cleanPlate.message}）`
                          : "。"}
                      </Hint>
                      <CandidateList>
                        {extraction.candidates.map((candidate) => (
                          <CandidateButton
                            key={candidate.id}
                            type="button"
                            $selected={candidate.selected}
                            onClick={() =>
                              toggleExtractionCandidate(candidate.id)
                            }
                          >
                            <LayerName>
                              {candidate.selected ? "☑ " : "☐ "}
                              {candidate.layer.name}
                            </LayerName>
                            <CandidateMeta>
                              {candidate.role} / 置信度{" "}
                              {Math.round(candidate.confidence * 100)}%
                              {candidate.issues?.includes("low_confidence")
                                ? " / 低置信度"
                                : ""}
                            </CandidateMeta>
                          </CandidateButton>
                        ))}
                      </CandidateList>
                    </>
                  ) : (
                    <Hint>当前文档还没有扁平图拆层候选。</Hint>
                  )}
                </PropertyCard>

                <PropertyCard>
                  <PropertyTitle>生成来源</PropertyTitle>
                  <Hint>
                    类型：{layerTypeLabels[selectedLayer.type]}；来源：
                    {selectedLayer.source}。
                    {selectedAsset
                      ? ` 资产：${selectedAsset.id}，模型：${
                          selectedAsset.modelId ?? "未记录"
                        }。`
                      : " 当前图层没有绑定图片资产。"}
                  </Hint>
                </PropertyCard>
              </>
            ) : (
              <PropertyCard>
                <Hint>当前文档还没有图层。</Hint>
              </PropertyCard>
            )}
          </InspectorBody>
        </Inspector>
      </Shell>
    );
  },
);

DesignCanvas.displayName = "DesignCanvas";
