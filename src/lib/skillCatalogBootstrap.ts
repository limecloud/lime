import {
  applyServerSyncedSkillCatalog,
  parseSkillCatalog,
  type SkillCatalog,
} from "@/lib/api/skillCatalog";
import { extractBaseSetupPackageFromBootstrapPayload } from "@/lib/base-setup/bootstrap";

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

function extractSkillCatalogPayloadFromRecord(
  record: Record<string, unknown>,
): unknown | null {
  if (record.skillCatalog !== undefined) {
    const directCatalog = parseSkillCatalog(record.skillCatalog);
    if (directCatalog) {
      return record.skillCatalog;
    }
  }

  const baseSetupPackage =
    extractBaseSetupPackageFromBootstrapPayload(record.baseSetupPackage) ??
    extractBaseSetupPackageFromBootstrapPayload(record.base_setup_package);
  if (baseSetupPackage) {
    return baseSetupPackage;
  }

  const nestedBootstrap = record.bootstrap;
  if (nestedBootstrap && typeof nestedBootstrap === "object") {
    return extractSkillCatalogPayloadFromBootstrapPayload(nestedBootstrap);
  }

  return null;
}

function extractSkillCatalogPayloadFromBootstrapPayload(
  payload: unknown,
): unknown | null {
  const directCatalog = parseSkillCatalog(payload);
  if (directCatalog) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  return extractSkillCatalogPayloadFromRecord(payload as Record<string, unknown>);
}

export function extractSkillCatalogFromBootstrapPayload(
  payload: unknown,
): SkillCatalog | null {
  const extracted = extractSkillCatalogPayloadFromBootstrapPayload(payload);
  if (!extracted) {
    return null;
  }

  return parseSkillCatalog(extracted);
}

export function syncSkillCatalogFromBootstrapPayload(
  payload: unknown,
): SkillCatalog | null {
  const extracted = extractSkillCatalogPayloadFromBootstrapPayload(payload);
  if (!extracted) {
    return null;
  }

  return applyServerSyncedSkillCatalog(extracted, "bootstrap_sync");
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
