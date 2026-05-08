import {
  createImageLayer,
  createLayeredDesignDocument,
  createTextLayer,
  normalizeLayeredDesignDocument,
} from "@/lib/layered-design";
import type {
  AnalyzeLayeredDesignFlatImage,
  LayeredDesignAnalyzerModelSlotConfigInput,
  LayeredDesignDocument,
  LayeredDesignDocumentInput,
} from "@/lib/layered-design";
import type {
  CreateImageGenerationTaskArtifactRequest,
  MediaTaskArtifactOutput,
  MediaTaskLookupRequest,
} from "@/lib/api/mediaTasks";
import type {
  ReadLayeredDesignProjectExportOutput,
  ReadLayeredDesignProjectExportRequest,
  SaveLayeredDesignProjectExportOutput,
  SaveLayeredDesignProjectExportRequest,
} from "@/lib/api/layeredDesignProject";

export interface DesignCanvasState {
  type: "design";
  document: LayeredDesignDocument;
  selectedLayerId?: string;
  zoom: number;
}

export interface DesignCanvasProps {
  state: DesignCanvasState;
  onStateChange: (state: DesignCanvasState) => void;
  onClose?: () => void;
  onBackHome?: () => void;
  projectRootPath?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  imageGenerationProviderId?: string | null;
  imageGenerationModelId?: string | null;
  createImageTaskArtifact?: (
    request: CreateImageGenerationTaskArtifactRequest,
  ) => Promise<MediaTaskArtifactOutput>;
  getImageTaskArtifact?: (
    request: MediaTaskLookupRequest,
  ) => Promise<MediaTaskArtifactOutput>;
  saveProjectExport?: (
    request: SaveLayeredDesignProjectExportRequest,
  ) => Promise<SaveLayeredDesignProjectExportOutput>;
  readProjectExport?: (
    request: ReadLayeredDesignProjectExportRequest,
  ) => Promise<ReadLayeredDesignProjectExportOutput>;
  analyzeFlatImage?: AnalyzeLayeredDesignFlatImage;
  analyzerModelSlotConfigs?: readonly LayeredDesignAnalyzerModelSlotConfigInput[];
}

function createBlankDesignDocument(): LayeredDesignDocument {
  const createdAt = new Date().toISOString();
  return createLayeredDesignDocument({
    id: `design-${Date.now()}`,
    title: "未命名图层设计",
    canvas: {
      width: 1080,
      height: 1440,
      backgroundColor: "#f8fafc",
    },
    layers: [
      createImageLayer({
        id: "background",
        name: "背景",
        type: "image",
        assetId: "asset-background-placeholder",
        x: 0,
        y: 0,
        width: 1080,
        height: 1440,
        zIndex: 0,
      }),
      createTextLayer({
        id: "headline",
        name: "标题文案",
        type: "text",
        text: "双击后续版本可编辑文案",
        x: 120,
        y: 160,
        width: 840,
        height: 120,
        fontSize: 54,
        color: "#0f172a",
        align: "center",
        zIndex: 10,
      }),
    ],
    assets: [
      {
        id: "asset-background-placeholder",
        kind: "background",
        src: "",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt,
      },
    ],
    createdAt,
    updatedAt: createdAt,
  });
}

export function createInitialDesignCanvasState(
  documentInput?: LayeredDesignDocumentInput | LayeredDesignDocument,
): DesignCanvasState {
  const document = documentInput
    ? normalizeLayeredDesignDocument(documentInput)
    : createBlankDesignDocument();
  const selectedLayerId =
    document.layers[document.layers.length - 1]?.id ?? document.layers[0]?.id;

  return {
    type: "design",
    document,
    selectedLayerId,
    zoom: 0.72,
  };
}

export function createDesignCanvasStateFromContent(
  content: string,
): DesignCanvasState {
  const trimmed = content.trim();
  if (!trimmed) {
    return createInitialDesignCanvasState();
  }

  try {
    const parsed = JSON.parse(trimmed) as LayeredDesignDocumentInput;
    return createInitialDesignCanvasState(parsed);
  } catch {
    return createInitialDesignCanvasState({
      ...createBlankDesignDocument(),
      title: trimmed.slice(0, 80) || "未命名图层设计",
    });
  }
}
