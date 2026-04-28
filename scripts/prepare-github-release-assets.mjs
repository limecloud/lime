#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    extraAsset: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    const value = !next || next.startsWith("--") ? "true" : next;
    if (value !== "true") {
      index += 1;
    }

    if (key === "extra-asset") {
      args.extraAsset.push(value);
    } else {
      args[key] = value;
    }
  }

  return args;
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/, "");
}

function listFilesRecursive(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const filePath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(filePath);
      }
      return entry.isFile() ? [filePath] : [];
    })
    .sort();
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function targetFromAssetPath(assetsDir, filePath) {
  if (!isPathInside(assetsDir, filePath)) {
    return "";
  }

  return path.relative(assetsDir, filePath).split(path.sep)[0] || "";
}

function duplicateTargetLabel(target) {
  if (target === "aarch64-apple-darwin") {
    return "macos-arm64";
  }
  if (target === "x86_64-apple-darwin") {
    return "macos-x64";
  }
  if (target === "x86_64-pc-windows-msvc") {
    return "windows-x64";
  }
  if (target === "x86_64-unknown-linux-gnu") {
    return "linux-x64";
  }
  return target.replace(/[^A-Za-z0-9._-]+/g, "-") || "asset";
}

function macUpdaterAssetName(basename, target, version) {
  let arch = "";
  if (target === "aarch64-apple-darwin") {
    arch = "aarch64";
  } else if (target === "x86_64-apple-darwin") {
    arch = "x64";
  }

  if (!arch) {
    return "";
  }
  if (basename === "Lime.app.tar.gz") {
    return `Lime_${version}_${arch}.app.tar.gz`;
  }
  if (basename === "Lime.app.tar.gz.sig") {
    return `Lime_${version}_${arch}.app.tar.gz.sig`;
  }
  return "";
}

function githubAssetName(filePath, context) {
  const basename = path.basename(filePath);
  const target = targetFromAssetPath(context.assetsDir, filePath);
  const duplicateCount = context.basenameCounts.get(basename) || 0;

  if (duplicateCount <= 1) {
    return basename;
  }

  const macName = macUpdaterAssetName(basename, target, context.version);
  if (macName) {
    return macName;
  }

  return `${duplicateTargetLabel(target)}-${basename}`;
}

function prepareGitHubReleaseAssets(options) {
  const assetsDir = path.resolve(options.assetsDir || "release-assets");
  const outDir = path.resolve(options.outDir || "release-github-assets");
  const version = normalizeVersion(options.version);
  const extraAssets = (options.extraAssets || []).map((item) =>
    path.resolve(item),
  );

  if (!version) {
    throw new Error("version is required");
  }
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`assets directory is missing: ${assetsDir}`);
  }

  const releaseAssetFiles = listFilesRecursive(assetsDir).filter(
    (filePath) => !/^latest.*\.json$/i.test(path.basename(filePath)),
  );
  const inputFiles = [...releaseAssetFiles, ...extraAssets].sort();

  for (const filePath of inputFiles) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`release asset is missing: ${filePath}`);
    }
  }

  const basenameCounts = new Map();
  for (const filePath of inputFiles) {
    const basename = path.basename(filePath);
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const usedNames = new Set();
  const copied = [];
  for (const filePath of inputFiles) {
    const name = githubAssetName(filePath, {
      assetsDir,
      basenameCounts,
      version,
    });
    if (usedNames.has(name)) {
      throw new Error(`duplicate GitHub release asset name: ${name}`);
    }
    usedNames.add(name);

    const destination = path.join(outDir, name);
    fs.copyFileSync(filePath, destination);
    copied.push({
      name,
      source: filePath,
      destination,
    });
  }

  return copied.sort((left, right) => left.name.localeCompare(right.name));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const copied = prepareGitHubReleaseAssets({
    assetsDir: args["assets-dir"],
    extraAssets: args.extraAsset,
    outDir: args["out-dir"],
    version:
      args.version || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME,
  });

  console.log("Prepared GitHub release upload assets:");
  for (const item of copied) {
    console.log(` - ${path.relative(process.cwd(), item.destination)}`);
  }
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  main();
}

export { prepareGitHubReleaseAssets };
