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
  | "asset_generation_requested"
  | "asset_replaced"
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

export interface LayeredDesignDocumentInput {
  schemaVersion?: typeof LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION;
  id: string;
  title: string;
  status?: LayeredDesignDocumentStatus;
  canvas: DesignCanvas;
  layers?: DesignLayerInput[];
  assets?: GeneratedDesignAsset[];
  preview?: Omit<DesignPreviewProjection, "stale"> &
    Partial<Pick<DesignPreviewProjection, "stale">>;
  editHistory?: LayerEditRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export type CreateLayeredDesignDocumentParams = LayeredDesignDocumentInput;

export type LayerTransformPatch = Partial<DesignLayerTransform>;
