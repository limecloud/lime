import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { readWorktreeSurfaceDom } from "./composer-worktree-scenario.mjs";
import { openSessionFromSidebar } from "../../agent-runtime/claw-chat-current-fixture-session.mjs";
import {
  assertWorktreeColdRead,
  assertWorktreeStaged,
  assertWorktreeSubmission,
  readWorktreeWorkspace,
  worktreeTraceRequests,
} from "./composer-worktree-evidence.mjs";
import {
  createComposerWorktreeGit,
  readComposerWorktreeGit,
  readComposerWorktreeEnvironment,
} from "./composer-worktree-git.mjs";

const sourceRoot = "/isolated/source";
const targetRoot = "/isolated/source-worktree";

test("cold sidebar navigation uses canonical session identity when the title is absent or changed", async () => {
  const dom = new JSDOM(
    `<button data-testid="app-sidebar-conversation-open" data-session-id="foreign" title="Old title">Old title</button><button data-testid="app-sidebar-conversation-open" data-session-id="accepted-session" title="Renamed conversation">Renamed conversation</button><main><div data-testid="message-list"></div><div data-testid="inputbar-core-container"><div data-testid="composer-editor" role="textbox" data-session-id="accepted-session" contenteditable="true"></div></div></main>`,
    { runScripts: "outside-only" },
  );
  try {
    const clicked = [];
    for (const button of dom.window.document.querySelectorAll("button")) {
      button.addEventListener("click", () =>
        clicked.push(button.dataset.sessionId),
      );
    }
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 300,
      height: 100,
    });
    dom.window.electronAPI = {
      invoke: async (_command, { request }) => {
        const message = JSON.parse(request.lines[0]);
        assert.equal(message.method, "thread/read");
        assert.equal(message.params.threadId, "accepted-thread");
        return {
          lines: [
            JSON.stringify({
              id: message.id,
              result: {
                thread: {
                  id: "accepted-thread",
                  sessionId: "accepted-session",
                },
              },
            }),
          ],
        };
      },
    };
    const page = {
      evaluate: async (callback, argument) =>
        dom.window.eval(`(${callback.toString()})`)(argument),
    };
    for (const title of [undefined, "Old title"]) {
      await openSessionFromSidebar(
        page,
        { timeoutMs: 100, intervalMs: 1 },
        undefined,
        {
          sessionId: "accepted-session",
          threadId: "accepted-thread",
          title,
        },
      );
    }
    assert.deepEqual(clicked, ["accepted-session", "accepted-session"]);
  } finally {
    dom.window.close();
  }
});

test("reads the exact accepted workspace from the conversation toolbar without new-chat controls", () => {
  const dom = new JSDOM(
    `<div data-testid="task-center-utility-toolbar" data-workspace-id="accepted-workspace" data-workspace-root="/accepted"></div><div data-testid="composer-editor" role="textbox" data-session-id="accepted-session" contenteditable="true"></div><div data-message-role="user"></div>`,
    { runScripts: "outside-only" },
  );
  try {
    dom.window.HTMLElement.prototype.getClientRects = function () {
      return this.style.display === "none" ? [] : [{}];
    };
    const read = dom.window.eval(`(${readWorktreeSurfaceDom.toString()})`);
    const actual = read();
    assert.equal(actual.sessionId, "accepted-session");
    assert.equal(actual.workspaceId, "accepted-workspace");
    assert.equal(actual.rootPath, "/accepted");
    assert.equal(actual.userMessageCount, 1);
    assert.equal(actual.disabled, false);
    dom.window.document.body.insertAdjacentHTML(
      "beforeend",
      `<div data-testid="task-center-utility-toolbar" data-workspace-id="foreign" data-workspace-root="/foreign"></div>`,
    );
    assert.equal(read().workspaceId, null);
    assert.equal(read().rootPath, null);
  } finally {
    dom.window.close();
  }
});
const entry = (method, params = {}) => ({
  command: "app_server_handle_json_lines",
  transport: "electron-ipc",
  status: "success",
  args_preview: {
    request: { lines: [JSON.stringify({ id: method, method, params })] },
  },
});
const snapshot = (entries) => ({
  entries,
  provenance: {
    mode: "continuous-storage-append",
    runId: "worktree-native",
    startedAt: "2026-10-18",
    traceKey: "lime_invoke_trace_buffer_v1",
    traceLimit: 240,
    seedCount: 0,
    seedDigest: "seed",
    appendCount: entries.length,
    captureSequence: entries.length,
    transitionDigests: entries.map((row) =>
      createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    ),
  },
});

