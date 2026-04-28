#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/, "");
}

function compareStableVersionsDesc(left, right) {
  const leftParts = normalizeVersion(left)
    .split(".")
    .map((part) => Number(part));
  const rightParts = normalizeVersion(right)
    .split(".")
    .map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const diff = (rightParts[index] || 0) - (leftParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return normalizeVersion(right).localeCompare(normalizeVersion(left));
}

function extractKeys(value) {
  if (Array.isArray(value)) {
    return value.flatMap(extractKeys);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (typeof value.key === "string") {
    return [value.key];
  }
  if (Array.isArray(value.objects)) {
    return value.objects.flatMap(extractKeys);
  }
  if (Array.isArray(value.result)) {
    return value.result.flatMap(extractKeys);
  }
  return [];
}

function releaseVersionFromKey(key, channel = "stable") {
  const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = key.match(new RegExp(`^lime/${escapedChannel}/v([^/]+)/`));
  return match ? match[1] : null;
}

function planR2ReleaseCleanup(options) {
  const channel = options.channel || "stable";
  const keep = Math.max(1, Number(options.keep || 3));
  const keys = Array.from(new Set(options.keys || [])).sort();
  const current = normalizeVersion(options.currentVersion);
  const minimum = normalizeVersion(options.minimumSupportedVersion);
  const versions = Array.from(
    new Set(
      keys.map((key) => releaseVersionFromKey(key, channel)).filter(Boolean),
    ),
  ).sort(compareStableVersionsDesc);
  const protectedVersions = new Set(
    versions.slice(0, keep).map(normalizeVersion),
  );

  if (current) {
    protectedVersions.add(current);
  }
  if (minimum) {
    protectedVersions.add(minimum);
  }

  const deleteKeys = keys.filter((key) => {
    const version = releaseVersionFromKey(key, channel);
    return version && !protectedVersions.has(normalizeVersion(version));
  });

  return {
    deleteKeys,
    protectedVersions: Array.from(protectedVersions).sort(
      compareStableVersionsDesc,
    ),
    versions,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input;
  if (!inputPath) {
    throw new Error("--input is required");
  }
  const raw = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  const plan = planR2ReleaseCleanup({
    channel: args.channel || process.env.LIME_RELEASE_CHANNEL || "stable",
    currentVersion:
      args.current || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME,
    keep: args.keep || process.env.LIME_R2_KEEP_RELEASES || "3",
    keys: extractKeys(raw),
    minimumSupportedVersion:
      args.minimum || process.env.LIME_MINIMUM_SUPPORTED_VERSION || "",
  });

  const outputPath = args.output ? path.resolve(args.output) : "";
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      `${plan.deleteKeys.join("\n")}${plan.deleteKeys.length ? "\n" : ""}`,
    );
  } else {
    process.stdout.write(
      `${plan.deleteKeys.join("\n")}${plan.deleteKeys.length ? "\n" : ""}`,
    );
  }
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  main();
}

export { extractKeys, planR2ReleaseCleanup, releaseVersionFromKey };
