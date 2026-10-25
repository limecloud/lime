import {
  APP_SERVER_SOURCE_DIRS,
  APP_SERVER_SOURCE_FILES,
  HOST_SOURCE_DIRS,
  HOST_SOURCE_FILES,
  HOST_PRELOAD_BUILD_ENTRIES,
  HOST_CLIENT_BUILD_ENTRIES,
  RENDERER_BUILD_ENTRIES,
  RENDERER_SOURCE_DIRS,
  RENDERER_SOURCE_FILES,
  createMtimeEntry,
  declaredBuildEntries,
  findNewestBuildInput,
  pickNewer,
  statFile,
} from "./electron-build-inputs.mjs";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { inspectRendererBuildReceipt } from "./electron-renderer-build.mjs";
import {
  electronAppServerBinaryDestination,
  electronCodeModeHostBinaryDestination,
} from "./electron-app-server-assets.mjs";

const BUILD_READY_ENV = "LIME_ELECTRON_FIXTURE_BUILD_READY";
const BUILD_LOCK_DIR = path.join(".lime", "electron-fixture-build.lock");
const BUILD_LOCK_WAIT_MS = 1_000;
const BUILD_LOCK_TIMEOUT_MS = 20 * 60_000;
const BUILD_LOCK_STALE_MS = 30 * 60_000;
function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function nodeCommand() {
  return process.execPath;
}

function electronFixtureBuildSegments({ rootDir }) {
  const rendererEntries = declaredBuildEntries(rootDir, RENDERER_BUILD_ENTRIES);
  const preloadEntries = declaredBuildEntries(
    rootDir,
    HOST_PRELOAD_BUILD_ENTRIES,
  );
  const clientEntries = declaredBuildEntries(rootDir, [
    HOST_PRELOAD_BUILD_ENTRIES[0],
    ...HOST_CLIENT_BUILD_ENTRIES,
  ]).slice(1);
  return [
    {
      id: "renderer",
      label: "renderer",
      requiredFiles: rendererEntries.map((entry) =>
        path.join(rootDir, entry.output),
      ),
      entrySources: rendererEntries
        .slice(1)
        .map((entry) => path.join(rootDir, entry.source)),
      sourceDirs: RENDERER_SOURCE_DIRS,
      sourceFiles: RENDERER_SOURCE_FILES,
      buildSteps: [
        {
          label: "build renderer",
          command: npmCommand(),
          args: ["run", "build:renderer:electron:smoke"],
        },
      ],
    },
    {
      id: "host",
      label: "Electron host",
      requiredFiles: [
        path.join(rootDir, "dist-electron", "main", "main.js"),
        ...preloadEntries.map((entry) => path.join(rootDir, entry.output)),
        ...clientEntries.map((entry) => path.join(rootDir, entry.output)),
        path.join(
          rootDir,
          "dist-electron",
          "plugins",
          "openai-bundled",
          ".agents",
          "plugins",
          "marketplace.json",
        ),
      ],
      entrySources: [...preloadEntries.slice(1), ...clientEntries].map(
        (entry) => path.join(rootDir, entry.source),
      ),
      sourceDirs: HOST_SOURCE_DIRS,
      sourceFiles: HOST_SOURCE_FILES,
      buildSteps: [
        {
          label: "build app-server client",
          command: npmCommand(),
          args: ["--prefix", "packages/app-server-client", "run", "build"],
        },
        {
          label: "typecheck Electron host",
          command: npmCommand(),
          args: ["run", "typecheck:electron"],
        },
        {
          label: "build Electron host",
          command: nodeCommand(),
          args: ["scripts/electron/build-host.mjs"],
        },
        {
          label: "copy desktop assets",
          command: npmCommand(),
          args: ["run", "electron:build:assets"],
        },
      ],
    },
    {
      id: "appServer",
      label: "app-server sidecar",
      requiredFiles: [
        path.join(rootDir, "dist-electron", "app-server.release.json"),
        path.join(rootDir, "dist-electron", "desktop-resources.manifest.json"),
        electronAppServerBinaryDestination({
          outputRoot: path.join(rootDir, "dist-electron"),
        }),
        electronCodeModeHostBinaryDestination({
          outputRoot: path.join(rootDir, "dist-electron"),
        }),
      ],
      sourceDirs: APP_SERVER_SOURCE_DIRS,
      sourceFiles: APP_SERVER_SOURCE_FILES,
      buildSteps: [
        {
          label: "prepare app-server sidecar",
          command: npmCommand(),
          args: ["run", "electron:build:app-server-assets"],
        },
      ],
    },
  ];
}

