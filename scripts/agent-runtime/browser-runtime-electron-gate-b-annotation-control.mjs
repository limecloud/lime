import { randomUUID } from "node:crypto";
import { invokeAppServerFromPage } from "./claw-chat-current-fixture-rpc.mjs";
import { assert } from "./claw-chat-current-fixture-utils.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

/** Start a real canonical turn without consuming the deliberately unsubmitted GUI drafts. */
export async function verifyBrowserAnnotationControl(ctx, ui, saved, previous) {
  const {
    app,
    page,
    options,
    identity,
    initial,
    providerFixture,
    requestLog,
    readBrowserWorkspaceState,
  } = ctx;
  const { native, observerKey, editor, label, capture, beginSelection, chip } =
    ui;
  const records = () =>
    app.evaluate((_electron, key) => globalThis[key].records, observerKey);
  const agent = providerFixture.scenario.annotation.agent;
  const prompt = `annotation-control-${randomUUID()}`;
  agent.configure(prompt, initial.tabId);
  const offset = (await records()).length;
  console.log("[browser-annotation-control] stage=canonical-agent-turn");
  try {
    const started = await invokeAppServerFromPage(
      page,
      "turn/start",
      {
        threadId: identity.threadId,
        input: [{ type: "text", text: prompt }],
      },
      requestLog,
    );
    assert(!started.error, "Agent control canonical turn/start failed");
    const held = await waitFor(
      options,
      () => agent.read(prompt),
      (value) => value?.ready,
      "Agent did not execute claim/observe/native key input",
    );
    const controlled = await readBrowserWorkspaceState(page);
    assert(
      controlled.controlOwner === "agent" &&
        controlled.tabId === initial.tabId &&
        controlled.webContentsId === initial.webContentsId &&
        controlled.pageRevision === held.mutated.pageRevision,
      "Agent input changed native Browser identity or lost control",
    );
    const whileControlled = (await records()).slice(offset);
    assert(
      !whileControlled.some(
        (value) =>
          value.kind === "marker-restored" &&
          [saved.firstId, saved.secondId].includes(value.annotationId),
      ),
      "A saved marker restored during Agent control",
    );
    const restoreOffset = (await records()).length;
    agent.release(prompt);
    const released = await waitFor(
      options,
      () => readBrowserWorkspaceState(page),
      (value) =>
        value.controlOwner === "released" && value.activeTurnId === null,
      "Canonical turn terminal did not release the Browser",
    );
    const inputs = await waitFor(
      options,
      records,
      (values) =>
        [saved.firstId, saved.secondId].every((id) =>
          values
            .slice(restoreOffset)
            .some(
              (value) =>
                value.kind === "marker-restored" && value.annotationId === id,
            ),
        ),
      "Saved markers did not restore after Agent terminal",
    );
    const restored = [saved.firstId, saved.secondId].map((id, index) => {
      const value = inputs
        .slice(restoreOffset)
        .findLast(
          (entry) =>
            entry.kind === "marker-restored" && entry.annotationId === id,
        );
      assert(
        value.mainFrame &&
          value.senderId === initial.webContentsId &&
          value.documentDigest === previous[index].documentDigest &&
          value.tokenDigest !== previous[index].tokenDigest &&
          value.pageRevision === released.pageRevision &&
          value.pageRevision > previous[index].pageRevision,
        "Agent marker restore reused stale authority or changed document",
      );
      return value;
    });
    const point = await waitFor(
      options,
      async () =>
        (await records()).findLast(
          (value) =>
            value.kind === "anchor" && value.annotationId === saved.firstId,
        ),
      (value) =>
        value?.anchor?.targetRect &&
        value.tokenDigest === restored[0].tokenDigest,
      "Agent-restored marker has no fresh live geometry",
    );
    await native.page.mouse.click(
      Math.max(12, point.anchor.targetRect.x),
      Math.max(12, point.anchor.targetRect.y),
    );
    const target = await editor();
    assert(
      (await target.page
        .locator('[data-testid="browser-annotation-composer"]')
        .innerText()) === saved.body,
      "Agent-restored marker lost the original body",
    );
    await capture("markers-agent-editor", target);
    await target.page
      .getByRole("button", { name: label("save"), exact: true })
      .click();
    await chip(saved.body).waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    await beginSelection();
    const thread = await invokeAppServerFromPage(
      page,
      "thread/read",
      { threadId: identity.threadId, includeTurns: true },
      requestLog,
    );
    const turn = thread.result?.thread?.turns?.find((value) =>
      value.items?.some(
        (item) =>
          item.type === "userMessage" &&
          item.content?.some(
            (part) => part.type === "text" && part.text === prompt,
          ),
      ),
    );
    assert(
      turn?.status === "completed",
      "Agent control turn did not reach a canonical completed state",
    );
    return {
      prompt,
      turnId: turn.id,
      claimed: held.claimed,
      mutated: held.mutated,
      released,
      restored,
      originalBodyReopened: true,
      freshPresentationRevision: true,
    };
  } finally {
    agent.release(prompt);
  }
}
