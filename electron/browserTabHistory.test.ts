import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserHistoryHost } from "./browserHistoryHost";
import { BrowserHistoryStore } from "./browserHistoryStore";
import { createHarness, mount } from "./browserTabHost.testHarness";
import type { BrowserHistoryPage } from "../src/lib/api/browserHistoryTypes";
import type { BrowserHistoryVisitsPage } from "../src/lib/api/browserHistoryVisits";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "browser-tab-history-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("canonical browser tab history integration", () => {
  it("derives visit attribution from the native control owner and ignores event-provided source", async () => {
    const history = new BrowserHistoryHost(() => undefined, {
      createStore: () => new BrowserHistoryStore(directory, { now: () => 100 }),
    });
    const h = createHarness({ history });
    const mounted = (await mount(h)) as { viewId: string };
    h.host.observeEmbeddedEvent("embedded-browser-view-navigation-committed", {
      viewId: mounted.viewId,
      url: "https://user.example/",
      isActorVisit: true,
    });
    await h.host.executeTool({
      arguments: {
        pageRevision: 0,
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim-history",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    h.host.observeEmbeddedEvent("embedded-browser-view-navigation-committed", {
      viewId: mounted.viewId,
      url: "https://agent.example/",
      isActorVisit: false,
    });
    const rows = (await h.host.invoke(
      h.window as never,
      "browser_history_list",
      { view: "visits" },
    )) as BrowserHistoryVisitsPage;
    expect(
      rows.entries.find((entry) => entry.url === "https://user.example/")
        ?.isActorVisit,
    ).toBe(false);
    expect(
      rows.entries.find((entry) => entry.url === "https://agent.example/")
        ?.isActorVisit,
    ).toBe(true);
  });
  it("requires a live window, permits settings without tabs and ignores state noise and unknown views", async () => {
    const revisions: number[] = [];
    const history = new BrowserHistoryHost(
      (revision) => revisions.push(revision),
      {
        createStore: () =>
          new BrowserHistoryStore(directory, { now: () => 100 }),
      },
    );
    const h = createHarness({ history });
    await expect(h.host.invoke(null, "browser_history_list")).rejects.toThrow(
      "owner window",
    );
    expect(
      (
        (await h.host.invoke(
          h.window as never,
          "browser_history_list",
        )) as BrowserHistoryPage
      ).total,
    ).toBe(0);
    const mounted = (await mount(h)) as { viewId: string };
    h.host.observeEmbeddedEvent("embedded-browser-view-navigation-committed", {
      viewId: "unknown",
      url: "https://unknown.example/",
      title: "Unknown",
    });
    h.host.observeEmbeddedEvent("embedded-browser-view-title-updated", {
      viewId: mounted.viewId,
      url: "https://example.com/",
      title: "No committed visit",
    });
    h.host.observeEmbeddedEvent("embedded-browser-view-state", {
      ...mounted,
      title: "State noise",
    });
    expect(
      (
        (await h.host.invoke(
          h.window as never,
          "browser_history_list",
        )) as BrowserHistoryPage
      ).total,
    ).toBe(0);
    h.host.observeEmbeddedEvent("embedded-browser-view-navigation-committed", {
      viewId: mounted.viewId,
      url: "https://example.com/",
      title: "First",
    });
    h.host.observeEmbeddedEvent("embedded-browser-view-title-updated", {
      viewId: mounted.viewId,
      url: "https://example.com/",
      title: "Loaded",
    });
    const page = (await h.host.invoke(
      h.window as never,
      "browser_history_list",
    )) as BrowserHistoryPage;
    expect(page.entries[0]).toMatchObject({ title: "Loaded", visitCount: 1 });
    expect(revisions).toEqual([1, 2]);
    await h.host.invoke(h.window as never, "browser_history_remove", {
      entries: [
        { url: page.entries[0].url, visitTime: page.entries[0].lastVisitedAt },
      ],
    });
    expect(
      (
        (await h.host.invoke(
          h.window as never,
          "browser_history_list",
        )) as BrowserHistoryPage
      ).total,
    ).toBe(0);
  });
});
