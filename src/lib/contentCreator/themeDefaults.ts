export const DEFAULT_ENABLED_CONTENT_THEME_IDS: string[] = [];

export function resolveEnabledContentThemes(savedThemes?: string[]): string[] {
  if (!savedThemes) {
    return [...DEFAULT_ENABLED_CONTENT_THEME_IDS];
  }

  return [...savedThemes];
}
