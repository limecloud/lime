// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  begin,
  button,
  command,
  messages,
  pointer,
} from "./browserPagePreload.testFixture";

function setup() {
  command({ ...begin, kind: "element" });
  pointer("pointerdown", 120, 140);
  pointer("pointerup", 120, 140);
  const selected = messages("selection")[0];
  command({ ...selected, type: "prepare", requestId: "initial" });
  command({ ...selected, type: "retain", requestId: "initial" });
  const change = {
    declarations: [],
    text: { previousValue: "Save", value: "Preview" },
  };
  command({ ...selected, type: "design-preview", change });
  return { selected, change };
}
describe("Design capture private page preparation", () => {
  it("captures the preview during original hold and restores the latest preference", () => {
    const { selected, change } = setup();
    command({ ...selected, type: "design-original", original: true });
    expect(button.textContent).toBe("Save");
    command({
      ...selected,
      type: "prepare-design-capture",
      requestId: "new",
      change,
    });
    expect(button.textContent).toBe("Preview");
    expect(messages("ready").at(-1)).toMatchObject({
      requestId: "new",
      status: "ready",
      selection: { targetText: "Save changes" },
    });
    command({ ...selected, type: "design-original", original: false });
    command({ ...selected, type: "clear-design-capture", requestId: "new" });
    expect(button.textContent).toBe("Preview");
    command({ ...selected, type: "design-original", original: true });
    command({
      ...selected,
      type: "prepare-design-capture",
      requestId: "next",
      change,
    });
    command({ ...selected, type: "clear-design-capture", requestId: "old" });
    expect(button.textContent).toBe("Preview");
    command({ ...selected, type: "clear-design-capture", requestId: "next" });
    expect(button.textContent).toBe("Save");
  });
  it("does not ACK after a later preview or pause between the two painted frames", () => {
    const { selected, change } = setup();
    const frames: ((time: number) => void)[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (time: number) => void) => {
        frames.push(callback);
        return frames.length;
      },
    );
    command({
      ...selected,
      type: "prepare-design-capture",
      requestId: "late",
      change,
    });
    frames.shift()!(0);
    command({ ...selected, type: "design-preview", change: null });
    frames.shift()!(0);
    expect(
      messages("ready").filter((value) => value.requestId === "late"),
    ).toEqual([]);
    expect(button.textContent).toBe("Save");
  });
});
