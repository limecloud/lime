import type {
  BaseSetupPackage,
  BaseSetupProjectionIndex,
} from "./types";

export const BASE_SETUP_PACKAGE_STORAGE_KEY = "lime:base-setup-package:v1";

export interface StoredBaseSetupPackageSnapshot {
  packageId: string;
  packageVersion: string;
  tenantId: string;
  syncedAt: string;
  package: BaseSetupPackage;
  projectionIndex: BaseSetupProjectionIndex;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createStoredBaseSetupPackageSnapshot(params: {
  package: BaseSetupPackage;
  projectionIndex: BaseSetupProjectionIndex;
  tenantId: string;
  syncedAt: string;
}): StoredBaseSetupPackageSnapshot {
  return {
    packageId: params.package.id,
    packageVersion: params.package.version,
    tenantId: params.tenantId,
    syncedAt: params.syncedAt,
    package: cloneJsonValue(params.package),
    projectionIndex: cloneJsonValue(params.projectionIndex),
  };
}

export function readStoredBaseSetupPackageSnapshot(): StoredBaseSetupPackageSnapshot | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(BASE_SETUP_PACKAGE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredBaseSetupPackageSnapshot;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.packageId !== "string" ||
      typeof parsed.packageVersion !== "string" ||
      typeof parsed.tenantId !== "string" ||
      typeof parsed.syncedAt !== "string" ||
      !parsed.package ||
      typeof parsed.package !== "object" ||
      !parsed.projectionIndex ||
      typeof parsed.projectionIndex !== "object"
    ) {
      return null;
    }

    return cloneJsonValue(parsed);
  } catch {
    return null;
  }
}

export function saveStoredBaseSetupPackageSnapshot(
  snapshot: StoredBaseSetupPackageSnapshot,
): void {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.setItem(
      BASE_SETUP_PACKAGE_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // ignore local cache errors
  }
}

export function clearStoredBaseSetupPackageSnapshot(): void {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.removeItem(BASE_SETUP_PACKAGE_STORAGE_KEY);
  } catch {
    // ignore local cache errors
  }
}
