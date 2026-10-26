import { randomUUID } from "node:crypto";
import { assert } from "../lib/chat-fixture/utils.mjs";
import {
  readTrace,
  waitFor,
} from "./browser-runtime-electron-gate-b-download-history-native.mjs";

/** Passive event/DOM observations, followed by the real id-scoped pause button. */
export async function observeLiveDownloadPagination({
  page,
  options,
  active,
  readInvokeTrace,
  query,
  labels,
}) {
  const key = `__downloadLive_${randomUUID().replaceAll("-", "")}`;
  await page.evaluate(
    ({ key, id }) => {
      const state = { events: [], stop: null };
      state.stop = window.electronAPI.listen(
        "browser-downloads-changed",
        ({ payload }) => {
          if (payload?.kind !== "updated") return;
          const entry = payload.entries.find((entry) => entry.id === id);
          if (entry)
            state.events.push({
              revision: payload.revision,
              historyRevision: payload.historyRevision,
              bytes: entry.receivedBytes,
              state: entry.state,
            });
        },
      );
      window[key] = state;
    },
    { key, id: active.id },
  );
  const row = page.locator(`li[data-download-id="${active.id}"]`);
  const reads = async () =>
    (await readTrace(page, readInvokeTrace)).filter(
      (entry) =>
        entry.command === "browser_downloads_list" &&
        entry.transport === "electron-ipc" &&
        entry.status === "success" &&
        entry.args_preview?.query === query,
    ).length;
  const sample = () =>
    page.evaluate(
      ({ key, id }) => ({
        events: window[key].events,
        text:
          document.querySelector(`li[data-download-id="${id}"] p`)
            ?.textContent ?? null,
        rows: document.querySelectorAll("li[data-download-id]").length,
      }),
      { key, id: active.id },
    );
  return {
    async verify() {
      try {
        await row
          .getByRole("button", { name: labels.pause, exact: true })
          .waitFor({ timeout: options.timeoutMs });
        // Begin measurement after the initial membership/status refresh and both pages have settled.
        const before = await sample();
        const beforeReads = await reads();
        await page.evaluate((key) => {
          window[key].events = [];
        }, key);
        const during = await waitFor(
          options,
          sample,
          (value) => {
            const progress = value.events.filter(
              (event) => event.state === "progressing",
            );
            return (
              new Set(progress.map((event) => event.bytes)).size >= 4 &&
              value.text !== before.text
            );
          },
          "Native progress did not update the rendered row while history remained loaded",
        );
        const afterReads = await reads();
        const progress = during.events.filter(
          (event) => event.state === "progressing",
        );
        assert(
          afterReads === beforeReads,
          "Progress-only updates refetched download history",
        );
        assert(
          during.rows === before.rows,
          "Progress-only updates lost loaded download records",
        );
        assert(
          new Set(progress.map((event) => event.historyRevision)).size === 1,
          "Progress-only updates changed the history generation",
        );
        await row
          .getByRole("button", { name: labels.pause, exact: true })
          .click();
        const paused = await waitFor(
          options,
          sample,
          (value) => value.events.some((event) => event.state === "paused"),
          "Pause did not publish its structural history change",
        );
        await row
          .getByRole("button", { name: labels.resume, exact: true })
          .waitFor({ timeout: options.timeoutMs });
        await waitFor(
          options,
          reads,
          (count) => count >= afterReads + 2,
          "The pause status change did not refresh both loaded history pages",
        );
        const terminal = paused.events.findLast(
          (event) => event.state === "paused",
        );
        assert(
          terminal.historyRevision > progress.at(-1).historyRevision,
          "Pause did not advance the history generation",
        );
        return {
          observedProgressUpdates: progress.length,
          distinctByteCounts: new Set(progress.map((event) => event.bytes))
            .size,
          nativeBytesAdvanced: progress.at(-1).bytes > progress[0].bytes,
          durableRevisionAdvanced:
            progress.at(-1).revision > progress[0].revision,
          historyRevisionStableDuringProgress: true,
          progressOnlyHistoryReads: afterReads - beforeReads,
          renderedRowsPreserved: true,
          visibleProgressTextChanged: during.text !== before.text,
          pauseAdvancedHistoryRevision: true,
          pauseRefreshedBothPages: true,
          events: paused.events,
        };
      } finally {
        await page.evaluate((key) => {
          window[key].stop?.();
          delete window[key];
        }, key);
      }
    },
    async dispose() {
      await page.evaluate((key) => {
        window[key]?.stop?.();
        delete window[key];
      }, key);
    },
  };
}
