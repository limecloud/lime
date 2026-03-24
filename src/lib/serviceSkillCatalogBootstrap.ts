import {
  parseServiceSkillCatalog,
  saveServiceSkillCatalog,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";

export const SERVICE_SKILL_CATALOG_BOOTSTRAP_EVENT =
  "lime:service-skill-catalog-bootstrap";

declare global {
  interface Window {
    __LIME_BOOTSTRAP__?: unknown;
    __LIME_SERVICE_SKILL_CATALOG__?: unknown;
  }
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function extractFromRecord(record: Record<string, unknown>): ServiceSkillCatalog | null {
  const directCatalog = parseServiceSkillCatalog(record.serviceSkillCatalog);
  if (directCatalog) {
    return directCatalog;
  }

  const nestedBootstrap = record.bootstrap;
  if (nestedBootstrap && typeof nestedBootstrap === "object") {
    return extractServiceSkillCatalogFromBootstrapPayload(nestedBootstrap);
  }

  return null;
}

export function extractServiceSkillCatalogFromBootstrapPayload(
  payload: unknown,
): ServiceSkillCatalog | null {
  const directCatalog = parseServiceSkillCatalog(payload);
  if (directCatalog) {
    return directCatalog;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  return extractFromRecord(payload as Record<string, unknown>);
}

export function syncServiceSkillCatalogFromBootstrapPayload(
  payload: unknown,
): ServiceSkillCatalog | null {
  const catalog = extractServiceSkillCatalogFromBootstrapPayload(payload);
  if (!catalog) {
    return null;
  }

  return saveServiceSkillCatalog(catalog, "bootstrap_sync");
}

export function applyInitialServiceSkillCatalogBootstrap(): ServiceSkillCatalog | null {
  if (!hasWindow()) {
    return null;
  }

  if (window.__LIME_SERVICE_SKILL_CATALOG__ !== undefined) {
    const directCatalog = syncServiceSkillCatalogFromBootstrapPayload({
      serviceSkillCatalog: window.__LIME_SERVICE_SKILL_CATALOG__,
    });
    if (directCatalog) {
      return directCatalog;
    }
  }

  return syncServiceSkillCatalogFromBootstrapPayload(window.__LIME_BOOTSTRAP__);
}

export function emitServiceSkillCatalogBootstrap(payload: unknown): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SERVICE_SKILL_CATALOG_BOOTSTRAP_EVENT, {
      detail: payload,
    }),
  );
}

export function subscribeServiceSkillCatalogBootstrap(
  listener?: (catalog: ServiceSkillCatalog | null) => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    listener?.(syncServiceSkillCatalogFromBootstrapPayload(event.detail));
  };

  window.addEventListener(SERVICE_SKILL_CATALOG_BOOTSTRAP_EVENT, handler);
  return () => {
    window.removeEventListener(SERVICE_SKILL_CATALOG_BOOTSTRAP_EVENT, handler);
  };
}