export function electronFixtureBuildReadyEnv() {
  return BUILD_READY_ENV;
}

export function electronFixtureBuildRequiredFiles({ rootDir }) {
  return electronFixtureBuildSegments({ rootDir }).flatMap(
    (segment) => segment.requiredFiles,
  );
}

function pickOlder(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return right.mtimeMs < left.mtimeMs ? right : left;
}

function findOldestRequiredArtifact(rootDir, requiredFiles) {
  return requiredFiles.reduce((oldest, filePath) => {
    const stats = statFile(filePath);
    if (!stats?.isFile()) {
      return oldest;
    }
    return pickOlder(oldest, createMtimeEntry(rootDir, filePath, stats));
  }, null);
}

function inspectElectronFixtureBuildSegmentFreshness(rootDir, segment) {
  const requiredFiles = segment.requiredFiles;
  const missingFiles = requiredFiles.filter(
    (filePath) => !existsSync(filePath),
  );
  if (missingFiles.length > 0) {
    return {
      id: segment.id,
      label: segment.label,
      ready: false,
      reason: "missing-artifacts",
      requiredFiles,
      missingFiles,
      newestSource: findNewestBuildInput(rootDir, segment),
      oldestArtifact: null,
    };
  }

  const oldestArtifact = findOldestRequiredArtifact(rootDir, requiredFiles);
  const newestSource = findNewestBuildInput(rootDir, segment);
  const missingSourceFiles = (segment.entrySources ?? []).filter(
    (filePath) => !statFile(filePath)?.isFile(),
  );
  if (missingSourceFiles.length > 0) {
    return {
      id: segment.id,
      label: segment.label,
      ready: false,
      reason: "stale-source",
      requiredFiles,
      missingFiles: [],
      missingSourceFiles,
      newestSource,
      oldestArtifact,
    };
  }
  if (segment.id === "renderer") {
    const invalidRendererAssets = requiredFiles.flatMap((entryPath) =>
      inspectRendererEntryAssets(rootDir, entryPath),
    );
    if (invalidRendererAssets.length > 0) {
      return {
        id: segment.id,
        label: segment.label,
        ready: false,
        reason: "invalid-renderer-assets",
        requiredFiles,
        missingFiles: [],
        invalidRendererAssets,
        newestSource,
        oldestArtifact,
      };
    }
  }
  if (
    oldestArtifact &&
    newestSource &&
    newestSource.mtimeMs > oldestArtifact.mtimeMs
  ) {
    return {
      id: segment.id,
      label: segment.label,
      ready: false,
      reason: "stale-source",
      requiredFiles,
      missingFiles: [],
      newestSource,
      oldestArtifact,
    };
  }

  if (segment.id === "renderer") {
    const buildReceipt = inspectRendererBuildReceipt(rootDir);
    if (!buildReceipt.ready)
      return {
        id: segment.id,
        label: segment.label,
        ready: false,
        reason: "stale-source",
        requiredFiles,
        missingFiles: [],
        newestSource,
        oldestArtifact,
        buildReceipt,
      };
  }

  return {
    id: segment.id,
    label: segment.label,
    ready: true,
    reason: "fresh-artifacts",
    requiredFiles,
    missingFiles: [],
    newestSource,
    oldestArtifact,
  };
}

