import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  fingerprintBuildInputs,
  declaredBuildEntries,
  RENDERER_BUILD_ENTRIES,
  RENDERER_SOURCE_DIRS,
  RENDERER_SOURCE_FILES,
  statFile,
} from "./electron-build-inputs.mjs";

const inputs = {
  sourceDirs: RENDERER_SOURCE_DIRS,
  sourceFiles: RENDERER_SOURCE_FILES,
};
const receiptPath = (rootDir) =>
  path.join(rootDir, ".lime", "electron-renderer-build.json");
function entryDigests(rootDir) {
  return declaredBuildEntries(rootDir, RENDERER_BUILD_ENTRIES).map(
    (entry, index) => {
      if (index > 0 && !statFile(path.join(rootDir, entry.source))?.isFile())
        throw new Error(
          `Renderer build entry source is missing: ${entry.source}`,
        );
      return {
        ...entry,
        sha256: createHash("sha256")
          .update(readFileSync(path.join(rootDir, entry.output)))
          .digest("hex"),
      };
    },
  );
}

function writeReceipt(rootDir, receipt) {
  const filePath = receiptPath(rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`);
}

export function beginRendererBuild(rootDir) {
  const build = {
    rootDir,
    input: fingerprintBuildInputs(rootDir, inputs),
    startedAt: new Date().toISOString(),
  };
  writeReceipt(rootDir, {
    version: 2,
    status: "building",
    input: build.input,
    startedAt: build.startedAt,
  });
  return build;
}

export function invalidateRendererBuild(build) {
  writeReceipt(build.rootDir, {
    version: 2,
    status: "invalid",
    input: build.input,
    startedAt: build.startedAt,
  });
}

export function completeRendererBuild(build) {
  try {
    const input = fingerprintBuildInputs(build.rootDir, inputs);
    if (input.sha256 !== build.input.sha256)
      throw new Error("Renderer build inputs changed during compilation");
    const receipt = {
      version: 2,
      status: "ready",
      input,
      entries: entryDigests(build.rootDir),
      startedAt: build.startedAt,
      completedAt: new Date().toISOString(),
    };
    writeReceipt(build.rootDir, receipt);
    return receipt;
  } catch (error) {
    invalidateRendererBuild(build);
    throw error;
  }
}

export function inspectRendererBuildReceipt(rootDir) {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath(rootDir), "utf8"));
    if (receipt.version !== 2 || receipt.status !== "ready")
      return { ready: false, reason: "unfinished-renderer-build" };
    const input = fingerprintBuildInputs(rootDir, inputs);
    if (receipt.input?.sha256 !== input.sha256)
      return { ready: false, reason: "renderer-input-mismatch" };
    if (
      JSON.stringify(receipt.entries) !== JSON.stringify(entryDigests(rootDir))
    )
      return { ready: false, reason: "renderer-entry-mismatch" };
    return { ready: true, input, entries: receipt.entries };
  } catch {
    return { ready: false, reason: "missing-or-invalid-renderer-receipt" };
  }
}
