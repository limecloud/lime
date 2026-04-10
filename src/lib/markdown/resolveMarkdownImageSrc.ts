import { convertLocalFileSrc } from "@/lib/api/fileSystem";

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isAbsoluteLikePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function dirnameFromFilePath(value: string): string {
  const normalized = normalizeFilePath(value).replace(/\/+$/, "");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return lastSlashIndex === 0 ? "/" : "";
  }
  return normalized.slice(0, lastSlashIndex);
}

function joinFilePath(parentDir: string, childPath: string): string {
  if (!parentDir) {
    return childPath;
  }
  return `${parentDir.replace(/\/+$/, "")}/${childPath.replace(/^[\\/]+/, "")}`;
}

function splitFilePathSuffix(value: string): {
  pathPart: string;
  suffix: string;
} {
  const suffixStart = value.search(/[?#]/);
  if (suffixStart < 0) {
    return { pathPart: value, suffix: "" };
  }

  return {
    pathPart: value.slice(0, suffixStart),
    suffix: value.slice(suffixStart),
  };
}

function normalizeResolvedFilePath(value: string): string {
  const normalized = normalizeFilePath(value);
  if (!normalized) {
    return "";
  }

  let prefix = "";
  let remainder = normalized;
  if (remainder.startsWith("//")) {
    prefix = "//";
    remainder = remainder.slice(2);
  } else if (/^[A-Za-z]:\//.test(remainder)) {
    prefix = remainder.slice(0, 2);
    remainder = remainder.slice(3);
  } else if (remainder.startsWith("/")) {
    prefix = "/";
    remainder = remainder.slice(1);
  }

  const segments = remainder.split("/");
  const stack: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!prefix) {
        stack.push("..");
      }
      continue;
    }

    stack.push(segment);
  }

  const joined = stack.join("/");
  if (prefix === "//") {
    return joined ? `//${joined}` : "//";
  }
  if (prefix === "/") {
    return joined ? `/${joined}` : "/";
  }
  if (prefix) {
    return joined ? `${prefix}/${joined}` : `${prefix}/`;
  }
  return joined;
}

export function resolveMarkdownImageSrc(
  rawSrc: string,
  baseFilePath?: string,
): string {
  const normalizedSrc = rawSrc.trim();
  if (!normalizedSrc) {
    return rawSrc;
  }

  if (
    normalizedSrc.startsWith("data:") ||
    normalizedSrc.startsWith("http://") ||
    normalizedSrc.startsWith("https://") ||
    normalizedSrc.startsWith("blob:") ||
    normalizedSrc.startsWith("asset://") ||
    normalizedSrc.startsWith("tauri://")
  ) {
    return normalizedSrc;
  }

  const { pathPart, suffix } = splitFilePathSuffix(normalizedSrc);
  const absolutePath = isAbsoluteLikePath(pathPart)
    ? normalizeResolvedFilePath(pathPart)
    : baseFilePath
      ? normalizeResolvedFilePath(
          joinFilePath(dirnameFromFilePath(baseFilePath), pathPart),
        )
      : "";

  if (!absolutePath) {
    return normalizedSrc;
  }

  return `${convertLocalFileSrc(absolutePath)}${suffix}`;
}