function fixture() {
  const beforeTrace = snapshot([
    entry("projectGit/status", { rootPath: sourceRoot }),
  ]);
  const baselineGit = {
    rootPath: sourceRoot,
    workspaceId: "workspace-source",
    head: "head",
    trackedSha256: "tracked",
    status: "",
    worktrees: [{ path: sourceRoot, head: "head", detached: false }],
  };
  const surface = {
    electron: true,
    preload: true,
    editorCount: 1,
    sessionId: null,
    workspaceId: "workspace-source",
    rootPath: sourceRoot,
    userMessageCount: 0,
  };
  const staged = {
    beforeTrace,
    stagedTrace: structuredClone(beforeTrace),
    beforeGit: baselineGit,
    stagedGit: structuredClone(baselineGit),
    beforeThreads: [],
    stagedThreads: [],
    surface,
    selected: true,
  };
  const thread = {
    id: "thread-target",
    sessionId: "session-target",
    cwd: targetRoot,
    projectId: null,
    turns: [
      {
        id: "turn-target",
        status: "inProgress",
        items: [{ id: "user-target", type: "userMessage" }],
      },
    ],
  };
  const trace = snapshot([
    ...beforeTrace.entries,
    entry("projectGit/worktree/create", { rootPath: sourceRoot }),
    entry("workspace/ensure", { rootPath: targetRoot }),
    entry("thread/start", { cwd: targetRoot }),
    entry("permissionProfile/list", { cwd: targetRoot }),
    entry("turn/start", { threadId: thread.id }),
  ]);
  const accepted = {
    trace,
    stagedTrace: staged.stagedTrace,
    baselineGit,
    sourceRoot,
    sourceWorkspaceId: "workspace-source",
    targetWorkspace: { id: "workspace-target", rootPath: targetRoot },
    thread,
    backendLedger: [
      { kind: "turnStart", sessionId: thread.sessionId, turnId: "turn-target" },
    ],
    sourceGit: {
      ...baselineGit,
      worktrees: [
        ...baselineGit.worktrees,
        { path: targetRoot, head: "head", detached: true },
      ],
    },
    targetGit: { head: "head", trackedSha256: "tracked", status: "" },
    surface: {
      ...surface,
      sessionId: thread.sessionId,
      workspaceId: "workspace-target",
      rootPath: targetRoot,
      userMessageCount: 1,
    },
    duplicateClickCount: 2,
  };
  return { staged, accepted };
}

test("staged GUI evidence binds zero Git effects to the same continuous source scope", () => {
  assert.equal(assertWorktreeStaged(fixture().staged).zeroGitSideEffects, true);
  for (const mutate of [
    (v) => {
      v.stagedTrace = snapshot([
        ...v.stagedTrace.entries,
        entry("projectGit/worktree/create", { rootPath: sourceRoot }),
      ]);
    },
    (v) => {
      v.stagedGit.worktrees.push({ path: targetRoot });
    },
    (v) => {
      v.stagedGit.head = "changed";
    },
    (v) => {
      v.stagedGit.trackedSha256 = "changed";
    },
    (v) => {
      v.stagedThreads.push({ id: "precreated" });
    },
    (v) => {
      v.surface.sessionId = "already-materialized";
    },
    (v) => {
      v.surface.workspaceId = "foreign";
    },
    (v) => {
      v.selected = false;
    },
    (v) => {
      v.stagedTrace.provenance.runId = "other-observer";
    },
    (v) => {
      v.stagedTrace.provenance.transitionDigests[0] = "missing-window";
    },
  ]) {
    const value = fixture().staged;
    mutate(value);
    assert.throws(() => assertWorktreeStaged(value));
  }
});

