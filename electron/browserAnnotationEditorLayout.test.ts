// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  native,
  fixture,
  message,
  presentation,
} from "./browserAnnotationEditorHost.testFixture";
import { BrowserAnnotationEditorHost } from "./browserAnnotationEditorHost";
import { BROWSER_ANNOTATION_EDITOR_UPDATE } from "../src/lib/api/browserAnnotationEditorTypes";

describe("native annotation content sizing", () => {
  it("resizes around the same anchor without changing the draft, capture or action state", async () => {
    const f = fixture();
    let finishLoad = () => {};
    native.nextLoad = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    const showing = f.show();
    const view = native.views[0];
    const original = view.setBounds.mock.calls.at(-1)![0];
    message(view, { kind: "resize", height: 140 });
    expect(view.setBounds).toHaveBeenCalledTimes(1);
    finishLoad();
    await showing;
    message(view, { kind: "ready" });
    expect(view.webContents.send.mock.calls.at(-1)?.[1].layout).toEqual({
      width: 360,
      maxHeight: 584,
    });
    message(view, { kind: "resize", height: 140 });
    expect(view.setBounds).toHaveBeenLastCalledWith({
      ...original,
      y: 460,
      height: 140,
    });
    message(view, { kind: "resize", height: 20_000 });
    expect(view.setBounds).toHaveBeenLastCalledWith({
      ...original,
      y: 16,
      height: 584,
    });
    expect(f.events).toEqual([]);
    message(view, {
      kind: "action",
      action: "save",
      body: "Comment",
      revision: 1,
    });
    expect(f.events[0]).toMatchObject({
      action: "save",
      body: "Comment",
      revision: 1,
    });
  });

  it("rejects forged sender/frame/token/generation, extra fields and invalid height", async () => {
    const f = fixture();
    await f.show();
    const view = native.views[0];
    message(view, { kind: "ready" });
    const before = view.setBounds.mock.calls.length;
    for (const fields of [
      { height: 0 },
      { height: -1 },
      { height: 10.5 },
      { height: NaN },
      { height: Infinity },
      { height: 20_001 },
      { height: 160, x: 0 },
      { height: 160, token: "forged" },
      { height: 160, generation: 100 },
      { height: 160, editorId: "other" },
    ])
      message(view, { kind: "resize", ...fields });
    message(view, { kind: "resize", height: 160 }, {});
    const other = fixture(false, 2);
    message(
      view,
      { kind: "resize", height: 160 },
      view.webContents.mainFrame,
      other.owner as never,
    );
    expect(view.setBounds).toHaveBeenCalledTimes(before);
    f.host.hideWindow(f.window.id, "hidden");
    message(view, { kind: "resize", height: 160 });
    expect(view.setBounds).toHaveBeenCalledTimes(before);
  });

  it("keeps measured height through anchor movement and publishes new native constraints", async () => {
    const f = fixture();
    if (!(f.host instanceof BrowserAnnotationEditorHost))
      throw new Error("Expected editor host");
    await f.show();
    const view = native.views[0];
    message(view, { kind: "ready" });
    message(view, { kind: "resize", height: 160 });
    vi.spyOn(f.window, "getContentBounds").mockReturnValue({
      x: 0,
      y: 0,
      width: 330,
      height: 300,
    });
    const anchor = {
      ...presentation().selection,
      targetRect: { x: 10, y: 20, width: 30, height: 40 },
    };
    f.host.position(f.identity, "annotation-1", anchor, {
      x: 0,
      y: 0,
      width: 330,
      height: 300,
    });
    expect(view.setBounds.mock.calls.at(-1)?.[0]).toMatchObject({
      width: 314,
      height: 160,
    });
    expect(view.webContents.send.mock.calls.at(-1)).toEqual([
      BROWSER_ANNOTATION_EDITOR_UPDATE,
      expect.objectContaining({
        layout: { width: 314, maxHeight: 284 },
        presentation: expect.objectContaining({ body: "", revision: 0 }),
      }),
    ]);
    const bounds = view.setBounds.mock.calls.at(-1)![0];
    f.host.position(f.identity, "annotation-1", anchor, {
      x: -1,
      y: 0,
      width: 330,
      height: 300,
    });
    message(view, { kind: "resize", height: 160 });
    expect(view.setBounds).toHaveBeenLastCalledWith(bounds);
    message(view, { kind: "resize", height: 284 });
    expect(view.setBounds.mock.calls.at(-1)?.[0]).toMatchObject({
      width: 314,
      height: 284,
      y: 12,
    });
    message(view, { kind: "resize", height: 160 });
    expect(view.setBounds).toHaveBeenLastCalledWith(bounds);
  });

  it("does not resize replaced or closing editors, including while waiting for final flush", async () => {
    const f = fixture();
    await f.show();
    const old = native.views[0];
    message(old, { kind: "ready" });
    await f.show(presentation("editor-two"));
    const current = native.views[1];
    message(current, { kind: "ready" });
    message(old, { kind: "resize", height: 140 });
    expect(old.setBounds).toHaveBeenCalledTimes(1);
    expect(current.setBounds).toHaveBeenCalledTimes(1);
    f.host.hideWindow(f.window.id, "hidden");
    message(current, { kind: "resize", height: 140 });
    expect(current.setBounds).toHaveBeenCalledTimes(1);
  });
});
