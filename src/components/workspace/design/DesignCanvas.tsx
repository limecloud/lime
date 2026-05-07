import React, { memo, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  applyLayeredDesignImageTaskOutput,
  createLayeredDesignArtifactFromFlatImage,
  createLayeredDesignAssetGenerationPlan,
  createLayeredDesignExportBundle,
  createLayeredDesignProjectExportFiles,
  createLayeredDesignExportZipFile,
  buildLayeredDesignProviderCapabilitySummary,
  confirmLayeredDesignExtraction,
  createLayeredDesignImageTaskArtifacts,
  createLayeredDesignWorkerFirstFlatImageAnalyzer,
  createLayeredDesignPreviewSvgDataUrl,
  createSingleLayerAssetGenerationRequest,
  evaluateLayeredDesignExtractionQuality,
  isImageDesignLayer,
  listPendingLayeredDesignImageTasks,
  normalizeLayeredDesignDocument,
  reanalyzeLayeredDesignExtraction,
  recordLayeredDesignImageTaskSubmissions,
  refreshLayeredDesignImageTaskResults,
  sortDesignLayers,
  updateLayerLock,
  updateLayeredDesignExtractionSelection,
  updateLayerTransform,
  updateLayerVisibility,
  updateTextLayerProperties,
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
  LayeredDesignExtractionAnalysisInput,
  LayeredDesignExtractionAnalysisOutputs,
  LayeredDesignExtractionCandidate,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionCleanPlate,
  LayeredDesignExtractionCleanPlateInput,
  LayeredDesignAnalyzerProviderCapability,
  LayeredDesignAnalyzerModelSlotExecutionEvidence,
  LayeredDesignDocument,
  LayeredDesignExportZipFile,
  LayerTransformPatch,
  ShapeLayer,
  TextLayer,
} from "@/lib/layered-design";
import {
  createDesignCanvasStateFromContent,
  type DesignCanvasProps,
  type DesignCanvasState,
} from "./types";

const defaultAnalyzeLayeredDesignFlatImage =
  createLayeredDesignWorkerFirstFlatImageAnalyzer();

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
  touch-action: none;
  outline: none;
  overflow: hidden;
  padding: 0;
  box-shadow: ${({ $selected }) =>
    $selected ? "0 0 0 3px rgba(14, 165, 233, 0.18)" : "none"};
`;

const RotateHandle = styled.span`
  position: absolute;
  top: 4px;
  left: 50%;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 2px solid #0f172a;
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  cursor: grab;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  touch-action: none;
  transform: translateX(-50%);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
`;

const ResizeHandle = styled.span<{
  $corner: CanvasLayerResizeCorner;
}>`
  position: absolute;
  z-index: 3;
  display: block;
  width: 12px;
  height: 12px;
  border: 2px solid #0f172a;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
  touch-action: none;
  ${({ $corner }) =>
    $corner.includes("n") ? "top: 4px;" : "bottom: 4px;"}
  ${({ $corner }) =>
    $corner.includes("w") ? "left: 4px;" : "right: 4px;"}
  cursor: ${({ $corner }) =>
    $corner === "nw" || $corner === "se" ? "nwse-resize" : "nesw-resize"};
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

const DragHint = styled.div`
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 999;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #334155;
  font-size: 11px;
  font-weight: 600;
  padding: 5px 9px;
  pointer-events: none;
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

const FieldStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
`;

const FieldInput = styled.input`
  width: 100%;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  padding: 8px 10px;
`;

const FieldSelect = styled.select`
  width: 100%;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  padding: 8px 10px;
`;

const FieldTextArea = styled.textarea`
  width: 100%;
  min-height: 88px;
  resize: vertical;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.45;
  padding: 8px 10px;
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

const ReviewPreviewFrame = styled.div`
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.04) 25%, transparent 25%) 0 0 /
      18px 18px,
    linear-gradient(135deg, transparent 75%, rgba(15, 23, 42, 0.04) 75%) 0 0 /
      18px 18px,
    hsl(var(--muted));
`;

const ReviewPreviewImage = styled.img`
  display: block;
  width: 100%;
  height: auto;
  max-height: 260px;
  object-fit: contain;
`;

const ReviewPreviewLayerStage = styled.div`
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  padding: 18px;
`;

const ReviewPreviewLayerSurface = styled.div`
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.9);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
`;

const PreviewToggleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
`;

const PreviewToggleButton = styled.button<{ $active: boolean }>`
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(var(--foreground))" : "hsl(var(--border))"};
  border-radius: 999px;
  background: ${({ $active }) =>
    $active ? "hsl(var(--accent))" : "hsl(var(--background))"};
  color: hsl(var(--foreground));
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 7px 10px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const ReviewPreviewPlaceholder = styled.div`
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
`;

const ReviewPreviewCaption = styled.div`
  margin-top: 10px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.55;
`;

const ReviewBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(14, 165, 233, 0.28);
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.1);
  color: #0369a1;
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  padding: 5px 9px;
`;

const ReviewNotice = styled.div<{ $tone: "success" | "warning" | "info" }>`
  border: 1px solid
    ${({ $tone }) =>
      $tone === "success"
        ? "rgba(16, 185, 129, 0.3)"
        : $tone === "warning"
          ? "rgba(245, 158, 11, 0.34)"
          : "rgba(14, 165, 233, 0.3)"};
  border-radius: 14px;
  background: ${({ $tone }) =>
    $tone === "success"
      ? "rgba(16, 185, 129, 0.1)"
      : $tone === "warning"
        ? "rgba(245, 158, 11, 0.12)"
        : "rgba(14, 165, 233, 0.1)"};
  color: hsl(var(--foreground));
  font-size: 12px;
  line-height: 1.55;
  margin-top: 10px;
  padding: 10px 11px;
`;

const ReviewNoticeTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
`;

const QualityFindingList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding-left: 16px;
`;

const QualityFindingItem = styled.li`
  color: hsl(var(--foreground));
`;

const ProviderCapabilityList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
`;

const ProviderCapabilityItem = styled.div`
  border: 1px solid rgba(14, 165, 233, 0.18);
  border-radius: 12px;
  background: rgba(14, 165, 233, 0.06);
  color: hsl(var(--foreground));
  font-size: 11px;
  line-height: 1.5;
  padding: 8px 9px;
`;

const ModelSlotExecutionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
`;

const ModelSlotExecutionItem = styled.div`
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 12px;
  background: #f8fafc;
  color: hsl(var(--foreground));
  font-size: 11px;
  line-height: 1.5;
  padding: 8px 9px;
`;

const ModelSlotExecutionTitle = styled.div`
  color: #0f172a;
  font-weight: 700;
`;

