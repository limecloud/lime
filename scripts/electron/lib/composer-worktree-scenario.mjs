import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  atomKey,
  requireDraftProof,
  savedDraft,
  summarizeDraft,
} from "./composer-draft-fixture-evidence.mjs";
import {
  assertFirstSendConsumed,
  assertFirstSendReceipt,
  assertFirstSendResourceReceipt,
  assertFirstSendSavedFiles,
  assertFirstSendSource,
  assertFirstSendTrace,
  assertUnboundScope,
  captureFirstSendResources,
  newEditText,
} from "./composer-first-send-evidence.mjs";
import { summarizeRichInputSubmission } from "../../agent-runtime/claw-chat-current-fixture-rich-input-evidence.mjs";
import {
  assertWorktreeColdRead,
  assertWorktreeStaged,
  assertWorktreeSubmission,
  assertWorktreeTraceContinuity,
  readWorktreeWorkspace,
  worktreeTraceRequests,
} from "./composer-worktree-evidence.mjs";
import { isObservedPreloadAppServerResponse } from "./mcp-config-fixture-evidence.mjs";
import {
  createComposerWorktreeGit,
  readComposerWorktreeGit,
  readComposerWorktreeEnvironment,
} from "./composer-worktree-git.mjs";

/** Serialized read-only DOM projection; no controller or store injection. */
export function readWorktreeSurfaceDom() {
  const visible = (node) =>
    node instanceof HTMLElement &&
    node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== "hidden";
  const editors = Array.from(
    document.querySelectorAll(
      '[data-testid="composer-editor"][role="textbox"]',
    ),
  ).filter(visible);
  const bars = Array.from(
    document.querySelectorAll('[data-testid="composer-utility-bar"]'),
  ).filter(
    (node) =>
      visible(node) &&
      node.querySelector('[data-testid="composer-utility-mode"]'),
  );
  const toolbars = Array.from(
    document.querySelectorAll('[data-testid="task-center-utility-toolbar"]'),
  ).filter(visible);
  const current =
    bars.length === 1 ? bars[0] : toolbars.length === 1 ? toolbars[0] : null;
  return {
    electron: window.__LIME_ELECTRON__ === true,
    preload: typeof window.electronAPI?.invoke === "function",
    editorCount: editors.length,
    sessionId: editors[0]?.getAttribute("data-session-id") || null,
    disabled:
      !editors[0] || editors[0].getAttribute("contenteditable") !== "true",
    workspaceId:
      current?.getAttribute("data-workspace-id") ||
      current?.getAttribute("data-project-id") ||
      null,
    rootPath: current?.getAttribute("data-workspace-root") || null,
    gitReady:
      bars.length === 1 && bars[0].getAttribute("data-git-status") === "ready",
    userMessageCount: Array.from(
      document.querySelectorAll('[data-message-role="user"]'),
    ).filter(visible).length,
  };
}

async function rpc(context, method, params = {}) {
  const observed = await context.modules.launcher.appServerCallFromPage(
    context.page,
    method,
    params,
  );
  requireDraftProof(
    isObservedPreloadAppServerResponse(observed.ipcObservation, method),
    "readback uses real preload IPC and matching JSON-RPC request/response IDs",
  );
  return observed;
}

async function inventory(context) {
  const read = await rpc(context, "thread/list", { limit: 100 });
  requireDraftProof(
    Array.isArray(read.result?.data) && read.result.nextCursor === null,
    "complete actual canonical Thread inventory",
  );
  return read.result.data.map(({ id, sessionId }) => ({ id, sessionId }));
}

async function threadRead(context, threadId) {
  return (await rpc(context, "thread/read", { threadId, includeTurns: true }))
    .result.thread;
}

const wait = (context, read, ready, phase) =>
  context.modules.drafts.until(context, read, ready, phase);
const bar = (context) =>
  context.page.locator('[data-testid="composer-utility-bar"]:visible').filter({
    has: context.page.locator('[data-testid="composer-utility-mode"]'),
  });

