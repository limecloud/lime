import { safeInvoke } from "@/lib/dev-bridge";

export type KnowledgePackStatus =
  | "draft"
  | "ready"
  | "needs-review"
  | "stale"
  | "disputed"
  | "archived"
  | string;

export interface KnowledgePackMetadata {
  name: string;
  description: string;
  type: string;
  status: KnowledgePackStatus;
  version?: string | null;
  language?: string | null;
  license?: string | null;
  maintainers: string[];
  scope?: string | null;
  trust?: string | null;
  grounding?: string | null;
}

export interface KnowledgePackSummary {
  metadata: KnowledgePackMetadata;
  rootPath: string;
  knowledgePath: string;
  defaultForWorkspace: boolean;
  updatedAt: number;
  sourceCount: number;
  wikiCount: number;
  compiledCount: number;
  runCount: number;
  preview?: string | null;
}

export interface KnowledgePackFileEntry {
  relativePath: string;
  absolutePath: string;
  bytes: number;
  updatedAt: number;
  sha256?: string | null;
  preview?: string | null;
}

export interface KnowledgePackDetail extends KnowledgePackSummary {
  guide: string;
  sources: KnowledgePackFileEntry[];
  wiki: KnowledgePackFileEntry[];
  compiled: KnowledgePackFileEntry[];
  runs: KnowledgePackFileEntry[];
}

export interface KnowledgeListPacksRequest {
  workingDir: string;
  includeArchived?: boolean;
}

export interface KnowledgeListPacksResponse {
  workingDir: string;
  rootPath: string;
  packs: KnowledgePackSummary[];
}

export interface KnowledgeImportSourceRequest {
  workingDir: string;
  packName: string;
  description?: string;
  packType?: string;
  language?: string;
  sourceFileName?: string;
  sourceText?: string;
}

export interface KnowledgeImportSourceResponse {
  pack: KnowledgePackDetail;
  source: KnowledgePackFileEntry;
}

export interface KnowledgeCompilePackResponse {
  pack: KnowledgePackDetail;
  selectedSourceCount: number;
  compiledView: KnowledgePackFileEntry;
  run: KnowledgePackFileEntry;
  warnings: string[];
}

export interface KnowledgeSetDefaultPackResponse {
  defaultPackName: string;
  defaultMarkerPath: string;
}

export interface KnowledgeUpdatePackStatusRequest {
  workingDir: string;
  name: string;
  status: KnowledgePackStatus;
}

export interface KnowledgeUpdatePackStatusResponse {
  pack: KnowledgePackDetail;
  previousStatus: KnowledgePackStatus;
  clearedDefault: boolean;
}

export interface KnowledgeResolveContextRequest {
  workingDir: string;
  name: string;
  task?: string;
  maxChars?: number;
}

export interface KnowledgeContextView {
  relativePath: string;
  tokenEstimate: number;
  charCount: number;
  sourceAnchors: string[];
}

export interface KnowledgeContextResolution {
  packName: string;
  status: KnowledgePackStatus;
  grounding?: string | null;
  selectedViews: KnowledgeContextView[];
  warnings: string[];
  tokenEstimate: number;
  fencedContext: string;
}

export function listKnowledgePacks(
  request: KnowledgeListPacksRequest,
): Promise<KnowledgeListPacksResponse> {
  return safeInvoke("knowledge_list_packs", { request });
}

export function getKnowledgePack(
  workingDir: string,
  name: string,
): Promise<KnowledgePackDetail> {
  return safeInvoke("knowledge_get_pack", {
    request: {
      workingDir,
      name,
    },
  });
}

export function importKnowledgeSource(
  request: KnowledgeImportSourceRequest,
): Promise<KnowledgeImportSourceResponse> {
  return safeInvoke("knowledge_import_source", { request });
}

export function compileKnowledgePack(
  workingDir: string,
  name: string,
): Promise<KnowledgeCompilePackResponse> {
  return safeInvoke("knowledge_compile_pack", {
    request: {
      workingDir,
      name,
    },
  });
}

export function setDefaultKnowledgePack(
  workingDir: string,
  name: string,
): Promise<KnowledgeSetDefaultPackResponse> {
  return safeInvoke("knowledge_set_default_pack", {
    request: {
      workingDir,
      name,
    },
  });
}

export function updateKnowledgePackStatus(
  request: KnowledgeUpdatePackStatusRequest,
): Promise<KnowledgeUpdatePackStatusResponse> {
  return safeInvoke("knowledge_update_pack_status", { request });
}

export function resolveKnowledgeContext(
  request: KnowledgeResolveContextRequest,
): Promise<KnowledgeContextResolution> {
  return safeInvoke("knowledge_resolve_context", { request });
}
