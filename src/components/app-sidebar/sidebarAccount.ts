import type { CloudAccountView } from "@/lib/cloudAccount";

export function resolveAccountDisplayName(
  sessionState: CloudAccountView | null,
  fallbackDisplayName: string,
): string {
  const user = sessionState?.account;
  const fallbackEmailName = user?.email?.split("@")[0]?.trim();
  return (
    user?.displayName?.trim() ||
    fallbackEmailName ||
    fallbackDisplayName
  );
}

export function resolveAccountInitial(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return "L";
  }

  return normalized.slice(0, 1).toUpperCase();
}
