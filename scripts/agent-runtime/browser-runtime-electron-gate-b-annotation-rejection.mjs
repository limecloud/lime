import { invokeAppServerFromPage } from "./claw-chat-current-fixture-rpc.mjs";
import { assert, sleep } from "./claw-chat-current-fixture-utils.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  composerEditorSelector,
  fillComposerEditor,
  readComposerEditorText,
} from "../lib/composer-editor-dom.mjs";

export function expectedBrowserAnnotationRejectionErrors(errors) {
  const capabilityGap =
    "model_input_capability_gap:missing_input_modalities:image";
  assert(
    errors.length === 3 &&
      /^\[AgentDebug\] AgentStream\.submitFailed \{elapsedMs: \d+, error: Object, eventName: agent_stream_[a-z0-9-]+, sessionId: [a-z0-9-]+, submitInvokeMs: \d+\}$/u.test(
        errors[0],
      ) &&
      errors[1].startsWith(`[AgentChat] 发送失败: Error: ${capabilityGap}\n`) &&
      errors[2].startsWith(
        `[AgentChat] 发送消息失败: Error: ${capabilityGap}\n`,
      ),
    "Annotation rejection had unexpected console errors",
  );
  return errors;
}

/** Reject through discovered text-only capability, then restore image support for retry. */
async function runBrowserAnnotationRejection(
  ctx,
  { chip, send, verifyDraft, consoleErrors, expectedConsoleErrors },
) {
  const { page, identity, providerId, requestLog, providerFixture, options } =
    ctx;
  const invoke = (method, params) =>
    invokeAppServerFromPage(page, method, params, requestLog);
  const readThread = () =>
    invoke("thread/read", { threadId: identity.threadId, includeTurns: true });
  const provider = await invoke("modelProvider/read", { providerId });
  const originalHost = provider.result?.provider?.apiHost;
  assert(
    typeof originalHost === "string",
    "Annotation provider host was unavailable",
  );
  const discover = async (apiHost, modalities) => {
    const updated = await invoke("modelProvider/update", {
      providerId,
      apiHost,
    });
    assert(
      updated.result?.provider?.apiHost === apiHost,
      "Annotation provider host did not update",
    );
    const fetched = await invoke("modelProvider/fetchModels", { providerId });
    assert(
      !fetched.error && fetched.result?.models?.length > 0,
      "Annotation rejection could not refresh real model discovery",
    );
    const catalog = await invoke("model/list", {
      includeHidden: true,
      limit: 500,
    });
    const selected = catalog.result?.data?.find(
      (model) => model.providerId === providerId,
    );
    assert(
      selected?.inputModalities?.includes("image") ===
        modalities.includes("image"),
      "Annotation rejection model/list did not reflect discovered capability",
    );
    return { inputModalities: selected.inputModalities };
  };
  const before = await readThread();
  const turnIds = (read) => read.result?.thread?.turns?.map((turn) => turn.id);
  assert(
    Array.isArray(turnIds(before)),
    "Annotation rejection did not read canonical turns",
  );
  const requestCount = providerFixture.requests.length;
  const textOnly = await startOpenAiCompatibleFixtureServer({
    model: providerFixture.provider.modelPreference,
    apiKey: providerFixture.provider.providerConfig.apiKey,
    modelInputModalities: ["text"],
  });
  try {
    await discover(`${textOnly.baseUrl}/v1`, ["text"]);
    const consoleStart = consoleErrors.length;
    await send();
    const deadline = Date.now() + options.timeoutMs;
    while (consoleErrors.length < consoleStart + 3 && Date.now() < deadline)
      await sleep(options.intervalMs);
    await verifyDraft();
    await chip.waitFor({ state: "visible", timeout: options.timeoutMs });
    const after = await readThread();
    assert(
      JSON.stringify(turnIds(before)) === JSON.stringify(turnIds(after)),
      "Rejected annotation created a canonical turn",
    );
    assert(
      providerFixture.requests.length === requestCount &&
        textOnly.requests.length === 0,
      "Text-only provider received the rejected image annotation",
    );
    const expected = expectedBrowserAnnotationRejectionErrors(
      consoleErrors.slice(consoleStart),
    );
    expectedConsoleErrors.push(...expected);
    consoleErrors.splice(consoleStart, expected.length);
    return {
      rejectedWithDiscoveredTextOnlyModel: true,
      bodyPreserved: true,
      draftChipPreserved: true,
      retryEnabled: true,
      canonicalTurnIdsUnchanged: true,
      providerRequestsUnchanged: true,
    };
  } finally {
    try {
      await discover(originalHost, ["text", "image"]);
    } finally {
      await textOnly.close();
    }
  }
}

export async function runBrowserAnnotationDirectRejection(ctx, args) {
  const { editor, body, label } = args;
  return runBrowserAnnotationRejection(ctx, {
    ...args,
    send: () =>
      editor.getByRole("button", { name: label("send"), exact: true }).click(),
    verifyDraft: async () => {
      await editor
        .getByRole("alert")
        .filter({ hasText: label("sendFailed") })
        .waitFor({ state: "visible", timeout: ctx.options.timeoutMs });
      assert(
        await editor
          .getByRole("button", { name: label("send"), exact: true })
          .isEnabled(),
        "Rejected annotation stayed pending instead of allowing retry",
      );
      assert(
        (await editor
          .locator('[data-testid="browser-annotation-composer"]')
          .innerText()) === body,
        "Pre-accept rejection lost the editor body",
      );
    },
  });
}

export async function runBrowserAnnotationMainRejection(ctx, args) {
  const { page, identity } = ctx;
  const editor = page.locator(
    `${composerEditorSelector(identity.sessionId)}:visible`,
  );
  const send = page.getByTestId("send-btn");
  return runBrowserAnnotationRejection(ctx, {
    ...args,
    send: async () => {
      await fillComposerEditor(page, args.prompt, identity.sessionId);
      await send.click();
    },
    verifyDraft: async () => {
      assert(await send.isEnabled(), "Rejected main Composer stayed pending");
      assert(
        (await readComposerEditorText(editor)) === args.prompt,
        "Rejected main Composer lost its text",
      );
    },
  });
}
