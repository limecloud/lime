#!/usr/bin/env node

// Test-only localhost provider; config, Thread/Turn and Git prompt assembly are production.
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  provisionToolExecutionFixtureProvider,
  buildToolExecutionThreadStartParams,
} from "../agent-runtime/tool-execution-current-contract.mjs";
import { terminalGateRuntimeEnvironment } from "./terminal-gate-binaries.mjs";

assert.ok(process.env.APP_SERVER_BIN, "Supply a fixed App Server artifact");
const binary = path.resolve(process.env.APP_SERVER_BIN);
const binarySha256 = createHash("sha256")
  .update(fs.readFileSync(binary))
  .digest("hex");
const temp = await mkdtemp(path.join(tmpdir(), "git-preferences-"));
const data = path.join(temp, "data"),
  app = path.join(temp, "app"),
  workspace = path.join(temp, "workspace");
await Promise.all([data, app, workspace].map((value) => mkdir(value)));
execFileSync("git", ["init", "--template=", workspace], {
  stdio: "pipe",
  env: Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ),
});
const { connectAppServerSidecar, stdioSidecar } = await import(
  pathToFileURL(path.resolve("packages/app-server-client/dist/index.js")).href
);
let connected;
let samples = 0;
const checks = [];
const requestObservations = [];
function developerText(body) {
  const messages = [...(body.input ?? []), ...(body.messages ?? [])].filter(
    (message) => ["system", "developer"].includes(message.role),
  );
  return [
    body.instructions ?? "",
    ...messages.map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content ?? []).map((part) => part.text ?? "").join("\n"),
    ),
  ].join("\n");
}
const fixture = await startOpenAiCompatibleFixtureServer({
  scriptedResponses: [
    async ({ body }) => {
      samples++;
      const prompt = developerText(body);
      requestObservations.push({
        sample: samples,
        gitPreferences: prompt.includes("<git_workflow_preferences>"),
        commitA: prompt.includes("GIT_COMMIT_GUIDANCE_A"),
        commitB: prompt.includes("GIT_COMMIT_GUIDANCE_B"),
        review: /review/i.test(prompt),
        memory: /memory|记忆/i.test(prompt),
      });
      if (samples <= 2) {
        const match = prompt.match(
          /<git_workflow_preferences>([\s\S]*?)<\/git_workflow_preferences>/,
        );
        assert.ok(
          match,
          "Git preferences reach the actual provider developer context",
        );
        const expected =
          samples === 1 ? "GIT_COMMIT_GUIDANCE_A" : "GIT_COMMIT_GUIDANCE_B";
        const preferences = JSON.parse(
          match[1].split("\n").find((line) => line.startsWith("{")),
        );
        assert.equal(preferences["always-force-push"], true);
        assert.equal(preferences["create-draft-pull-requests"], false);
        assert.equal(preferences["pull-request-merge-method"], "squash");
        assert.ok(prompt.includes(expected));
        if (samples === 2)
          assert.ok(
            !prompt.includes("GIT_COMMIT_GUIDANCE_A"),
            "The current instruction is refreshed on the next turn",
          );
        assert.ok(prompt.includes("GIT_PR_GUIDANCE"));
        assert.ok(prompt.includes("team/"));
        assert.ok(prompt.includes("--force-with-lease, never --force"));
        checks.push(
          samples === 1 ? "preferences-provider-context" : "next-turn-refresh",
        );
        return { type: "text", content: "Git preferences received." };
      }
      assert.equal(samples, 3);
      assert.ok(JSON.stringify(body).includes("review"));
      checks.push("forked-review-provider-roundtrip");
      return {
        type: "text",
        content: JSON.stringify({
          findings: [],
          overall_correctness: "patch is correct",
          overall_explanation: "No changes to review in this fixture.",
          overall_confidence_score: 1,
        }),
      };
    },
  ],
});
async function connect() {
  connected = await connectAppServerSidecar(
    { ...stdioSidecar(binary, undefined, data), backendMode: "runtime" },
    {
      clientInfo: { name: "git-preferences-fixture", version: "1" },
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
      env: terminalGateRuntimeEnvironment({ appServerBinaryPath: binary }),
      initializeTimeoutMs: 60000,
    },
  );
}
async function call(method, params = {}) {
  return (
    await connected.connection.request(
      connected.client.request(method, params),
      method,
      { timeoutMs: 60000 },
    )
  ).result;
}
async function waitTurn(threadId, turnId) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const result = await call("thread/read", { threadId, includeTurns: true });
    const turn = result.thread.turns.find((turn) => turn.id === turnId);
    if (turn?.status === "failed") throw Error(JSON.stringify(turn.error));
    if (turn?.status === "completed") return result.thread;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error("Timed out waiting for the canonical completed turn");
}
try {
  await connect();
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_, method, params) => call(method, params),
  });
  await call("modelProvider/update", {
    providerId: provider.providerPreference,
    providerType: "openai-response",
  });
  const preferences = {
    "branch-prefix": "team/",
    "always-force-push": true,
    "create-draft-pull-requests": false,
    "pull-request-merge-method": "squash",
    "review-delivery": "detached",
    "commit-instructions": "GIT_COMMIT_GUIDANCE_A",
    "pull-request-instructions": "GIT_PR_GUIDANCE",
  };
  await call("config/batchWrite", {
    edits: [
      { keyPath: "git", value: preferences, mergeStrategy: "replace" },
      { keyPath: "memory.enabled", value: false, mergeStrategy: "replace" },
      {
        keyPath: "memory.auto.enabled",
        value: false,
        mergeStrategy: "replace",
      },
    ],
  });
  const parent = (
    await call(
      "thread/start",
      buildToolExecutionThreadStartParams({
        provider,
        title: "Git preferences",
        workspaceRoot: workspace,
      }),
    )
  ).thread;
  for (let index = 0; index < 2; index++) {
    if (index)
      await call("config/batchWrite", {
        edits: [
          {
            keyPath: "git.commit-instructions",
            value: "GIT_COMMIT_GUIDANCE_B",
            mergeStrategy: "replace",
          },
        ],
      });
    const turn = (
      await call("turn/start", {
        threadId: parent.id,
        input: [
          {
            type: "text",
            text: "Inspect the Git defaults only. Do not modify or push anything.",
          },
        ],
      })
    ).turn;
    await waitTurn(parent.id, turn.id);
  }
  const fork = await call("thread/fork", {
    threadId: parent.id,
    excludeTurns: true,
    deferGoalContinuation: false,
  });
  assert.notEqual(fork.thread.id, parent.id);
  const review = await call("review/start", {
    threadId: fork.thread.id,
    delivery: "inline",
    target: { type: "uncommittedChanges" },
  });
  assert.equal(review.reviewThreadId, fork.thread.id);
  await waitTurn(fork.thread.id, review.turn.id);
  const original = (
    await call("thread/read", { threadId: parent.id, includeTurns: true })
  ).thread;
  assert.equal(
    original.turns.length,
    2,
    "The review never modifies the parent conversation",
  );
  assert.equal(samples, 3);
  checks.push("parent-thread-unchanged");
  await connected.sidecar.close();
  await connect();
  const restored = await call("config/read", { includeLayers: true });
  assert.deepEqual(restored.config.git, {
    ...preferences,
    "commit-instructions": "GIT_COMMIT_GUIDANCE_B",
  });
  checks.push("canonical-config-cold-recovery");
  console.log(
    JSON.stringify({
      ok: true,
      binarySha256,
      transport: "stdio",
      backend: "runtime",
      liveProviderUsed: false,
      providerSamples: samples,
      parentThreadId: parent.id,
      reviewThreadId: fork.thread.id,
      checks,
      requestObservations,
      promptsStored: false,
      gitMutations:
        "Only git init in the disposable fixture directory; no commit/push/PR operation",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      failed: true,
      binarySha256,
      samples,
      checks,
      requestObservations,
      providerErrors: fixture.requests
        .map((request) => request.responseError)
        .filter(Boolean),
      stderr: connected?.sidecar.stderrLines,
    }),
  );
  throw error;
} finally {
  await connected?.sidecar.close();
  await fixture.close();
  await rm(temp, { recursive: true, force: true });
}
