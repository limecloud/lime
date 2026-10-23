// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  begin,
  command,
  messages,
  pointer,
} from "./browserPagePreload.testFixture";

const keyboard = vi.hoisted(() => ({
  key: undefined as ((event: KeyboardEvent) => void) | undefined,
}));
vi.mock("./browserAnnotationKeyboard", async (original) => ({
  ...(await original<typeof import("./browserAnnotationKeyboard")>()),
  watchAnnotationKeyboard: (key: (event: KeyboardEvent) => void) => {
    keyboard.key = key;
    return () => undefined;
  },
}));
const key = (overrides: Partial<KeyboardEvent> = {}) => {
  const event = {
    isTrusted: true,
    type: "keydown",
    code: "Space",
    key: " ",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    composedPath: () => [document.body],
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
  keyboard.key!(event);
  return event;
};
const resume = (overrides: Record<string, unknown> = {}) =>
  command({
    ...begin,
    documentToken: messages("began")[0].documentToken,
    type: "resume",
    ...overrides,
  });

describe("isolated page transient annotation input", () => {
  it("reports real Space state and resets through the exact native resume command", () => {
    command({ ...begin, kind: "element" });
    key();
    expect(messages("input-state").at(-1)).toMatchObject({
      suspended: true,
      addModifierPressed: false,
    });
    resume({ documentToken: "old-document" });
    expect(messages("input-state").at(-1)?.suspended).toBe(true);
    resume();
    expect(messages("input-state").at(-1)).toMatchObject({
      suspended: false,
      addModifierPressed: false,
    });
    key({ type: "keyup" });
    expect(messages("input-state").at(-1)?.suspended).toBe(false);
  });

  it.each([
    ["MacIntel", { metaKey: true }, { ctrlKey: true }],
    ["Win32", { ctrlKey: true }, { metaKey: true }],
  ])(
    "uses only the platform add modifier on %s and releases it on resume",
    (platform, primary, other) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      command({ ...begin, kind: "element" });
      key({ code: "KeyA", ...other });
      expect(messages("input-state")).toHaveLength(0);
      key({ code: "KeyA", ...primary });
      expect(messages("input-state").at(-1)?.addModifierPressed).toBe(true);
      resume();
      expect(messages("input-state").at(-1)?.addModifierPressed).toBe(false);
    },
  );

  it("ignores synthetic input and never updates picker state after selection", () => {
    command({ ...begin, kind: "element" });
    key({ isTrusted: false });
    key({
      isTrusted: false,
      code: "ControlLeft",
      ctrlKey: true,
      metaKey: true,
    });
    expect(messages("input-state")).toHaveLength(0);
    pointer("pointerdown", 120, 140);
    pointer("pointerup", 120, 140);
    key({ code: "ControlLeft", ctrlKey: true, metaKey: true });
    key();
    expect(messages("input-state")).toHaveLength(0);
    expect(messages("selection")).toHaveLength(1);
  });
});
