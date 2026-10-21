// Apply only to discovered choices. Saved/custom model IDs remain explicit inputs.
export function filterMiniMaxCatalogModels<T extends { id: string }>(
  providerId: string,
  models: T[],
  configuredModelIds: string[] = [],
): T[] {
  if (!["minimax", "minimax-cn"].includes(providerId)) return models;
  const current = ["MiniMax-M3.1-Flash", "MiniMax-M3"];
  return models
    .filter(
      (model) =>
        !/^MiniMax-M\d/i.test(model.id) ||
        current.includes(model.id) ||
        configuredModelIds.some(
          (id) => id.toLowerCase() === model.id.toLowerCase(),
        ),
    )
    .sort((a, b) => {
      const rank = (id: string) => {
        const index = current.indexOf(id);
        return index < 0 ? current.length : index;
      };
      return rank(a.id) - rank(b.id);
    });
}
