import fs from "node:fs";

import path from "node:path";
import { LOG_PREFIX } from "./constants.mjs";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function sanitizeText(value) {
  const sanitized = String(value ?? "")
    .replace(
      /((?:api[_-]?key|authorization|password|secret|session|token)[^=\s]*=)(["']?)[^\s"']+/gi,
      "$1$2[redacted]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]");
  return sanitized.length > 2_000
    ? `${sanitized.slice(0, 2_000)}... [truncated ${
        sanitized.length - 2_000
      } chars]`
    : sanitized;
}

export function isIgnorableConsoleError(text) {
  return text === "Failed to load resource: net::ERR_FILE_NOT_FOUND";
}

export function sanitizeJson(value, depth = 0) {
  if (depth > 8) {
    return "[truncated-depth]";
  }
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 180)
        .map(([key, item]) => [
          key,
          /^(system_prompt|systemPrompt)$/u.test(key)
            ? item
              ? "[redacted-prompt]"
              : null
            : sanitizeJson(item, depth + 1),
        ]),
    );
  }
  return sanitizeText(String(value));
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function cleanupTempRoot(tempRoot) {
  try {
    fs.rmSync(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (error) {
    console.warn(
      `${LOG_PREFIX} cleanup warning: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function readString(value, ...keys) {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }
  return null;
}

export function readArray(value, ...keys) {
  if (keys.length === 0) {
    return Array.isArray(value) ? value : [];
  }
  const record = readRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key];
    }
  }
  return [];
}
