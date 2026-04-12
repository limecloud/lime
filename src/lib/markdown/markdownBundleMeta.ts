function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function dirname(value: string): string {
  const normalized = normalizePath(value).replace(/\/+$/, "");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return lastSlashIndex === 0 ? "/" : "";
  }
  return normalized.slice(0, lastSlashIndex);
}

function readStringField(
  value: unknown,
  ...keys: string[]
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of keys) {
    const nextValue = (value as Record<string, unknown>)[key];
    if (typeof nextValue === "string" && nextValue.trim()) {
      return nextValue.trim();
    }
  }

  return undefined;
}

function resolveRelativePathBetween(
  fromFilePath: string,
  toPath: string,
): string | undefined {
  const normalizedFrom = normalizePath(fromFilePath).trim();
  const normalizedTo = normalizePath(toPath).trim();
  if (!normalizedFrom || !normalizedTo) {
    return undefined;
  }

  const fromSegments = normalizedFrom.split("/").filter(Boolean);
  const toSegments = normalizedTo.split("/").filter(Boolean);
  if (fromSegments.length === 0 || toSegments.length === 0) {
    return undefined;
  }

  fromSegments.pop();

  let sharedIndex = 0;
  while (
    sharedIndex < fromSegments.length &&
    sharedIndex < toSegments.length &&
    fromSegments[sharedIndex] === toSegments[sharedIndex]
  ) {
    sharedIndex += 1;
  }

  const upwardSegments = Array.from(
    { length: fromSegments.length - sharedIndex },
    () => "..",
  );
  const downwardSegments = toSegments.slice(sharedIndex);
  const relativePath = [...upwardSegments, ...downwardSegments].join("/");
  return relativePath || undefined;
}

export function resolveMarkdownBundleMetaPath(
  baseFilePath?: string,
): string | undefined {
  const normalizedPath = baseFilePath?.trim();
  if (!normalizedPath) {
    return undefined;
  }

  const parentDir = dirname(normalizedPath);
  if (!parentDir) {
    return undefined;
  }

  return `${parentDir}/meta.json`;
}

export function parseMarkdownBundleImageOverrides(
  metaContent: string,
): Record<string, string> {
  if (!metaContent.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metaContent);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const markdownRelativePath = readStringField(
    parsed,
    "markdown_relative_path",
    "markdownRelativePath",
  );
  const imageRecords = Array.isArray((parsed as { images?: unknown }).images)
    ? ((parsed as { images: unknown[] }).images ?? [])
    : [];

  return imageRecords.reduce<Record<string, string>>((accumulator, item) => {
    const originalUrl = readStringField(item, "original_url", "originalUrl");
    if (!originalUrl) {
      return accumulator;
    }

    const markdownPath = readStringField(item, "markdown_path", "markdownPath");
    if (markdownPath) {
      accumulator[originalUrl] = markdownPath;
      return accumulator;
    }

    const projectRelativePath = readStringField(
      item,
      "project_relative_path",
      "projectRelativePath",
    );
    if (!projectRelativePath || !markdownRelativePath) {
      return accumulator;
    }

    const relativePath = resolveRelativePathBetween(
      markdownRelativePath,
      projectRelativePath,
    );
    if (relativePath) {
      accumulator[originalUrl] = relativePath;
    }
    return accumulator;
  }, {});
}