function inspectRendererEntryAssets(rootDir, entryPath) {
  const entryRelativePath = path.relative(rootDir, entryPath);
  let dom;
  try {
    // Parse only: default JSDOM options neither execute scripts nor load resources.
    dom = new JSDOM(readFileSync(entryPath, "utf8"), {
      url: pathToFileURL(entryPath).href,
    });
    const document = dom.window.document;
    const modules = Array.from(document.querySelectorAll("script[src]")).filter(
      (node) =>
        !node.closest("noscript") &&
        node.getAttribute("type")?.trim().toLowerCase() === "module",
    );
    const stylesheets = Array.from(
      document.querySelectorAll("link[href]"),
    ).filter(
      (node) =>
        !node.closest("noscript") &&
        node
          .getAttribute("rel")
          ?.toLowerCase()
          .split(/\s+/u)
          .includes("stylesheet"),
    );
    const references = [
      ...modules.map((node) => ({
        kind: "module-script",
        reference: node.getAttribute("src"),
      })),
      ...stylesheets.map((node) => ({
        kind: "stylesheet",
        reference: node.getAttribute("href"),
      })),
    ];
    const invalid =
      modules.length === 0
        ? [
            {
              kind: "module-entry",
              reason: "missing-module-entry",
              relativePath: entryRelativePath,
            },
          ]
        : [];
    for (const { kind, reference } of references) {
      const value = reference.trim();
      if (!value) {
        invalid.push({ kind, reason: "empty-reference" });
        continue;
      }
      if (/^[\\/]|^[a-z]:[\\/]/iu.test(value)) {
        invalid.push({ kind, reason: "root-absolute" });
        continue;
      }
      try {
        const url = new URL(value, document.baseURI);
        if (url.protocol !== "file:") {
          invalid.push({ kind, reason: "non-local-url" });
          continue;
        }
        const filePath = fileURLToPath(url);
        if (!statFile(filePath)?.isFile()) {
          invalid.push({
            kind,
            reason: "missing-local-file",
            relativePath: path.relative(rootDir, filePath),
          });
        }
      } catch {
        invalid.push({ kind, reason: "invalid-url" });
      }
    }
    return invalid;
  } catch {
    return [
      {
        kind: "module-entry",
        reason: "unreadable-entry",
        relativePath: entryRelativePath,
      },
    ];
  } finally {
    dom?.window.close();
  }
}

export function inspectElectronFixtureBuildFreshness({ rootDir }) {
  const segmentFreshness = electronFixtureBuildSegments({ rootDir }).map(
    (segment) => inspectElectronFixtureBuildSegmentFreshness(rootDir, segment),
  );
  const requiredFiles = segmentFreshness.flatMap(
    (segment) => segment.requiredFiles,
  );
  const missingFiles = segmentFreshness.flatMap((segment) =>
    segment.missingFiles.map((filePath) => filePath),
  );
  const invalidRendererAssets = segmentFreshness.flatMap(
    (segment) => segment.invalidRendererAssets ?? [],
  );
  const staleSegments = segmentFreshness.filter((segment) => !segment.ready);
  const aggregateSegments =
    staleSegments.length > 0 ? staleSegments : segmentFreshness;
  const oldestArtifact = aggregateSegments.reduce(
    (oldest, segment) => pickOlder(oldest, segment.oldestArtifact),
    null,
  );
  const newestSource = aggregateSegments.reduce(
    (newest, segment) => pickNewer(newest, segment.newestSource),
    null,
  );
  const reason =
    missingFiles.length > 0
      ? "missing-artifacts"
      : invalidRendererAssets.length > 0
        ? "invalid-renderer-assets"
        : staleSegments.length > 0
          ? "stale-source"
          : "fresh-artifacts";

  return {
    ready: staleSegments.length === 0,
    reason,
    requiredFiles,
    missingFiles,
    invalidRendererAssets,
    newestSource,
    oldestArtifact,
    segments: Object.fromEntries(
      segmentFreshness.map((segment) => [segment.id, segment]),
    ),
    staleSegments: staleSegments.map((segment) => segment.id),
  };
}

function buildReadyResult(logPrefix, freshness) {
  console.log(
    `[${logPrefix}] reusing fresh packaged fixture assets; oldest=${freshness.oldestArtifact?.relativePath ?? "unknown"} newestSource=${freshness.newestSource?.relativePath ?? "none"}`,
  );
  process.env[BUILD_READY_ENV] = "1";
  return {
    status: "reused",
    reason: freshness.reason,
    freshness,
  };
}

function runCommandSync({ command, args, cwd, env, stdio }) {
  return spawnSync(command, args, {
    cwd,
    stdio,
    env,
  });
}

