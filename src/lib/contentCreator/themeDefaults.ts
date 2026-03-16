export const DEFAULT_ENABLED_CONTENT_THEME_IDS = ["social-media", "poster"];

export function resolveEnabledContentThemes(savedThemes?: string[]): string[] {
  if (!savedThemes || savedThemes.length === 0) {
    return [...DEFAULT_ENABLED_CONTENT_THEME_IDS];
  }

  return [...savedThemes];
}