test("accepted evidence requires real ordered create/ensure/Thread/permission/Turn with one identity", () => {
  const proof = assertWorktreeSubmission(fixture().accepted);
  assert.equal(proof.createCount, 1);
  assert.equal(proof.mockFallbackHitCount, 0);
  assert.equal(proof.acceptedNavigationMatchesCanonicalIdentity, true);
  for (const mutate of [
    (v) => {
      v.trace = snapshot([
        ...v.trace.entries,
        entry("projectGit/worktree/create", { rootPath: sourceRoot }),
      ]);
    },
    (v) => {
      v.trace = snapshot([
        ...v.trace.entries,
        entry("turn/start", { threadId: v.thread.id }),
      ]);
    },
    (v) => {
      v.trace = snapshot([
        ...v.trace.entries,
        entry("turn/steer", { threadId: v.thread.id }),
      ]);
    },
    (v) => {
      v.trace.entries[4] = entry("permissionProfile/list", { cwd: sourceRoot });
    },
    (v) => {
      [v.trace.entries[2], v.trace.entries[3]] = [
        v.trace.entries[3],
        v.trace.entries[2],
      ];
    },
    (v) => {
      v.trace.entries[1].transport = "mock";
    },
    (v) => {
      v.trace.entries[1].status = "error";
    },
    (v) => {
      v.trace.entries[1].args_preview.request.lines = ["malformed"];
    },
    (v) => {
      v.targetWorkspace.id = v.sourceWorkspaceId;
    },
    (v) => {
      v.thread.cwd = sourceRoot;
    },
    (v) => {
      v.thread.projectId = "foreign";
    },
    (v) => {
      v.backendLedger[0].sessionId = "foreign";
    },
    (v) => {
      v.backendLedger[0].turnId = "foreign";
    },
    (v) => {
      v.backendLedger.push({ ...v.backendLedger[0] });
    },
    (v) => {
      v.sourceGit.worktrees[1].detached = false;
    },
    (v) => {
      v.sourceGit.head = "source-edited";
    },
    (v) => {
      v.targetGit.trackedSha256 = "other-bytes";
    },
    (v) => {
      v.sourceGit.status = " M worktree-reference.md";
    },
    (v) => {
      v.surface.sessionId = "source-session";
    },
    (v) => {
      v.surface.userMessageCount = 0;
    },
    (v) => {
      v.duplicateClickCount = 1;
    },
  ]) {
    const value = fixture().accepted;
    mutate(value);
    assert.throws(() => assertWorktreeSubmission(value));
  }
});

test("all production trace entries must be native successes; malformed RPC cannot disappear", () => {
  for (const item of [
    { ...entry("turn/start"), transport: "http" },
    { ...entry("turn/start"), status: "error" },
    { ...entry("turn/start"), args_preview: {} },
  ])
    assert.throws(() => worktreeTraceRequests(snapshot([item])));
});