function runBuildStep(step, { rootDir, env, logPrefix, runCommand }) {
  console.log(`[${logPrefix}] > ${step.label}`);
  const result = runCommand({
    command: step.command,
    args: step.args,
    cwd: rootDir,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 || result.signal) {
    const termination = result.signal
      ? `signal=${result.signal}`
      : `exit=${result.status ?? "unknown"}`;
    const error = new Error(
      `[${logPrefix}] ${step.label} 失败: ${step.command} ${step.args.join(
        " ",
      )} (${termination})`,
    );
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function buildStaleElectronFixtureSegments({
  freshness,
  logPrefix,
  rootDir,
  runCommand,
}) {
  const staleSegmentIds = new Set(freshness.staleSegments);
  const segmentsToBuild = electronFixtureBuildSegments({ rootDir }).filter(
    (segment) => staleSegmentIds.has(segment.id),
  );
  if (segmentsToBuild.length === 0) {
    return;
  }

  const buildEnv = {
    ...process.env,
    LIME_ALLOW_LIVE_PROVIDER_SMOKE: "0",
    LIME_REAL_API_TEST: "0",
  };
  const preflightSteps = [
    {
      label: "verify app version",
      command: npmCommand(),
      args: ["run", "verify:app-version"],
    },
  ];

  for (const step of preflightSteps) {
    runBuildStep(step, {
      rootDir,
      env: buildEnv,
      logPrefix,
      runCommand,
    });
  }

  for (const segment of segmentsToBuild) {
    console.log(`[${logPrefix}] rebuilding ${segment.label} fixture assets`);
    for (const step of segment.buildSteps) {
      runBuildStep(step, {
        rootDir,
        env: buildEnv,
        logPrefix,
        runCommand,
      });
    }
  }
}

function acquireElectronFixtureBuildLock({ rootDir, logPrefix }) {
  const lockDir = path.join(rootDir, BUILD_LOCK_DIR);
  const startedAt = Date.now();
  let loggedWait = false;

  while (Date.now() - startedAt < BUILD_LOCK_TIMEOUT_MS) {
    mkdirSync(path.dirname(lockDir), { recursive: true });
    try {
      mkdirSync(lockDir);
      writeFileSync(
        path.join(lockDir, "owner.json"),
        `${JSON.stringify(
          {
            pid: process.pid,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      return () => {
        rmSync(lockDir, { force: true, recursive: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    const lockStats = statFile(lockDir);
    if (lockStats && Date.now() - lockStats.mtimeMs > BUILD_LOCK_STALE_MS) {
      console.warn(
        `[${logPrefix}] removing stale Electron fixture build lock after ${Math.round(
          (Date.now() - lockStats.mtimeMs) / 1000,
        )}s: ${path.relative(rootDir, lockDir)}`,
      );
      rmSync(lockDir, { force: true, recursive: true });
      continue;
    }

    if (!loggedWait) {
      console.log(
        `[${logPrefix}] waiting for Electron fixture packaged renderer/assets build lock`,
      );
      loggedWait = true;
    }
    sleepSync(BUILD_LOCK_WAIT_MS);
  }

  throw new Error(
    `[${logPrefix}] timed out waiting for Electron fixture packaged renderer/assets build lock: ${path.relative(
      rootDir,
      lockDir,
    )}`,
  );
}

export function ensureElectronFixtureBuild({
  appUrl = "",
  logPrefix,
  rootDir,
  runCommand = runCommandSync,
}) {
  if (appUrl) {
    return {
      status: "skipped",
      reason: "app-url",
    };
  }

  if (process.env[BUILD_READY_ENV] === "1") {
    return {
      status: "skipped",
      reason: BUILD_READY_ENV,
    };
  }

  const freshness = inspectElectronFixtureBuildFreshness({ rootDir });
  if (freshness.ready) {
    return buildReadyResult(logPrefix, freshness);
  }

  const releaseBuildLock = acquireElectronFixtureBuildLock({
    rootDir,
    logPrefix,
  });
  try {
    const lockedFreshness = inspectElectronFixtureBuildFreshness({ rootDir });
    if (lockedFreshness.ready) {
      return buildReadyResult(logPrefix, lockedFreshness);
    }

    console.log(
      `\n[${logPrefix}] > Electron fixture packaged renderer/assets build`,
    );
    if (lockedFreshness.missingFiles.length > 0) {
      console.log(
        `[${logPrefix}] missing build artifacts: ${lockedFreshness.missingFiles
          .map((filePath) => path.relative(rootDir, filePath))
          .join(", ")}`,
      );
    } else {
      console.log(
        `[${logPrefix}] rebuilding stale packaged fixture assets; segments=${lockedFreshness.staleSegments.join(",")} newestSource=${lockedFreshness.newestSource?.relativePath ?? "unknown"} oldestArtifact=${lockedFreshness.oldestArtifact?.relativePath ?? "unknown"}`,
      );
    }

    buildStaleElectronFixtureSegments({
      freshness: lockedFreshness,
      logPrefix,
      rootDir,
      runCommand,
    });

    process.env[BUILD_READY_ENV] = "1";
    return {
      status: lockedFreshness.missingFiles.length > 0 ? "built" : "rebuilt",
      missingFiles: lockedFreshness.missingFiles,
      freshness: lockedFreshness,
      rebuiltSegments: lockedFreshness.staleSegments,
    };
  } finally {
    releaseBuildLock();
  }
}
