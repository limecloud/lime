import { getOemCloudBootstrapSnapshot } from "./cloudAccount";
import {
  applyServerSyncedServiceSkillCatalog,
  parseServiceSkillCatalog,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";
import { extractBaseSetupPackageFromBootstrapPayload } from "@/lib/base-setup/bootstrap";

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
    return extractServiceSkillCatalogPayloadFromBootstrapPayload(
      nestedBootstrap,
    );
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

export function syncServiceSkillCatalogFromBootstrapPayload(
  payload: unknown,
): ServiceSkillCatalog | null {
  const extracted =
    extractServiceSkillCatalogPayloadFromBootstrapPayload(payload);
  if (!extracted) {
    return null;
  }

  return applyServerSyncedServiceSkillCatalog(extracted, "bootstrap_sync");
}

export function applyInitialServiceSkillCatalogBootstrap(): ServiceSkillCatalog | null {
  return syncServiceSkillCatalogFromBootstrapPayload(
    getOemCloudBootstrapSnapshot(),
  );
}
