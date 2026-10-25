#!/usr/bin/env node

// Test-only provider; every tool, session, transport and storage owner is production.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, watch } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";
import { terminalGateRuntimeEnvironment } from "./terminal-gate-binaries.mjs";

assert.ok(process.env.APP_SERVER_BIN, "supply a fixed App Server artifact");
const binaryPath = path.resolve(process.env.APP_SERVER_BIN);
const hash = createHash("sha256");
for await (const chunk of createReadStream(binaryPath)) hash.update(chunk);
const binarySha256 = hash.digest("hex");
const { connectAppServerSidecar, stdioSidecar } = await import(
  pathToFileURL(path.resolve("packages/app-server-client/dist/index.js")).href
);
const temp = await realpath(
  await mkdtemp(path.join(tmpdir(), "memory-agent-")),
);
const data = path.join(temp, "data");
const app = path.join(temp, "app");
const workspace = path.join(temp, "project");
const root = path.join(data, "memories");
const hooksHome = path.join(temp, "hooks-home");
const stopMode = process.env.MEMORY_AGENT_STOP ?? "allow";
assert.ok(["allow", "block", "abort"].includes(stopMode));
await Promise.all(
  [data, app, workspace, hooksHome].map((directory) => mkdir(directory)),
);
let hookConfig;
if (stopMode !== "allow") {
  const hookPath = path.join(hooksHome, "stop.cjs");
  const decision =
    stopMode === "block"
      ? { decision: "block", reason: "fixture rejection" }
      : { continue: false, stopReason: "fixture abort" };
  await writeFile(
    hookPath,
    `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(decision))}));`,
  );
  hookConfig = `[hooks]\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(`"${process.execPath}" "${hookPath}"`)}\n`;
  await writeFile(path.join(hooksHome, "config.toml"), hookConfig);
}
const markerA = "MEMORY_SHARED_HARNESS_A_20261020";
const markerB = "MEMORY_SHARED_HARNESS_B_20261020";
const agentsMarker = "MEMORY_LOCAL_AGENTS_INSTRUCTION_20261020";
const globalAgentsMarker = "PERSONALIZATION_GLOBAL_INSTRUCTION_20261023";
const revisedAgentsMarker = "PERSONALIZATION_REVISED_INSTRUCTION_20261023";
await writeFile(path.join(hooksHome, "AGENTS.md"), globalAgentsMarker);
const summary = `v1\n\n## User Profile\n\n## User preferences\n\nUse the selected model route.\n\n## General Tips\n\n## What's in Memory\n\n${markerA}\n`;
let agentSamples = 0;
let extractionSamples = 0;
let phase2Runs = 0;
let phase2Step = 0;
const phase2Orders = [];
let internalIdentity;
const internalIdentities = [];
let citationThreadId;
let normalTurnSamples = 0;
let normalContextSnapshot;
let sourceThreadA;
let sourceThreadB;
let memoryExpected = true;
let instructionExpected = globalAgentsMarker;
const toolNames = (body) =>
  (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
const fixture = await startOpenAiCompatibleFixtureServer({
  scriptedResponses: [
    async ({ body }) => {
      const text = JSON.stringify(body);
      if (text.includes("Consolidate the supplied rollout summaries")) {
        if (phase2Step === 0) phase2Runs += 1;
        phase2Step += 1;
        agentSamples += 1;
        const identity = {
          threadId: body.client_metadata?.thread_id,
          turnId: body.client_metadata?.turn_id,
        };
        assert.ok(
          identity.threadId && identity.turnId,
          "provider request retains canonical Thread/Turn identity",
        );
        if (!internalIdentity) internalIdentity = identity;
        if (
          !internalIdentities.some(
            (entry) => entry.threadId === identity.threadId,
          )
        ) {
          internalIdentities.push(identity);
          const snapshot = await call("thread/read", {
            threadId: identity.threadId,
          });
          assert.equal(snapshot.thread.ephemeral, true);
          assert.equal(snapshot.thread.path ?? null, null);
          assert.equal(snapshot.thread.cwd, root);
        }
        const names = toolNames(body);
        assert.ok(names.includes("exec_command"));
        assert.ok(names.includes("apply_patch"));
        for (const name of names)
          assert.ok(
            [
              "exec_command",
              "write_stdin",
              "apply_patch",
              "read_file",
              "list_dir",
              "grep_files",
              "view_image",
              "update_plan",
            ].includes(name),
            `unexpected internal Agent tool: ${name}`,
          );
        assert.ok(
          text.includes(agentsMarker),
          "local AGENTS instructions remain active",
        );
        const currentStep = phase2Step % 3 || 3;
        if (currentStep === 1)
          return {
            type: "tool_call",
            id: `memory-cwd-${phase2Runs}`,
            name: "exec_command",
            arguments: {
              cmd:
                process.platform === "win32"
                  ? `Set-Content -Path memory_summary.md -Value ${JSON.stringify(summary)}; Get-Location`
                  : `printf %b ${JSON.stringify(summary)} > memory_summary.md && cat raw_memories.md && pwd`,
              workdir: root,
              login: false,
              shell:
                process.platform === "win32" ? "powershell.exe" : "/bin/sh",
              yield_time_ms: 1000,
            },
          };
        if (currentStep === 2) {
          const result = body.input?.find(
            (message) =>
              message.type === "function_call_output" &&
              message.call_id === `memory-cwd-${phase2Runs}`,
          );
          assert.ok(
            result,
            "shell continuation retains the original tool call identity",
          );
          assert.ok(
            JSON.stringify(result.output).includes(root),
            "shell result is present in the continuation",
          );
          const resultText = JSON.stringify(result.output);
          phase2Orders.push(
            [markerA, markerB]
              .map((marker) => ({ marker, index: resultText.indexOf(marker) }))
              .filter((entry) => entry.index >= 0)
              .sort((left, right) => left.index - right.index)
              .map((entry) => entry.marker),
          );
          return {
            type: "tool_call",
            id: `memory-patch-${phase2Runs}`,
            name: "apply_patch",
            arguments: {
              patch: `*** Begin Patch\n*** Add File: harness-proof-${phase2Runs}.md\n+${markerA}\n*** End Patch`,
            },
          };
        }
        const patchResult = body.input?.find(
          (message) =>
            message.type === "function_call_output" &&
            message.call_id === `memory-patch-${phase2Runs}`,
        );
        assert.ok(
          patchResult,
          "patch continuation retains the original tool call identity",
        );
        assert.ok(
          JSON.stringify(patchResult.output).includes(
            `harness-proof-${phase2Runs}.md`,
          ),
          "native patch result reaches the next sample",
        );
        phase2Step = 0;
        return { type: "text", content: "Consolidation complete." };
      }
      if (text.includes("Read this immutable rollout record")) {
        extractionSamples += 1;
        assert.equal(
          toolNames(body).length,
          0,
          "phase-1 is structured extraction",
        );
        assert.equal(body.text?.format?.type, "json_schema");
        assert.equal(body.text?.format?.strict, true);
        assert.ok(body.text?.format?.schema?.properties?.rollout_summary);
        assert.match(body.client_metadata?.turn_id ?? "", /^memory-stage1-/);
        const marker = text.includes(sourceThreadB) ? markerB : markerA;
        return {
          type: "text",
          content: JSON.stringify({
            rollout_summary: marker,
            rollout_slug:
              marker === markerB ? "shared-harness-b" : "shared-harness-a",
          }),
        };
      }
      normalTurnSamples += 1;
      normalContextSnapshot = {
        hasMemory: text.includes(markerA),
        hasCurrentInstructions: text.includes(instructionExpected),
        memoryExpected,
      };
      assert.equal(normalContextSnapshot.hasMemory, memoryExpected);
      assert.equal(normalContextSnapshot.hasCurrentInstructions, true);
      assert.ok(
        citationThreadId,
        "fixture selected a source for citation feedback",
      );
      return {
        type: "text",
        content: memoryExpected
          ? `Memory context used.\n<oai-mem-citation><rollout_ids>${citationThreadId}</rollout_ids></oai-mem-citation>`
          : "Memory disabled for this turn.",
      };
    },
  ],
});
let connected;
const notifications = [];
const { DatabaseSync } = await import("node:sqlite");
function storageState() {
  const db = new DatabaseSync(path.join(data, "memory_state.sqlite"), {
    readOnly: true,
  });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return {
      job: db
        .prepare(
          "SELECT status, lease_owner, completed_watermark, last_error FROM memory_phase2_jobs",
        )
        .get(),
      sources: db
        .prepare(
          "SELECT source_path, source_thread_id, status, selected_for_phase2, usage_count, last_usage FROM memory_rollout_jobs ORDER BY source_path",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}
function waitForStorage(expected) {
  return new Promise((resolve, reject) => {
    const watcher = watch(data, check);
    const timer = setTimeout(
      () => finish(new Error("phase-2 storage did not finish")),
      120_000,
    );
    function finish(error) {
      clearTimeout(timer);
      watcher.close();
      if (error) reject(error);
      else resolve();
    }
    function check() {
      try {
        const { job } = storageState();
        if (job?.status === expected) finish();
        else if (["failed", "succeeded"].includes(job?.status))
          finish(
            new Error(
              `phase-2 storage expected ${expected}, got ${job.status}`,
            ),
          );
      } catch (error) {
        finish(error);
      }
    }
    check();
  });
}
async function call(method, params) {
  return (
    await connected.connection.request(
      connected.client.request(method, params),
      method,
      { timeoutMs: 60_000 },
    )
  ).result;
}
async function assertNoEphemeralHistory(directory, identities) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertNoEphemeralHistory(target, identities);
    else if (entry.isFile()) {
      const bytes = await readFile(target);
      for (const id of identities)
        assert.ok(
          !bytes.includes(Buffer.from(id)),
          `internal history leaked: ${path.relative(temp, target)}`,
        );
    }
  }
}
try {
  connected = await connectAppServerSidecar(
    { ...stdioSidecar(binaryPath, undefined, data), backendMode: "runtime" },
    {
      clientInfo: { name: "memory-agent-fixture", version: "1" },
      capabilities: { experimentalApi: true },
    },
    {
      args: [
        "--listen",
        "stdio://",
        "--backend",
        "runtime",
        "--data-dir",
        data,
        "--app-data-dir",
        app,
      ],
      env: {
        ...terminalGateRuntimeEnvironment({ appServerBinaryPath: binaryPath }),
        LIME_HOME: hooksHome,
      },
      initializeTimeoutMs: 60_000,
    },
  );
  connected.connection.setNotificationObserver((message) =>
    notifications.push(message),
  );
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_, method, params) => call(method, params),
  });
  await call("config/batchWrite", {
    edits: [
      {
        keyPath: "memory",
        value: { enabled: true, auto: { enabled: false } },
        mergeStrategy: "replace",
      },
    ],
  });
  // Responses carries canonical identity in client_metadata; Chat has no such wire field.
  await call("modelProvider/update", {
    providerId: provider.providerPreference,
    providerType: "openai-response",
  });
  if (hookConfig) {
    const listed = await call("hooks/list", { cwds: [root] });
    const hook = listed.data
      .flatMap((entry) => entry.hooks)
      .find((entry) => entry.eventName.toLowerCase() === "stop");
    assert.ok(
      hook,
      `global Stop hook is discoverable: ${JSON.stringify(listed)}`,
    );
    assert.equal(
      hook.source,
      "user",
      "the fixture hook must exercise Codex user-hook filtering",
    );
    await writeFile(
      path.join(hooksHome, "config.toml"),
      `${hookConfig}\n[hooks.state.${JSON.stringify(hook.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`,
    );
  }
  sourceThreadA = (
    await call(
      "thread/start",
      buildToolExecutionThreadStartParams({
        provider,
        title: "Memory source A",
        workspaceRoot: workspace,
      }),
    )
  ).thread.id;
  sourceThreadB = (
    await call(
      "thread/start",
      buildToolExecutionThreadStartParams({
        provider,
        title: "Memory source B",
        workspaceRoot: workspace,
      }),
    )
  ).thread.id;
  const note = await call("memoryStore/addNote", {
    scope: "global",
    slug: "harness",
    content: `threadId: ${sourceThreadA}\nUse the selected model route A.`,
  });
  const noteB = await call("memoryStore/addNote", {
    scope: "global",
    slug: "harness-b",
    content: `threadId: ${sourceThreadB}\nUse the selected model route B.`,
  });
  await writeFile(path.join(root, "AGENTS.md"), agentsMarker);
  await call("config/batchWrite", {
    edits: [
      { keyPath: "memory.auto.enabled", value: true, mergeStrategy: "replace" },
    ],
  });
  const { thread } = await call(
    "thread/start",
    buildToolExecutionThreadStartParams({
      provider,
      title: "Memory parent",
      workspaceRoot: workspace,
    }),
  );
  // Storage finalization follows terminal -> shutdown -> validation -> exact commit.
  await waitForStorage("succeeded");
  assert.ok(internalIdentity, "shared Agent reached the provider");
  const internalId = internalIdentity.threadId;
  const consolidated = await call("memoryStore/consolidate", {
    sessionId: thread.id,
    scope: "global",
    maxNotes: 2,
  });
  assert.equal(consolidated.archivedNotes, 0);
  assert.equal(
    await readFile(path.join(root, "memory_summary.md"), "utf8"),
    summary,
  );
  assert.equal(
    await readFile(path.join(root, "harness-proof-1.md"), "utf8"),
    `${markerA}\n`,
  );
  assert.ok(await readFile(path.join(root, note.path), "utf8"));
  assert.ok(await readFile(path.join(root, noteB.path), "utf8"));
  assert.ok(
    !(await call("thread/loaded/list", {})).data.includes(internalId),
    "internal Agent was shut down",
  );
  assert.ok(
    !(await call("thread/list", {})).data.some(
      (entry) => entry.id === internalId,
    ),
  );
  await assert.rejects(
    call("thread/read", { threadId: internalId, includeTurns: true }),
  );
  assert.equal(extractionSamples, 2);
  assert.equal(phase2Runs, 1);
  assert.equal(phase2Orders.length, 1);
  assert.equal(phase2Orders[0].length, 2);
  if (stopMode === "allow") {
    const firstOrder = phase2Orders[0];
    citationThreadId =
      firstOrder[1] === markerA ? sourceThreadA : sourceThreadB;
    const turnStart = await call("turn/start", {
      threadId: thread.id,
      input: [
        { type: "text", text: "Use the memory summary and cite the source." },
      ],
      approvalPolicy: "never",
      sandboxPolicy: "danger-full-access",
    });
    const turnDeadline = Date.now() + 60_000;
    while (Date.now() < turnDeadline) {
      const read = await call("thread/read", {
        threadId: thread.id,
        includeTurns: true,
      });
      const current = read.thread.turns.find(
        (entry) => entry.id === turnStart.turn.id,
      );
      if (current && current.status !== "inProgress") {
        assert.equal(current.status, "completed", JSON.stringify(current));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(normalTurnSamples, 1);
    const { job, sources } = storageState();
    assert.equal(job.status, "succeeded");
    assert.equal(job.lease_owner, null);
    assert.ok(job.completed_watermark > 0);
    assert.ok(
      sources.length > 0 &&
        sources.every(
          (source) =>
            source.status === "consolidated" &&
            source.selected_for_phase2 === 1,
        ),
    );
    const usageBefore = sources.find(
      (source) => source.source_thread_id === citationThreadId,
    );
    assert.ok(
      usageBefore && usageBefore.usage_count >= 1,
      "citation updates durable usage feedback",
    );
    await call("memoryStore/consolidate", {
      sessionId: thread.id,
      scope: "global",
      maxNotes: 2,
    });
    assert.equal(phase2Runs, 2);
    assert.deepEqual(
      phase2Orders[1],
      [
        citationThreadId === sourceThreadA ? markerA : markerB,
        citationThreadId === sourceThreadA ? markerB : markerA,
      ],
      "next phase-2 snapshot prioritizes the cited source",
    );
    assert.equal(
      storageState().sources.find(
        (source) => source.source_thread_id === citationThreadId,
      )?.usage_count,
      usageBefore.usage_count,
      "phase-2 does not consume or reset citation usage",
    );
    assert.equal(
      await readFile(path.join(root, "harness-proof-2.md"), "utf8"),
      `${markerA}\n`,
    );
    const instructions = await call("instructions/read", {});
    assert.equal(
      path.resolve(instructions.path),
      path.join(hooksHome, "AGENTS.md"),
    );
    await call("instructions/write", {
      contents: revisedAgentsMarker,
      expectedRevision: instructions.revision,
    });
    instructionExpected = revisedAgentsMarker;
    await call("config/batchWrite", {
      edits: [
        { keyPath: "memory.enabled", value: false, mergeStrategy: "replace" },
        {
          keyPath: "memory.auto.enabled",
          value: false,
          mergeStrategy: "replace",
        },
      ],
    });
    const samplesBeforeDisabled = fixture.requests.length;
    await assert.rejects(
      call("memoryStore/consolidate", {
        sessionId: thread.id,
        scope: "global",
      }),
    );
    assert.equal(
      fixture.requests.length,
      samplesBeforeDisabled,
      "disabled generation must not sample a provider",
    );
    async function preferenceTurn() {
      const started = await call("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text: "Check current preferences." }],
        approvalPolicy: "never",
        sandboxPolicy: "danger-full-access",
      });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const read = await call("thread/read", {
          threadId: thread.id,
          includeTurns: true,
        });
        const current = read.thread.turns.find(
          (entry) => entry.id === started.turn.id,
        );
        if (current && current.status !== "inProgress") {
          assert.equal(current.status, "completed");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw Error("preference turn did not complete");
    }
    memoryExpected = false;
    await preferenceTurn();
    await call("config/batchWrite", {
      edits: [
        { keyPath: "memory.enabled", value: true, mergeStrategy: "replace" },
      ],
    });
    memoryExpected = true;
    await preferenceTurn();
    assert.equal(normalTurnSamples, 3);
  } else {
    assert.equal(
      normalTurnSamples,
      0,
      "stop hook fixture does not start a user turn",
    );
    assert.equal(phase2Runs, 1);
  }
  const internalIdentitiesOnDisk = internalIdentities.flatMap((identity) => [
    identity.threadId,
    identity.turnId,
  ]);
  await assertNoEphemeralHistory(data, internalIdentitiesOnDisk);
  await assertNoEphemeralHistory(app, internalIdentitiesOnDisk);
  connected.sidecar.child.stdin.end();
  await connected.sidecar.waitForExit(30_000);
  assert.equal(connected.sidecar.child.exitCode, 0);
  assert.equal(connected.sidecar.child.signalCode, null);
  console.log(
    JSON.stringify({
      ok: true,
      binaryPath,
      binarySha256,
      transport: "stdio",
      backend: "runtime",
      liveProviderUsed: false,
      protocol: "openai_responses",
      stopMode,
      userStopHookIgnored: stopMode !== "allow",
      extractionSamples,
      agentSamples,
      phase2Runs,
      phase2Orders,
      normalTurnSamples,
      citationThreadId,
      normalContextSnapshot,
      memoryDisabledNextTurn: stopMode === "allow",
      memoryReenabledNextTurn: stopMode === "allow",
      disabledGenerationNoProviderRequest: stopMode === "allow",
      instructionsWriteReachesProvider: stopMode === "allow",
      parentThreadId: thread.id,
      internalThreadId: internalId,
      internalThreadIds: internalIdentities.map(
        (identity) => identity.threadId,
      ),
      toolContinuation: true,
      nativePatch: true,
      localAgentsRetained: true,
      shutdown: true,
      exactSelection: true,
      ephemeralHistoryOnDisk: false,
      normalExit: true,
    }),
  );
} catch (error) {
  let storage;
  let summaryContent;
  try {
    storage = storageState();
  } catch {
    /* Storage may not exist if startup failed. */
  }
  try {
    summaryContent = await readFile(
      path.join(root, "memory_summary.md"),
      "utf8",
    );
  } catch {
    /* The workspace may not have been initialized. */
  }
  console.error(
    JSON.stringify({
      failed: true,
      binaryPath,
      binarySha256,
      extractionSamples,
      agentSamples,
      internalIdentity,
      storage,
      summaryContent,
      requests: fixture.requests.map((request) => ({
        path: request.path,
        tool: request.responseToolName,
        responseKind: request.responseKind,
        metadataKeys: Object.keys(request.body?.client_metadata ?? {}),
        responseError: request.responseError,
        identity: request.body?.client_metadata,
        tools: toolNames(request.body),
        extractionPrompt: JSON.stringify(request.body).includes(
          "Read this immutable rollout record",
        ),
        consolidationPrompt: JSON.stringify(request.body).includes(
          "Consolidate the supplied rollout summaries",
        ),
      })),
      events: notifications.map(({ method, params }) => ({
        method,
        threadId: params.threadId,
        status: params.turn?.status,
        error: params.turn?.error,
      })),
      stderr: connected?.sidecar.stderrLines,
    }),
  );
  throw error;
} finally {
  await connected?.sidecar.close();
  await fixture.close();
  await rm(temp, { recursive: true, force: true });
}
