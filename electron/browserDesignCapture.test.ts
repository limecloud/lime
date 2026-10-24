// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fixture, selection } from "./browserAnnotationHost.testFixture";

const snapshot = {
  elementTagName: "button",
  declarations: [{ property: "color", previousValue: "black", value: "black" }],
  text: { previousValue: "Save", value: "Save" },
};
const designChange = {
  declarations: [],
  text: { previousValue: "Save", value: "Preview" },
};
async function setup() {
  const f = fixture();
  const session = await f.start();
  const source = selection();
  f.message({ type: "selection", selection: source, designSnapshot: snapshot });
  const initial = f.capture(session.annotationId);
  f.ready(source);
  await initial;
  const event = {
    ...session,
    editorId: "editor",
    draftId: session.annotationId,
    generation: 1,
    body: "",
    attachedImages: [],
    revision: 1,
    designChange,
    action: "save" as const,
  };
  const ready = (overrides: Record<string, unknown> = {}) => {
    const prepare = [...f.frame.send.mock.calls]
      .reverse()
      .find((call) => call[1].type === "prepare-design-capture")?.[1];
    expect(prepare).toBeDefined();
    f.message({
      type: "ready",
      requestId: prepare.requestId,
      status: "ready",
      selection: {
        ...source,
        viewportSize: { width: 700, height: 500 },
        targetText: "Preview",
      },
      ...overrides,
    });
  };
  return { ...f, event, ready, source };
}

describe("first Design commit screenshot", () => {
  it.each(["save", "send"] as const)(
    "recaptures %s and keeps saved edits on their original screenshot",
    async (action) => {
      const f = await setup();
      const result = f.host.prepareEditorEvent({ ...f.event, action });
      f.ready();
      expect(await result).toMatchObject({
        capture: {
          screenshotStatus: "captured",
          selection: f.source,
          screenshot: { viewportSize: { width: 700, height: 500 } },
        },
      });
      expect(f.webContents.capturePage).toHaveBeenCalledTimes(2);
      expect(f.frame.send).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ type: "clear-design-capture" }),
      );
      const edited = await f.host.prepareEditorEvent({
        ...f.event,
        revision: 2,
        designChange: {
          declarations: [],
          text: { previousValue: "Save", value: "Edited" },
        },
      });
      expect(edited?.capture).toBeUndefined();
      expect(f.webContents.capturePage).toHaveBeenCalledTimes(2);
    },
  );
  it("clears the old screenshot on timeout and never captures a stale revision", async () => {
    const f = await setup();
    const timed = await f.host.prepareEditorEvent(f.event);
    expect(timed?.capture).toMatchObject({
      screenshot: null,
      screenshotStatus: "timeout",
    });
    const g = await setup();
    const pending = g.host.prepareEditorEvent({ ...g.event, action: "send" });
    g.host.previewDesign({
      ...g.event,
      action: "change",
      revision: 2,
      designChange: null,
    });
    g.ready();
    expect((await pending)?.capture?.screenshotStatus).toBe("stale");
    expect(g.webContents.capturePage).toHaveBeenCalledTimes(1);
  });
  it("rejects navigation, takeover, and malformed ready geometry without accepting old pixels", async () => {
    for (const invalidate of [
      (f: Awaited<ReturnType<typeof setup>>) => {
        f.target.identity.pageRevision++;
      },
      (f: Awaited<ReturnType<typeof setup>>) => {
        f.target.annotationAllowed = false;
      },
      (f: Awaited<ReturnType<typeof setup>>) => {
        f.ready({
          selection: { ...f.source, viewportSize: { width: -1, height: 1 } },
        });
      },
    ]) {
      const f = await setup();
      const pending = f.host.prepareEditorEvent(f.event);
      invalidate(f);
      expect((await pending)?.capture?.screenshot).toBeNull();
      expect(f.webContents.capturePage).toHaveBeenCalledTimes(1);
    }
  });
  it("does not recapture a plain first save or a foreign editor identity", async () => {
    const f = await setup();
    expect(
      (await f.host.prepareEditorEvent({ ...f.event, designChange: null }))
        ?.capture,
    ).toBeUndefined();
    expect(
      (await f.host.prepareEditorEvent({ ...f.event, revision: 2 }))?.capture,
    ).toBeUndefined();
    expect(
      await f.host.prepareEditorEvent({ ...f.event, tabId: "other" }),
    ).toBeNull();
    expect(f.webContents.capturePage).toHaveBeenCalledTimes(1);
  });

  it("drops pixels when a newer revision arrives during capturePage and preserves the final trusted close flush", async () => {
    const f = await setup();
    let resolve!: (value: typeof f.screenshot) => void;
    f.webContents.capturePage.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.host.prepareEditorEvent({ ...f.event, action: "send" });
    f.ready();
    await vi.waitFor(() =>
      expect(f.webContents.capturePage).toHaveBeenCalledTimes(2),
    );
    f.host.previewDesign({
      ...f.event,
      action: "change",
      revision: 2,
      designChange: null,
    });
    resolve(f.screenshot);
    expect((await pending)?.capture).toMatchObject({
      screenshotStatus: "stale",
      screenshot: null,
    });
    f.host.cancelView(f.event.viewId, "navigation");
    const close = {
      ...f.event,
      action: "close" as const,
      body: "Final body",
      revision: 3,
    };
    expect(await f.host.prepareEditorEvent(close)).toEqual(close);
  });
});