async function publicSource(context, workspace) {
  // Navigation preferences are seed data; business identities still come from RPC.
  await context.page.evaluate(
    ({ workspaceId, provider, model }) => {
      const storage = localStorage;
      storage.setItem(
        "agent_opened_project_ids",
        JSON.stringify([workspaceId]),
      );
      for (const suffix of [workspaceId, "global"]) {
        storage.setItem(
          `agent_pref_provider_${suffix}`,
          JSON.stringify(provider),
        );
        storage.setItem(`agent_pref_model_${suffix}`, JSON.stringify(model));
        storage.setItem(`agent_pref_migrated_${suffix}`, "true");
        storage.setItem(
          `agent_access_mode_${suffix}`,
          JSON.stringify("full-access"),
        );
        storage.setItem(
          `agent_execution_strategy_${suffix}`,
          JSON.stringify("react"),
        );
      }
      dispatchEvent(
        new CustomEvent("agent-opened-project-ids-changed", {
          detail: { projectIds: [workspaceId] },
        }),
      );
      dispatchEvent(new Event("focus"));
    },
    {
      workspaceId: workspace.id,
      provider: context.modules.constants.FIXTURE_PROVIDER,
      model: context.modules.constants.FIXTURE_MODEL,
    },
  );
  await context.page
    .getByTestId("app-sidebar-home-button")
    .filter({ visible: true })
    .click();
  await bar(context).getByTestId("composer-utility-project-trigger").click();
  await context.page
    .locator(
      `[data-testid="composer-utility-opened-project"][data-project-id="${workspace.id}"]`,
    )
    .click();
  await wait(
    context,
    () => context.page.evaluate(readWorktreeSurfaceDom),
    (value) =>
      value.workspaceId === workspace.id &&
      value.rootPath === workspace.rootPath &&
      value.gitReady &&
      value.sessionId === null &&
      !value.disabled,
    "public project selection commits a ready null-session source Composer",
  );
}

async function readIndex(context, workspaceId) {
  return (
    await context.modules.atom.observePersistedAtomCommand(
      context.page,
      context.protocol,
      "persisted_atom_read",
      { key: atomKey, query: { kind: "workspace-index", workspaceId } },
      { timeoutMs: context.options.timeoutMs },
    )
  ).result;
}

