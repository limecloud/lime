/** Local cloud work includes bounded provider calls, tool preparation and archive transfer. */
export function cloudDesktopRequestTimeoutMs(
  params: unknown,
): number | undefined {
  const action = (params as { action?: unknown } | null)?.action;
  switch (action) {
    case "preflightEcsPurchase":
      return 60_000;
    case "prepareEcsPurchase":
    case "readEcsPurchasePreparation":
    case "prepareEcsConnection":
      return 360_000;
    case "createEcsImage":
    case "listEcsImages":
    case "hibernateEcs":
      return 120_000;
    case "readOperation":
      return 300_000;
    case "listOssBuckets":
      return 360_000;
    case "transferOssArchive":
      return 4_200_000;
    case "prepareRuntimeDistribution":
    case "readRuntimeDistribution":
    case "signRuntimeDistribution":
      return 900_000;
    case "cleanupRuntimeDistribution":
      return 360_000;
    case "transferArchive":
      return 3_900_000;
    case "rewrapArchiveForRestore":
      return 600_000;
    default:
      return undefined;
  }
}
