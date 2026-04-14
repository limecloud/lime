import {
  BASE_SETUP_ALLOWED_BINDING_FAMILIES,
  BASE_SETUP_ALLOWED_KERNEL_CAPABILITIES,
  BASE_SETUP_VIEWER_KINDS,
  type BaseSetupPackage,
  type BaseSetupRolloutInput,
  type BaseSetupRolloutResult,
} from "./types";
import { validateBaseSetupPackage } from "./validator";

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function evaluateBaseSetupRollout(
  pkg: BaseSetupPackage,
  input: BaseSetupRolloutInput,
): BaseSetupRolloutResult {
  const validation = input.validationResult ?? validateBaseSetupPackage(pkg);
  const hasL2Error = validation.issues.some(
    (issue) => issue.level === "L2" && issue.severity === "error",
  );
  if (hasL2Error) {
    return {
      decision: "reject_upgrade_required",
      reason: "Base Setup Package 触发了宿主边界错误，需要升级主 App。",
    };
  }

  const hasValidationError = validation.issues.some(
    (issue) => issue.severity === "error",
  );
  if (hasValidationError) {
    return input.seededFallbackAvailable
      ? {
          decision: "fallback_seeded",
          reason: "Base Setup Package 结构或引用校验未通过，退回 seeded fallback。",
        }
      : {
          decision: "reject_invalid_package",
          reason: "Base Setup Package 结构或引用校验未通过，且当前没有 seeded fallback。",
        };
  }

  if (compareVersions(input.appVersion, pkg.compatibility.minAppVersion) < 0) {
    return {
      decision: "reject_upgrade_required",
      reason: `当前 App 版本 ${input.appVersion} 低于包要求的最小版本 ${pkg.compatibility.minAppVersion}。`,
    };
  }

  const supportedBindingFamilies =
    input.supportedBindingFamilies ?? BASE_SETUP_ALLOWED_BINDING_FAMILIES;
  const supportedBindingFamilySet = new Set<string>(supportedBindingFamilies);
  const unsupportedBindingFamily = pkg.bindingProfiles.find(
    (profile) => !supportedBindingFamilySet.has(profile.bindingFamily),
  );
  if (unsupportedBindingFamily) {
    return {
      decision: "reject_upgrade_required",
      reason: `当前宿主不支持 binding family：${unsupportedBindingFamily.bindingFamily}。`,
    };
  }

  const supportedViewerKinds =
    input.supportedViewerKinds ?? BASE_SETUP_VIEWER_KINDS;
  const supportedViewerKindSet = new Set<string>(supportedViewerKinds);
  const unsupportedViewer = pkg.artifactProfiles.find(
    (profile) => !supportedViewerKindSet.has(profile.viewerKind),
  );
  if (unsupportedViewer) {
    return {
      decision: "reject_upgrade_required",
      reason: `当前宿主不支持 viewer kind：${unsupportedViewer.viewerKind}。`,
    };
  }

  const supportedKernelCapabilities =
    input.supportedKernelCapabilities ?? BASE_SETUP_ALLOWED_KERNEL_CAPABILITIES;
  const supportedKernelCapabilitySet = new Set<string>(
    supportedKernelCapabilities,
  );
  const unsupportedCapability = pkg.compatibility.requiredKernelCapabilities.find(
    (capability) => !supportedKernelCapabilitySet.has(capability),
  );
  if (unsupportedCapability) {
    return {
      decision: "reject_upgrade_required",
      reason: `当前宿主缺少 kernel capability：${unsupportedCapability}。`,
    };
  }

  return {
    decision: "accept",
  };
}
