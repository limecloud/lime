import type { LayeredDesignAnalyzerProviderCapability } from "./providerCapabilities";

export const LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION = "2026-05-05.p1";

export type LayeredDesignDocumentStatus = "draft" | "ready" | "exported";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignCanvas {
  width: number;
  height: number;
  backgroundColor?: string;
  safeArea?: Rect;
}

export type DesignLayerSource =
  | "planned"
  | "generated"
  | "extracted"
  | "user_added";

export type DesignBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "lighten";

export interface DesignLayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}

export interface BaseDesignLayer extends DesignLayerTransform {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  blendMode?: DesignBlendMode;
  params?: Record<string, unknown>;
  source: DesignLayerSource;
}

export type ImageLayerAlphaMode = "embedded" | "mask" | "blend" | "none";

export interface ImageLayer extends BaseDesignLayer {
  type: "image" | "effect";
  assetId: string;
  maskAssetId?: string;
  alphaMode: ImageLayerAlphaMode;
  prompt?: string;
}

export interface TextLayer extends BaseDesignLayer {
  type: "text";
  text: string;
  fontFamily?: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
}

export interface ShapeLayer extends BaseDesignLayer {
  type: "shape";
  shape: "rect" | "round_rect" | "line" | "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface GroupLayer extends BaseDesignLayer {
  type: "group";
  children: string[];
}

export type DesignLayer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;

export type GeneratedDesignAssetKind =
  | "source_image"
  | "background"
  | "subject"
  | "effect"
  | "logo"
  | "text_raster"
  | "mask"
  | "clean_plate"
  | "preview";

export interface GeneratedDesignAsset {
  id: string;
  kind: GeneratedDesignAssetKind;
  src: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  provider?: string;
  modelId?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  parentAssetId?: string;
  createdAt: string;
}

export type LayeredDesignExtractionCandidateRole =
  | "subject"
  | "logo"
  | "effect"
  | "text"
  | "background_fragment";

export type LayeredDesignExtractionCandidateIssue = "low_confidence";

export type LayeredDesignExtractionCleanPlateStatus =
  | "not_requested"
  | "succeeded"
  | "failed";

export type LayeredDesignExtractionReviewStatus = "pending" | "confirmed";
export type LayeredDesignExtractionAnalyzerKind =
  | "local_heuristic"
  | "structured_pipeline"
  | "unknown";

export interface LayeredDesignExtractionAnalyzerInfo {
  kind: LayeredDesignExtractionAnalyzerKind;
  label: string;
}

export interface LayeredDesignExtractionAnalysisOutputs {
  candidateRaster: boolean;
  candidateMask: boolean;
  cleanPlate: boolean;
  ocrText: boolean;
}

export interface LayeredDesignExtractionAnalysis {
  analyzer: LayeredDesignExtractionAnalyzerInfo;
  outputs: LayeredDesignExtractionAnalysisOutputs;
  providerCapabilities?: LayeredDesignAnalyzerProviderCapability[];
  generatedAt?: string;
}

export interface LayeredDesignExtractionCleanPlate {
  status: LayeredDesignExtractionCleanPlateStatus;
  assetId?: string;
  message?: string;
}

export interface LayeredDesignExtractionReview {
  status: LayeredDesignExtractionReviewStatus;
  confirmedAt?: string;
}

export interface LayeredDesignExtractionCandidate {
  id: string;
  role: LayeredDesignExtractionCandidateRole;
  confidence: number;
  selected: boolean;
  layer: DesignLayer;
  assetIds: string[];
  issues?: LayeredDesignExtractionCandidateIssue[];
}

export interface LayeredDesignExtraction {
  sourceAssetId: string;
  backgroundLayerId: string;
  candidateSelectionThreshold: number;
  review: LayeredDesignExtractionReview;
  analysis?: LayeredDesignExtractionAnalysis;
  cleanPlate: LayeredDesignExtractionCleanPlate;
  candidates: LayeredDesignExtractionCandidate[];
}

export interface DesignPreviewProjection {
  assetId: string;
  src: string;
  width: number;
  height: number;
  updatedAt: string;
  stale: boolean;
}

export type LayerEditActor = "user" | "assistant" | "system";

export type LayerEditRecordType =
  | "created"
  | "normalized"
  | "candidate_selection_updated"
  | "candidate_selection_confirmed"
  | "extraction_reanalyzed"
  | "asset_generation_requested"
  | "asset_replaced"
  | "text_updated"
  | "transform_updated"
  | "visibility_updated"
  | "lock_updated";

