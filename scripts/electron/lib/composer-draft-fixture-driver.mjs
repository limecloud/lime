import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import {
  createRecord,
  markers,
  openRecord,
  prepareRecord,
  readIndex,
  readScope,
  verifyAcceptedNewEdit,
  verifyRecord,
  verifyRejectedSubmission,
} from "../../agent-runtime/claw-chat-current-fixture-draft-persistence.mjs";
import {
  assertAppServerRequestMethods,
  assertRestartLifecycle,
  assertConsumedDraft,
  requireDraftProof,
  summarizeDraft,
} from "./composer-draft-fixture-evidence.mjs";

const dependencies = {
  drafts:
    "scripts/agent-runtime/claw-chat-current-fixture-draft-persistence.mjs",
  launcher: "scripts/electron/mcp-config-fixture-smoke.mjs",
  lifecycle: "scripts/electron/lib/persisted-atom-fixture-driver.mjs",
  owners: "scripts/electron/lib/persisted-atom-fixture-standalone.mjs",
  atom: "scripts/electron/lib/persisted-atom-fixture.mjs",
  freshness: "scripts/lib/electron-fixture-build.mjs",
  assets: "scripts/lib/electron-app-server-assets.mjs",
  trace: "scripts/lib/invoke-trace-collector.mjs",
  runtime: "scripts/agent-runtime/claw-chat-current-fixture-backend-file.mjs",
  constants: "scripts/agent-runtime/claw-chat-current-fixture-constants.mjs",
  rpc: "scripts/agent-runtime/claw-chat-current-fixture-rpc.mjs",
  sessions: "scripts/agent-runtime/claw-chat-current-fixture-session.mjs",
  marks: "scripts/agent-runtime/claw-chat-current-fixture-composer-marks.mjs",
  image:
    "scripts/agent-runtime/claw-chat-current-fixture-composer-image-upload.mjs",
  history:
    "scripts/agent-runtime/claw-chat-current-fixture-composer-history.mjs",
  dom: "scripts/lib/composer-editor-dom.mjs",
  skills:
    "scripts/agent-runtime/claw-chat-current-fixture-skills-workspace.mjs",
};
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixtureSources = [
  "scripts/electron/composer-draft-fixture-smoke.mjs",
  "scripts/electron/lib/composer-draft-fixture-driver.mjs",
  "scripts/electron/lib/composer-draft-fixture-evidence.mjs",
  "scripts/agent-runtime/claw-chat-current-fixture-draft-persistence.mjs",
];

async function sourceFingerprint(repoRoot, relative) {
  const file = path.join(repoRoot, relative);
  return { path: file, sha256: hashBytes(await fs.readFile(file)) };
}

async function loadModules(repoRoot) {
  const result = await Promise.allSettled(
    Object.entries(dependencies).map(async ([key, relative]) => [
      key,
      await import(pathToFileURL(path.join(repoRoot, relative)).href),
    ]),
  );
  const loaded = {};
  for (const [index, entry] of result.entries()) {
    requireDraftProof(
      entry.status === "fulfilled",
      `load current dependency ${Object.keys(dependencies)[index]}`,
    );
    loaded[entry.value[0]] = entry.value[1];
  }
  return loaded;
}

export function parseComposerDraftFixtureArgs(argv, cwd = process.cwd()) {
  const options = {
    repoRoot: cwd,
    evidenceDir: null,
    packetPath: null,
    runId: null,
    timeoutMs: 60_000,
    intervalMs: 200,
    quitTimeoutMs: 15_000,
    help: false,
  };
  const fields = {
    "--repo": "repoRoot",
    "--evidence-dir": "evidenceDir",
    "--verification-packet": "packetPath",
    "--run-id": "runId",
    "--timeout-ms": "timeoutMs",
    "--quit-timeout-ms": "quitTimeoutMs",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const field = fields[argument];
    requireDraftProof(
      field && argv[index + 1],
      "known CLI argument with value",
    );
    options[field] = argv[++index];
  }
  if (options.help) return options;
  requireDraftProof(
    options.evidenceDir &&
      options.packetPath &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(options.runId ?? ""),
    "explicit verification packet, fresh evidence directory and run ID",
  );
  for (const field of ["repoRoot", "evidenceDir", "packetPath"])
    options[field] = path.resolve(cwd, options[field]);
  for (const field of ["timeoutMs", "quitTimeoutMs"]) {
    options[field] = Number(options[field]);
    requireDraftProof(
      Number.isSafeInteger(options[field]) &&
        options[field] > 0 &&
        options[field] <= 60_000,
      "bounded CLI timeout",
    );
  }
  return options;
}

