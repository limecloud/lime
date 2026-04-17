export type ContextLayerSourceKind =
  | "user_input"
  | "slot"
  | "project"
  | "workspace"
  | "memory_profile"
  | "reference_library"
  | "tool_readiness";

export interface ReferenceItem {
  id: string;
  label: string;
  sourceKind: ContextLayerSourceKind;
  contentType: string;
  uri?: string | null;
  summary?: string | null;
  selected: boolean;
}

export interface TasteProfile {
  profileId: string;
  summary: string;
  keywords: string[];
  avoidKeywords: string[];
  derivedFromReferenceIds: string[];
  confidence?: number | null;
}

export interface ContextCompilerPlan {
  activeLayers: string[];
  memoryRefs: string[];
  toolRefs: string[];
  referenceCount: number;
  notes: string[];
}

export interface ContextLayerSnapshot {
  workspaceId?: string | null;
  projectId?: string | null;
  skillRefs: string[];
  memoryRefs: string[];
  toolRefs: string[];
  referenceItems: ReferenceItem[];
  tasteProfile?: TasteProfile | null;
}

export interface SceneAppContextOverlay {
  compilerPlan: ContextCompilerPlan;
  snapshot: ContextLayerSnapshot;
}
