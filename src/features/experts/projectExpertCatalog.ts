import type {
  ExpertCatalog,
  ExpertCatalogProjection,
  ExpertCatalogProjectionItem,
  ExpertCatalogProjectionOptions,
  ExpertCatalogProjectionRanking,
  ExpertInstallOverlayRecord,
} from "./types";

function normalizeSearch(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function buildOverlayMap(
  overlays: ExpertInstallOverlayRecord[] | undefined,
): Map<string, ExpertInstallOverlayRecord> {
  return new Map(
    (overlays ?? []).map((overlay) => [overlay.expertId, overlay]),
  );
}

function matchesQuery(
  item: ExpertCatalogProjectionItem,
  query: string,
): boolean {
  if (!query) {
    return true;
  }
  const haystack = [item.title, item.summary, item.category, ...item.tags]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function matchesCategory(
  item: ExpertCatalogProjectionItem,
  category: string | undefined,
): boolean {
  return !category || category === "all" || item.category === category;
}

function buildRankingKeysByExpert(
  catalog: ExpertCatalog,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  catalog.rankings.forEach((ranking) => {
    ranking.items.forEach((expertId) => {
      const keys = result.get(expertId) ?? [];
      keys.push(ranking.key);
      result.set(expertId, keys);
    });
  });
  return result;
}

function projectItems(
  catalog: ExpertCatalog,
  overlays: ExpertInstallOverlayRecord[] | undefined,
): ExpertCatalogProjectionItem[] {
  const overlayByExpert = buildOverlayMap(overlays);
  const rankingKeysByExpert = buildRankingKeysByExpert(catalog);
  return catalog.items.map((item) => {
    const overlay = overlayByExpert.get(item.id);
    return {
      ...item,
      installed: Boolean(overlay),
      pinned: overlay?.pinned ?? false,
      hidden: overlay?.hidden ?? false,
      lastUsedAt: overlay?.lastUsedAt ?? null,
      rankingKeys: rankingKeysByExpert.get(item.id) ?? [],
    };
  });
}

function sortProjectionItems(
  items: ExpertCatalogProjectionItem[],
): ExpertCatalogProjectionItem[] {
  return [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    return (right.stats.hotScore ?? 0) - (left.stats.hotScore ?? 0);
  });
}

function projectRankings(
  catalog: ExpertCatalog,
  items: ExpertCatalogProjectionItem[],
): ExpertCatalogProjectionRanking[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return catalog.rankings.map((ranking) => ({
    ...ranking,
    profiles: ranking.items
      .map((expertId) => itemById.get(expertId))
      .filter((item): item is ExpertCatalogProjectionItem => Boolean(item)),
  }));
}

export function buildExpertCatalogProjection(
  catalog: ExpertCatalog,
  options: ExpertCatalogProjectionOptions = {},
): ExpertCatalogProjection {
  const query = normalizeSearch(options.query);
  const projectedItems = projectItems(catalog, options.overlays).filter(
    (item) =>
      !item.hidden &&
      matchesCategory(item, options.category) &&
      matchesQuery(item, query),
  );
  const items = sortProjectionItems(projectedItems);

  return {
    version: catalog.version,
    catalogId: catalog.catalogId,
    syncedAt: catalog.syncedAt,
    categories: [...catalog.categories].sort(
      (left, right) => left.sort - right.sort,
    ),
    items,
    rankings: projectRankings(catalog, items),
  };
}