async function backend(context) {
  return (await fs.readFile(context.runtimeEnv.backendLedgerPath, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readEnvironmentSelection(context) {
  return (
    await context.modules.atom.observePersistedAtomCommand(
      context.page,
      context.protocol,
      "persisted_atom_read",
      {
        key: "local-env-selections-by-workspace",
        query: { kind: "selections" },
      },
      { timeoutMs: context.options.timeoutMs },
    )
  ).result;
}

async function chooseEnvironment(
  context,
  workspace,
  configPath,
  screenshotPath,
) {
  const trigger = bar(context).getByTestId("worktree-environment-trigger");
  const key = `local:${workspace.rootPath}`;
  const saved = (expected) =>
    wait(
      context,
      () => readEnvironmentSelection(context),
      (value) =>
        value.outcome === "ready" &&
        value.persistence.state === "saved" &&
        (expected === undefined
          ? !Object.hasOwn(value.data.selections, key)
          : value.data.selections[key] === expected),
      "Host saves the GUI environment preference without confusing missing and null",
    );
  await saved(undefined);
  await trigger.click();
  const menu = context.page.getByTestId("worktree-environment-menu");
  await menu.locator('[cmdk-item][data-value="no-environment"]').click();
  await saved(null);
  await trigger.click();
  await menu.locator('[cmdk-item][data-value="reset-selection"]').click();
  await saved(undefined);
  await trigger.click();
  await menu.getByRole("combobox").fill("GUI environment");
  await menu
    .locator("[data-config-path]")
    .filter({ hasText: "GUI environment fixture" })
    .click();
  await saved(configPath);
  await trigger.click();
  const selected = menu.locator('[data-config-path][aria-current="true"]');
  await selected.waitFor();
  const metrics = await selected.evaluate((node) => ({
    fontSize: getComputedStyle(node).fontSize,
    menuWidth: node
      .closest('[data-testid="worktree-environment-menu"]')
      .getBoundingClientRect().width,
  }));
  requireDraftProof(
    metrics.fontSize === "13px" && Math.abs(metrics.menuWidth - 256) <= 1,
    "environment menu has 13px entries and 256px width",
  );
  await context.page.screenshot({
    path: screenshotPath,
    animations: "disabled",
  });
  await context.page.keyboard.press("Escape");
  return {
    explicitNoneSaved: true,
    resetDeletesRecord: true,
    chosenByGui: true,
    metrics,
  };
}

export const worktreeSubmissionScenario = {
  id: "worktree-first-send",
  scope:
    "GUI environment selection, staged Worktree, real setup and detached Git creation on first Send, canonical target identity, accepted rich draft promotion and normal cold restore",
  generationCount: 2,
  sourcePaths: [
    "scripts/electron/composer-worktree-gate-b.mjs",
    "scripts/electron/lib/composer-worktree-scenario.mjs",
    "scripts/electron/lib/composer-worktree-evidence.mjs",
    "scripts/electron/lib/composer-worktree-evidence.test.mjs",
    "scripts/electron/lib/composer-worktree-git.mjs",
    "scripts/electron/lib/composer-first-send-evidence.mjs",
    "scripts/agent-runtime/claw-chat-current-fixture-rich-input-evidence.mjs",
    "scripts/agent-runtime/claw-chat-current-fixture-skill-identity.mjs",
    "src/components/agent/chat/components/WorktreeEnvironmentDropdown.tsx",
    "src/components/agent/chat/components/Inputbar/components/ComposerUtilityBar.tsx",
    "src/hooks/useLocalEnvironmentSelection.ts",
    "src/lib/api/localEnvironmentSelection.ts",
    "src/lib/localEnvironmentSelection.ts",
    "src/lib/api/localEnvironmentSelectionProtocol.ts",
    "src/lib/api/persistedAtoms.ts",
    "src/lib/api/persistedAtomProtocol.ts",
    "src/lib/api/persistedAtomTypes.ts",
    "electron/persistedAtomHost.ts",
    "electron/persistedAtomStore.ts",
    "electron/persistedAtomRecords.ts",
    "src/lib/api/projectGit.ts",
    "src/components/agent/chat/workspace/composerWorktreeSubmission.ts",
    "src/components/agent/chat/workspace/useWorkspaceSendActions.ts",
    "src/components/agent/chat/workspace/worktreeSetupRecovery.ts",
    "lime-rs/crates/app-server/src/runtime/local_environments/lifecycle.rs",
    "lime-rs/crates/app-server/src/runtime/project_git.rs",
    "lime-rs/crates/app-server/src/processor/project_git.rs",
  ],
  limitations: [
    "Controlled external provider only; real Git/filesystem/IPC/JSON-RPC/read model are never replaced.",
    "Synthetic rich paste/drop use production GUI ingress; OS clipboard and OS drag are not covered.",
    "Duplicate means two real mouse Send clicks on the same prepared draft; transport retries, unknown outcomes, ABA and cancellation races remain deterministic owner tests.",
    "Desktop Main pending producer internals remain unknown; this verifies Lime's existing Git -> Workspace -> canonical Thread adaptation to the REA-proven staged menu/actual-submit contract.",
    "The accepted Turn is interrupted through public current JSON-RPC before strict normal quit; GUI Stop interaction and live providers are outside this slice.",
    "Temporary repositories, checkouts and profiles remain under the owned fixture root for evidence; no unknown Worktree is deleted.",
  ],
  async run(fixture) {
    let context = await fixture.launch(1);
    fixture.setPhase("isolated-real-git-and-current-workspace");
    const marker = `Worktree首发${fixture.options.runId}`;
    const sourceGit = await createComposerWorktreeGit(
      path.join(fixture.runtimeEnv.tempRoot, "worktree-source"),
      marker,
    );
    const seed = await rpc(context, "workspace/ensure", {
      name: "Worktree source " + fixture.options.runId,
      rootPath: sourceGit.rootPath,
      workspaceType: "general",
    });
    const workspace = readWorktreeWorkspace(seed.result);
    requireDraftProof(
      workspace?.id && workspace.rootPath === sourceGit.rootPath,
      "real source Workspace identity",
    );
    const configPath = path.join(
      workspace.rootPath,
      ".codex",
      "environments",
      "environment.toml",
    );
    const configRaw =
      'version = 1\nname = "GUI environment fixture"\n[setup]\nscript = "echo environment-fixture>local-environment-setup.txt"\n';
    const config = await rpc(context, "localEnvironments/saveConfig", {
      configPath,
      expectedRevision: null,
      raw: configRaw,
    });
    requireDraftProof(
      config.result.type === "success",
      "current public owner creates the fixture environment",
    );
    await publicSource(context, workspace);
    const record = {
      workspaceId: workspace.id,
      scope: {
        workspaceId: workspace.id,
        kind: "home",
        id: "new-conversation",
      },
      sessionId: null,
      marker,
      rootPath: sourceGit.rootPath,
      path: sourceGit.filePath,
      pathName: path.basename(sourceGit.filePath),
    };
    const beforeThreads = await inventory(context);
    fixture.setPhase("real-rich-gui-edit-and-opaque-source-capture");
    const original = await context.modules.drafts.prepareVisibleDraft(
      context,
      record,
    );
    const scopeRead = await context.modules.drafts.readScope(
      context,
      record.scope,
    );
    const preparedThreads = await inventory(context);
    const dom = await context.modules.history.readComposerHistorySnapshot(
      context.page,
      null,
    );
    const source = assertFirstSendSource("project-new", {
      workspaceId: workspace.id,
      scope: record.scope,
      entry: original.entry,
      workspaceIndex: await readIndex(context, workspace.id),
      scopeRead,
      dom,
      expectedMarker: marker,
      beforeThreads,
      preparedThreads,
    });
    const expected = context.expected(record);
    const skillIdentity =
      context.modules.skills.ensureUserVisibleCapabilityReportSkill(
        context.runtimeEnv,
      ).skillIdentity;
    const literal = context.modules.marks.composerMarksFixture({
      prompt: expected.prompt,
      pasteText: expected.pasteText,
      skillIdentity,
    });
    const expectedSubmission = {
      ...literal,
      text: literal.text + " " + marker,
      displayText: literal.displayText + " " + marker,
    };
    source.resources = captureFirstSendResources(original.entry, {
      ...expected,
      skillIdentity,
      skillFileSha256: createHash("sha256")
        .update(await fs.readFile(skillIdentity.path))
        .digest("hex"),
      expectedSubmission,
    });
    const beforeTrace = await context.captureTrace();
    const beforeGit = await readComposerWorktreeGit(
      record.rootPath,
      workspace.id,
    );
    fixture.setPhase("public-staged-worktree-has-zero-git-effects");
    await bar(context).getByTestId("composer-utility-mode").click();
    await context.page
      .locator('[data-utility-action="select-worktree"]')
      .click();
    await bar(context).getByTestId("composer-utility-mode").click();
    const selected =
      (await context.page
        .locator('[data-utility-action="select-worktree"]')
        .getAttribute("aria-pressed")) === "true";
    await context.page.keyboard.press("Escape");
    const stagedTrace = await context.captureTrace();
    fixture.recordStage(
      "staged-zero-side-effects",
      assertWorktreeStaged({
        beforeTrace,
        stagedTrace,
        beforeGit,
        stagedGit: await readComposerWorktreeGit(record.rootPath, workspace.id),
        beforeThreads: preparedThreads,
        stagedThreads: await inventory(context),
        surface: await context.page.evaluate(readWorktreeSurfaceDom),
        selected,
      }),
    );
    fixture.setPhase("native-environment-none-reset-selection-and-menu");
    const environmentSelection = await chooseEnvironment(
      context,
      workspace,
      configPath,
      path.join(
        fixture.options.evidenceDir,
        fixture.options.runId,
        "worktree-environment-menu.png",
      ),
    );
    fixture.setPhase("two-real-send-clicks-and-canonical-target-acceptance");
    const send = context.modules.drafts
      .editor(context, record)
      .locator('xpath=ancestor::*[@data-testid="inputbar-core-container"][1]')
      .getByTestId("send-btn");
    await send.dblclick();
    const acceptedThread = await wait(
      context,
      async () => {
        const created = (await inventory(context)).filter(
          (item) => !source.preexistingThreadIds.includes(item.id),
        );
        requireDraftProof(
          created.length <= 1,
          "duplicate GUI Send created multiple canonical Threads",
        );
        return created.length === 1 ? threadRead(context, created[0].id) : null;
      },
      (value) =>
        value?.turns?.length === 1 &&
        value.turns[0].items?.some((item) => item.type === "userMessage"),
      "one accepted canonical target Thread/Turn/user Item",
    );
    const receipt = assertFirstSendReceipt(acceptedThread, source, [
      expected.prompt,
      marker,
      expected.pasteText,
    ]);
    const targetResponse = await rpc(context, "workspace/byPath/read", {
      rootPath: acceptedThread.cwd,
    });
    const target = readWorktreeWorkspace(targetResponse.result);
    try {
      await wait(
        context,
        () => context.page.evaluate(readWorktreeSurfaceDom),
        (value) =>
          value.sessionId === receipt.sessionId &&
          value.workspaceId === target?.id &&
          value.rootPath === target?.rootPath &&
          value.userMessageCount === 1,
        "accepted current navigation commits target Composer and visible user message",
      );
    } catch (error) {
      throw new Error(
        `${error.message}; expected=${JSON.stringify({ sessionId: receipt.sessionId, workspaceId: target?.id, rootPath: target?.rootPath, userMessageCount: 1 })}; actual=${JSON.stringify(await context.page.evaluate(readWorktreeSurfaceDom))}`,
        { cause: error },
      );
    }
    await wait(
      context,
      () => context.modules.drafts.readScope(context, source.sourceScope),
      (value) =>
        value.data?.view?.entry === null &&
        value.persistence?.state === "saved",
      "same captured source unbound after accepted promotion",
    );
    const consumedRead = await context.modules.drafts.readScope(
      context,
      source.sourceScope,
    );
    assertUnboundScope(consumedRead, source.sourceScope);
    const tombstoneFiles = await fixture.inspectSavedFiles(
      consumedRead.storeRevision,
      (envelope) => assertFirstSendConsumed(envelope, source, receipt),
    );
    assertFirstSendSavedFiles(tombstoneFiles, {
      ...source.identity,
      sessionId: receipt.sessionId,
      threadId: receipt.threadId,
      sameCapturedIdentity: true,
    });
    fixture.recordStage(
      "same-capture-accepted-target-promotion",
      tombstoneFiles,
    );
    const mediaRead = await rpc(context, "media/read", {
      threadId: receipt.threadId,
      uri: source.resources.image.canonicalUrl,
    });
    const trace = await context.captureTrace();
    const creates = worktreeTraceRequests(trace).filter(
      (request) => request.method === "projectGit/worktree/create",
    );
    requireDraftProof(
      creates.length === 1 &&
        creates[0].params.localEnvironmentConfigPath === configPath,
      "GUI choice reaches the real worktree create request",
    );
    const environment = await readComposerWorktreeEnvironment(target.rootPath);
    requireDraftProof(
      environment.setupMarker && environment.configRaw === configRaw,
      "actual setup runs in the target worktree and persists its selected config",
    );
    fixture.recordStage("gui-environment-selection-and-real-setup", {
      ...environmentSelection,
      setupMarker: environment.setupMarker,
      setupMarkerSha256: environment.setupMarkerSha256,
      configPath: environment.configPath,
    });
    assertWorktreeTraceContinuity(stagedTrace, trace);
    const richInput = summarizeRichInputSubmission({
      traceRaw: JSON.stringify(trace.entries),
      canonical: { thread: acceptedThread },
      threadId: receipt.threadId,
      turnId: receipt.turnId,
      prompt: expected.prompt,
      editorText: dom.text,
      skillToken: dom.tokens.find((token) => token.type === "skill"),
      skillIdentity,
      imageBase64: expected.imageBase64,
      pathReference: { name: record.pathName, path: record.path },
      mediaRead,
      pasteToken: dom.tokens.find((token) => token.type === "paste"),
      pasteText: expected.pasteText,
      expectedSubmission,
    });
    fixture.recordStage(
      "target-canonical-complete-rich-input-and-real-media",
      assertFirstSendResourceReceipt(source, receipt, {
        richInput,
        mediaRead,
        expectedSubmission,
      }),
    );
    const proof = assertWorktreeSubmission({
      trace,
      stagedTrace,
      baselineGit: beforeGit,
      sourceRoot: record.rootPath,
      sourceWorkspaceId: workspace.id,
      targetWorkspace: target,
      thread: acceptedThread,
      backendLedger: await backend(context),
      sourceGit: await readComposerWorktreeGit(record.rootPath, workspace.id),
      targetGit: await readComposerWorktreeGit(target.rootPath, target.id),
      surface: await context.page.evaluate(readWorktreeSurfaceDom),
      duplicateClickCount: 2,
    });
    fixture.recordStage(
      "real-worktree-canonical-target-and-duplicate-proof",
      proof,
    );
    const local = {
      ...record,
      workspaceId: target.id,
      workspaceName: target.name,
      rootPath: target.rootPath,
      sessionId: receipt.sessionId,
      threadId: receipt.threadId,
      scope: { workspaceId: target.id, kind: "local", id: receipt.sessionId },
    };
    await context.modules.dom.fillComposerEditor(
      context.page,
      newEditText,
      receipt.sessionId,
    );
    const newRead = await context.modules.drafts.waitSaved(context, local);
    const newEntry = savedDraft(newRead, local.scope);
    requireDraftProof(
      newEntry.draft.document.text === newEditText &&
        (newEntry.draftId !== source.identity.draftId ||
          newEntry.scopeVersion !== source.identity.scopeVersion),
      "later target edit owns an independent saved capture",
    );
    await rpc(context, "turn/interrupt", {
      threadId: receipt.threadId,
      turnId: receipt.turnId,
    });
    await wait(
      context,
      () => threadRead(context, receipt.threadId),
      (value) =>
        ["interrupted", "canceled", "cancelled"].includes(
          value.turns[0]?.status,
        ),
      "same canonical Turn reaches actual interrupted terminal",
    );
    const finalTrace = await context.captureTrace();
    assertWorktreeTraceContinuity(trace, finalTrace);
    assertWorktreeSubmission({
      trace: finalTrace,
      stagedTrace,
      baselineGit: beforeGit,
      sourceRoot: record.rootPath,
      sourceWorkspaceId: workspace.id,
      targetWorkspace: target,
      thread: await threadRead(context, receipt.threadId),
      backendLedger: await backend(context),
      sourceGit: await readComposerWorktreeGit(record.rootPath, workspace.id),
      targetGit: await readComposerWorktreeGit(target.rootPath, target.id),
      surface: await context.page.evaluate(readWorktreeSurfaceDom),
      duplicateClickCount: 2,
    });
    fixture.recordStage(
      "native-promote-consume-before-later-edit",
      assertFirstSendTrace(await fixture.stopTrace()),
    );
    await fixture.quit();
    context = await fixture.launch(2);
    const coldSelection = await readEnvironmentSelection(context);
    requireDraftProof(
      coldSelection.data.selections[`local:${workspace.rootPath}`] ===
        configPath,
      "normal cold restart retains the source environment selection",
    );
    const coldEnvironment = await readComposerWorktreeEnvironment(
      target.rootPath,
    );
    requireDraftProof(
      coldEnvironment.setupMarkerSha256 === environment.setupMarkerSha256 &&
        coldEnvironment.configRaw === configRaw,
      "cold restore keeps the setup artifact and actual worktree environment",
    );
    fixture.setPhase("normal-cold-restore-without-worktree-or-turn-replay");
    await context.modules.drafts.openRecord(context, local);
    const restored = await context.modules.drafts.waitSaved(context, local);
    const cold = assertWorktreeColdRead({
      proof,
      thread: await threadRead(context, receipt.threadId),
      git: await readComposerWorktreeGit(record.rootPath, workspace.id),
      targetGit: await readComposerWorktreeGit(target.rootPath, target.id),
      trace: await context.captureTrace(),
      surface: await context.page.evaluate(readWorktreeSurfaceDom),
      originalEntry: newEntry,
      restoredEntry: savedDraft(restored, local.scope),
      backendLedger: await backend(context),
    });
    fixture.recordStage("cold-canonical-and-newer-draft-restoration", cold);
    await fixture.quit();
    return {
      guiDraftRestoration: true,
      worktreeSubmission: {
        ...proof,
        cold,
        sourceCapture: source.identity,
        sourceResources: source.resources,
      },
      records: [
        {
          workspaceId: target.id,
          sessionId: receipt.sessionId,
          threadId: receipt.threadId,
          draft: summarizeDraft(newEntry),
        },
      ],
    };
  },
};
