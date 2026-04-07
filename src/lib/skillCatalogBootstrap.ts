import {
  applyServerSyncedSkillCatalog,
  parseSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";

const SKILL_CATALOG_BOOTSTRAP_EVENT = "lime:skill-catalog-bootstrap";

declare global {
  interface Window {
    __LIME_BOOTSTRAP__?: unknown;
    __LIME_SKILL_CATALOG__?: unknown;
  }
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function extractFromRecord(
  record: Record<string, unknown>,
): SkillCatalog | null {
  const directCatalog = parseSkillCatalog(record.skillCatalog);
  if (directCatalog) {
    return directCatalog;
  }

  const nestedBootstrap = record.bootstrap;
  if (nestedBootstrap && typeof nestedBootstrap === "object") {
    return extractSkillCatalogFromBootstrapPayload(nestedBootstrap);
  }

  return null;
}

function extractSkillCatalogFromBootstrapPayload(
  payload: unknown,
): SkillCatalog | null {
  const directCatalog = parseSkillCatalog(payload);
  if (directCatalog) {
    return directCatalog;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  return extractFromRecord(payload as Record<string, unknown>);
}

export function syncSkillCatalogFromBootstrapPayload(
  payload: unknown,
): SkillCatalog | null {
  const catalog = extractSkillCatalogFromBootstrapPayload(payload);
  if (!catalog) {
    return null;
  }

  return applyServerSyncedSkillCatalog(catalog, "bootstrap_sync");
}

export function applyInitialSkillCatalogBootstrap(): SkillCatalog | null {
  if (!hasWindow()) {
    return null;
  }

  if (window.__LIME_SKILL_CATALOG__ !== undefined) {
    const directCatalog = syncSkillCatalogFromBootstrapPayload({
      skillCatalog: window.__LIME_SKILL_CATALOG__,
    });
    if (directCatalog) {
      return directCatalog;
    }
  }

  return syncSkillCatalogFromBootstrapPayload(window.__LIME_BOOTSTRAP__);
}

export function subscribeSkillCatalogBootstrap(
  listener?: (catalog: SkillCatalog | null) => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    listener?.(syncSkillCatalogFromBootstrapPayload(event.detail));
  };

  window.addEventListener(SKILL_CATALOG_BOOTSTRAP_EVENT, handler);
  return () => {
    window.removeEventListener(SKILL_CATALOG_BOOTSTRAP_EVENT, handler);
  };
}
