import { getRuntimeAppVersion } from "@/lib/appVersion";
import type { ServiceSkillCatalog } from "@/lib/api/serviceSkills";
import {
  createStoredBaseSetupPackageSnapshot,
  saveStoredBaseSetupPackageSnapshot,
  type StoredBaseSetupPackageSnapshot,
} from "./storage";
import {
  parseBaseSetupPackage,
  resolveBaseSetupServiceSkillCatalog,
  type BaseSetupServiceSkillCatalogAdapterOptions,
} from "./serviceSkillCatalogAdapter";
import type { BaseSetupPackage, CompiledBaseSetupPackage } from "./types";

type UnknownRecord = Record<string, unknown>;

export interface ResolveBaseSetupCatalogPayloadOptions extends BaseSetupServiceSkillCatalogAdapterOptions {
  persistSnapshot?: boolean;
}

export interface ResolvedBaseSetupCatalogPayload {
  package: BaseSetupPackage;
  compiled: CompiledBaseSetupPackage;
  catalog: ServiceSkillCatalog;
  snapshot: StoredBaseSetupPackageSnapshot;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function buildStoredSnapshot(
  pkg: BaseSetupPackage,
  compiled: CompiledBaseSetupPackage,
): StoredBaseSetupPackageSnapshot {
  return createStoredBaseSetupPackageSnapshot({
    package: pkg,
    projectionIndex: compiled.projectionIndex,
    tenantId: compiled.serviceSkillCatalogProjection.tenantId,
    syncedAt: compiled.serviceSkillCatalogProjection.syncedAt,
  });
}

export function resolveBaseSetupCatalogPayload(
  value: unknown,
  options: ResolveBaseSetupCatalogPayloadOptions = {},
): ResolvedBaseSetupCatalogPayload | null {
  const resolved = resolveBaseSetupServiceSkillCatalog(value, {
    appVersion: options.appVersion ?? getRuntimeAppVersion(),
    tenantId: options.tenantId,
    syncedAt: options.syncedAt,
    seededFallbackAvailable: options.seededFallbackAvailable,
  });
  if (!resolved) {
    return null;
  }

  const snapshot = buildStoredSnapshot(resolved.package, resolved.compiled);
  if (options.persistSnapshot) {
    saveStoredBaseSetupPackageSnapshot(snapshot);
  }

  return {
    package: resolved.package,
    compiled: resolved.compiled,
    catalog: resolved.compiled.serviceSkillCatalogProjection,
    snapshot,
  };
}

export function extractBaseSetupPackageFromBootstrapPayload(
  payload: unknown,
): BaseSetupPackage | null {
  const directPackage = parseBaseSetupPackage(payload);
  if (directPackage) {
    return directPackage;
  }

  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const nestedPackage =
    parseBaseSetupPackage(record.baseSetupPackage) ??
    parseBaseSetupPackage(record.base_setup_package);
  if (nestedPackage) {
    return nestedPackage;
  }

  if (record.bootstrap) {
    return extractBaseSetupPackageFromBootstrapPayload(record.bootstrap);
  }

  return null;
}

export function resolveBaseSetupCatalogFromBootstrapPayload(
  payload: unknown,
  options: ResolveBaseSetupCatalogPayloadOptions = {},
): ResolvedBaseSetupCatalogPayload | null {
  const pkg = extractBaseSetupPackageFromBootstrapPayload(payload);
  if (!pkg) {
    return null;
  }

  return resolveBaseSetupCatalogPayload(pkg, options);
}