export interface LayerEditRecord {
  id: string;
  type: LayerEditRecordType;
  layerId?: string;
  actor: LayerEditActor;
  summary?: string;
  previousAssetId?: string;
  nextAssetId?: string;
  previousVisible?: boolean;
  nextVisible?: boolean;
  previousLocked?: boolean;
  nextLocked?: boolean;
  previousText?: string;
  nextText?: string;
  previousFontSize?: number;
  nextFontSize?: number;
  previousColor?: string;
  nextColor?: string;
  previousAlign?: TextLayer["align"];
  nextAlign?: TextLayer["align"];
  taskId?: string;
  taskPath?: string;
  taskStatus?: string;
  transformBefore?: DesignLayerTransform;
  transformAfter?: DesignLayerTransform;
  createdAt: string;
}

export interface LayeredDesignDocument {
  schemaVersion: typeof LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION;
  id: string;
  title: string;
  status: LayeredDesignDocumentStatus;
  canvas: DesignCanvas;
  layers: DesignLayer[];
  assets: GeneratedDesignAsset[];
  extraction?: LayeredDesignExtraction;
  preview?: DesignPreviewProjection;
  editHistory: LayerEditRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface BaseDesignLayerInput {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
  locked?: boolean;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  blendMode?: DesignBlendMode;
  params?: Record<string, unknown>;
  source?: DesignLayerSource;
}

export interface ImageLayerInput extends BaseDesignLayerInput {
  type: "image" | "effect";
  assetId: string;
  maskAssetId?: string;
  alphaMode?: ImageLayerAlphaMode;
  prompt?: string;
}

export interface TextLayerInput extends BaseDesignLayerInput {
  type: "text";
  text: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
}

export interface ShapeLayerInput extends BaseDesignLayerInput {
  type: "shape";
  shape?: "rect" | "round_rect" | "line" | "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface GroupLayerInput extends BaseDesignLayerInput {
  type: "group";
  children?: string[];
}

export type DesignLayerInput =
  | ImageLayerInput
  | TextLayerInput
  | ShapeLayerInput
  | GroupLayerInput;

export interface LayeredDesignExtractionCleanPlateInput {
  status?: LayeredDesignExtractionCleanPlateStatus;
  assetId?: string;
  asset?: GeneratedDesignAsset;
  message?: string;
}

export interface LayeredDesignExtractionReviewInput {
  status?: LayeredDesignExtractionReviewStatus;
  confirmedAt?: string;
}

export interface LayeredDesignExtractionAnalyzerInfoInput {
  kind?: LayeredDesignExtractionAnalyzerKind;
  label: string;
}

export interface LayeredDesignExtractionAnalysisOutputsInput {
  candidateRaster?: boolean;
  candidateMask?: boolean;
  cleanPlate?: boolean;
  ocrText?: boolean;
}

export interface LayeredDesignExtractionAnalysisInput {
  analyzer: LayeredDesignExtractionAnalyzerInfoInput;
  outputs?: LayeredDesignExtractionAnalysisOutputsInput;
  providerCapabilities?: LayeredDesignAnalyzerProviderCapability[];
  generatedAt?: string;
}

export interface LayeredDesignExtractionCandidateInput {
  id: string;
  role: LayeredDesignExtractionCandidateRole;
  confidence?: number;
  selected?: boolean;
  layer: DesignLayerInput | DesignLayer;
  assetIds?: string[];
  assets?: GeneratedDesignAsset[];
  issues?: LayeredDesignExtractionCandidateIssue[];
}

export interface LayeredDesignExtractionInput {
  sourceAssetId: string;
  backgroundLayerId?: string;
  candidateSelectionThreshold?: number;
  review?: LayeredDesignExtractionReviewInput;
  analysis?: LayeredDesignExtractionAnalysisInput;
  cleanPlate?: LayeredDesignExtractionCleanPlateInput;
  candidates?: LayeredDesignExtractionCandidateInput[];
}

export interface LayeredDesignDocumentInput {
  schemaVersion?: typeof LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION;
  id: string;
  title: string;
  status?: LayeredDesignDocumentStatus;
  canvas: DesignCanvas;
  layers?: DesignLayerInput[];
  assets?: GeneratedDesignAsset[];
  extraction?: LayeredDesignExtractionInput;
  preview?: Omit<DesignPreviewProjection, "stale"> &
    Partial<Pick<DesignPreviewProjection, "stale">>;
  editHistory?: LayerEditRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export type CreateLayeredDesignDocumentParams = LayeredDesignDocumentInput;

export type LayerTransformPatch = Partial<DesignLayerTransform>;
