import {
  BASE_SETUP_ALLOWED_BINDING_FAMILIES,
  BASE_SETUP_ALLOWED_KERNEL_CAPABILITIES,
  BASE_SETUP_TARGET_CATALOGS,
  BASE_SETUP_VIEWER_KINDS,
  type BaseSetupPackage,
  type BaseSetupValidationIssue,
  type BaseSetupValidationResult,
} from "./types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pushIssue(
  issues: BaseSetupValidationIssue[],
  issue: BaseSetupValidationIssue,
): void {
  issues.push(issue);
}

function finalizeIssues(
  issues: BaseSetupValidationIssue[],
): BaseSetupValidationResult {
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function collectDuplicateIds(
  entries: Array<{ id: string }>,
): Array<{ id: string; indexes: number[] }> {
  const indexesById = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const current = indexesById.get(entry.id) ?? [];
    current.push(index);
    indexesById.set(entry.id, current);
  });

  return [...indexesById.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([id, indexes]) => ({ id, indexes }));
}

function validateUniqueIds(
  issues: BaseSetupValidationIssue[],
  entries: Array<{ id: string }>,
  collectionPath: string,
): void {
  for (const duplicate of collectDuplicateIds(entries)) {
    pushIssue(issues, {
      level: "L0",
      severity: "error",
      code: "duplicate_id",
      message: `${collectionPath} 中存在重复 ID：${duplicate.id}`,
      path: collectionPath,
    });
  }
}

function validateSlotProfileShape(
  issues: BaseSetupValidationIssue[],
  pkg: BaseSetupPackage,
): void {
  pkg.slotProfiles.forEach((profile, profileIndex) => {
    if (!profile.slots.length) {
      pushIssue(issues, {
        level: "L0",
        severity: "warning",
        code: "empty_slot_profile",
        message: `slotProfiles[${profileIndex}] 未声明任何 slots`,
        path: `slotProfiles[${profileIndex}]`,
      });
      return;
    }

    profile.slots.forEach((slot, slotIndex) => {
      if (!isNonEmptyString(slot.key)) {
        pushIssue(issues, {
          level: "L0",
          severity: "error",
          code: "invalid_slot_key",
          message: "slot.key 不能为空",
          path: `slotProfiles[${profileIndex}].slots[${slotIndex}].key`,
        });
      }
      if (!isNonEmptyString(slot.label)) {
        pushIssue(issues, {
          level: "L0",
          severity: "error",
          code: "invalid_slot_label",
          message: "slot.label 不能为空",
          path: `slotProfiles[${profileIndex}].slots[${slotIndex}].label`,
        });
      }
      if (!isNonEmptyString(slot.placeholder)) {
        pushIssue(issues, {
          level: "L0",
          severity: "warning",
          code: "missing_slot_placeholder",
          message: "slot.placeholder 为空，后续表单体验可能不稳定",
          path: `slotProfiles[${profileIndex}].slots[${slotIndex}].placeholder`,
        });
      }
    });
  });
}

