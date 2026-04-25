const MODULE_IMPORT_FAILURE_PATTERNS = [
  "Importing a module script failed",
  "Failed to fetch dynamically imported module",
] as const;
const RESOURCE_RELOAD_PARAM = "__lime_resource_reload";
const MODULE_IMPORT_AUTO_RELOAD_SESSION_KEY =
  "lime_module_import_auto_reload_v1";

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function isModuleImportFailureErrorMessage(message: string): boolean {
  return MODULE_IMPORT_FAILURE_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
}

function normalizeModuleImportRecoveryLocation(currentHref: string): string {
  const normalizedUrl = new URL(currentHref);
  normalizedUrl.searchParams.delete(RESOURCE_RELOAD_PARAM);
  return normalizedUrl.toString();
}

function resolveModuleImportRecoveryFingerprint(
  currentHref: string,
  appVersion: string,
): string {
  const version = appVersion.trim() || "unknown";
  return `${version}::${normalizeModuleImportRecoveryLocation(currentHref)}`;
}

export function buildCrashRecoveryReloadUrl(
  currentHref: string,
  cacheBust: string,
): string {
  const nextUrl = new URL(currentHref);
  nextUrl.searchParams.set(RESOURCE_RELOAD_PARAM, cacheBust);
  return nextUrl.toString();
}

export function stripCrashRecoveryReloadUrl(currentHref: string): string {
  const nextUrl = new URL(currentHref);
  nextUrl.searchParams.delete(RESOURCE_RELOAD_PARAM);
  return nextUrl.toString();
}

export function prepareModuleImportAutoReload(
  currentHref: string,
  appVersion: string,
  storage: SessionStorageLike,
): string | null {
  const fingerprint = resolveModuleImportRecoveryFingerprint(
    currentHref,
    appVersion,
  );

  try {
    if (
      storage.getItem(MODULE_IMPORT_AUTO_RELOAD_SESSION_KEY) === fingerprint
    ) {
      return null;
    }

    storage.setItem(MODULE_IMPORT_AUTO_RELOAD_SESSION_KEY, fingerprint);
  } catch {
    return null;
  }

  return buildCrashRecoveryReloadUrl(currentHref, `${Date.now()}`);
}

export function finalizeModuleImportAutoReload(
  currentHref: string,
  appVersion: string,
  storage: SessionStorageLike,
  history: HistoryLike,
): void {
  const fingerprint = resolveModuleImportRecoveryFingerprint(
    currentHref,
    appVersion,
  );

  try {
    if (
      storage.getItem(MODULE_IMPORT_AUTO_RELOAD_SESSION_KEY) === fingerprint
    ) {
      storage.removeItem(MODULE_IMPORT_AUTO_RELOAD_SESSION_KEY);
    }
  } catch {
    // 忽略 sessionStorage 访问失败，避免影响正常启动
  }

  const cleanUrl = stripCrashRecoveryReloadUrl(currentHref);
  if (cleanUrl === currentHref) {
    return;
  }

  try {
    history.replaceState(null, "", cleanUrl);
  } catch {
    // 忽略 history 写入失败，最多保留 query 参数，不阻断页面渲染
  }
}
