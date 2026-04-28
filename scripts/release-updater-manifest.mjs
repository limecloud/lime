#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const result = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

function normalizeVersionTag(version) {
  const normalized = String(version || "").trim();
  if (!normalized) {
    throw new Error("release version is required");
  }
  const withoutPrefix = normalized.replace(/^v/, "");
  if (withoutPrefix.includes("-")) {
    throw new Error(
      `stable updater manifest does not accept prerelease version: ${normalized}`,
    );
  }
  if (!/^\d+\.\d+\.\d+(?:\+\S+)?$/.test(withoutPrefix)) {
    throw new Error(`release version must be stable semver: ${normalized}`);
  }
  return `v${withoutPrefix.split("+")[0]}`;
}

function normalizeStableVersion(version) {
  return normalizeVersionTag(version).slice(1);
}

function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("base URL is required");
  }
  return normalized;
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function basenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(path.posix.basename(parsed.pathname));
  } catch {
    return path.basename(String(url || ""));
  }
}

function collectFilesByBasename(files) {
  const byName = new Map();
  for (const file of files) {
    const name = path.basename(file);
    if (!byName.has(name)) {
      byName.set(name, []);
    }
    byName.get(name).push(file);
  }
  return byName;
}

function findLatestManifestFiles(files) {
  return files.filter((file) => /^latest.*\.json$/i.test(path.basename(file)));
}

function resolveReferencedAssetFile(manifestFile, candidates) {
  const manifestDir = path.dirname(manifestFile);
  const assetCandidates = candidates.filter(
    (candidate) => !/^latest.*\.json$/i.test(path.basename(candidate)),
  );
  return (
    assetCandidates.find(
      (candidate) => path.dirname(candidate) === manifestDir,
    ) || assetCandidates[0]
  );
}

function buildPlatformAssetPath(platformKey, assetName) {
  return `${encodePathSegment(platformKey)}/${encodePathSegment(assetName)}`;
}

function collectUpdaterManifest(options) {
  const assetsDir = path.resolve(options.assetsDir);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const channel = options.channel || "stable";
  const versionTag = normalizeVersionTag(options.version);
  const version = versionTag.slice(1);
  const files = walkFiles(assetsDir);
  const filesByBasename = collectFilesByBasename(files);
  const latestFiles = findLatestManifestFiles(files);
  const requiredPlatforms = (
    options.requiredPlatforms || DEFAULT_REQUIRED_PLATFORMS
  )
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (latestFiles.length === 0) {
    throw new Error(`no latest*.json files found under ${assetsDir}`);
  }

  const platforms = {};
  const referencedFiles = new Map();
  let notes = options.notes || "";
  let pubDate = options.pubDate || "";

  for (const manifestFile of latestFiles) {
    const manifest = readJson(manifestFile);
    const manifestVersion = normalizeStableVersion(manifest.version);
    if (manifestVersion !== version) {
      throw new Error(
        `${manifestFile} version ${manifest.version} does not match release ${versionTag}`,
      );
    }

    if (!notes && typeof manifest.notes === "string") {
      notes = manifest.notes;
    }
    if (!pubDate && typeof manifest.pub_date === "string") {
      pubDate = manifest.pub_date;
    }

    for (const [platformKey, platform] of Object.entries(
      manifest.platforms || {},
    )) {
      const sourceUrl = String(platform?.url || "").trim();
      const signature = String(platform?.signature || "").trim();
      if (!sourceUrl || !signature) {
        throw new Error(
          `${manifestFile} platform ${platformKey} has empty url or signature`,
        );
      }
      if (platforms[platformKey]) {
        throw new Error(
          `${manifestFile} duplicates updater platform ${platformKey}`,
        );
      }

      const assetName = basenameFromUrl(sourceUrl);
      const candidates = filesByBasename.get(assetName) || [];
      const assetFile = resolveReferencedAssetFile(manifestFile, candidates);
      if (!assetFile) {
        throw new Error(
          `${manifestFile} platform ${platformKey} references missing asset: ${assetName}`,
        );
      }

      const platformAssetPath = buildPlatformAssetPath(platformKey, assetName);
      const targetUrl = `${baseUrl}/lime/${channel}/${versionTag}/${platformAssetPath}`;
      platforms[platformKey] = {
        signature,
        url: targetUrl,
      };
      referencedFiles.set(platformAssetPath, {
        assetName,
        file: assetFile,
        platformKey,
        targetPath: platformAssetPath,
      });
    }
  }

  const missing = requiredPlatforms.filter((platform) => !platforms[platform]);
  if (missing.length > 0) {
    throw new Error(
      `updater manifest missing required platforms: ${missing.join(", ")}`,
    );
  }

  const manifest = {
    version,
    notes,
    pub_date: pubDate || new Date().toISOString(),
    platforms,
  };

  const r2UploadPlan = [
    ...Array.from(referencedFiles.values()).map((item) => ({
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "application/octet-stream",
      file: item.file,
      key: `lime/${channel}/${versionTag}/${item.targetPath}`,
    })),
  ].sort((a, b) => a.key.localeCompare(b.key));

  return {
    manifest,
    referencedFiles: Array.from(referencedFiles.values())
      .map((item) => item.file)
      .sort(),
    r2UploadPlan,
    version,
    versionTag,
  };
}

