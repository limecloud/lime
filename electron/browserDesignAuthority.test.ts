// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixture, selection } from "./browserAnnotationHost.testFixture";

describe("design preview native authority", () => {
  it("requires the captured tab/frame/page identity and user availability", async () => {
    const f = fixture();
    const session = await f.start();
    const source = selection();
    const snapshot = {
      elementTagName: "button",
      declarations: [
        { property: "color", value: "black", previousValue: "black" },
      ],
    };
    f.message({
      type: "selection",
      selection: source,
      designSnapshot: snapshot,
    });
    const capture = f.capture(session.annotationId);
    f.ready(source);
    await capture;
    const designChange = {
      declarations: [
        { property: "color", value: "red", previousValue: "black" },
      ],
    };
    const event = {
      ...session,
      action: "change" as const,
      revision: 1,
      designChange,
    };
    f.frame.send.mockClear();
    for (const wrong of [
      { tabId: "other" },
      { threadId: "other" },
      { pageRevision: session.pageRevision + 1 },
      { webContentsId: 999 },
    ])
      f.host.previewDesign({ ...event, ...wrong });
    expect(f.frame.send).not.toHaveBeenCalled();
    f.host.previewDesign(event);
    expect(f.frame.send).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        type: "design-preview",
        change: designChange,
        documentToken: "document-1",
      }),
    );
    f.hide();
    f.host.revalidateView("view-1");
    f.frame.send.mockClear();
    f.host.previewDesign({ ...event, revision: 2 });
    expect(f.frame.send).not.toHaveBeenCalled();
  });
});
