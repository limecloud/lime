// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixture, selection } from "./browserAnnotationHost.testFixture";

async function saved(visible = true) {
  const f = fixture();
  await f.invoke("browser_tab_set_annotation_markers", {
    tabId: "tab-1",
    visible,
  });
  const session = await f.start();
  const source = selection();
  f.message({ type: "selection", selection: source });
  const pending = f.capture(session.annotationId);
  f.ready(source);
  const captured = await pending;
  return { ...f, session, captured };
}
type Saved = Awaited<ReturnType<typeof saved>>;
const last = (f: Saved) => f.frame.send.mock.calls.at(-1)![1];
const visibility = (f: Saved, visible: boolean) =>
  f.invoke("browser_tab_set_annotation_markers", { tabId: "tab-1", visible });
const activations = (f: Saved) =>
  f.events.filter((e) => e.event.endsWith("activate"));

describe("saved Browser annotation marker visibility", () => {
  it("reconciles a visibility change that arrives during the restoration handshake", async () => {
    const f = await saved();
    f.hide();
    f.host.revalidateView("view-1");
    f.show();
    f.host.revalidateView("view-1");
    const restore = last(f);
    expect(restore).toMatchObject({
      type: "restore-marker",
      markersVisible: true,
    });
    await visibility(f, false);
    f.message({
      ...restore,
      type: "marker-restored",
      pageRevision: restore.nextPageRevision,
    });
    expect(f.frame.send.mock.calls.at(-2)![1]).toMatchObject({
      type: "set-marker-visibility",
      visible: false,
    });
    f.message({ ...restore, type: "activate" });
    expect(activations(f)).toHaveLength(0);
  });

  it("hides and shows saved markers without changing the captured selection or authorizing another capture", async () => {
    const f = await saved();
    const capture = structuredClone(f.captured);
    expect(last(f)).toMatchObject({ type: "retain", markersVisible: true });
    expect(await visibility(f, false)).toEqual({
      tabId: "tab-1",
      visible: false,
    });
    expect(last(f)).toMatchObject({
      type: "set-marker-visibility",
      visible: false,
    });
    f.message({ type: "activate" });
    expect(activations(f)).toHaveLength(0);
    await expect(f.capture(f.session.annotationId)).rejects.toThrow(
      "unavailable",
    );
    await visibility(f, true);
    f.message({ type: "activate" });
    expect(activations(f)).toHaveLength(1);
    expect(f.captured).toEqual(capture);
    expect(f.webContents.capturePage).toHaveBeenCalledTimes(1);
  });

  it("applies the saved preference to captures and restores after a hidden tab", async () => {
    const f = await saved(false);
    expect(last(f)).toMatchObject({ type: "retain", markersVisible: false });
    f.hide();
    f.host.revalidateView("view-1");
    const paused = last(f);
    f.show();
    f.host.revalidateView("view-1");
    const restore = last(f);
    expect(restore).toMatchObject({
      type: "restore-marker",
      markersVisible: false,
      token: paused.nextToken,
    });
    f.message({
      ...restore,
      type: "marker-restored",
      pageRevision: restore.nextPageRevision,
    });
    f.message({ ...restore, type: "activate" });
    expect(activations(f)).toHaveLength(0);
    await visibility(f, true);
    f.message({ ...restore, type: "activate" });
    expect(activations(f)).toHaveLength(1);
  });

  it("records a preference during Agent control without resuming a paused marker", async () => {
    const f = await saved(false);
    f.target.annotationAllowed = false;
    f.host.revalidateView("view-1");
    const paused = last(f);
    await visibility(f, true);
    expect(last(f)).toBe(paused);
    f.message({ ...paused, token: paused.nextToken, type: "activate" });
    expect(activations(f)).toHaveLength(0);
    f.target.annotationAllowed = true;
    f.host.revalidateView("view-1");
    const restore = last(f);
    expect(restore).toMatchObject({
      type: "restore-marker",
      markersVisible: true,
    });
    f.message({
      ...restore,
      type: "marker-restored",
      pageRevision: restore.nextPageRevision,
    });
    f.message({ ...restore, type: "activate" });
    expect(activations(f)).toHaveLength(1);
  });

  it("forgets the preference only when the native owner is retired", async () => {
    const f = await saved(false);
    f.host.cancelView("view-1", "owner");
    const session = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    const pending = f.capture(session.annotationId);
    f.ready(source);
    await pending;
    expect(last(f)).toMatchObject({ type: "retain", markersVisible: true });
  });

  it("rejects malformed arguments and foreign native windows without sending a page command", async () => {
    const f = await saved();
    const count = f.frame.send.mock.calls.length;
    for (const args of [
      { tabId: "tab-1", visible: "false" },
      { tabId: "tab-1", visible: false, annotationId: "other" },
      { tabId: "other", visible: false },
    ])
      await expect(
        f.invoke("browser_tab_set_annotation_markers", args),
      ).rejects.toThrow();
    await expect(
      f.host.invoke(
        { ...f.window, id: 12 } as never,
        "browser_tab_set_annotation_markers",
        { tabId: "tab-1", visible: false },
      ),
    ).rejects.toThrow("owner mismatch");
    expect(f.frame.send.mock.calls).toHaveLength(count);
  });
});
