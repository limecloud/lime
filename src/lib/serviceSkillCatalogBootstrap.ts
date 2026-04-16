import {
  applyServerSyncedServiceSkillCatalog,
  parseServiceSkillCatalog,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";
import { extractBaseSetupPackageFromBootstrapPayload } from "@/lib/base-setup/bootstrap";

const SERVICE_SKILL_CATALOG_BOOTSTRAP_EVENT =
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

function extractServiceSkillCatalogPayloadFromRecord(
  record: Record<string, unknown>,
): unknown | null {
  if (record.serviceSkillCatalog !== undefined) {
    const directCatalog = parseServiceSkillCatalog(record.serviceSkillCatalog);
    if (directCatalog) {
      return record.serviceSkillCatalog;
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
    return extractServiceSkillCatalogPayloadFromBootstrapPayload(nestedBootstrap);
  }

  return null;
}

function extractServiceSkillCatalogPayloadFromBootstrapPayload(
  payload: unknown,
): unknown | null {
  const directCatalog = parseServiceSkillCatalog(payload);
  if (directCatalog) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  return extractServiceSkillCatalogPayloadFromRecord(
    payload as Record<string, unknown>,
  );
}

export function extractServiceSkillCatalogFromBootstrapPayload(
  payload: unknown,
): ServiceSkillCatalog | null {
  const extracted = extractServiceSkillCatalogPayloadFromBootstrapPayload(payload);
  if (!extracted) {
    return null;
  }

  return parseServiceSkillCatalog(extracted);
}

export function syncServiceSkillCatalogFromBootstrapPayload(
  payload: unknown,
): ServiceSkillCatalog | null {
  const extracted = extractServiceSkillCatalogPayloadFromBootstrapPayload(payload);
  if (!extracted) {
    return null;
  }

  return applyServerSyncedServiceSkillCatalog(extracted, "bootstrap_sync");
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
