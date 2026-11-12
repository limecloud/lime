export type ExpertCatalogSource = "cloud_catalog" | "builtin" | "local_custom";

export type ExpertAvatar =
  | { kind: "emoji"; value: string }
  | { kind: "url"; value: string }
  | { kind: "asset"; value: string };

export interface ExpertStats {
  usageCount: number;
  likeCount: number;
  hotScore?: number;
  freshReleasedAt?: string;
}

export interface ExpertReadiness {
  requiresModel?: boolean;
  requiresBrowser?: boolean;
  requiresProject?: boolean;
  missingSkillRefs?: string[];
}

export interface ExpertRelease {
  releaseId: string;
  version: string;
  personaRef: string;
  personaHash?: string;
  memoryTemplateRef?: string;
  skillRefs: string[];
  workflowRefs: string[];
  readiness?: ExpertReadiness;
  releasedAt?: string;
}

export interface ExpertShowcaseItem {
  title: string;
  body: string;
}

export interface ExpertProfile {
  id: string;
  slug: string;
  title: string;
  summary: string;
  avatar: ExpertAvatar;
  category: string;
  tags: string[];
  source: ExpertCatalogSource;
  stats: ExpertStats;
  release: ExpertRelease;
  promptStarters: string[];
  showcase: ExpertShowcaseItem[];
}

export interface ExpertRanking {
  key: string;
  title: string;
  summary?: string;
  category?: string;
  items: string[];
  generatedAt?: string;
  expiresAt?: string;
}

export interface ExpertCategory {
  key: string;
  title: string;
  sort: number;
}

export interface ExpertCatalog {
  version: string;
  catalogId: string;
  syncedAt: string;
  items: ExpertProfile[];
  rankings: ExpertRanking[];
  categories: ExpertCategory[];
}

export type ExpertCatalogEventName =
  | "expert_impression"
  | "expert_detail_opened"
  | "expert_installed"
  | "expert_chat_started"
  | "expert_skill_added"
  | "expert_liked"
  | "expert_shared";

export interface ExpertCatalogEvent {
  expertId: string;
  releaseId: string;
  eventName: ExpertCatalogEventName;
  sourceSurface: string;
  catalogVersion?: string;
  clientVersion?: string;
  locale?: string;
  sessionId?: string;
  occurredAt?: string;
  metadata?: Record<string, string>;
}

export interface ExpertInstallOverlayRecord {
  expertId: string;
  releaseId: string;
  installedAt: number;
  lastUsedAt: number | null;
  pinned?: boolean;
  hidden?: boolean;
  memoryEnabled?: boolean;
  workflowEnabled?: boolean;
}

export interface ExpertCatalogProjectionOptions {
  category?: string;
  query?: string;
  overlays?: ExpertInstallOverlayRecord[];
}

export interface ExpertCatalogProjectionItem extends ExpertProfile {
  installed: boolean;
  pinned: boolean;
  hidden: boolean;
  lastUsedAt: number | null;
  rankingKeys: string[];
}

export interface ExpertCatalogProjectionRanking extends ExpertRanking {
  profiles: ExpertCatalogProjectionItem[];
}

export interface ExpertCatalogProjection {
  version: string;
  catalogId: string;
  syncedAt: string;
  categories: ExpertCategory[];
  items: ExpertCatalogProjectionItem[];
  rankings: ExpertCatalogProjectionRanking[];
}
