function flattenCommandReferences(result) {
  return [...result.referencesByCommand.values()].flat();
}

export function getImportStatus(result) {
  return result.violations.length > 0
    ? "违规"
    : result.references.length === 0 && result.existingTargets.length === 0
      ? "已删除"
      : result.references.length === 0
        ? "零引用"
        : "受控";
}

export function getCommandStatus(result) {
  const uniqueReferences = [
    ...new Set(flattenCommandReferences(result)),
  ].sort();
  return result.violations.length > 0
    ? "违规"
    : uniqueReferences.length === 0
      ? "零引用"
      : "受控";
}

export function getTextStatus(result) {
  return result.violations.length > 0
    ? "违规"
    : result.references.length === 0
      ? "零引用"
      : "受控";
}

export function getTextCountStatus(result) {
  return result.violations.length > 0
    ? "违规"
    : result.runtimeMatches.length === 0
      ? "零引用"
      : "受控";
}

export function isStatusClassificationDrift(status, classification) {
  return (
    (status === "已删除" || status === "零引用") &&
    classification !== "dead-candidate"
  );
}

function collectClassificationDriftCandidates({
  importResults,
  commandResults,
  frontendTextResults,
  rustTextResults,
  rustTextCountResults,
}) {
  return [
    ...importResults
      .filter((result) =>
        isStatusClassificationDrift(
          getImportStatus(result),
          result.classification,
        ),
      )
      .map(
        (result) =>
          `${result.id} -> ${result.classification} / ${getImportStatus(result)}`,
      ),
    ...commandResults
      .filter((result) =>
        isStatusClassificationDrift(
          getCommandStatus(result),
          result.classification,
        ),
      )
      .map(
        (result) =>
          `${result.id} -> ${result.classification} / ${getCommandStatus(result)}`,
      ),
    ...frontendTextResults
      .filter((result) =>
        isStatusClassificationDrift(
          getTextStatus(result),
          result.classification,
        ),
      )
      .map(
        (result) =>
          `${result.id} -> ${result.classification} / ${getTextStatus(result)}`,
      ),
    ...rustTextResults
      .filter((result) =>
        isStatusClassificationDrift(
          getTextStatus(result),
          result.classification,
        ),
      )
      .map(
        (result) =>
          `${result.id} -> ${result.classification} / ${getTextStatus(result)}`,
      ),
    ...rustTextCountResults
      .filter((result) =>
        isStatusClassificationDrift(
          getTextCountStatus(result),
          result.classification,
        ),
      )
      .map(
        (result) =>
          `${result.id} -> ${result.classification} / ${getTextCountStatus(result)}`,
      ),
  ];
}

function collectViolations({
  importResults,
  commandResults,
  frontendTextResults,
  rustTextResults,
  rustTextCountResults,
}) {
  return [
    ...importResults.flatMap((result) =>
      result.violations.map((item) => `${result.id} -> ${item}`),
    ),
    ...commandResults.flatMap((result) =>
      result.violations.map((item) => `${result.id} -> ${item}`),
    ),
    ...frontendTextResults.flatMap((result) =>
      result.violations.map((item) => `${result.id} -> ${item}`),
    ),
    ...rustTextResults.flatMap((result) =>
      result.violations.map((item) => `${result.id} -> ${item}`),
    ),
    ...rustTextCountResults.flatMap((result) =>
      result.violations.map((item) => `${result.id} -> ${item}`),
    ),
  ];
}

export function buildLegacySurfaceSummary({
  importResults,
  commandResults,
  frontendTextResults,
  rustTextResults,
  rustTextCountResults,
}) {
  const zeroReferenceCandidates = importResults
    .filter(
      (result) =>
        result.references.length === 0 && result.existingTargets.length > 0,
    )
    .map((result) => `${result.id} (${result.description})`);

  return {
    zeroReferenceCandidates,
    classificationDriftCandidates: collectClassificationDriftCandidates({
      importResults,
      commandResults,
      frontendTextResults,
      rustTextResults,
      rustTextCountResults,
    }),
    violations: collectViolations({
      importResults,
      commandResults,
      frontendTextResults,
      rustTextResults,
      rustTextCountResults,
    }),
  };
}

export function serializeMapEntries(map) {
  return Object.fromEntries(map.entries());
}
