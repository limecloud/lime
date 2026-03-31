import type { DataBinding } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function encodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function splitRelativePath(path: string): string[] {
  if (path.includes("/")) {
    return path.split("/").filter(Boolean);
  }

  return path.split(".").filter(Boolean);
}

export function appendJsonPointer(
  basePointer: string,
  ...segments: string[]
): string {
  const base = basePointer && basePointer !== "/" ? basePointer : "";
  const suffix = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeJsonPointerSegment(segment))
    .join("/");

  if (!suffix) {
    return base || "/";
  }

  return `${base}/${suffix}`;
}

export function normalizeDataPath(
  path: string | undefined,
  scopePath: string = "/",
): string {
  const trimmed = path?.trim();

  if (!trimmed || trimmed === ".") {
    return scopePath || "/";
  }

  if (trimmed === "/") {
    return "/";
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  return appendJsonPointer(scopePath || "/", ...splitRelativePath(trimmed));
}

export function resolveDataAtPath(
  data: unknown,
  path: string | undefined,
  scopePath: string = "/",
): unknown {
  const pointer = normalizeDataPath(path, scopePath);

  if (pointer === "/") {
    return data;
  }

  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => decodeJsonPointerSegment(segment));

  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }

    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function assignAtPath(
  root: Record<string, unknown> | unknown[],
  segments: string[],
  value: unknown,
) {
  let current: Record<string, unknown> | unknown[] = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    const nextSegment = segments[index + 1];
    const nextShouldBeArray =
      nextSegment !== undefined && /^\d+$/.test(nextSegment);

    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);
      if (Number.isNaN(arrayIndex)) {
        return;
      }

      if (isLast) {
        if (value === undefined) {
          current.splice(arrayIndex, 1);
        } else {
          current[arrayIndex] = value;
        }
        return;
      }

      const existing = current[arrayIndex];
      if (!Array.isArray(existing) && !isRecord(existing)) {
        current[arrayIndex] = nextShouldBeArray ? [] : {};
      }
      current = current[arrayIndex] as Record<string, unknown> | unknown[];
      continue;
    }

    if (isLast) {
      if (value === undefined) {
        delete current[segment];
      } else {
        current[segment] = value;
      }
      return;
    }

    const existing = current[segment];
    if (!Array.isArray(existing) && !isRecord(existing)) {
      current[segment] = nextShouldBeArray ? [] : {};
    }
    current = current[segment] as Record<string, unknown> | unknown[];
  }
}

export function updateDataModel(
  currentData: Record<string, unknown> | undefined,
  path: string | undefined,
  value: unknown,
): Record<string, unknown> {
  const pointer = normalizeDataPath(path ?? "/", "/");

  if (pointer === "/") {
    return isRecord(value) ? { ...value } : {};
  }

  const nextRoot: Record<string, unknown> = { ...(currentData || {}) };
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => decodeJsonPointerSegment(segment));

  assignAtPath(nextRoot, segments, value);
  return nextRoot;
}

export function isDataBindingValue(value: unknown): value is DataBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    !("componentId" in value)
  );
}