const ModelSlotExecutionMeta = styled.div`
  color: hsl(var(--muted-foreground));
  margin-top: 2px;
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

type ExtractionReviewPreviewMode =
  | "source"
  | "candidate"
  | "mask"
  | "clean_plate";

type CanvasLayerResizeCorner = "nw" | "ne" | "sw" | "se";
const canvasLayerResizeCorners: CanvasLayerResizeCorner[] = [
  "nw",
  "ne",
  "sw",
  "se",
];
const MIN_CANVAS_LAYER_SIZE = 16;

interface CanvasLayerDragState {
  layerId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  scaleX: number;
  scaleY: number;
}

interface CanvasLayerResizeState extends CanvasLayerDragState {
  corner: CanvasLayerResizeCorner;
  startWidth: number;
  startHeight: number;
}

interface CanvasLayerRotationState {
  layerId: string;
  pointerId: number;
  centerClientX: number;
  centerClientY: number;
  startAngle: number;
  startRotation: number;
}

function formatExtractionAnalysisOutput(
  available: boolean,
  options: {
    availableLabel: string;
    unavailableLabel: string;
  },
): string {
  return available ? options.availableLabel : options.unavailableLabel;
}

function getStringParam(
  params: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumberParam(
  params: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBooleanParam(
  params: Record<string, unknown> | undefined,
  key: string,
): boolean | null {
  const value = params?.[key];
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readModelSlotExecutionEvidence(
  params: Record<string, unknown> | undefined,
): LayeredDesignAnalyzerModelSlotExecutionEvidence | null {
  const raw = params?.modelSlotExecution;
  if (!isRecord(raw)) {
    return null;
  }

  const slotId = getStringParam(raw, "slotId");
  const slotKind = getStringParam(raw, "slotKind");
  const providerLabel = getStringParam(raw, "providerLabel");
  const modelId = getStringParam(raw, "modelId");
  const execution = getStringParam(raw, "execution");
  const fallbackStrategy = getStringParam(raw, "fallbackStrategy");
  const status = getStringParam(raw, "status");
  const attempt = getNumberParam(raw, "attempt");
  const maxAttempts = getNumberParam(raw, "maxAttempts");
  const timeoutMs = getNumberParam(raw, "timeoutMs");
  const fallbackUsed = getBooleanParam(raw, "fallbackUsed");

  if (
    !slotId ||
    !slotKind ||
    !providerLabel ||
    !modelId ||
    !execution ||
    !fallbackStrategy ||
    !status ||
    attempt === null ||
    maxAttempts === null ||
    timeoutMs === null ||
    fallbackUsed === null
  ) {
    return null;
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
    ...(getStringParam(raw, "providerId")
      ? { providerId: getStringParam(raw, "providerId") ?? undefined }
      : {}),
    ...(getStringParam(raw, "modelVersion")
      ? { modelVersion: getStringParam(raw, "modelVersion") ?? undefined }
      : {}),
  };
}

function describeCleanPlateSource(asset: GeneratedDesignAsset | null): string {
  const seed = getStringParam(asset?.params, "seed");
  const provider = getStringParam(asset?.params, "provider") ?? asset?.provider;
  const model = getStringParam(asset?.params, "model") ?? asset?.modelId;

  if (provider && model) {
    return `${provider} / ${model}`;
  }
  if (provider) {
    return provider;
  }
  if (seed === "worker_heuristic_clean_plate_provider") {
    return "clean plate provider";
  }
  if (seed?.includes("heuristic")) {
    return "Worker local heuristic";
  }

  return seed ?? "未记录";
}

function describeProviderCapabilityStatus(
  capabilities: LayeredDesignAnalyzerProviderCapability[] | undefined,
): string {
  if (!capabilities || capabilities.length === 0) {
    return "未记录";
  }

  const productionReadyCount = capabilities.filter(
    (capability) => capability.quality?.productionReady === true,
  ).length;
  const reviewCount = capabilities.filter(
    (capability) => capability.quality?.requiresHumanReview !== false,
  ).length;

  if (productionReadyCount === capabilities.length) {
    return `${capabilities.length} 项 / 均生产可用`;
  }

  if (reviewCount > 0) {
    return `${capabilities.length} 项 / ${reviewCount} 项需人工复核`;
  }

  return `${capabilities.length} 项 / 实验能力`;
}

interface ModelSlotExecutionReviewSummary {
  key: string;
  roleLabel: string;
  modelId: string;
  attemptLabel: string;
  status: string;
  fallbackUsed: boolean;
  sourceLabels: string[];
}

function describeModelSlotKind(
  kind: LayeredDesignAnalyzerModelSlotExecutionEvidence["slotKind"],
): string {
  if (kind === "subject_matting") {
    return "主体抠图";
  }
  if (kind === "clean_plate") {
    return "背景修补";
  }
  if (kind === "text_ocr") {
    return "OCR TextLayer";
  }

  return kind;
}

function createModelSlotExecutionKey(
  evidence: LayeredDesignAnalyzerModelSlotExecutionEvidence,
): string {
  return [
    evidence.slotId,
    evidence.slotKind,
    evidence.modelId,
    evidence.attempt,
    evidence.maxAttempts,
    evidence.fallbackUsed ? "fallback" : "direct",
    evidence.status,
  ].join(":");
}

function describeModelSlotExecutionStatus(
  executions: readonly ModelSlotExecutionReviewSummary[],
): string {
  if (executions.length === 0) {
    return "未记录";
  }

  const fallbackCount = executions.filter((item) => item.fallbackUsed).length;
  return fallbackCount > 0
    ? `${executions.length} 条 / ${fallbackCount} 条 fallback`
    : `${executions.length} 条 / 均直接成功`;
}

function collectModelSlotExecutionSummaries(params: {
  extraction: NonNullable<LayeredDesignDocument["extraction"]>;
  assets: GeneratedDesignAsset[];
}): ModelSlotExecutionReviewSummary[] {
  const { extraction, assets } = params;
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const summaryByKey = new Map<string, ModelSlotExecutionReviewSummary>();

  const addEvidence = (
    evidence: LayeredDesignAnalyzerModelSlotExecutionEvidence | null,
    sourceLabel: string,
  ) => {
    if (!evidence) {
      return;
    }

    const key = createModelSlotExecutionKey(evidence);
    const existing = summaryByKey.get(key);
    if (existing) {
      if (!existing.sourceLabels.includes(sourceLabel)) {
        existing.sourceLabels.push(sourceLabel);
      }
      return;
    }

    summaryByKey.set(key, {
      key,
      roleLabel: describeModelSlotKind(evidence.slotKind),
      modelId: evidence.modelId,
      attemptLabel: `attempt ${evidence.attempt}/${evidence.maxAttempts}`,
      status: evidence.status,
      fallbackUsed: evidence.fallbackUsed,
      sourceLabels: [sourceLabel],
    });
  };

  for (const candidate of extraction.candidates) {
    addEvidence(
      readModelSlotExecutionEvidence(candidate.layer.params),
      candidate.layer.name,
    );
    for (const assetId of candidate.assetIds) {
      const asset = assetById.get(assetId);
      addEvidence(
        readModelSlotExecutionEvidence(asset?.params),
        candidate.layer.name,
      );
    }
  }

  if (extraction.cleanPlate.assetId) {
    const cleanPlateAsset = assetById.get(extraction.cleanPlate.assetId);
    addEvidence(
      readModelSlotExecutionEvidence(cleanPlateAsset?.params),
      "clean plate",
    );
  }

  return Array.from(summaryByKey.values());
}

function resolveCleanPlateReviewNotice(params: {
  cleanPlate: LayeredDesignExtractionCleanPlate;
  asset: GeneratedDesignAsset | null;
}): { tone: "success" | "warning" | "info"; title: string; message: string } {
  const { cleanPlate, asset } = params;
  const source = describeCleanPlateSource(asset);

  if (cleanPlate.status === "succeeded") {
    return {
      tone: "success",
      title: "背景修补可用于进入编辑",
      message: `背景修补来源：${source}。移动主体后仍建议核对边缘与原位置纹理。${
        cleanPlate.message ? ` ${cleanPlate.message}` : ""
      }`,
    };
  }

  if (cleanPlate.status === "failed") {
    return {
      tone: "warning",
      title: "背景修补失败，移动主体有露洞风险",
      message:
        cleanPlate.message ??
        "当前只能保留原图背景进入编辑；移动主体、放大主体或隐藏主体后可能露出原位置。",
    };
  }

  return {
    tone: "info",
    title: "尚未生成背景修补",
    message:
      cleanPlate.message ??
      "可以继续确认候选进入编辑，但移动主体后需要人工处理原位置背景。",
  };
}

function describeExtractionPreviewMessage(
  mode: ExtractionReviewPreviewMode,
  outputs: LayeredDesignExtractionAnalysisOutputs | undefined,
  hasFocusedCandidate: boolean,
  hasFocusedCandidateMask: boolean,
  cleanPlateMessage: string | undefined,
): string {
  if (mode === "clean_plate") {
    if (outputs?.cleanPlate) {
      return cleanPlateMessage || "当前 analyzer 已提供 clean plate 预览。";
    }

    return (
      cleanPlateMessage || "当前 analyzer 还没有生成可预览的 clean plate。"
    );
  }

  if (mode === "mask") {
    if (!hasFocusedCandidate) {
      return "当前没有可核对的候选层，也没有可预览的 mask。";
    }

    if (!outputs?.candidateMask) {
      return "当前 analyzer 还没有返回可预览的候选 mask。";
    }

    return hasFocusedCandidateMask
      ? "这里展示当前候选的 mask 预览，用来核对裁切范围；切换候选时会同步更新。"
      : "当前 analyzer 标记已有 mask 输出，但这个候选还没有可预览的 mask 资产。";
  }

  if (mode === "candidate") {
    if (!hasFocusedCandidate) {
      return "当前没有可预览的候选层。";
    }

    const baseMessage =
      "当前候选预览跟随你最近聚焦的候选层；图片候选显示裁片，文字候选直接渲染 TextLayer。";

    if (!outputs?.candidateMask) {
      return `${baseMessage} 本轮 analyzer 尚未提供 mask。`;
    }

    return hasFocusedCandidateMask
      ? `${baseMessage} 当前候选同时可切到 mask 核对裁切范围。`
      : `${baseMessage} 本轮 analyzer 声明有 mask，但当前候选还没有可预览的 mask 资产。`;
  }

  return outputs?.candidateMask
    ? "这里展示上传的原始扁平图；当前 analyzer 已返回候选 mask，可继续切到当前候选或 mask 预览核对。"
    : "这里展示上传的原始扁平图；当前 analyzer 只返回候选裁片，还没有 mask 视图。";
}

function findLayerAsset(
  layer: DesignLayer,
  assets: GeneratedDesignAsset[],
): GeneratedDesignAsset | null {
  if (!isImageDesignLayer(layer)) {
    return null;
  }

  return assets.find((asset) => asset.id === layer.assetId) ?? null;
}

function findAssetById(
  assets: GeneratedDesignAsset[],
  assetId: string | undefined,
): GeneratedDesignAsset | null {
  if (!assetId) {
    return null;
  }

  return assets.find((asset) => asset.id === assetId) ?? null;
}

function findExtractionCandidateMaskAsset(
  candidate: LayeredDesignExtractionCandidate | null,
  assets: GeneratedDesignAsset[],
): GeneratedDesignAsset | null {
  if (!candidate) {
    return null;
  }

  if (isImageDesignLayer(candidate.layer) && candidate.layer.maskAssetId) {
    return findAssetById(assets, candidate.layer.maskAssetId);
  }

  for (const assetId of candidate.assetIds) {
    const asset = findAssetById(assets, assetId);
    if (asset?.kind === "mask") {
      return asset;
    }
  }

  return null;
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeInspectorNumber(
  value: number,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return clampNumber(
    value,
    options.min ?? Number.NEGATIVE_INFINITY,
    options.max ?? Number.POSITIVE_INFINITY,
  );
}

function readPointerAngleDegrees(params: {
  clientX: number;
  clientY: number;
  centerClientX: number;
  centerClientY: number;
}): number {
  return (
    (Math.atan2(
      params.clientY - params.centerClientY,
      params.clientX - params.centerClientX,
    ) *
      180) /
    Math.PI
  );
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

function buildReviewPreviewLayerStyle(layer: DesignLayer): React.CSSProperties {
  const safeWidth = Math.max(1, Math.round(layer.width));
  const safeHeight = Math.max(1, Math.round(layer.height));
  const scale = Math.min(420 / safeWidth, 260 / safeHeight, 1);

  return {
    width: `${Math.max(1, Math.round(safeWidth * scale))}px`,
    height: `${Math.max(1, Math.round(safeHeight * scale))}px`,
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
    analyzeFlatImage = defaultAnalyzeLayeredDesignFlatImage,
    analyzerModelSlotConfigs,
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
    const [analysisBusy, setAnalysisBusy] = useState(false);
    const [reviewPreviewMode, setReviewPreviewMode] =
      useState<ExtractionReviewPreviewMode>("source");
    const flatImageInputRef = useRef<HTMLInputElement | null>(null);
    const stageFrameRef = useRef<HTMLDivElement | null>(null);
    const [layerDragState, setLayerDragState] =
      useState<CanvasLayerDragState | null>(null);
    const [layerResizeState, setLayerResizeState] =
      useState<CanvasLayerResizeState | null>(null);
    const [layerRotationState, setLayerRotationState] =
      useState<CanvasLayerRotationState | null>(null);
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
    const extractionReviewPending = extraction?.review.status === "pending";
    const extractionAnalysis = extraction?.analysis;
    const extractionSourceAsset = extraction
      ? findAssetById(document.assets, extraction.sourceAssetId)
      : null;
    const extractionCleanPlateAsset = extraction
      ? findAssetById(document.assets, extraction.cleanPlate.assetId)
      : null;
    const extractionCleanPlateNotice = extraction
      ? resolveCleanPlateReviewNotice({
          cleanPlate: extraction.cleanPlate,
          asset: extractionCleanPlateAsset,
        })
      : null;
    const extractionFocusedCandidate = extraction
      ? extraction.candidates.find(
          (candidate) => candidate.layer.id === state.selectedLayerId,
        ) ??
        extraction.candidates.find((candidate) => candidate.selected) ??
        extraction.candidates[0] ??
        null
      : null;
    const extractionFocusedCandidateAsset = extractionFocusedCandidate
      ? findAssetById(
          document.assets,
          isImageDesignLayer(extractionFocusedCandidate.layer)
            ? extractionFocusedCandidate.layer.assetId
            : extractionFocusedCandidate.assetIds[0],
        )
      : null;
    const extractionFocusedCandidateMaskAsset = extraction
      ? findExtractionCandidateMaskAsset(
          extractionFocusedCandidate,
          document.assets,
        )
      : null;
    const extractionSelectedCandidateCount = extraction
      ? extraction.candidates.filter((candidate) => candidate.selected).length
      : 0;
    const extractionQualityAssessment = extraction
      ? evaluateLayeredDesignExtractionQuality(extraction)
      : null;
    const extractionQualityBlocksConfirm =
      extractionQualityAssessment?.level === "high_risk";
    const extractionModelSlotExecutions = extraction
      ? collectModelSlotExecutionSummaries({
          extraction,
          assets: document.assets,
        })
      : [];
    const extractionReviewPreview = (() => {
      if (!extraction) {
        return null;
      }

      if (reviewPreviewMode === "clean_plate") {
        return {
          title: "修补背景",
          alt: "拆层确认预览：修补背景",
          asset: extractionCleanPlateAsset,
          layer: null,
          message: describeExtractionPreviewMessage(
            "clean_plate",
            extractionAnalysis?.outputs,
            Boolean(extractionFocusedCandidate),
            Boolean(extractionFocusedCandidateMaskAsset),
            extraction.cleanPlate.message,
          ),
        };
      }

      if (reviewPreviewMode === "mask") {
        return {
          title: `${extractionFocusedCandidate?.layer.name ?? "当前候选"} mask`,
          alt: `拆层确认预览：${extractionFocusedCandidate?.layer.name ?? "当前候选"} mask`,
          asset: extractionFocusedCandidateMaskAsset,
          layer: null,
          message: describeExtractionPreviewMessage(
            "mask",
            extractionAnalysis?.outputs,
            Boolean(extractionFocusedCandidate),
            Boolean(extractionFocusedCandidateMaskAsset),
            extraction.cleanPlate.message,
          ),
        };
      }

      if (reviewPreviewMode === "candidate") {
        return {
          title: extractionFocusedCandidate?.layer.name ?? "当前候选",
          alt: `拆层确认预览：${extractionFocusedCandidate?.layer.name ?? "当前候选"}`,
          asset: extractionFocusedCandidateAsset,
          layer: extractionFocusedCandidate?.layer ?? null,
          message: describeExtractionPreviewMessage(
            "candidate",
            extractionAnalysis?.outputs,
            Boolean(extractionFocusedCandidate),
            Boolean(extractionFocusedCandidateMaskAsset),
            extraction.cleanPlate.message,
          ),
        };
      }

      return {
        title: "原图",
        alt: "拆层确认预览：原图",
        asset: extractionSourceAsset,
        layer: null,
        message: describeExtractionPreviewMessage(
          "source",
          extractionAnalysis?.outputs,
          Boolean(extractionFocusedCandidate),
          Boolean(extractionFocusedCandidateMaskAsset),
          extraction.cleanPlate.message,
        ),
      };
    })();
    const selectedAsset = selectedLayer
      ? findLayerAsset(selectedLayer, document.assets)
      : null;
    const selectedImageLayer =
      selectedLayer && isImageDesignLayer(selectedLayer) ? selectedLayer : null;
    const selectedTextLayer =
      selectedLayer?.type === "text" ? selectedLayer : null;
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
      Boolean(normalizedProjectRootPath) &&
      generationBusyTarget === null &&
      !extractionReviewPending &&
      !analysisBusy;
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

    const startLayerDrag = (
      event: React.PointerEvent<HTMLButtonElement>,
      layer: DesignLayer,
    ) => {
      if (
        layer.locked ||
        extractionReviewPending ||
        layerResizeState ||
        layerRotationState
      )
        return;
      const stageRect = stageFrameRef.current?.getBoundingClientRect();
      if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
        return;
      }

      selectLayer(layer.id);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setLayerDragState({
        layerId: layer.id,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: layer.x,
        startY: layer.y,
        scaleX: document.canvas.width / stageRect.width,
        scaleY: document.canvas.height / stageRect.height,
      });
      event.preventDefault();
    };

    const moveLayerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
      const draggedLayer = layerDragState
        ? document.layers.find((layer) => layer.id === layerDragState.layerId)
        : null;
      if (
        !layerDragState ||
        layerDragState.pointerId !== event.pointerId ||
        !draggedLayer ||
        draggedLayer.locked
      ) {
        return;
      }

      emitDocument(
        updateLayerTransform(document, {
          layerId: layerDragState.layerId,
          transform: {
            x:
              layerDragState.startX +
              (event.clientX - layerDragState.startClientX) *
                layerDragState.scaleX,
            y:
              layerDragState.startY +
              (event.clientY - layerDragState.startClientY) *
                layerDragState.scaleY,
          },
          summary: "画布内拖拽移动图层。",
        }),
        layerDragState.layerId,
      );
      event.preventDefault();
    };

    const stopLayerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
      if (layerDragState?.pointerId === event.pointerId) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setLayerDragState(null);
      }
    };

    const startLayerResize = (
      event: React.PointerEvent<HTMLSpanElement>,
      layer: DesignLayer,
      corner: CanvasLayerResizeCorner,
    ) => {
      if (layer.locked || extractionReviewPending || layerRotationState) return;
      const stageRect = stageFrameRef.current?.getBoundingClientRect();
      if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
        return;
      }

      selectLayer(layer.id);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setLayerResizeState({
        layerId: layer.id,
        pointerId: event.pointerId,
        corner,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: layer.x,
        startY: layer.y,
        startWidth: layer.width,
        startHeight: layer.height,
        scaleX: document.canvas.width / stageRect.width,
        scaleY: document.canvas.height / stageRect.height,
      });
      event.stopPropagation();
      event.preventDefault();
    };

    const moveLayerResize = (event: React.PointerEvent<HTMLSpanElement>) => {
      const resizedLayer = layerResizeState
        ? document.layers.find((layer) => layer.id === layerResizeState.layerId)
        : null;
      if (
        !layerResizeState ||
        layerResizeState.pointerId !== event.pointerId ||
        !resizedLayer ||
        resizedLayer.locked
      ) {
        return;
      }

      const deltaX =
        (event.clientX - layerResizeState.startClientX) *
        layerResizeState.scaleX;
      const deltaY =
        (event.clientY - layerResizeState.startClientY) *
        layerResizeState.scaleY;
      const resizeFromWest = layerResizeState.corner.includes("w");
      const resizeFromNorth = layerResizeState.corner.includes("n");
      const nextWidth = Math.max(
        MIN_CANVAS_LAYER_SIZE,
        layerResizeState.startWidth + (resizeFromWest ? -deltaX : deltaX),
      );
      const nextHeight = Math.max(
        MIN_CANVAS_LAYER_SIZE,
        layerResizeState.startHeight + (resizeFromNorth ? -deltaY : deltaY),
      );

      emitDocument(
        updateLayerTransform(document, {
          layerId: layerResizeState.layerId,
          transform: {
            x: resizeFromWest
              ? layerResizeState.startX +
                (layerResizeState.startWidth - nextWidth)
              : layerResizeState.startX,
            y: resizeFromNorth
              ? layerResizeState.startY +
                (layerResizeState.startHeight - nextHeight)
              : layerResizeState.startY,
            width: nextWidth,
            height: nextHeight,
          },
          summary: "画布内缩放图层。",
        }),
        layerResizeState.layerId,
      );
      event.stopPropagation();
      event.preventDefault();
    };

    const stopLayerResize = (event: React.PointerEvent<HTMLSpanElement>) => {
      if (layerResizeState?.pointerId === event.pointerId) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setLayerResizeState(null);
      }
      event.stopPropagation();
    };

    const startLayerRotation = (
      event: React.PointerEvent<HTMLSpanElement>,
      layer: DesignLayer,
    ) => {
      if (layer.locked || extractionReviewPending || layerResizeState) return;
      const stageRect = stageFrameRef.current?.getBoundingClientRect();
      if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
        return;
      }

      const centerClientX =
        stageRect.left +
        ((layer.x + layer.width / 2) / document.canvas.width) *
          stageRect.width;
      const centerClientY =
        stageRect.top +
        ((layer.y + layer.height / 2) / document.canvas.height) *
          stageRect.height;
      const startAngle = readPointerAngleDegrees({
        clientX: event.clientX,
        clientY: event.clientY,
        centerClientX,
        centerClientY,
      });

      selectLayer(layer.id);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setLayerRotationState({
        layerId: layer.id,
        pointerId: event.pointerId,
        centerClientX,
        centerClientY,
        startAngle,
        startRotation: layer.rotation,
      });
      event.stopPropagation();
      event.preventDefault();
    };

    const moveLayerRotation = (event: React.PointerEvent<HTMLSpanElement>) => {
      const rotatedLayer = layerRotationState
        ? document.layers.find((layer) => layer.id === layerRotationState.layerId)
        : null;
      if (
        !layerRotationState ||
        layerRotationState.pointerId !== event.pointerId ||
        !rotatedLayer ||
        rotatedLayer.locked
      ) {
        return;
      }

      const nextAngle = readPointerAngleDegrees({
        clientX: event.clientX,
        clientY: event.clientY,
        centerClientX: layerRotationState.centerClientX,
        centerClientY: layerRotationState.centerClientY,
      });

      emitDocument(
        updateLayerTransform(document, {
          layerId: layerRotationState.layerId,
          transform: {
            rotation: Math.round(
              layerRotationState.startRotation +
                nextAngle -
                layerRotationState.startAngle,
            ),
          },
          summary: "画布内旋转图层。",
        }),
        layerRotationState.layerId,
      );
      event.stopPropagation();
      event.preventDefault();
    };

    const stopLayerRotation = (event: React.PointerEvent<HTMLSpanElement>) => {
      if (layerRotationState?.pointerId === event.pointerId) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        setLayerRotationState(null);
      }
      event.stopPropagation();
    };

    const updateSelectedLayerTransform = (transform: LayerTransformPatch) => {
      if (!selectedLayer || selectedLayer.locked) return;
      emitDocument(
        updateLayerTransform(document, {
          layerId: selectedLayer.id,
          transform,
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

    const updateSelectedTextLayer = (
      patch: {
        text?: string;
        fontSize?: number;
        color?: string;
        align?: TextLayer["align"];
      },
    ) => {
      if (!selectedTextLayer || selectedTextLayer.locked) return;
      emitDocument(
        updateTextLayerProperties(document, {
          layerId: selectedTextLayer.id,
          ...patch,
        }),
        selectedTextLayer.id,
      );
    };

    const exportDesignProject = async () => {
      setExportBusy(true);
      setGenerationStatus({
        tone: "info",
        message: normalizedProjectRootPath
          ? "正在保存 design.json、psd-like-manifest.json、trial.psd、assets/ 和 preview.* 到项目工程目录..."
          : "未绑定工作区，正在打包 design.json、psd-like-manifest.json、trial.psd、assets/ 和 preview.* ZIP 工程包...",
      });

      try {
        const bundle = createLayeredDesignExportBundle(document, {
          analyzerModelSlotConfigs,
        });
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
          message: `已下载 ZIP 工程包：包含 design.json、export-manifest.json、psd-like-manifest.json、trial.psd、preview.svg、preview.png 和 ${bundle.assetFiles.length} 个内嵌 assets；远程 assets 保留引用。`,
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

    const runFlatImageAnalyzer = async (
      image: {
        src: string;
        width: number;
        height: number;
        mimeType?: string;
        hasAlpha?: boolean;
      },
      createdAt: string,
      fallbackMessage: string,
    ): Promise<{
      analysis: LayeredDesignExtractionAnalysisInput | undefined;
      candidates: LayeredDesignExtractionCandidateInput[] | undefined;
      cleanPlate: LayeredDesignExtractionCleanPlateInput | undefined;
      message: string;
    }> => {
      try {
        const analysis = await analyzeFlatImage({
          image,
          createdAt,
        });
        const autoSelectedCount = analysis.candidates.filter((candidate) => {
          const confidence =
            typeof candidate.confidence === "number"
              ? candidate.confidence
              : 0;
          return candidate.selected ?? confidence >= 0.6;
        }).length;

        return {
          analysis: analysis.analysis,
          candidates: analysis.candidates,
          cleanPlate: analysis.cleanPlate,
          message: `已载入扁平图 draft，并通过 ${analysis.analysis.analyzer.label} 生成 ${autoSelectedCount}/${analysis.candidates.length} 个候选层；当前 clean plate 输出：${formatExtractionAnalysisOutput(
            analysis.analysis.outputs?.cleanPlate ?? false,
            {
              availableLabel: "已提供",
              unavailableLabel: "未提供",
            },
          )}。`,
        };
      } catch {
        return {
          analysis: undefined,
          candidates: undefined,
          cleanPlate: undefined,
          message: fallbackMessage,
        };
      }
    };

    const toggleExtractionCandidate = (candidateId: string) => {
      if (!extraction) {
        return;
      }

      const focusedCandidate = extraction.candidates.find(
        (candidate) => candidate.id === candidateId,
      );

      const selectedCandidateIds = extraction.candidates
        .filter((candidate) =>
          candidate.id === candidateId
            ? !candidate.selected
            : candidate.selected,
        )
        .map((candidate) => candidate.id);

      setReviewPreviewMode("candidate");
      emitDocument(
        updateLayeredDesignExtractionSelection(document, {
          selectedCandidateIds,
        }),
        focusedCandidate?.layer.id,
      );
    };

    const restoreDefaultExtractionSelection = () => {
      if (!extraction) {
        return;
      }

      const selectedCandidateIds = extraction.candidates
        .filter(
          (candidate) =>
            candidate.confidence >= extraction.candidateSelectionThreshold,
        )
        .map((candidate) => candidate.id);

      emitDocument(
        updateLayeredDesignExtractionSelection(document, {
          selectedCandidateIds,
          summary: `恢复默认候选选择：${selectedCandidateIds.length}/${extraction.candidates.length} 个高置信度候选层已重新选中。`,
        }),
      );
    };

    const confirmExtractionReview = () => {
      if (!extraction) {
        return;
      }

      if (extractionQualityBlocksConfirm) {
        setGenerationStatus({
          tone: "warning",
          message:
            "当前拆层质量为高风险，请先重新拆层，或选择“仅保留原图”进入编辑。",
        });
        return;
      }

      emitDocument(
        confirmLayeredDesignExtraction(document, {
          summary: `确认拆层候选并进入图层编辑：${extractionSelectedCandidateCount}/${extraction.candidates.length} 个候选层已保留。`,
        }),
      );
    };

    const confirmExtractionWithSourceOnly = () => {
      if (!extraction) {
        return;
      }

      const sourceOnlyDocument = updateLayeredDesignExtractionSelection(
        document,
        {
          selectedCandidateIds: [],
          summary: "已清空拆层候选，准备仅保留原图背景进入图层编辑。",
        },
      );

      emitDocument(
        confirmLayeredDesignExtraction(sourceOnlyDocument, {
          summary: "确认仅保留原图背景进入图层编辑。",
        }),
        extraction.backgroundLayerId,
      );
    };

    const rerunExtractionAnalysis = async () => {
      if (!extraction || !extractionSourceAsset?.src) {
        setGenerationStatus({
          tone: "warning",
          message: "当前文档缺少可重新拆层的原图来源。",
        });
        return;
      }

      const sourceMimeType =
        typeof extractionSourceAsset.params?.mimeType === "string"
          ? extractionSourceAsset.params.mimeType
          : undefined;
      const analyzedAt = new Date().toISOString();

      setAnalysisBusy(true);
      setGenerationStatus({
        tone: "info",
        message: "正在重新拆层并刷新候选图层...",
      });

      try {
        const analysis = await analyzeFlatImage({
          image: {
            src: extractionSourceAsset.src,
            width: extractionSourceAsset.width || document.canvas.width,
            height: extractionSourceAsset.height || document.canvas.height,
            mimeType: sourceMimeType,
            hasAlpha: extractionSourceAsset.hasAlpha,
          },
          createdAt: analyzedAt,
        });
        const nextDocument = reanalyzeLayeredDesignExtraction(document, {
          analysis: analysis.analysis,
          candidates: analysis.candidates,
          cleanPlate: analysis.cleanPlate,
          editedAt: analyzedAt,
          summary: `已通过 ${analysis.analysis.analyzer.label} 重新生成 ${analysis.candidates.length} 个拆层候选。`,
        });

        setReviewPreviewMode("source");
        emitDocument(nextDocument, nextDocument.extraction?.backgroundLayerId);
        setGenerationStatus({
          tone: "success",
          message: `已通过 ${analysis.analysis.analyzer.label} 重新拆层，候选层已刷新；请再次确认后进入编辑。`,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "重新拆层失败。",
        });
      } finally {
        setAnalysisBusy(false);
      }
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
      setAnalysisBusy(true);

      try {
        const importedAt = new Date().toISOString();
        const dataUrl = await readFileAsDataUrl(file);
        const { width, height } = await readImageDimensions(dataUrl);
        const analysis = await runFlatImageAnalyzer(
          {
            src: dataUrl,
            width,
            height,
            mimeType: file.type,
          },
          importedAt,
          "已载入扁平图 draft；当前 analyzer 不可用，先以原图背景进入编辑。",
        );

        const artifact = createLayeredDesignArtifactFromFlatImage({
          image: {
            src: dataUrl,
            width,
            height,
            fileName: file.name,
            mimeType: file.type,
          },
          ...(analysis.analysis ? { analysis: analysis.analysis } : {}),
          ...(analysis.candidates ? { candidates: analysis.candidates } : {}),
          ...(analysis.cleanPlate ? { cleanPlate: analysis.cleanPlate } : {}),
          documentCreatedAt: importedAt,
        });
        const nextState = createDesignCanvasStateFromContent(artifact.content);

        setReviewPreviewMode("source");
        emitState(nextState);
        setGenerationStatus({
          tone: "success",
          message: analysis.message,
        });
      } catch (error) {
        setGenerationStatus({
          tone: "error",
          message:
            error instanceof Error ? error.message : "载入扁平图 draft 失败。",
        });
      } finally {
        setAnalysisBusy(false);
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
                {extractionReviewPending ? " / 拆层确认中" : ""}
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
                    ? extractionReviewPending
                      ? "先确认拆层候选，再生成图片图层"
                      : "为所有待生成图片层创建图片任务"
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
                    ? extractionReviewPending
                      ? "先确认拆层候选，再刷新图层任务结果"
                      : "刷新已提交图片任务，并把完成结果写回图层"
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
              ref={stageFrameRef}
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
                  onPointerDown={(event) => startLayerDrag(event, layer)}
                  onPointerMove={moveLayerDrag}
                  onPointerUp={stopLayerDrag}
                  onPointerCancel={stopLayerDrag}
                  onClick={() => selectLayer(layer.id)}
                  aria-label={`选择图层 ${layer.name}`}
                >
                  {renderLayerContent(layer, document.assets)}
                  {layer.id === selectedLayer?.id &&
                  !layer.locked &&
                  !extractionReviewPending
                    ? (
                        <>
                          <RotateHandle
                            aria-label={`旋转图层 ${layer.name}`}
                            onPointerDown={(event) =>
                              startLayerRotation(event, layer)
                            }
                            onPointerMove={moveLayerRotation}
                            onPointerUp={stopLayerRotation}
                            onPointerCancel={stopLayerRotation}
                            onClick={(event) => event.stopPropagation()}
                          >
                            ↻
                          </RotateHandle>
                          {canvasLayerResizeCorners.map((corner) => (
                            <ResizeHandle
                              key={corner}
                              $corner={corner}
                              aria-label={`缩放图层 ${layer.name} ${corner}`}
                              onPointerDown={(event) =>
                                startLayerResize(event, layer, corner)
                              }
                              onPointerMove={moveLayerResize}
                              onPointerUp={stopLayerResize}
                              onPointerCancel={stopLayerResize}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ))}
                        </>
                      )
                    : null}
                </CanvasLayer>
              ))}
              {layerRotationState ? (
                <DragHint>拖拽旋转图层</DragHint>
              ) : layerResizeState ? (
                <DragHint>拖拽缩放图层</DragHint>
              ) : layerDragState ? (
                <DragHint>拖拽移动图层</DragHint>
              ) : null}
            </StageFrame>
          </StageViewport>
        </StageColumn>

        <Inspector aria-label="图层属性">
          <PanelHeader>
            <Eyebrow>{extractionReviewPending ? "拆层确认" : "属性"}</Eyebrow>
            <Title>
              {extractionReviewPending
                ? "确认候选图层后进入编辑"
                : selectedLayer?.name ?? "未选择图层"}
            </Title>
          </PanelHeader>
          <InspectorBody>
            {extractionReviewPending && extraction ? (
              <>
                <PropertyCard>
                  <PropertyTitle>拆层确认</PropertyTitle>
                  <ReviewBadge>待确认</ReviewBadge>
                  <Hint>
                    当前上传图已进入 extraction draft。先确认要保留的候选层，再进入正式图层编辑；进入后才开放移动、层级调整和图层重生成。
                  </Hint>
                  <PropertyGrid style={{ marginTop: 10 }}>
                    <PropertyItem>
                      <PropertyLabel>原图尺寸</PropertyLabel>
                      <PropertyValue>
                        {document.canvas.width} x {document.canvas.height}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>已选候选</PropertyLabel>
                      <PropertyValue>
                        {extractionSelectedCandidateCount}/
                        {extraction.candidates.length}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>当前 analyzer</PropertyLabel>
                      <PropertyValue>
                        {extractionAnalysis?.analyzer.label ?? "未记录"}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>raster 候选</PropertyLabel>
                      <PropertyValue>
                        {formatExtractionAnalysisOutput(
                          extractionAnalysis?.outputs.candidateRaster ?? false,
                          {
                            availableLabel: "已提供",
                            unavailableLabel: "未提供",
                          },
                        )}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>mask</PropertyLabel>
                      <PropertyValue>
                        {formatExtractionAnalysisOutput(
                          extractionAnalysis?.outputs.candidateMask ?? false,
                          {
                            availableLabel: "已提供",
                            unavailableLabel: "未提供",
                          },
                        )}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>OCR text</PropertyLabel>
                      <PropertyValue>
                        {formatExtractionAnalysisOutput(
                          extractionAnalysis?.outputs.ocrText ?? false,
                          {
                            availableLabel: "已提供",
                            unavailableLabel: "未提供",
                          },
                        )}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>clean plate</PropertyLabel>
                      <PropertyValue>
                        {formatExtractionAnalysisOutput(
                          extractionAnalysis?.outputs.cleanPlate ?? false,
                          {
                            availableLabel: "已提供",
                            unavailableLabel: extraction.cleanPlate.status,
                          },
                        )}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>背景修补来源</PropertyLabel>
                      <PropertyValue>
                        {describeCleanPlateSource(extractionCleanPlateAsset)}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>能力矩阵</PropertyLabel>
                      <PropertyValue>
                        {describeProviderCapabilityStatus(
                          extractionAnalysis?.providerCapabilities,
                        )}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>模型执行</PropertyLabel>
                      <PropertyValue>
                        {describeModelSlotExecutionStatus(
                          extractionModelSlotExecutions,
                        )}
                      </PropertyValue>
                    </PropertyItem>
                    <PropertyItem>
                      <PropertyLabel>确认状态</PropertyLabel>
                      <PropertyValue>{extraction.review.status}</PropertyValue>
                    </PropertyItem>
                  </PropertyGrid>
                  {extractionQualityAssessment ? (
                    <ReviewNotice
                      $tone={
                        extractionQualityAssessment.level === "ready"
                          ? "success"
                          : "warning"
                      }
                      aria-label="拆层质量评估"
                    >
                      <ReviewNoticeTitle>
                        拆层质量：{extractionQualityAssessment.label} /{" "}
                        {extractionQualityAssessment.score} 分
                      </ReviewNoticeTitle>
                      {extractionQualityAssessment.summary}
                      {extractionQualityAssessment.findings.length > 0 ? (
                        <QualityFindingList>
                          {extractionQualityAssessment.findings.map(
                            (finding) => (
                              <QualityFindingItem key={finding.id}>
                                {finding.title}：{finding.message}
                              </QualityFindingItem>
                            ),
                          )}
                        </QualityFindingList>
                      ) : null}
                    </ReviewNotice>
                  ) : null}
                  {extractionQualityBlocksConfirm ? (
                    <ReviewNotice $tone="warning">
                      <ReviewNoticeTitle>
                        高风险拆层已阻止直接进入编辑
                      </ReviewNoticeTitle>
                      请先重新拆层，或选择“仅保留原图”进入编辑，避免把缺
                      mask / 缺 clean plate 的候选层误当作可编辑图层。
                    </ReviewNotice>
                  ) : null}
                  {extractionAnalysis?.providerCapabilities &&
                  extractionAnalysis.providerCapabilities.length > 0 ? (
                    <ProviderCapabilityList aria-label="Analyzer provider capability">
                      {extractionAnalysis.providerCapabilities.map(
                        (capability) => (
                          <ProviderCapabilityItem
                            key={`${capability.kind}:${capability.label}`}
                          >
                            {buildLayeredDesignProviderCapabilitySummary(
                              capability,
                            )}
                          </ProviderCapabilityItem>
                        ),
                      )}
                    </ProviderCapabilityList>
                  ) : null}
                  {extractionModelSlotExecutions.length > 0 ? (
                    <ModelSlotExecutionList aria-label="Analyzer model slot execution evidence">
                      {extractionModelSlotExecutions.map((execution) => (
                        <ModelSlotExecutionItem key={execution.key}>
                          <ModelSlotExecutionTitle>
                            {execution.roleLabel}：{execution.modelId} /{" "}
                            {execution.attemptLabel} / {execution.status}
                          </ModelSlotExecutionTitle>
                          <ModelSlotExecutionMeta>
                            来源：{execution.sourceLabels.join("、")}
                            {execution.fallbackUsed ? " / 已走 fallback" : ""}
                          </ModelSlotExecutionMeta>
                        </ModelSlotExecutionItem>
                      ))}
                    </ModelSlotExecutionList>
                  ) : null}
                  {extractionCleanPlateNotice ? (
                    <ReviewNotice $tone={extractionCleanPlateNotice.tone}>
                      <ReviewNoticeTitle>
                        {extractionCleanPlateNotice.title}
                      </ReviewNoticeTitle>
                      {extractionCleanPlateNotice.message}
                    </ReviewNotice>
                  ) : null}
                </PropertyCard>

                <PropertyCard>
                  <PropertyTitle>对照预览</PropertyTitle>
                  <Hint>
                    这里对照原图、当前候选、候选 mask 和 clean plate；当前仍未做真实 matting /
                    mask refine，但 UI 已直接消费同一份 extraction 事实源里的预览资产和文字候选。
                  </Hint>
                  <PreviewToggleRow>
                    <PreviewToggleButton
                      type="button"
                      $active={reviewPreviewMode === "source"}
                      onClick={() => setReviewPreviewMode("source")}
                    >
                      查看原图
                    </PreviewToggleButton>
                    <PreviewToggleButton
                      type="button"
                      $active={reviewPreviewMode === "candidate"}
                      onClick={() => setReviewPreviewMode("candidate")}
                      disabled={!extractionFocusedCandidate}
                    >
                      查看当前候选
                    </PreviewToggleButton>
                    <PreviewToggleButton
                      type="button"
                      $active={reviewPreviewMode === "mask"}
                      onClick={() => setReviewPreviewMode("mask")}
                      disabled={!extractionFocusedCandidate}
                    >
                      查看 mask
                    </PreviewToggleButton>
                    <PreviewToggleButton
                      type="button"
                      $active={reviewPreviewMode === "clean_plate"}
                      onClick={() => setReviewPreviewMode("clean_plate")}
                    >
                      查看修补背景
                    </PreviewToggleButton>
                  </PreviewToggleRow>
                  <ReviewPreviewFrame style={{ marginTop: 10 }}>
                    {extractionReviewPreview?.asset?.src ? (
                      <ReviewPreviewImage
                        src={extractionReviewPreview.asset.src}
                        alt={extractionReviewPreview.alt}
                        draggable={false}
                      />
                    ) : extractionReviewPreview?.layer ? (
                      <ReviewPreviewLayerStage>
                        <ReviewPreviewLayerSurface
                          role="img"
                          aria-label={extractionReviewPreview.alt}
                          style={buildReviewPreviewLayerStyle(
                            extractionReviewPreview.layer,
                          )}
                        >
                          {renderLayerContent(
                            extractionReviewPreview.layer,
                            document.assets,
                          )}
                        </ReviewPreviewLayerSurface>
                      </ReviewPreviewLayerStage>
                    ) : (
                      <ReviewPreviewPlaceholder>
                        {extractionReviewPreview?.message ??
                          "当前没有可预览的拆层素材。"}
                      </ReviewPreviewPlaceholder>
                    )}
                  </ReviewPreviewFrame>
                  <ReviewPreviewCaption>
                    {extractionReviewPreview
                      ? `${extractionReviewPreview.title}：${extractionReviewPreview.message}`
                      : "当前没有可预览的拆层素材。"}
                  </ReviewPreviewCaption>
                </PropertyCard>

                <PropertyCard>
                  <PropertyTitle>候选图层</PropertyTitle>
                  <Hint>
                    低置信度候选默认不会进入正式图层。你可以先在这里补选，再确认进入编辑。
                    {extraction.cleanPlate.message
                      ? ` 当前 clean plate 提示：${extraction.cleanPlate.message}`
                      : ""}
                    点击候选时，当前候选和 mask 预览都会同步切换。
                  </Hint>
                  <CandidateList>
                    {extraction.candidates.map((candidate) => (
                      <CandidateButton
                        key={candidate.id}
                        type="button"
                        $selected={candidate.selected}
                        onClick={() => toggleExtractionCandidate(candidate.id)}
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
                </PropertyCard>

                <PropertyCard>
                  <PropertyTitle>下一步</PropertyTitle>
                  <ActionGrid>
                    <Button
                      type="button"
                      $primary
                      onClick={confirmExtractionReview}
                      disabled={analysisBusy || extractionQualityBlocksConfirm}
                      title={
                        extractionQualityBlocksConfirm
                          ? "当前拆层质量为高风险，请先重新拆层，或仅保留原图进入编辑"
                          : undefined
                      }
                    >
                      进入图层编辑
                    </Button>
                    <Button
                      type="button"
                      onClick={confirmExtractionWithSourceOnly}
                      disabled={analysisBusy}
                    >
                      仅保留原图
                    </Button>
                    <Button
                      type="button"
                      onClick={restoreDefaultExtractionSelection}
                      disabled={analysisBusy}
                    >
                      恢复默认候选
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        void rerunExtractionAnalysis();
                      }}
                      disabled={analysisBusy}
                    >
                      {analysisBusy ? "重新拆层中..." : "重新拆层"}
                    </Button>
                  </ActionGrid>
                  <Hint style={{ marginTop: 10 }}>
                    这一步只确认 `LayeredDesignDocument.extraction` 的候选选择，不会回流旧 poster /
                    image viewer 路线。
                  </Hint>
                </PropertyCard>
              </>
            ) : selectedLayer ? (
              <>
                <PropertyCard>
                  <PropertyTitle>位置与尺寸</PropertyTitle>
                  <PropertyGrid>
                    <FieldLabel>
                      X
                      <FieldInput
                        aria-label="图层 X"
                        type="number"
                        value={Math.round(selectedLayer.x)}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            x: normalizeInspectorNumber(
                              event.currentTarget.valueAsNumber,
                              selectedLayer.x,
                            ),
                          })
                        }
                      />
                    </FieldLabel>
                    <FieldLabel>
                      Y
                      <FieldInput
                        aria-label="图层 Y"
                        type="number"
                        value={Math.round(selectedLayer.y)}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            y: normalizeInspectorNumber(
                              event.currentTarget.valueAsNumber,
                              selectedLayer.y,
                            ),
                          })
                        }
                      />
                    </FieldLabel>
                    <FieldLabel>
                      宽
                      <FieldInput
                        aria-label="图层宽度"
                        type="number"
                        min={1}
                        value={Math.round(selectedLayer.width)}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            width: normalizeInspectorNumber(
                              event.currentTarget.valueAsNumber,
                              selectedLayer.width,
                              { min: 1 },
                            ),
                          })
                        }
                      />
                    </FieldLabel>
                    <FieldLabel>
                      高
                      <FieldInput
                        aria-label="图层高度"
                        type="number"
                        min={1}
                        value={Math.round(selectedLayer.height)}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            height: normalizeInspectorNumber(
                              event.currentTarget.valueAsNumber,
                              selectedLayer.height,
                              { min: 1 },
                            ),
                          })
                        }
                      />
                    </FieldLabel>
                    <FieldLabel>
                      旋转
                      <FieldInput
                        aria-label="图层旋转"
                        type="number"
                        value={Math.round(selectedLayer.rotation)}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            rotation: normalizeInspectorNumber(
                              event.currentTarget.valueAsNumber,
                              selectedLayer.rotation,
                            ),
                          })
                        }
                      />
                    </FieldLabel>
                    <FieldLabel>
                      透明度
                      <FieldInput
                        aria-label="图层透明度"
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(selectedLayer.opacity * 100)}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            opacity:
                              normalizeInspectorNumber(
                                event.currentTarget.valueAsNumber,
                                selectedLayer.opacity * 100,
                                { min: 0, max: 100 },
                              ) / 100,
                          })
                        }
                      />
                    </FieldLabel>
                    <FieldLabel>
                      层级
                      <FieldInput
                        aria-label="图层层级"
                        type="number"
                        value={selectedLayer.zIndex}
                        disabled={selectedLayer.locked}
                        onChange={(event) =>
                          updateSelectedLayerTransform({
                            zIndex: Math.round(
                              normalizeInspectorNumber(
                                event.currentTarget.valueAsNumber,
                                selectedLayer.zIndex,
                              ),
                            ),
                          })
                        }
                      />
                    </FieldLabel>
                  </PropertyGrid>
                </PropertyCard>

                {selectedTextLayer ? (
                  <PropertyCard>
                    <PropertyTitle>文字编辑</PropertyTitle>
                    <FieldStack>
                      <FieldLabel>
                        文字内容
                        <FieldTextArea
                          aria-label="文字内容"
                          value={selectedTextLayer.text}
                          disabled={selectedTextLayer.locked}
                          onChange={(event) =>
                            updateSelectedTextLayer({
                              text: event.currentTarget.value,
                            })
                          }
                        />
                      </FieldLabel>
                      <PropertyGrid>
                        <FieldLabel>
                          字号
                          <FieldInput
                            aria-label="字号"
                            type="number"
                            min={1}
                            max={512}
                            value={selectedTextLayer.fontSize}
                            disabled={selectedTextLayer.locked}
                            onChange={(event) =>
                              updateSelectedTextLayer({
                                fontSize: Number(event.currentTarget.value),
                              })
                            }
                          />
                        </FieldLabel>
                        <FieldLabel>
                          颜色
                          <FieldInput
                            aria-label="文字颜色"
                            value={selectedTextLayer.color}
                            disabled={selectedTextLayer.locked}
                            onChange={(event) =>
                              updateSelectedTextLayer({
                                color: event.currentTarget.value,
                              })
                            }
                          />
                        </FieldLabel>
                      </PropertyGrid>
                      <FieldLabel>
                        对齐
                        <FieldSelect
                          aria-label="文字对齐"
                          value={selectedTextLayer.align}
                          disabled={selectedTextLayer.locked}
                          onChange={(event) =>
                            updateSelectedTextLayer({
                              align: event.currentTarget
                                .value as TextLayer["align"],
                            })
                          }
                        >
                          <option value="left">左对齐</option>
                          <option value="center">居中</option>
                          <option value="right">右对齐</option>
                        </FieldSelect>
                      </FieldLabel>
                      <Hint>
                        OCR 或规划生成的普通文案会继续作为真实 TextLayer
                        写回 `LayeredDesignDocument`，不是烘焙图片层。
                      </Hint>
                    </FieldStack>
                  </PropertyCard>
                ) : null}

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
                        extractionReviewPending
                          ? "先确认拆层候选，再重生成当前层"
                          : selectedImageLayer
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
