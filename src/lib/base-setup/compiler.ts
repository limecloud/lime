import { compileServiceSkillCatalogProjection } from "./compat/serviceSkillCatalogProjection";
import type {
  BaseSetupPackage,
  CompiledBaseSetupPackage,
} from "./types";
import { validateBaseSetupPackage } from "./validator";

export interface CompileBaseSetupPackageOptions {
  tenantId?: string;
  syncedAt?: string;
}

function formatValidationIssues(pkg: BaseSetupPackage): string {
  const result = validateBaseSetupPackage(pkg);
  return result.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.code}${issue.path ? `(${issue.path})` : ""}: ${issue.message}`)
    .join("; ");
}

export function compileBaseSetupPackage(
  pkg: BaseSetupPackage,
  options: CompileBaseSetupPackageOptions = {},
): CompiledBaseSetupPackage {
  const validation = validateBaseSetupPackage(pkg);
  if (!validation.ok) {
    throw new Error(
      `Base Setup Package 校验失败：${formatValidationIssues(pkg) || "unknown error"}`,
    );
  }

  const compiled = compileServiceSkillCatalogProjection(pkg, options);
  return {
    packageId: pkg.id,
    packageVersion: pkg.version,
    serviceSkillCatalogProjection: compiled.catalog,
    projectionIndex: compiled.projectionIndex,
  };
}
