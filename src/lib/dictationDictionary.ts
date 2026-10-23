export const MAX_DICTATION_DICTIONARY_ENTRIES = 100;

export function normalizeDictationDictionary(
  entries?: readonly unknown[] | null,
): string[] {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_DICTATION_DICTIONARY_ENTRIES);
}
