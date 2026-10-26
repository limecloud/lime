import { invokeAppServerFromPage } from "../lib/chat-fixture/rpc.mjs";
import { assert } from "../lib/chat-fixture/utils.mjs";
import { createBrowserAnnotationControlResponses } from "./browser-runtime-electron-gate-b-annotation-control-provider.mjs";
import {
  annotationTextOf,
  BROWSER_ANNOTATION_FINAL_MARKER,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

/** Hold only explicit fixture prompts so GUI queue/steer actions can reach the real runtime. */
export function createBrowserAnnotationActiveResponses(scenario, readers) {
  const gates = new Map();
  const agent = createBrowserAnnotationControlResponses(readers);
  scenario.annotation = {
    agent: agent.control,
    holds: [],
    release: (prompt) => gates.get(prompt)?.(),
    releaseAll: () => {
      [...gates.values()].forEach((release) => release());
      agent.control.releaseAll();
    },
  };
  return [
    async ({ body }) => {
      const messages = body.messages ?? body.input ?? [];
      const prompt = annotationTextOf(
        messages.findLast((item) => item.role === "user")?.content,
      );
      const controlled = agent.respond(prompt, body);
      if (controlled) return controlled;
      if (
        /^annotation-active-(queue|steer)-[a-z0-9-]+$/u.test(prompt) &&
        !gates.has(prompt)
      ) {
        await new Promise((resolve) => {
          gates.set(prompt, resolve);
          scenario.annotation.holds.push(prompt);
        });
      }
      return { type: "text", content: BROWSER_ANNOTATION_FINAL_MARKER };
    },
  ];
}

/** Require actual image support from the current catalog before any annotation input. */
export async function assertBrowserAnnotationModel(
  page,
  requestLog,
  providerId,
  modelId,
) {
  const catalog = await invokeAppServerFromPage(
    page,
    "model/list",
    { includeHidden: true, limit: 500 },
    requestLog,
  );
  const selected = catalog.result?.data?.find(
    (model) => model.model === modelId && model.providerId === providerId,
  );
  console.log(
    "[browser-annotation] model-capability=" +
      JSON.stringify({
        selected: selected && {
          id: selected.id,
          providerId: selected.providerId,
          model: selected.model,
          inputModalities: selected.inputModalities,
          capabilitySnapshot: selected.capabilitySnapshot,
        },
        providerModels: catalog.result?.data
          ?.filter((model) => model.providerId === providerId)
          .map((model) => ({
            id: model.id,
            model: model.model,
            inputModalities: model.inputModalities,
          })),
      }),
  );
  assert(selected, "Annotation test model was absent from model/list");
  assert(
    selected?.inputModalities?.includes("image"),
    "Annotation test model did not expose image capability through model/list",
  );
}
