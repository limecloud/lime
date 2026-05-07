#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { readCargoVersions } from "./app-version.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const repoRoot = path.resolve(process.cwd());
const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriHeadlessConfigPath = path.join(
  repoRoot,
  "src-tauri",
  "tauri.conf.headless.json",
);
const packageJsonPath = path.join(repoRoot, "package.json");
const cliNpmPackageJsonPath = path.join(
  repoRoot,
  "packages",
  "lime-cli-npm",
  "package.json",
);

const cargo = readCargoVersions(cargoTomlPath);
const tauriConfig = readJson(tauriConfigPath);
const tauriHeadlessConfig = readJson(tauriHeadlessConfigPath);
const packageJson = readJson(packageJsonPath);
const cliNpmPackageJson = readJson(cliNpmPackageJsonPath);

const sourceVersion = cargo.workspaceVersion;
const issues = [];

if (!sourceVersion) {
  issues.push("src-tauri/Cargo.toml [workspace.package].version 缺失");
}

if (!cargo.packageVersionIsWorkspace && cargo.packageVersion !== sourceVersion) {
  issues.push(
    `src-tauri/Cargo.toml [package].version (${cargo.packageVersion ?? "missing"}) 与 workspace.version (${sourceVersion ?? "missing"}) 不一致`,
  );
}

if ((packageJson.version ?? null) !== sourceVersion) {
  issues.push(
    `package.json version (${packageJson.version ?? "missing"}) 与 workspace.version (${sourceVersion ?? "missing"}) 不一致`,
  );
}

if ((cliNpmPackageJson.version ?? null) !== sourceVersion) {
  issues.push(
    `packages/lime-cli-npm/package.json version (${cliNpmPackageJson.version ?? "missing"}) 与 workspace.version (${sourceVersion ?? "missing"}) 不一致`,
  );
}

if ((tauriConfig.version ?? null) !== sourceVersion) {
  issues.push(
    `src-tauri/tauri.conf.json version (${tauriConfig.version ?? "missing"}) 与 workspace.version (${sourceVersion ?? "missing"}) 不一致`,
  );
}

if ((tauriHeadlessConfig.version ?? null) !== sourceVersion) {
  issues.push(
    `src-tauri/tauri.conf.headless.json version (${tauriHeadlessConfig.version ?? "missing"}) 与 workspace.version (${sourceVersion ?? "missing"}) 不一致`,
  );
}

if (issues.length > 0) {
  console.error("[lime] 应用版本一致性检查失败:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`[lime] 版本一致性检查通过: ${sourceVersion}`);
