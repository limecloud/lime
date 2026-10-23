import { assert } from "./claw-chat-current-fixture-utils.mjs";

/** Script only provider responses; every tool still executes through RuntimeCore and the native Host. */
export function createBrowserAnnotationControlResponses(readers) {
  const runs = new Map();
  const control = {
    configure(prompt, tabId) {
      assert(!runs.has(prompt), "Duplicate Browser control fixture prompt");
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      runs.set(prompt, {
        prompt,
        tabId,
        gate,
        release,
        stage: 0,
        ready: false,
      });
    },
    read: (prompt) => {
      const run = runs.get(prompt);
      if (!run) return null;
      const { gate: _gate, release: _release, ...record } = run;
      return record;
    },
    release: (prompt) => runs.get(prompt)?.release(),
    releaseAll: () => [...runs.values()].forEach((run) => run.release()),
  };
  return {
    control,
    respond(prompt, body) {
      const run = runs.get(prompt);
      if (!run) return null;
      const call = (name, args) => ({
        type: "tool_call",
        id: `${prompt}-${run.stage++}`,
        name: `browser__${name}`,
        arguments: args,
      });
      if (run.stage === 0) return call("openTabs", {});
      const result = readers.toolResultFromRequest(body);
      const state = readers.extractBrowserState(result);
      assert(
        state?.tabId === run.tabId,
        "Agent control fixture changed its canonical tab",
      );
      if (run.stage === 1)
        return call("claimTab", {
          tabId: state.tabId,
          title: state.title,
          url: state.url,
          pageRevision: state.pageRevision,
        });
      assert(
        state.controlOwner === "agent",
        "Agent tool did not retain native Browser control",
      );
      if (run.stage === 2) {
        run.claimed = state;
        return call("observe", { tabId: state.tabId });
      }
      if (run.stage === 3) {
        const observation = readers.extractBrowserObservation(result);
        assert(
          observation?.pageRevision === state.pageRevision,
          "Agent observe returned a stale revision",
        );
        run.observed = state;
        return call("press", {
          tabId: state.tabId,
          snapshotId: observation.snapshotId,
          key: "Tab",
        });
      }
      assert(
        state.pageRevision > run.claimed.pageRevision,
        "Agent native input did not advance the Host revision",
      );
      run.mutated = state;
      run.ready = true;
      return run.gate.then(() => ({
        type: "text",
        content: `${prompt}-released`,
      }));
    },
  };
}
