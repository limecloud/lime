function workspacePathKey(value: string | null | undefined): string | null {
  const path = value?.trim();
  if (!path || path.includes("\0")) return null;

  let family: string;
  let normalized = path;
  if (/^[a-z]:[\\/]/i.test(path)) {
    family = "drive";
    normalized = `${path[0].toUpperCase()}${path.slice(1)}`.replace(/\\/g, "/");
  } else if (/^(?:\\\\|\/\/)[^/?\\]+[/\\][^/?\\]+(?:[/\\]|$)/.test(path)) {
    family = "unc";
    normalized = path.replace(/\\/g, "/");
  } else if (path.startsWith("/") && !path.startsWith("//")) {
    family = "posix";
  } else {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.includes("..")) return null;
  normalized = segments
    .filter((segment) => segment && segment !== ".")
    .join("/");
  return `${family}:${normalized}`;
}

export function areWorkspacePathsIdentical(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftKey = workspacePathKey(left);
  return leftKey !== null && leftKey === workspacePathKey(right);
}
