// 对应 Desktop 的分阶段路径处理：打开路径与大小写无关的去重 key 分开。
export function normalizeOutputPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\/(?=[a-z]:\/)/i, "");
}

export function resolveOutputPath(path: string, cwd: string | null): string {
  const normalized = normalizeOutputPath(path);
  const absolute = /^(?:\/|[a-z]:\/)/i.test(normalized);
  const value =
    absolute || !cwd
      ? normalized
      : `${normalizeOutputPath(cwd).replace(/\/+$/, "")}/${normalized}`;
  const prefix = value.startsWith("//")
    ? "//"
    : value.startsWith("/")
      ? "/"
      : "";
  const parts: string[] = [];
  const minimum = prefix === "//" ? 2 : /^[a-z]:\//i.test(value) ? 1 : 0;
  for (const part of value.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length > minimum && parts.at(-1) !== "..")
      parts.pop();
    else if (part !== ".." || (!prefix && minimum === 0)) parts.push(part);
  }
  return prefix + parts.join("/");
}

export function outputPathKey(path: string, cwd: string | null): string {
  return resolveOutputPath(path, cwd).toLowerCase();
}

export function isOutputPathWithin(
  path: string,
  root: string,
  cwd: string | null,
): boolean {
  const key = outputPathKey(path, cwd);
  const boundary = outputPathKey(root, cwd).replace(/\/+$/, "");
  return (
    Boolean(boundary) && (key === boundary || key.startsWith(`${boundary}/`))
  );
}

export function isExcludedOutputPath(
  path: string,
  cwd: string | null,
): boolean {
  return ["work", ".lime_scratch"].some((root) =>
    isOutputPathWithin(path, root, cwd),
  );
}

export function outputFileName(path: string): string {
  return normalizeOutputPath(path).split("/").at(-1) || path;
}
