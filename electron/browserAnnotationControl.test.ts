// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fixture, selection } from "./browserAnnotationHost.testFixture";

async function saved() {
  const f = fixture();
  const session = await f.start();
  const source = selection();
  f.message({ type: "selection", selection: source });
  const pending = f.capture(session.annotationId);
  f.ready(source);
  const capture = await pending;
  return { ...f, session, captured: capture };
}
type Saved = Awaited<ReturnType<typeof saved>>;
const command = (f: Saved) => f.frame.send.mock.calls.at(-1)![1];
const activations = (f: Saved) =>
  f.events.filter((e) => e.event.endsWith("activate"));
const acknowledge = (f: Saved, value = command(f)) =>
  f.message({
    ...value,
    type: "marker-restored",
    pageRevision: value.nextPageRevision,
  });

describe("saved Browser annotation control and presentation revisions", () => {
  it("rejects new input during Agent control and restores a saved read-only marker after release", async () => {
    const f = await saved();
    const capture = structuredClone(f.captured);
    f.target.annotationAllowed = false;
    f.host.revalidateView("view-1");
    const hidden = command(f);
    expect(hidden.type).toBe("hide-marker");
    await expect(f.start()).rejects.toThrow("visible attached selected");
    await expect(f.capture(f.session.annotationId)).rejects.toThrow(
      "unavailable",
    );
    f.message({ type: "activate", token: hidden.nextToken });
    expect(activations(f)).toHaveLength(0);
    f.target.annotationAllowed = true;
    f.host.revalidateView("view-1");
    const restore = command(f);
    expect(restore).toMatchObject({
      type: "restore-marker",
      token: hidden.nextToken,
      nextPageRevision: 2,
    });
    acknowledge(f, restore);
    f.message({ ...restore, type: "activate" });
    expect(activations(f).at(-1)?.payload).toEqual({
      ...f.session,
      presentationPageRevision: 2,
    });
    expect(f.captured).toEqual(capture);
    expect(f.webContents.capturePage).toHaveBeenCalledTimes(1);
  });

  it("advances only presentation across consecutive Host revisions without changing the original capture", async () => {
    const f = await saved();
    const original = structuredClone(f.captured);
    f.target.annotationAllowed = false;
    f.host.revalidateView("view-1");
    const hidden = command(f);
    for (const revision of [3, 4]) {
      f.target.identity.pageRevision = revision;
      f.host.advanceView("view-1", revision - 1);
      f.host.revalidateView("view-1");
    }
    expect(command(f)).toEqual(hidden);
    f.target.annotationAllowed = true;
    f.host.revalidateView("view-1");
    const restore = command(f);
    expect(restore).toMatchObject({ pageRevision: 2, nextPageRevision: 4 });
    f.message({ ...restore, type: "marker-restored", pageRevision: 2 });
    f.message({ ...restore, type: "activate", pageRevision: 4 });
    expect(activations(f)).toHaveLength(0);
    acknowledge(f, restore);
    f.message({ ...restore, type: "activate", pageRevision: 4 });
    expect(activations(f).at(-1)?.payload).toEqual({
      ...f.session,
      presentationPageRevision: 4,
    });
    f.host.refresh("view-1", f.session.annotationId);
    expect(command(f).pageRevision).toBe(4);
    expect(f.captured).toEqual(original);
    expect(f.session.pageRevision).toBe(2);
    expect(f.webContents.capturePage).toHaveBeenCalledTimes(1);
  });

  it("revokes an in-flight restore if Agent control returns and rejects its late acknowledgement", async () => {
    vi.useFakeTimers();
    const f = await saved();
    f.target.identity.pageRevision = 3;
    f.host.advanceView("view-1", 2);
    f.host.revalidateView("view-1");
    const old = command(f);
    f.target.annotationAllowed = false;
    f.host.revalidateView("view-1");
    const hidden = command(f);
    expect(hidden).toMatchObject({
      type: "hide-marker",
      pageRevision: 3,
      token: old.token,
    });
    acknowledge(f, old);
    await vi.advanceTimersByTimeAsync(20);
    expect(f.events.some((e) => e.event.endsWith("cancelled"))).toBe(false);
    f.target.annotationAllowed = true;
    f.host.revalidateView("view-1");
    const fresh = command(f);
    expect(fresh.token).toBe(hidden.nextToken);
    acknowledge(f, fresh);
    f.message({ ...fresh, type: "activate", pageRevision: 3 });
    expect(activations(f)).toHaveLength(1);
  });

  it("requires exact native identity, document and a requested current-version acknowledgement", async () => {
    const f = await saved();
    f.target.identity.pageRevision = 3;
    f.host.advanceView("view-1", 2);
    f.host.revalidateView("view-1");
    const restore = command(f);
    f.message({
      ...restore,
      type: "marker-restored",
      pageRevision: 3,
      documentToken: "another-document",
    });
    f.message({ ...restore, type: "activate", pageRevision: 3 });
    expect(activations(f)).toHaveLength(0);
    f.target.identity.webContentsId = 32;
    acknowledge(f, restore);
    f.host.revalidateView("view-1");
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-cancelled",
    });
    expect(activations(f)).toHaveLength(0);
  });

  it("keeps a released hidden marker paused and allows exact removal before restoration", async () => {
    const f = await saved();
    f.target.annotationAllowed = false;
    f.host.revalidateView("view-1");
    f.target.identity.pageRevision = 3;
    f.host.advanceView("view-1", 2);
    f.hide();
    f.target.annotationAllowed = true;
    f.host.revalidateView("view-1");
    expect(command(f).type).toBe("hide-marker");
    await f.invoke("browser_tab_cancel_annotation", {
      tabId: "tab-1",
      annotationId: f.session.annotationId,
    });
    expect(command(f)).toMatchObject({ type: "cancel", pageRevision: 2 });
    f.show();
    f.host.revalidateView("view-1");
    expect(command(f).type).toBe("cancel");
  });

  it("cannot advance an uncaptured picker, skip revisions or restore a navigated document", async () => {
    const f = fixture();
    await f.start();
    f.target.identity.pageRevision = 3;
    f.host.advanceView("view-1", 2);
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-cancelled",
    });
    const retained = await saved();
    retained.target.identity.pageRevision = 4;
    retained.host.advanceView("view-1", 3);
    expect(retained.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-cancelled",
    });
    const navigated = await saved();
    navigated.webContents.emit(
      "did-start-navigation",
      {},
      "https://page.test/new",
      false,
      true,
    );
    navigated.target.identity.pageRevision = 3;
    navigated.host.advanceView("view-1", 2);
    navigated.host.revalidateView("view-1");
    expect(command(navigated).type).toBe("cancel");
  });
});