async function runLocalDraftScenario({
  options,
  runtimeEnv,
  launch,
  quit,
  stopTrace,
  inspectSavedFiles,
  recordStage,
  setPhase,
}) {
  let context = await launch(1);
  setPhase("three-real-workspaces-and-rich-gui-edits");
  const records = [],
    originals = [];
  for (const [index, marker] of markers.entries()) {
    const rootPath = path.join(runtimeEnv.tempRoot, `workspace-${index + 1}`);
    await fs.mkdir(rootPath);
    const fixturePath = path.join(rootPath, "composer-persistence.md");
    const fixtureBytes = Buffer.alloc(128, " ");
    fixtureBytes.write(`# Composer persistence\n${marker}\n`, "utf8");
    await fs.writeFile(fixturePath, fixtureBytes);
    const record = await createRecord(context, {
      rootPath,
      marker,
      title: `Composer persistence ${options.runId} ${index + 1}`,
    });
    record.path = fixturePath;
    record.pathName = path.basename(fixturePath);
    records.push(record);
    originals.push(await prepareRecord(context, record));
  }
  requireDraftProof(
    new Set(records.map((record) => record.workspaceId)).size === 3 &&
      new Set(records.map((record) => record.threadId)).size === 3,
    "three genuine isolated workspaces and canonical threads",
  );
  setPhase("real-gui-rejected-submission-preserves-rich-draft");
  const rejectionBaseline = await verifyRecord(
    context,
    records[0],
    originals[0],
  );
  recordStage("rejection-complete-rich-baseline", rejectionBaseline);
  const rejected = await verifyRejectedSubmission(
    context,
    records[0],
    recordStage,
  );
  originals[0] = rejected.original;
  recordStage("gui-failure-preserves-rich-draft", rejected.evidence);
  for (const [index, record] of records.entries()) {
    await verifyRecord(context, record, originals[index]);
    recordStage(
      `workspace-${index + 1}-isolation`,
      await readIndex(context, record, originals[index].entry),
    );
  }
  const savedBeforeQuit = await readScope(context, records[2].scope);
  recordStage(
    "generation-1-saved-files",
    await inspectSavedFiles(savedBeforeQuit.storeRevision),
  );
  await quit();
  context = await launch(2);
  setPhase("new-main-pid-cold-gui-restoration");
  const second = [];
  for (const [index, record] of records.entries())
    second.push(await verifyRecord(context, record, originals[index]));
  requireDraftProof(
    second.every((proof) => proof.revision === savedBeforeQuit.storeRevision),
    "cold GUI hydration performs no extra atom mutation",
  );
  recordStage("generation-2-cold-gui-restoration", second);
  setPhase("accepted-current-turn-new-edit-and-foreign-workspace");
  recordStage(
    "accepted-new-edit-cross-scope",
    await verifyAcceptedNewEdit(context, records, originals),
  );
  for (const [index, record] of records.entries()) {
    await verifyRecord(context, record, originals[index]);
    await readIndex(context, record, originals[index].entry);
  }
  const acceptedTrace = await stopTrace();
  requireDraftProof(
    acceptedTrace.atomOperations.some(
      (operation) =>
        operation.op === "consume" && operation.status === "success",
    ) &&
      acceptedTrace.atomOperations.some(
        (operation) => operation.op === "put" && operation.status === "success",
      ),
    "production GUI performs accepted consume and newer-edit put through native IPC",
  );
  const secondSaved = await readScope(context, records[2].scope);
  recordStage(
    "generation-2-saved-files",
    await inspectSavedFiles(secondSaved.storeRevision),
  );
  await quit();
  context = await launch(3);
  setPhase("normal-restart-restores-new-edit-and-other-workspaces");
  const third = [];
  for (const [index, record] of records.entries())
    third.push(await verifyRecord(context, record, originals[index]));
  requireDraftProof(
    third.every((proof) => proof.revision === secondSaved.storeRevision),
    "second cold restart hydrates without additional mutation",
  );
  recordStage("generation-3-cold-gui-restoration", third);
  await quit();
  return {
    guiDraftRestoration: true,
    records: records.map((record, index) => ({
      ...record,
      draft: summarizeDraft(originals[index].entry),
    })),
  };
}