export function validateBaseSetupStructure(
  pkg: BaseSetupPackage,
): BaseSetupValidationResult {
  const issues: BaseSetupValidationIssue[] = [];

  if (!isNonEmptyString(pkg.id)) {
    pushIssue(issues, {
      level: "L0",
      severity: "error",
      code: "invalid_package_id",
      message: "Base Setup Package 的 id 不能为空",
      path: "id",
    });
  }
  if (!isNonEmptyString(pkg.version)) {
    pushIssue(issues, {
      level: "L0",
      severity: "error",
      code: "invalid_package_version",
      message: "Base Setup Package 的 version 不能为空",
      path: "version",
    });
  }
  if (!isNonEmptyString(pkg.title)) {
    pushIssue(issues, {
      level: "L0",
      severity: "error",
      code: "invalid_package_title",
      message: "Base Setup Package 的 title 不能为空",
      path: "title",
    });
  }
  if (!isNonEmptyString(pkg.summary)) {
    pushIssue(issues, {
      level: "L0",
      severity: "error",
      code: "invalid_package_summary",
      message: "Base Setup Package 的 summary 不能为空",
      path: "summary",
    });
  }

  validateUniqueIds(issues, pkg.bundleRefs, "bundleRefs");
  validateUniqueIds(issues, pkg.catalogProjections, "catalogProjections");
  validateUniqueIds(issues, pkg.slotProfiles, "slotProfiles");
  validateUniqueIds(issues, pkg.bindingProfiles, "bindingProfiles");
  validateUniqueIds(issues, pkg.artifactProfiles, "artifactProfiles");
  validateUniqueIds(issues, pkg.scorecardProfiles, "scorecardProfiles");
  validateUniqueIds(issues, pkg.policyProfiles, "policyProfiles");
  validateUniqueIds(
    issues,
    pkg.compositionBlueprints ?? [],
    "compositionBlueprints",
  );

  if (!pkg.bundleRefs.length) {
    pushIssue(issues, {
      level: "L0",
      severity: "warning",
      code: "empty_bundle_refs",
      message: "bundleRefs 为空，当前包无法追溯标准来源",
      path: "bundleRefs",
    });
  }
  if (!pkg.catalogProjections.length) {
    pushIssue(issues, {
      level: "L0",
      severity: "warning",
      code: "empty_catalog_projections",
      message: "catalogProjections 为空，当前包不会产生任何目录项",
      path: "catalogProjections",
    });
  }

  pkg.catalogProjections.forEach((projection, index) => {
    if (!BASE_SETUP_TARGET_CATALOGS.includes(projection.targetCatalog)) {
      pushIssue(issues, {
        level: "L0",
        severity: "error",
        code: "invalid_target_catalog",
        message: `catalogProjections[${index}] 使用了非法 targetCatalog：${projection.targetCatalog}`,
        path: `catalogProjections[${index}].targetCatalog`,
      });
    }
    if (!isNonEmptyString(projection.entryKey)) {
      pushIssue(issues, {
        level: "L0",
        severity: "error",
        code: "missing_entry_key",
        message: "catalog projection 的 entryKey 不能为空",
        path: `catalogProjections[${index}].entryKey`,
      });
    }
    if (!isNonEmptyString(projection.title)) {
      pushIssue(issues, {
        level: "L0",
        severity: "error",
        code: "missing_projection_title",
        message: "catalog projection 的 title 不能为空",
        path: `catalogProjections[${index}].title`,
      });
    }
    if (!isNonEmptyString(projection.summary)) {
      pushIssue(issues, {
        level: "L0",
        severity: "error",
        code: "missing_projection_summary",
        message: "catalog projection 的 summary 不能为空",
        path: `catalogProjections[${index}].summary`,
      });
    }
  });

  validateSlotProfileShape(issues, pkg);

  if (!isNonEmptyString(pkg.compatibility.minAppVersion)) {
    pushIssue(issues, {
      level: "L0",
      severity: "error",
      code: "missing_min_app_version",
      message: "compatibility.minAppVersion 不能为空",
      path: "compatibility.minAppVersion",
    });
  }

  return finalizeIssues(issues);
}

