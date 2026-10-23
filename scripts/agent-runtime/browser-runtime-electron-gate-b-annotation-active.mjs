import { randomUUID } from "node:crypto";
import { invokeAppServerFromPage } from "./claw-chat-current-fixture-rpc.mjs";
import { sendPromptFromGui } from "./claw-chat-current-fixture-gui-actions.mjs";
import { assert } from "./claw-chat-current-fixture-utils.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { annotationTextOf } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

/** Exercise user actions during a real active provider request; no injected submissions. */
export async function runBrowserAnnotationActiveSubmissions(ctx, actions) {
  const { page, options, identity, providerFixture, requestLog } = ctx;
  const {
    beginSelection,
    selectHeading,
    editor,
    fill,
    chip,
    label,
    verifySubmission,
    captureRenderer,
  } = actions;
  const read = () =>
    invokeAppServerFromPage(
      page,
      "thread/read",
      {
        threadId: identity.threadId,
        includeTurns: true,
      },
      requestLog,
    );
  const control = providerFixture.scenario.annotation;
  assert(control, "Annotation provider active-input controller is unavailable");
  const results = {};
  try {
    for (const mode of ["queue", "steer"]) {
      const prefix = `annotation-active-${mode}-${randomUUID()}`;
      await sendPromptFromGui(page, options, prefix, {
        expectedSessionId: identity.sessionId,
      });
      await waitFor(
        options,
        async () => control.holds.includes(prefix),
        Boolean,
        `Annotation ${mode} provider request did not stay active`,
      );
      const active = await waitFor(
        options,
        read,
        (response) =>
          response.result?.thread?.turns?.some(
            (turn) =>
              turn.status === "inProgress" &&
              turn.items?.some(
                (item) =>
                  item.type === "userMessage" &&
                  annotationTextOf(item.content) === prefix,
              ),
          ),
        `Annotation ${mode} did not have a canonical active turn`,
      );
      const activeTurnId = active.result.thread.turns.findLast(
        (turn) => turn.status === "inProgress",
      ).id;
      const body = `${prefix} browser comment`;
      await beginSelection();
      await selectHeading();
      const current = await editor();
      await fill(current, body);
      let expectedTurnId = activeTurnId;
      if (mode === "queue") {
        await current.page
          .getByRole("button", { name: label("send"), exact: true })
          .click();
        await chip(body).waitFor({
          state: "hidden",
          timeout: options.timeoutMs,
        });
        const queue = await waitFor(
          options,
          () =>
            invokeAppServerFromPage(
              page,
              "thread/queue/list",
              {
                threadId: identity.threadId,
                limit: 100,
              },
              requestLog,
            ),
          (response) =>
            response.result?.data?.some((submission) =>
              annotationTextOf(submission.input).includes(body),
            ),
          "Annotation queue acceptance was not visible through the real App Server",
        );
        const queued = queue.result.data.find((submission) =>
          annotationTextOf(submission.input).includes(body),
        );
        expectedTurnId = queued.id;
        assert(
          expectedTurnId !== activeTurnId &&
            queued.input.filter((part) => part.type === "image").length === 1,
          "Queued Browser annotation lost its independent identity or screenshot",
        );
        const list = page.getByTestId("queued-message-list");
        await list.locator('[data-queue-action="expand"]').click();
        await list
          .getByTestId("queued-message-item")
          .filter({ hasText: body })
          .waitFor({ state: "visible", timeout: options.timeoutMs });
        await captureRenderer("active-queue-accepted");
      } else {
        await current.page
          .getByRole("button", { name: label("save"), exact: true })
          .click();
        await chip(body).waitFor({
          state: "visible",
          timeout: options.timeoutMs,
        });
        await sendPromptFromGui(page, options, `${prefix} follow-up`, {
          expectedSessionId: identity.sessionId,
          submitWithEnter: true,
        });
        await chip(body).waitFor({
          state: "hidden",
          timeout: options.timeoutMs,
        });
        await captureRenderer("active-steer-accepted");
      }
      assert(
        !providerFixture.requests.some((request) => {
          const messages = request.body?.messages ?? request.body?.input ?? [];
          return messages.some(
            (message) =>
              message.role === "user" &&
              annotationTextOf(message.content).includes(body),
          );
        }),
        "Browser annotation reached the provider before the held turn was released",
      );
      control.release(prefix);
      const evidence = await verifySubmission(
        body,
        "element",
        mode === "steer" ? `${prefix} follow-up` : "",
        mode === "queue" ? "thread/queue/add" : "turn/steer",
        expectedTurnId,
      );
      assert(
        evidence.failedAssertions.length === 0,
        `Annotation ${mode} evidence failed: ${evidence.failedAssertions.join(", ")}`,
      );
      results[mode] = { activeTurnId, expectedTurnId, ...evidence };
    }
    return results;
  } finally {
    control.releaseAll();
  }
}
