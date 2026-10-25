#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.target) {
  console.error("用法: verify-source-copy.mjs --source <path> --target <path> [--output <json>]");
  process.exit(2);
}

const source = resolve(args.source);
const target = resolve(args.target);
const excluded = new Set((args.exclude ?? "target,node_modules,__pycache__,.DS_Store").split(",").filter(Boolean));
const [sourceEntries, targetEntries] = await Promise.all([collect(source, excluded), collect(target, excluded)]);
const mismatches = [];
const missing = [];
const extra = [];

for (const [path, entry] of sourceEntries) {
  const actual = targetEntries.get(path);
  if (!actual) {
    missing.push(path);
    continue;
  }
  if (entry.kind !== actual.kind || entry.sha256 !== actual.sha256 || entry.linkTarget !== actual.linkTarget) {
    mismatches.push({ path, source: entry, target: actual });
  }
}
for (const path of targetEntries.keys()) {
  if (!sourceEntries.has(path)) extra.push(path);
}

const report = {
  sourceRoot: source,
  destinationRoot: target,
  excluded: [...excluded],
  sourceCount: sourceEntries.size,
  destinationCount: targetEntries.size,
  missing,
  extra,
  mismatches,
  status: missing.length || extra.length || mismatches.length ? "mismatch" : "identical",
};

const output = JSON.stringify(report, null, 2) + "\n";
if (args.output) await writeFile(resolve(args.output), output, "utf8");
process.stdout.write(output);
process.exit(report.status === "identical" ? 0 : 1);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    result[key] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  }
  return result;
}

async function collect(root, excludes) {
  const out = new Map();
  await walk(root, "");
  return out;

  async function walk(directory, prefix) {
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const name of names) {
      if (excludes.has(name)) continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const absolutePath = join(directory, name);
      const stat = await lstat(absolutePath);
      if (stat.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (stat.isSymbolicLink()) {
        out.set(relativePath, { kind: "symlink", linkTarget: await readlink(absolutePath) });
        continue;
      }
      if (!stat.isFile()) continue;
      out.set(relativePath, { kind: "file", sha256: await hash(absolutePath) });
    }
  }
}

async function hash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
