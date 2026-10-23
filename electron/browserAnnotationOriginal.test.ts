// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixture, selection } from "./browserAnnotationHost.testFixture";
import type { BrowserAnnotationCommand } from "./browserAnnotationModel";

const command =
  "browser_tab_set_annotation_original" as BrowserAnnotationCommand;
async function saved() {
  const f = fixture();
  const session = await f.start();
  const source = selection();
  f.message({ type: "selection", selection: source });
  const capture = f.capture(session.annotationId);
  f.ready(source);
  await capture;
  f.frame.send.mockClear();
  return f;
}

describe("temporary original page presentation", () => {
  it("reconciles a new hold that arrives during restoration and rejects the old page after advance", async () => {
    const f = await saved();
    f.hide();
    f.host.revalidateView("view-1");
    f.show();
    f.host.revalidateView("view-1");
    const restore = f.frame.send.mock.calls.at(-1)![1];
    const args = {
      tabId: "tab-1",
      identity: { ...f.target.identity },
      gestureId: "during-restore",
      original: true,
    };
    await f.invoke(command, args);
    f.message({
      ...restore,
      type: "marker-restored",
      pageRevision: restore.nextPageRevision,
    });
    expect(
      f.frame.send.mock.calls.some(
        ([, message]) =>
          message.type === "design-original" && message.original === true,
      ),
    ).toBe(true);
    f.target.identity.pageRevision += 1;
    f.host.advanceView("view-1", args.identity.pageRevision);
    await expect(
      f.invoke(command, { ...args, original: false }),
    ).rejects.toThrow("identity");
    f.host.revalidateView("view-1");
    expect(f.frame.send.mock.calls.at(-1)![1]).toMatchObject({
      type: "restore-marker",
      original: false,
      nextPageRevision: f.target.identity.pageRevision,
    });
  });

  it("releases on owner renderer loss and does not leave a native listener after cancellation", async () => {
    const f = await saved();
    const args = {
      tabId: "tab-1",
      identity: f.target.identity,
      gestureId: "renderer",
      original: true,
    };
    await f.invoke(command, args);
    f.owner.emit("render-process-gone");
    expect(f.frame.send.mock.calls.at(-1)![1]).toMatchObject({
      type: "design-original",
      original: false,
    });
    await f.invoke(command, { ...args, gestureId: "cancel" });
    f.host.cancelView("view-1", "navigation");
    expect(f.window.listenerCount("blur")).toBe(0);
    expect(f.owner.listenerCount("render-process-gone")).toBe(0);
  });
  it("holds only the exact current page and ignores a late release from a previous gesture", async () => {
    const f = await saved();
    const args = {
      tabId: "tab-1",
      identity: f.target.identity,
      gestureId: "first",
      original: true,
    };
    expect(await f.invoke(command, args)).toEqual({
      ...f.target.identity,
      gestureId: "first",
      original: true,
    });
    expect(f.frame.send.mock.calls.at(-1)![1]).toMatchObject({
      type: "design-original",
      original: true,
      documentToken: "document-1",
    });
    await f.invoke(command, { ...args, original: false });
    await f.invoke(command, { ...args, gestureId: "second" });
    f.frame.send.mockClear();
    await f.invoke(command, { ...args, original: false });
    expect(f.frame.send).not.toHaveBeenCalled();
    await f.invoke(command, { ...args, gestureId: "second", original: false });
    expect(f.frame.send.mock.calls.at(-1)![1]).toMatchObject({
      type: "design-original",
      original: false,
    });
  });

  it("restores on native window blur and releases its listeners", async () => {
    const f = await saved();
    const before = f.window.listenerCount("blur");
    const args = {
      tabId: "tab-1",
      identity: f.target.identity,
      gestureId: "blur",
      original: true,
    };
    await f.invoke(command, args);
    expect(f.window.listenerCount("blur")).toBe(before + 1);
    f.window.emit("blur");
    expect(f.frame.send.mock.calls.at(-1)![1]).toMatchObject({
      type: "design-original",
      original: false,
    });
    expect(f.window.listenerCount("blur")).toBe(before);
  });

  it("rejects malformed, foreign and stale identity without changing the page", async () => {
    const f = await saved();
    const args = {
      tabId: "tab-1",
      identity: f.target.identity,
      gestureId: "current",
      original: true,
    };
    for (const invalid of [
      { ...args, original: "true" },
      { ...args, gestureId: "" },
      { ...args, extra: true },
      ...Object.keys(f.target.identity).map((key) => ({
        ...args,
        identity: { ...f.target.identity, [key]: "old" },
      })),
      { ...args, identity: { ...f.target.identity, extra: true } },
    ])
      await expect(f.invoke(command, invalid)).rejects.toThrow();
    f.target.annotationAllowed = false;
    await expect(f.invoke(command, args)).rejects.toThrow();
    expect(f.frame.send).not.toHaveBeenCalled();
  });

  it("clears a held original on pause, so restoring the same page shows the design again", async () => {
    const f = await saved();
    await f.invoke(command, {
      tabId: "tab-1",
      identity: f.target.identity,
      gestureId: "pause",
      original: true,
    });
    f.target.annotationAllowed = false;
    f.host.revalidateView("view-1");
    f.target.annotationAllowed = true;
    f.host.revalidateView("view-1");
    expect(f.frame.send.mock.calls.at(-1)![1]).toMatchObject({
      type: "restore-marker",
      original: false,
    });
  });
});
