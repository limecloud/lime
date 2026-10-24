import { isDeepStrictEqual } from "node:util";
import {
  assertAppServerRequestMethods,
  requireDraftProof,
} from "./composer-draft-fixture-evidence.mjs";
import { sameInvokeTraceCollectorProvenance } from "../../lib/invoke-trace-collector.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "./mcp-config-fixture-evidence.mjs";

const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const mutationMethods = new Set([
  "projectGit/worktree/create",
  "projectGit/worktree/delete",
  "projectGit/branch/create",
  "projectGit/branch/checkout",
  "thread/start",
  "turn/start",
  "turn/steer",
  "thread/queue/add",
]);

export function readWorktreeWorkspace(result) {
  const raw = result?.workspace;
  requireDraftProof(
    nonempty(raw?.id) && nonempty(raw.name) && nonempty(raw.root_path),
    "current raw Workspace response identity and snake-case root_path",
  );
  return { id: raw.id, name: raw.name, rootPath: raw.root_path };
}

/** All requests come from the validated continuous production safeInvoke ledger. */
export function worktreeTraceRequests(snapshot) {
  requireDraftProof(
    Array.isArray(snapshot?.entries) && snapshot.provenance,
    "continuous Worktree invoke observation exists",
  );
  requireDraftProof(
    snapshot.entries.every(
      (entry) =>
        entry.transport === "electron-ipc" && entry.status === "success",
    ),
    "Worktree production mock fallback and invoke errors are zero",
  );
  const rpc = snapshot.entries.filter(
    (entry) => entry.command === "app_server_handle_json_lines",
  );
  assertAppServerRequestMethods(rpc);
  return parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(rpc));
}

export function assertWorktreeTraceContinuity(before, after) {
  requireDraftProof(
    sameInvokeTraceCollectorProvenance(before?.provenance, after?.provenance) &&
      isDeepStrictEqual(
        after.entries.slice(0, before.entries.length),
        before.entries,
      ),
    "same native trace observer retains the entire earlier request prefix",
  );
}

export function assertWorktreeStaged({
  beforeTrace,
  stagedTrace,
  beforeGit,
  stagedGit,
  beforeThreads,
  stagedThreads,
  surface,
  selected,
}) {
  assertWorktreeTraceContinuity(beforeTrace, stagedTrace);
  const requests = worktreeTraceRequests(stagedTrace).slice(
    worktreeTraceRequests(beforeTrace).length,
  );
  requireDraftProof(
    !requests.some((request) => mutationMethods.has(request.method)) &&
      isDeepStrictEqual(beforeThreads, stagedThreads),
    "staging creates no canonical Thread, Turn or Git mutation",
  );
  requireDraftProof(
    beforeGit.worktrees.length === 1 &&
      isDeepStrictEqual(beforeGit, stagedGit) &&
      selected === true &&
      surface.electron &&
      surface.preload &&
      surface.editorCount === 1 &&
      surface.sessionId === null &&
      surface.workspaceId === beforeGit.workspaceId &&
      surface.rootPath === beforeGit.rootPath,
    "public staged mode keeps the same null-session source, HEAD, tree and Git inventory",
  );
  return {
    stagedSelected: true,
    zeroGitSideEffects: true,
    noCanonicalInputBeforeSend: true,
    traceProvenance: stagedTrace.provenance,
  };
}

