// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  begin,
  button,
  command,
  messages,
  pointer,
} from "./browserPagePreload.testFixture";

describe("private page design integration", () => {
  it("keeps marker visibility independent, and original reveals the real nodes without discarding changes", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    const nodes = Array.from(button.childNodes);
    command({ ...selected, type: "prepare", requestId: "capture" });
    command({
      ...selected,
      type: "retain",
      requestId: "capture",
      markersVisible: false,
    });
    command({
      ...selected,
      type: "design-preview",
      change: {
        declarations: [],
        text: { previousValue: "Save", value: "Preview" },
      },
    });
    expect(button.textContent).toBe("Preview");
    command({ ...selected, type: "set-marker-visibility", visible: false });
    expect(button.textContent).toBe("Preview");
    for (const invalid of [
      { token: "old" },
      { documentToken: "old" },
      { pageRevision: 42 },
    ]) {
      command({
        ...selected,
        type: "design-original",
        original: true,
        ...invalid,
      });
      expect(button.textContent).toBe("Preview");
    }
    command({ ...selected, type: "design-original", original: true });
    expect(Array.from(button.childNodes)).toEqual(nodes);
    command({
      ...selected,
      type: "design-preview",
      change: {
        declarations: [],
        text: { previousValue: "Save", value: "New preview" },
      },
    });
    expect(button.textContent).toBe("Save");
    command({ ...selected, type: "design-original", original: false });
    expect(button.textContent).toBe("New preview");
  });
  it("keeps CSS/text previews on the captured element and revokes them on pause/cancel", () => {
    command({ ...begin, kind: "element" });
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    const selected = messages("selection")[0];
    expect(selected.designSnapshot.text).toEqual({
      previousValue: "Save",
      value: "Save",
    });
    command({ ...selected, type: "prepare", requestId: "capture" });
    command({ ...selected, type: "retain", requestId: "capture" });
    const change = {
      declarations: [],
      text: { previousValue: "Save", value: "Preview" },
    };
    for (const invalid of [
      { token: "wrong" },
      { documentToken: "wrong" },
      { pageRevision: 2 },
    ])
      command({ ...selected, type: "design-preview", change, ...invalid });
    expect(button.textContent).toBe("Save");
    command({ ...selected, type: "design-preview", change });
    expect(button.textContent).toBe("Preview");
    command({ ...selected, type: "hide-marker", nextToken: "fresh" });
    expect(button.textContent).toBe("Save");
    command({ ...selected, type: "design-preview", change });
    expect(button.textContent).toBe("Save");
    command({
      ...selected,
      token: "fresh",
      type: "restore-marker",
      nextPageRevision: 5,
      markersVisible: true,
    });
    expect(button.textContent).toBe("Preview");
    command({ ...selected, token: "fresh", pageRevision: 5, type: "cancel" });
    expect(button.textContent).toBe("Save");
    expect(
      button
        .getAttributeNames()
        .filter((name) => name.startsWith("data-browser-design-")),
    ).toEqual([]);
  });
});