test("cold proof rejects repeated creation, wrong terminal identity or substituted new draft", () => {
  const { accepted } = fixture();
  const proof = assertWorktreeSubmission(accepted);
  const cold = {
    proof,
    thread: {
      ...accepted.thread,
      turns: [{ ...accepted.thread.turns[0], status: "interrupted" }],
    },
    git: accepted.sourceGit,
    targetGit: { ...accepted.targetGit, rootPath: targetRoot },
    trace: snapshot([entry("thread/read", { threadId: proof.threadId })]),
    surface: accepted.surface,
    originalEntry: {
      draftId: "new-native-draft",
      scopeVersion: "opaque",
      draft: { document: { text: "later edit" } },
    },
    backendLedger: accepted.backendLedger,
  };
  cold.restoredEntry = structuredClone(cold.originalEntry);
  assert.equal(assertWorktreeColdRead(cold).noRepeatedCreateOrTurn, true);
  for (const mutate of [
    (v) => {
      v.trace = snapshot([
        entry("projectGit/worktree/create", { rootPath: sourceRoot }),
      ]);
    },
    (v) => {
      v.thread.turns[0].id = "foreign";
    },
    (v) => {
      v.thread.turns[0].status = "inProgress";
    },
    (v) => {
      v.surface.workspaceId = "source";
    },
    (v) => {
      v.restoredEntry.draft.document.text = "restored old submitted content";
    },
    (v) => {
      v.backendLedger.push({ ...v.backendLedger[0] });
    },
    (v) => {
      v.backendLedger[0].sessionId = "foreign";
    },
    (v) => {
      v.git.worktrees[1].path = "/unrelated-checkout";
    },
    (v) => {
      v.git.head = "changed";
    },
    (v) => {
      v.targetGit.trackedSha256 = "changed";
    },
    (v) => {
      v.targetGit.rootPath = sourceRoot;
    },
  ]) {
    const value = structuredClone(cold);
    mutate(value);
    assert.throws(() => assertWorktreeColdRead(value));
  }
});

test("current Workspace readback requires the real raw response contract", () => {
  assert.deepEqual(
    readWorktreeWorkspace({
      workspace: { id: "target", name: "Target", root_path: targetRoot },
    }),
    { id: "target", name: "Target", rootPath: targetRoot },
  );
  for (const raw of [
    null,
    {},
    { id: "target", name: "Target", rootPath: targetRoot },
    { id: "", name: "Target", root_path: targetRoot },
  ])
    assert.throws(() => readWorktreeWorkspace({ workspace: raw }));
});

test("real Git fixture and inventory readback handle spaces and a genuine detached checkout", async (t) => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "composer-worktree-oracle-"),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const { rootPath } = await createComposerWorktreeGit(
    path.join(temporary, "source with spaces"),
    "独立Git夹具",
  );
  const before = await readComposerWorktreeGit(rootPath);
  assert.equal(before.worktrees.length, 1);
  assert.equal(before.status, "");
  const target = path.join(temporary, "target with spaces");
  execFileSync("git", ["worktree", "add", "--detach", target, "HEAD"], {
    cwd: rootPath,
    stdio: "pipe",
  });
  const canonicalTarget = await fs.realpath(target);
  const after = await readComposerWorktreeGit(rootPath);
  const checkout = await readComposerWorktreeGit(canonicalTarget);
  assert.equal(after.worktrees.length, 2);
  assert.equal(
    after.worktrees.find((row) => row.path === canonicalTarget)?.detached,
    true,
  );
  assert.equal(checkout.head, before.head);
  assert.equal(checkout.trackedSha256, before.trackedSha256);
  const configPath = path.join(canonicalTarget, "environment.toml");
  const configRaw = 'version = 1\nname = "Worktree fixture"\n';
  await fs.writeFile(configPath, configRaw);
  await fs.writeFile(
    path.join(canonicalTarget, "local-environment-setup.txt"),
    "environment-fixture\n",
  );
  const configFile = execFileSync(
    "git",
    ["rev-parse", "--git-path", "config.worktree"],
    { cwd: canonicalTarget, encoding: "utf8" },
  ).trim();
  execFileSync(
    "git",
    [
      "config",
      "--file",
      configFile,
      "lime.localEnvironmentConfigPath",
      configPath,
    ],
    { cwd: canonicalTarget },
  );
  const environment = await readComposerWorktreeEnvironment(canonicalTarget);
  assert.equal(environment.configPath, configPath);
  assert.equal(environment.configRaw, configRaw);
  assert.equal(environment.setupMarker, true);
});
