import fs from "node:fs";
import path from "node:path";

const TEST_FIXTURE_FILE_PATTERN =
  /(?:^|[._-])test[-_]?fixtures?\.(?:[cm]?[jt]sx?)$/i;
const NODE_TEST_IMPORT_PATTERN = /\bfrom\s+["']node:test["']/;
const VITEST_TEST_SIGNAL_PATTERN =
  /\bfrom\s+["']vitest["']|\bprocess\.env\.VITEST\b/;

function readTestFileSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function isVitestRunnableTestFile(filePath, source = undefined) {
  const normalized = path
    .relative(process.cwd(), path.resolve(String(filePath || "")))
    .replaceAll("\\", "/");
  const fileName = normalized.split("/").pop() ?? normalized;
  if (normalized.startsWith(".lime/") || normalized.includes("/.lime/")) {
    return false;
  }
  if (TEST_FIXTURE_FILE_PATTERN.test(fileName)) {
    return false;
  }

  const content =
    typeof source === "string" ? source : readTestFileSource(filePath);
  if (
    NODE_TEST_IMPORT_PATTERN.test(content) &&
    !VITEST_TEST_SIGNAL_PATTERN.test(content)
  ) {
    return false;
  }

  return true;
}