export function validateBaseSetupReferences(
  pkg: BaseSetupPackage,
): BaseSetupValidationResult {
  const issues: BaseSetupValidationIssue[] = [];
  const bundleRefIds = new Set(pkg.bundleRefs.map((entry) => entry.id));
  const slotProfileIds = new Set(pkg.slotProfiles.map((entry) => entry.id));
  const bindingProfileIds = new Set(pkg.bindingProfiles.map((entry) => entry.id));
  const artifactProfiles = new Map(
    pkg.artifactProfiles.map((entry) => [entry.id, entry] as const),
  );
  const scorecardProfileIds = new Set(
    pkg.scorecardProfiles.map((entry) => entry.id),
  );
  const policyProfileIds = new Set(pkg.policyProfiles.map((entry) => entry.id));
  const compositionBlueprints = new Map(
    (pkg.compositionBlueprints ?? []).map((entry) => [entry.id, entry] as const),
  );

  pkg.catalogProjections.forEach((projection, index) => {
    const basePath = `catalogProjections[${index}]`;
    const refChecks = [
      ["bundleRefId", projection.bundleRefId, bundleRefIds],
      ["slotProfileRef", projection.slotProfileRef, slotProfileIds],
      ["bindingProfileRef", projection.bindingProfileRef, bindingProfileIds],
      ["artifactProfileRef", projection.artifactProfileRef, new Set(artifactProfiles.keys())],
      ["scorecardProfileRef", projection.scorecardProfileRef, scorecardProfileIds],
      ["policyProfileRef", projection.policyProfileRef, policyProfileIds],
    ] as const;

    refChecks.forEach(([field, value, allowedIds]) => {
      if (!allowedIds.has(value)) {
        pushIssue(issues, {
          level: "L1",
          severity: "error",
          code: "missing_projection_ref",
          message: `${field} 引用了不存在的对象：${value}`,
          path: `${basePath}.${field}`,
        });
      }
    });

    if (
      projection.compositionBlueprintRef &&
      !compositionBlueprints.has(projection.compositionBlueprintRef)
    ) {
      pushIssue(issues, {
        level: "L1",
        severity: "error",
        code: "missing_composition_blueprint_ref",
        message: `compositionBlueprintRef 引用了不存在的蓝图：${projection.compositionBlueprintRef}`,
        path: `${basePath}.compositionBlueprintRef`,
      });
    }
  });

  for (const [blueprintId, blueprint] of compositionBlueprints.entries()) {
    if (blueprint.artifactProfileRef && !artifactProfiles.has(blueprint.artifactProfileRef)) {
      pushIssue(issues, {
        level: "L1",
        severity: "error",
        code: "missing_blueprint_artifact_profile",
        message: `compositionBlueprint ${blueprintId} 引用了不存在的 artifactProfile：${blueprint.artifactProfileRef}`,
        path: `compositionBlueprints.${blueprintId}.artifactProfileRef`,
      });
    }

    if (blueprint.steps?.length) {
      blueprint.steps.forEach((step, stepIndex) => {
        if (step.bindingProfileRef && !bindingProfileIds.has(step.bindingProfileRef)) {
          pushIssue(issues, {
            level: "L1",
            severity: "error",
            code: "missing_step_binding_profile",
            message: `compositionBlueprint ${blueprintId} 的步骤引用了不存在的 bindingProfile：${step.bindingProfileRef}`,
            path: `compositionBlueprints.${blueprintId}.steps[${stepIndex}].bindingProfileRef`,
          });
        }
      });
    }

    if (
      blueprint.artifactProfileRef &&
      blueprint.deliveryContract?.requiredParts?.length
    ) {
      const artifactProfile = artifactProfiles.get(blueprint.artifactProfileRef);
      if (artifactProfile) {
        const artifactParts = [...artifactProfile.requiredParts].sort();
        const deliveryParts = [...blueprint.deliveryContract.requiredParts].sort();
        if (artifactParts.join("|") !== deliveryParts.join("|")) {
          pushIssue(issues, {
            level: "L1",
            severity: "error",
            code: "delivery_contract_mismatch",
            message: `compositionBlueprint ${blueprintId} 的 deliveryContract.requiredParts 与 artifactProfile.requiredParts 不一致`,
            path: `compositionBlueprints.${blueprintId}.deliveryContract.requiredParts`,
          });
        }
      }
    }
  }

  return finalizeIssues(issues);
}

export function validateBaseSetupHostBoundary(
  pkg: BaseSetupPackage,
): BaseSetupValidationResult {
  const issues: BaseSetupValidationIssue[] = [];
  const allowedBindingFamilies = new Set<string>(
    BASE_SETUP_ALLOWED_BINDING_FAMILIES,
  );
  const allowedViewerKinds = new Set<string>(BASE_SETUP_VIEWER_KINDS);
  const allowedKernelCapabilities = new Set<string>(
    BASE_SETUP_ALLOWED_KERNEL_CAPABILITIES,
  );

  pkg.bindingProfiles.forEach((profile, index) => {
    if (!allowedBindingFamilies.has(profile.bindingFamily)) {
      pushIssue(issues, {
        level: "L2",
        severity: "error",
        code: "unsupported_binding_family",
        message: `bindingProfiles[${index}] 使用了不受支持的 bindingFamily：${profile.bindingFamily}`,
        path: `bindingProfiles[${index}].bindingFamily`,
      });
    }
  });

  pkg.artifactProfiles.forEach((profile, index) => {
    if (!allowedViewerKinds.has(profile.viewerKind)) {
      pushIssue(issues, {
        level: "L2",
        severity: "error",
        code: "unsupported_viewer_kind",
        message: `artifactProfiles[${index}] 使用了不受支持的 viewerKind：${profile.viewerKind}`,
        path: `artifactProfiles[${index}].viewerKind`,
      });
    }
  });

  pkg.compatibility.requiredKernelCapabilities.forEach((capability, index) => {
    if (!allowedKernelCapabilities.has(capability)) {
      pushIssue(issues, {
        level: "L2",
        severity: "error",
        code: "unsupported_kernel_capability",
        message: `compatibility.requiredKernelCapabilities[${index}] 使用了不受支持的 capability：${capability}`,
        path: `compatibility.requiredKernelCapabilities[${index}]`,
      });
    }
  });

  return finalizeIssues(issues);
}

export function validateBaseSetupPackage(
  pkg: BaseSetupPackage,
): BaseSetupValidationResult {
  const results = [
    validateBaseSetupStructure(pkg),
    validateBaseSetupReferences(pkg),
    validateBaseSetupHostBoundary(pkg),
  ];

  return finalizeIssues(results.flatMap((result) => result.issues));
}
