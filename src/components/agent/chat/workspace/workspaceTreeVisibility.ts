import type { FileEntry } from "@/components/terminal/widgets/types";
import type { DirectoryListing } from "@/lib/api/fileBrowser";

const ROOT_HIDDEN_DIRECTORY_NAMES = new Set([".lime", "output"]);
const GLOBAL_HIDDEN_ENTRY_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const ROOT_HIDDEN_FILE_PATTERNS = [/^output_image\.[a-z0-9]+$/i];

function normalizeWorkspaceTreePath(value?: string | null): string {
  return (value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function isWorkspaceRootListing(
  listingPath: string,
  workspaceRoot: string | null | undefined,
): boolean {
  const normalizedListingPath = normalizeWorkspaceTreePath(listingPath);
  const normalizedWorkspaceRoot = normalizeWorkspaceTreePath(workspaceRoot);
  return Boolean(
    normalizedListingPath &&
    normalizedWorkspaceRoot &&
    normalizedListingPath === normalizedWorkspaceRoot,
  );
}

export function shouldHideWorkspaceTreeEntry(params: {
  entry: FileEntry;
  listingPath: string;
  workspaceRoot: string | null | undefined;
}): boolean {
  const { entry, listingPath, workspaceRoot } = params;
  const normalizedName = (entry.name || "").trim();
  if (!normalizedName) {
    return false;
  }

  if (GLOBAL_HIDDEN_ENTRY_NAMES.has(normalizedName)) {
    return true;
  }

  if (!isWorkspaceRootListing(listingPath, workspaceRoot)) {
    return false;
  }

  if (entry.isDir && ROOT_HIDDEN_DIRECTORY_NAMES.has(normalizedName)) {
    return true;
  }

  return ROOT_HIDDEN_FILE_PATTERNS.some((pattern) =>
    pattern.test(normalizedName),
  );
}

export function filterWorkspaceDirectoryListing(
  listing: DirectoryListing,
  workspaceRoot: string | null | undefined,
): DirectoryListing {
  if (!workspaceRoot?.trim()) {
    return listing;
  }

  const entries = listing.entries.filter(
    (entry) =>
      !shouldHideWorkspaceTreeEntry({
        entry,
        listingPath: listing.path,
        workspaceRoot,
      }),
  );

  return entries.length === listing.entries.length
    ? listing
    : { ...listing, entries };
}
