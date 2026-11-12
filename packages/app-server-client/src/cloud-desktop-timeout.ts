/** Local cloud work includes bounded provider calls, tool preparation and archive transfer. */
export function cloudDesktopRequestTimeoutMs(
  params: unknown,
): number | undefined {
  const action = (params as { action?: unknown } | null)?.action;
  switch (action) {
    case "prepareEcsPurchase":
    case "readEcsPurchasePreparation":
      return 360_000;
    case "createEcsImage":
    case "listEcsImages":
      return 120_000;
    case "readOperation":
      return 180_000;
    case "listOssBuckets":
      return 360_000;
    case "transferOssArchive":
      return 4_200_000;
    case "transferArchive":
      return 3_900_000;
    case "rewrapArchiveForRestore":
      return 600_000;
    default:
      return undefined;
  }
}
