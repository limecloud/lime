export function resolveProviderTestModel(
  providerCustomModels: string[] | undefined,
  rawInputValue: string,
): string | undefined {
  const parsedInputModels = rawInputValue
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  if (parsedInputModels.length > 0) {
    return parsedInputModels[0];
  }

  const fallbackModel = providerCustomModels?.find(
    (model) => model.trim().length > 0,
  );

  return fallbackModel?.trim();
}

export function verifyProviderSelectionSync(
  selectedId: string | null,
  displayedProviderId: string | null,
): boolean {
  if (selectedId === null) {
    return displayedProviderId === null;
  }

  return selectedId === displayedProviderId;
}

export function extractSelectionState(
  selectedProviderId: string | null,
  selectedProvider: { id: string } | null,
): {
  listSelectedId: string | null;
  settingProviderId: string | null;
  isSynced: boolean;
} {
  const settingProviderId = selectedProvider?.id ?? null;
  return {
    listSelectedId: selectedProviderId,
    settingProviderId,
    isSynced: verifyProviderSelectionSync(
      selectedProviderId,
      settingProviderId,
    ),
  };
}