export function assertWorktreeSubmission({
  trace,
  stagedTrace,
  baselineGit,
  sourceRoot,
  sourceWorkspaceId,
  targetWorkspace,
  thread,
  backendLedger,
  sourceGit,
  targetGit,
  surface,
  duplicateClickCount,
}) {
  assertWorktreeTraceContinuity(stagedTrace, trace);
  const requests = worktreeTraceRequests(trace).slice(
    worktreeTraceRequests(stagedTrace).length,
  );
  const creates = requests.filter(
    (row) => row.method === "projectGit/worktree/create",
  );
  const starts = requests.filter((row) => row.method === "thread/start");
  const turns = requests.filter((row) => row.method === "turn/start");
  const targetRoot = targetWorkspace?.rootPath;
  requireDraftProof(
    creates.length === 1 &&
      creates[0].params.rootPath === sourceRoot &&
      starts.length === 1 &&
      starts[0].params.cwd === targetRoot &&
      turns.length === 1 &&
      turns[0].params.threadId === thread?.id &&
      duplicateClickCount === 2 &&
      !requests.some((row) =>
        [
          "projectGit/worktree/delete",
          "turn/steer",
          "thread/queue/add",
        ].includes(row.method),
      ),
    "two real Send clicks create exactly one Worktree, canonical Thread and Turn",
  );
  const ensured = requests.filter(
    (row) =>
      row.method === "workspace/ensure" && row.params.rootPath === targetRoot,
  );
  const createIndex = requests.indexOf(creates[0]);
  const startIndex = requests.indexOf(starts[0]);
  const turnIndex = requests.indexOf(turns[0]);
  const permissions = requests.filter(
    (row, index) =>
      row.method === "permissionProfile/list" &&
      row.params.cwd === targetRoot &&
      index > startIndex &&
      index < turnIndex,
  );
  requireDraftProof(
    ensured.length === 1 &&
      createIndex < requests.indexOf(ensured[0]) &&
      requests.indexOf(ensured[0]) < startIndex &&
      startIndex < turnIndex &&
      permissions.length > 0,
    "real Git create -> target Workspace ensure -> Thread -> target cwd permission -> Turn order",
  );
  const turn = thread?.turns?.[0];
  const startsAtBackend = backendLedger.filter(
    (row) => row.kind === "turnStart",
  );
  requireDraftProof(
    nonempty(targetWorkspace?.id) &&
      targetWorkspace.id !== sourceWorkspaceId &&
      nonempty(targetRoot) &&
      targetRoot !== sourceRoot &&
      nonempty(thread?.id) &&
      nonempty(thread.sessionId) &&
      thread.cwd === targetRoot &&
      // Project directory grouping is separate from the Workspace at this cwd.
      thread.projectId === null &&
      thread.turns.length === 1 &&
      nonempty(turn?.id) &&
      startsAtBackend.length === 1 &&
      startsAtBackend[0].sessionId === thread.sessionId &&
      startsAtBackend[0].turnId === turn.id,
    "current Workspace, cwd, canonical session/Thread/Turn and controlled provider share identity",
  );
  const worktrees = sourceGit.worktrees;
  const target = worktrees.find((row) => row.path === targetRoot);
  requireDraftProof(
    worktrees.length === 2 &&
      target?.detached === true &&
      sourceGit.head === baselineGit.head &&
      sourceGit.trackedSha256 === baselineGit.trackedSha256 &&
      target.head === sourceGit.head &&
      targetGit.head === sourceGit.head &&
      targetGit.trackedSha256 === sourceGit.trackedSha256 &&
      targetGit.status === "" &&
      sourceGit.status === "" &&
      surface.electron &&
      surface.preload &&
      surface.editorCount === 1 &&
      surface.sessionId === thread.sessionId &&
      surface.workspaceId === targetWorkspace.id &&
      surface.rootPath === targetRoot &&
      surface.userMessageCount === 1,
    "real detached Git checkout and accepted visible navigation agree on the target",
  );
  return {
    sourceRoot,
    sourceWorkspaceId,
    targetRoot,
    workspaceId: targetWorkspace.id,
    sessionId: thread.sessionId,
    threadId: thread.id,
    turnId: turn.id,
    gitHead: sourceGit.head,
    trackedFileSha256: sourceGit.trackedSha256,
    createCount: creates.length,
    threadStartCount: starts.length,
    turnStartCount: turns.length,
    duplicateClickCount,
    mockFallbackHitCount: 0,
    targetPermissionBeforeTurn: true,
    detachedCheckoutReadback: true,
    acceptedNavigationMatchesCanonicalIdentity: true,
    traceProvenance: trace.provenance,
    rpc: requests
      .filter(
        (row) =>
          mutationMethods.has(row.method) ||
          row.method === "workspace/ensure" ||
          row.method === "permissionProfile/list",
      )
      .map((row) => ({
        id: row.id,
        method: row.method,
        transport: row.transport,
        status: row.status,
        cwd: row.params.cwd ?? null,
        rootPath: row.params.rootPath ?? null,
        threadId: row.params.threadId ?? null,
      })),
  };
}

export function assertWorktreeColdRead({
  proof,
  thread,
  git,
  targetGit,
  trace,
  surface,
  originalEntry,
  restoredEntry,
  backendLedger,
}) {
  worktreeTraceRequests(trace);
  requireDraftProof(
    !worktreeTraceRequests(trace).some((row) =>
      mutationMethods.has(row.method),
    ) &&
      backendLedger.filter((row) => row.kind === "turnStart").length === 1 &&
      thread.id === proof.threadId &&
      thread.sessionId === proof.sessionId &&
      thread.cwd === proof.targetRoot &&
      thread.projectId === null &&
      thread.turns.length === 1 &&
      thread.turns[0].id === proof.turnId &&
      ["interrupted", "canceled", "cancelled"].includes(
        thread.turns[0].status,
      ) &&
      git.rootPath === proof.sourceRoot &&
      git.head === proof.gitHead &&
      git.trackedSha256 === proof.trackedFileSha256 &&
      git.status === "" &&
      git.worktrees.length === 2 &&
      git.worktrees.some(
        (row) =>
          row.path === proof.targetRoot &&
          row.head === proof.gitHead &&
          row.detached === true,
      ) &&
      targetGit.rootPath === proof.targetRoot &&
      targetGit.head === proof.gitHead &&
      targetGit.trackedSha256 === proof.trackedFileSha256 &&
      targetGit.status === "" &&
      backendLedger.some(
        (row) =>
          row.kind === "turnStart" &&
          row.sessionId === proof.sessionId &&
          row.turnId === proof.turnId,
      ) &&
      surface.sessionId === proof.sessionId &&
      surface.workspaceId === proof.workspaceId &&
      surface.rootPath === proof.targetRoot &&
      isDeepStrictEqual(restoredEntry, originalEntry),
    "normal restart restores target canonical identity and the later draft without replaying Worktree or Turn creation",
  );
  return {
    canonicalIdentityRetained: true,
    newerDraftRestored: true,
    noRepeatedCreateOrTurn: true,
    terminalStatus: thread.turns[0].status,
    traceProvenance: trace.provenance,
  };
}
