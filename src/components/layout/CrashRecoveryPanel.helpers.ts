const MODULE_IMPORT_FAILURE_PATTERNS = [
  "Importing a module script failed",
  "Failed to fetch dynamically imported module",
] as const;
const RESOURCE_RELOAD_PARAM = "__lime_resource_reload";

export function isModuleImportFailureErrorMessage(message: string): boolean {
  return MODULE_IMPORT_FAILURE_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
}

export function buildCrashRecoveryReloadUrl(
  currentHref: string,
  cacheBust: string,
): string {
  const nextUrl = new URL(currentHref);
  nextUrl.searchParams.set(RESOURCE_RELOAD_PARAM, cacheBust);
  return nextUrl.toString();
}
