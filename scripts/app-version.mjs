import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(content, sectionName) {
  const pattern = new RegExp(
    `^\\[${escapeRegExp(sectionName)}\\]\\s*([\\s\\S]*?)(?=^\\[|\\Z)`,
    "m",
  );
  const match = content.match(pattern);
  return match?.[1] ?? "";
}

function parseStringField(section, fieldName) {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(fieldName)}\\s*=\\s*\"([^\"]+)\"\\s*$`,
    "m",
  );
  return section.match(pattern)?.[1] ?? null;
}

function parseWorkspaceField(section, fieldName) {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(fieldName)}\\.workspace\\s*=\\s*true\\s*$`,
    "m",
  );
  return pattern.test(section);
}

function readPackageJsonVersion(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

export function readCargoVersions(cargoTomlPath) {
  const content = fs.readFileSync(cargoTomlPath, "utf8");
  const workspacePackageSection = extractSection(content, "workspace.package");
  const packageSection = extractSection(content, "package");

  const workspaceVersion = parseStringField(workspacePackageSection, "version");
  const packageVersion = parseStringField(packageSection, "version");
  const packageVersionIsWorkspace = parseWorkspaceField(packageSection, "version");

  return {
    workspaceVersion,
    packageVersion,
    packageVersionIsWorkspace,
  };
}

export function readWorkspaceAppVersion(repoRoot = process.cwd()) {
  const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
  if (!fs.existsSync(cargoTomlPath)) {
    return readPackageJsonVersion(repoRoot);
  }
  const { workspaceVersion } = readCargoVersions(cargoTomlPath);
  return workspaceVersion ?? readPackageJsonVersion(repoRoot);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryFilePath && currentFilePath === entryFilePath) {
  const repoRoot = path.resolve(path.dirname(currentFilePath), "..");
  const version = readWorkspaceAppVersion(repoRoot);
  if (!version) {
    console.error("[lime] 无法从 src-tauri/Cargo.toml 读取 workspace 版本");
    process.exit(1);
  }
  process.stdout.write(version);
}
