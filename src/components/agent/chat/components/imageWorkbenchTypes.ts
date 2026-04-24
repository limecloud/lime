import type { ImageStoryboardSlot } from "../types";

export type ImageWorkbenchTaskMode = "generate" | "edit" | "variation";

export type ImageWorkbenchTaskStatus =
  | "queued"
  | "routing"
  | "running"
  | "partial"
  | "complete"
  | "cancelled"
  | "error";

export interface ImageWorkbenchViewport {
  x: number;
  y: number;
  scale: number;
}

export interface ImageWorkbenchTaskView {
  id: string;
  mode: ImageWorkbenchTaskMode;
  status: ImageWorkbenchTaskStatus;
  prompt: string;
  rawText: string;
  expectedCount: number;
  layoutHint?: string | null;
  storyboardSlots?: ImageStoryboardSlot[];
  outputIds: string[];
  targetOutputId?: string | null;
  targetOutputRefId?: string | null;
  sourceImageUrl?: string | null;
  sourceImagePrompt?: string | null;
  sourceImageRef?: string | null;
  sourceImageCount?: number;
  createdAt: number;
  failureMessage?: string;
}

export interface ImageWorkbenchOutputView {
  id: string;
  refId: string;
  taskId: string;
  url: string;
  prompt: string;
  slotId?: string | null;
  slotIndex?: number | null;
  slotLabel?: string | null;
  slotPrompt?: string | null;
  createdAt: number;
  providerName?: string;
  modelName?: string;
  size?: string;
  parentOutputId?: string | null;
  resourceSaved?: boolean;
}

export interface ImageTaskViewerProps {
  tasks: ImageWorkbenchTaskView[];
  outputs: ImageWorkbenchOutputView[];
  selectedOutputId: string | null;
  viewport: ImageWorkbenchViewport;
  preferenceSummary?: string | null;
  preferenceWarning?: string | null;
  availableProviders: Array<{ id: string; name?: string }>;
  selectedProviderId: string;
  onProviderChange: (providerId: string) => void;
  availableModels: Array<{
    id: string;
    name: string;
    supportedSizes: string[];
  }>;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  selectedSize: string;
  onSizeChange: (size: string) => void;
  generating: boolean;
  savingToResource: boolean;
  onStopGeneration?: () => void;
  onViewportChange: (viewport: ImageWorkbenchViewport) => void;
  onSelectOutput: (outputId: string) => void;
  onSaveSelectedToLibrary?: () => void;
  applySelectedOutputLabel?: string;
  onApplySelectedOutput?: () => void;
  onSeedFollowUpCommand?: (command: string) => void;
  onOpenImage?: (url: string) => void;
  onClose?: () => void;
}