function writeOutputs(result, outDir, channel) {
  const outputDir = path.resolve(outDir);
  const latestPath = path.join(outputDir, "latest.json");
  const versionedLatestPath = path.join(
    outputDir,
    result.versionTag,
    "latest.json",
  );
  const uploadPlanPath = path.join(outputDir, "r2-upload-plan.json");
  const metadataPath = path.join(outputDir, "manifest-meta.json");

  writeJson(latestPath, result.manifest);
  writeJson(versionedLatestPath, result.manifest);
  writeJson(uploadPlanPath, [
    ...result.r2UploadPlan,
    {
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
      contentType: "application/json",
      file: versionedLatestPath,
      key: `lime/${channel}/${result.versionTag}/latest.json`,
    },
    {
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
      contentType: "application/json",
      file: latestPath,
      key: `lime/${channel}/latest.json`,
    },
  ]);
  writeJson(metadataPath, {
    platformCount: Object.keys(result.manifest.platforms).length,
    version: result.version,
    versionTag: result.versionTag,
  });

  return {
    latestPath,
    metadataPath,
    uploadPlanPath,
    versionedLatestPath,
  };
}

function loadNotes(args) {
  if (args["notes-file"]) {
    return fs.readFileSync(path.resolve(args["notes-file"]), "utf8").trim();
  }
  return process.env.RELEASE_BODY || "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const requiredPlatforms = (
    args["required-platforms"] ||
    process.env.REQUIRED_UPDATE_PLATFORMS ||
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const channel = args.channel || process.env.LIME_RELEASE_CHANNEL || "stable";
  const result = collectUpdaterManifest({
    assetsDir: args["assets-dir"] || "release-assets",
    baseUrl:
      args["base-url"] ||
      process.env.LIME_UPDATES_BASE_URL ||
      "https://updates.limecloud.com",
    channel,
    notes: loadNotes(args),
    pubDate: args["pub-date"] || process.env.RELEASE_PUB_DATE || "",
    requiredPlatforms:
      requiredPlatforms.length > 0
        ? requiredPlatforms
        : DEFAULT_REQUIRED_PLATFORMS,
    version:
      args.version || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME,
  });
  const output = writeOutputs(
    result,
    args["out-dir"] || "release-updater",
    channel,
  );
  console.log(
    JSON.stringify(
      {
        ...output,
        platformCount: Object.keys(result.manifest.platforms).length,
        version: result.version,
      },
      null,
      2,
    ),
  );
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  main();
}

export { collectUpdaterManifest, normalizeVersionTag, writeOutputs };