/** Real GUI driver. Native atom mutation is exclusively owned by production UI. */
export async function runComposerDraftGuiFixture(options, scenario = null) {
  requireDraftProof(
    path.resolve(process.cwd()) === options.repoRoot,
    "existing Electron launcher uses the formal repository cwd",
  );
  const runRoot = path.join(options.evidenceDir, options.runId);
  await fs.mkdir(options.evidenceDir, { recursive: true });
  await fs.mkdir(runRoot); // Never overwrite an existing run or reuse an unknown profile.
  const scope =
    scenario?.scope ??
    "existing canonical local conversations and their rich persistent drafts";
  const generationCount = scenario?.generationCount ?? 3;
  requireDraftProof(
    scenario === null ||
      (/^[a-z][a-z0-9-]{0,60}$/.test(scenario.id ?? "") &&
        typeof scenario.run === "function" &&
        typeof scope === "string" &&
        scope.length > 0 &&
        Number.isSafeInteger(generationCount) &&
        generationCount >= 2 &&
        Array.isArray(scenario.sourcePaths) &&
        scenario.sourcePaths.every(
          (relative) =>
            typeof relative === "string" &&
            !path.isAbsolute(relative) &&
            !relative.split(/[\\/]/).includes(".."),
        )),
    "explicit current scenario, identity and relative source lineage",
  );
  const summaryPath = path.join(
    runRoot,
    scenario
      ? `composer-${scenario.id}-gui.json`
      : "composer-draft-gui-persistence.json",
  );
  const generations = [],
    traceEvidence = [],
    stageEvidence = [];
  const consoleErrors = [],
    pageErrors = [];
  let active = null,
    context = null,
    phase = "current-dependencies";
  let modules, runtimeEnv, sourceRecords, owners, packetBytes;
  const recordStage = (name, proof) => stageEvidence.push({ name, proof });
  try {
    sourceRecords = await Promise.all(
      [
        ...new Set([
          ...Object.values(dependencies),
          ...fixtureSources,
          ...(scenario?.sourcePaths ?? []),
        ]),
      ].map((relative) => sourceFingerprint(options.repoRoot, relative)),
    );
    modules = await loadModules(options.repoRoot);
    const freshness = modules.freshness.inspectElectronFixtureBuildFreshness({
      rootDir: options.repoRoot,
    });
    requireDraftProof(
      freshness.ready === true,
      "fresh formal renderer, Main, preload and App Server artifacts; build forbidden",
    );
    recordStage("current-build-freshness", {
      ready: true,
      reason: freshness.reason,
    });
    packetBytes = await fs.readFile(options.packetPath);
    const packet = JSON.parse(packetBytes.toString("utf8"));
    phase = "current-pure-protocol-and-records";
    // This only compiles pure protocol/records/appDataPaths for strict parsing;
    // it does not build renderer, Electron Host, sidecar or product runtime.
    owners = await modules.owners.bundlePersistedAtomOwners({
      repoRoot: options.repoRoot,
      workDir: runRoot,
      packet,
    });
    const eventGuard = await modules.lifecycle.verifyPersistedAtomEventGuard({
      repoRoot: options.repoRoot,
      packet: packet.eventGuard,
    });
    recordStage("main-event-authority", eventGuard);
    runtimeEnv = modules.runtime.createTempRuntimeEnv();
    const { skillIdentity } =
      modules.skills.ensureUserVisibleCapabilityReportSkill(runtimeEnv);
    const profile = runtimeEnv.electronUserDataDir;
    const roots = owners.resolveDesktopStorageRoots({
      platform: process.platform,
      hostUserData: profile,
      e2eMode: true,
      e2eUserDataDir: profile,
      localAppData: runtimeEnv.env.LOCALAPPDATA,
    });
    requireDraftProof(
      roots.appDataRoot === profile && roots.agentRoot === runtimeEnv.agentRoot,
      "real platform appDataPaths map the same isolated profile",
    );
    const binaryRecords = await Promise.all(
      ["dist-electron/main/main.js", "dist-electron/preload/preload.cjs"].map(
        (relative) => sourceFingerprint(options.repoRoot, relative),
      ),
    );
    const appServerBinary = modules.assets.electronAppServerBinaryDestination({
      outputRoot: modules.assets.electronAppServerResourcesRoot(
        options.repoRoot,
      ),
    });
    const sidecarRecord = {
      path: appServerBinary,
      sha256: hashBytes(await fs.readFile(appServerBinary)),
    };
    binaryRecords.push(sidecarRecord);
    const appServerEnv = {
      APP_SERVER_BIN: appServerBinary,
      APP_SERVER_BACKEND_COMMAND: process.execPath,
      APP_SERVER_BACKEND_ARGS: JSON.stringify([
        runtimeEnv.backendPath,
        runtimeEnv.backendLedgerPath,
        runtimeEnv.cancelSignalPath,
        runtimeEnv.typedErrorSignalPath,
      ]),
      APP_SERVER_BACKEND_TIMEOUT_MS: "130000",
      CLAW_CHAT_FIXTURE_SCENARIO: "inputbar-rich-restore",
    };
    async function launch(generation) {
      phase = `generation-${generation}-real-electron-launch`;
      requireDraftProof(active === null, "sequential Main processes only");
      const current = modules.freshness.inspectElectronFixtureBuildFreshness({
        rootDir: options.repoRoot,
      });
      requireDraftProof(
        current.ready === true,
        "fresh build before each launch; no implicit build",
      );
      for (const record of [...sourceRecords, ...binaryRecords])
        requireDraftProof(
          hashBytes(await fs.readFile(record.path)) === record.sha256,
          "fixture dependencies and real Main/preload unchanged",
        );
      const launched = await modules.launcher.launchElectronFixture({
        options,
        runtimeEnv,
        appServerEnv,
        consoleErrors,
        pageErrors,
        backendMode: "external",
      });
      active = {
        ...launched,
        exit: modules.lifecycle.captureMainProcessExit(launched.app.process()),
        generation,
      };
      context = {
        app: launched.app,
        page: launched.page,
        options,
        modules,
        runtimeEnv,
        protocol: owners.protocol,
        captureTrace: async () => {
          const capture = await modules.trace.captureInvokeTraceCollector(
            active.page,
            active.trace,
          );
          const observed = modules.trace.validateInvokeTraceCollectorCapture(
            capture,
            active.trace,
          );
          requireDraftProof(
            observed.complete,
            "complete current native trace snapshot",
          );
          return {
            entries: observed.ledgerEntries,
            provenance: observed.provenance,
          };
        },
        setPhase: (value) => {
          phase = value;
          process.stdout.write(`[composer-draft-fixture] stage=${value}\n`);
        },
        readConsumedDraft: async (identity) => {
          const bytes = await fs.readFile(
            path.join(roots.appDataRoot, "host-state.json"),
          );
          requireDraftProof(
            bytes.length <= owners.limits.maxFileBytes,
            "saved consumption file budget",
          );
          return assertConsumedDraft(
            owners.parseEnvelope(
              JSON.parse(bytes.toString("utf8")),
              owners.limits,
            ),
            identity,
          );
        },
        expected: (record) => ({
          skillIdentity,
          marker: record.marker,
          prompt: modules.constants.INPUTBAR_RICH_RESTORE_PROMPT,
          pasteText: "历史粘贴验证😀\n".repeat(180),
          imageBase64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          path: record.path,
          pathName: record.pathName,
        }),
      };
      await modules.rpc.initializeAppServer(launched.page);
      active.trace = await modules.trace.installInvokeTraceCollector(
        launched.page,
      );
      return context;
    }
    async function stopTrace() {
      const stopped = await modules.trace.stopInvokeTraceCollector(
        active.page,
        active.trace,
      );
      const observed = modules.trace.validateInvokeTraceCollectorCapture(
        stopped,
        active.trace,
      );
      requireDraftProof(
        observed.complete && stopped.nativeRestored === true,
        "complete native Storage trace observation without missing ring entries",
      );
      const atoms = observed.ledgerEntries.filter(
        (entry) => entry.command === "persisted_atom_update",
      );
      requireDraftProof(
        atoms.every(
          (entry) =>
            entry.transport === "electron-ipc" &&
            Object.keys(entry.args_preview ?? {}).every((key) =>
              ["key", "op"].includes(key),
            ),
        ),
        "native GUI atom calls and metadata-only diagnostics",
      );
      const rpcEntries = observed.ledgerEntries.filter(
        (entry) => entry.command === "app_server_handle_json_lines",
      );
      const appServerRequestMethods = assertAppServerRequestMethods(rpcEntries);
      const evidence = {
        generation: active.generation,
        appServerRequestMethods,
        provenance: observed.provenance,
        atomOperations: atoms.map((entry) => ({
          op: entry.args_preview?.op,
          status: entry.status,
          transport: entry.transport,
        })),
        appServerInvokeCount: observed.ledgerEntries.filter(
          (entry) => entry.command === "app_server_handle_json_lines",
        ).length,
      };
      traceEvidence.push(evidence);
      active.trace = null;
      return evidence;
    }
    async function quit() {
      phase = `generation-${active.generation}-public-normal-quit`;
      if (active.trace) await stopTrace();
      const receipt = await modules.lifecycle.quitMainProcessNormally(
        active,
        options.quitTimeoutMs,
      );
      generations.push({ ...receipt, profile, generation: active.generation });
      active = null;
    }
    async function inspectSavedFiles(revision, inspectEnvelope = null) {
      const records = [];
      for (const name of ["host-state.json", "host-state.json.bak"]) {
        const file = path.join(roots.appDataRoot, name);
        const bytes = await fs.readFile(file);
        requireDraftProof(
          bytes.length <= owners.limits.maxFileBytes,
          "native saved file budget",
        );
        const envelope = owners.parseEnvelope(
          JSON.parse(bytes.toString("utf8")),
          owners.limits,
        );
        requireDraftProof(
          envelope.storeRevision === revision,
          "both native saved envelopes acknowledge exact revision",
        );
        const entryEvidence = inspectEnvelope
          ? await inspectEnvelope(envelope)
          : null;
        records.push({
          ...(entryEvidence === null ? {} : { entryEvidence }),
          path: file,
          sha256: hashBytes(bytes),
          storeRevision: envelope.storeRevision,
          validatedBy: "persistedAtomRecords.parseEnvelope",
        });
      }
      requireDraftProof(
        records[0].sha256 === records[1].sha256,
        "same saved primary and backup snapshot",
      );
      return records;
    }
    const scenarioResult = await (scenario?.run ?? runLocalDraftScenario)({
      options,
      runtimeEnv,
      launch,
      quit,
      stopTrace,
      inspectSavedFiles,
      recordStage,
      setPhase: (next) => {
        context?.setPhase(next);
      },
      getContext: () => context,
    });
    requireDraftProof(
      active === null,
      "scenario completed by public normal quit",
    );
    assertRestartLifecycle(generations, profile, generationCount);
    for (const record of [...sourceRecords, ...binaryRecords])
      requireDraftProof(
        hashBytes(await fs.readFile(record.path)) === record.sha256,
        "current sources and product binaries unchanged through final normal exit",
      );
    requireDraftProof(
      pageErrors.length === 0,
      "no uncaught renderer exception",
    );
    requireDraftProof(
      hashBytes(await fs.readFile(options.packetPath)) ===
        hashBytes(packetBytes),
      "verification packet unchanged throughout real run",
    );
    const summary = {
      schemaVersion: 1,
      result: "pass",
      runId: options.runId,
      guiDraftRestoration: scenarioResult.guiDraftRestoration === true,
      desktopGateB: true,
      desktopGateScope: scope,
      allGuiSlicesClosed: false,
      firstSubmissionRoutesVerified:
        scenarioResult.firstSubmissionRoutesVerified === true,
      firstSubmissionRoutes: scenarioResult.firstSubmissionRoutes ?? [],
      worktreeSubmission: scenarioResult.worktreeSubmission ?? null,
      sameCanonicalThreadTurnItemOwner: true,
      normalExitMustNotBeReplacedByKill: true,
      generations,
      stageEvidence,
      traceEvidence,
      sourceRecords,
      binaryRecords,
      pureOwnerCompilation: owners.receipt,
      verificationPacketSha256: hashBytes(packetBytes),
      isolatedProfile: profile,
      fixtureRuntimeRoot: runtimeEnv.tempRoot,
      records: scenarioResult.records,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      limitations: scenario?.limitations ?? [
        "Home, direct draftTab and materialized draftTab first submissions and cold tab discovery are not covered.",
        "Synthetic DataTransfer/ClipboardEvent and DragEvent use production ingress; OS clipboard and OS drag are not covered.",
        "Saved is awaited before app.quit; pending-save abrupt exit is not covered.",
        "Public RPC interrupts the accepted Turn under a foreign GUI scope; GUI Stop button is not covered here.",
        "New edit follows accepted consume; pending old-token race is covered by behavior tests, not claimed here.",
        "Submission failure proves visible rejection, no canonical Turn, and exact saved-draft preservation; RPC rejection layer needs trace review.",
      ],
    };
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
    return { summaryPath, summary };
  } catch (error) {
    // Teardown still uses public normal quit. A failed quit stays a failed run;
    // do not kill the process and then present that as normal-restart evidence.
    let teardown = null;
    if (active && modules) {
      await active.page
        .screenshot({ path: path.join(runRoot, "failed-gui.png") })
        .catch(() => undefined);
      if (active.trace)
        await modules.trace
          .stopInvokeTraceCollector(active.page, active.trace)
          .catch(() => undefined);
      try {
        teardown = await modules.lifecycle.quitMainProcessNormally(
          active,
          options.quitTimeoutMs,
        );
      } catch {
        teardown = { pid: active.exit.pid, normalQuitFailed: true };
      }
    }
    const failure = {
      schemaVersion: 1,
      result: "fail",
      runId: options.runId,
      phase,
      guiDraftRestoration: false,
      desktopGateB: false,
      desktopGateScope: scope,
      allGuiSlicesClosed: false,
      generations,
      stageEvidence,
      traceEvidence,
      teardown,
      errorClass: error instanceof Error ? error.name : "unknown",
      errorLocations: String(error?.stack ?? "")
        .split("\n")
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 5),
      failureReason: /^Composer draft GUI fixture (failed|timed out):/.test(
        error?.message ?? "",
      )
        ? error.message
        : "Current dependency or GUI action failed; raw error omitted",
      diagnostic:
        "Inspect the failed phase; request bodies and rich draft data are intentionally omitted.",
      sourceRecords,
      isolatedProfile: runtimeEnv?.electronUserDataDir ?? null,
    };
    await fs.writeFile(summaryPath, JSON.stringify(failure, null, 2) + "\n");
    throw new Error(
      `Composer draft GUI fixture failed at ${phase}; evidence=${summaryPath}`,
    );
  }
}
