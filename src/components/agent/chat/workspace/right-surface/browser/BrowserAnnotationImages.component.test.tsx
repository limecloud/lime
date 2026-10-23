import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/components/input-kit/composerEditor.testUtils";
import type {
  BrowserAnnotationEditorBridge,
  BrowserAnnotationEditorUpdate,
} from "@/lib/api/browserAnnotationEditorTypes";
import { BrowserAnnotationEditor } from "./BrowserAnnotationEditor";
import { initial, labels } from "./browserAnnotationEditor.testFixture";

const dataUrl = "data:image/png;base64,YWJj";
const image = { id: "saved-image", dataUrl, filename: "saved.png" };
class Reader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  file?: File;
  readAsDataURL(file: File) {
    this.file = file;
    reads.push(this);
  }
  abort() {
    this.onabort?.();
  }
  finish(value = dataUrl) {
    this.result = value;
    this.onload?.();
  }
}
let reads: Reader[];
let root: Root;
let container: HTMLDivElement;
let bridge: BrowserAnnotationEditorBridge;
let receive: (update: BrowserAnnotationEditorUpdate) => void;
function publish(
  presentation: Partial<BrowserAnnotationEditorUpdate["presentation"]> = {},
  generation = initial.generation,
) {
  act(() =>
    receive({
      ...initial,
      generation,
      presentation: { ...initial.presentation, ...presentation },
    }),
  );
}
function editor() {
  return container.querySelector<HTMLElement>('[role="textbox"]')!;
}
function button(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error("Missing button " + label);
  return found;
}
async function transfer(kind: "paste" | "drop", files: File[]) {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(
    event,
    kind === "paste" ? "clipboardData" : "dataTransfer",
    {
      value: {
        files,
        types: ["Files"],
        items: files.map((file) => ({
          kind: "file",
          type: file.type,
          getAsFile: () => file,
        })),
        getData: () => "",
      },
    },
  );
  await act(async () => {
    (kind === "paste"
      ? editor()
      : container.querySelector("section")!
    ).dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
}
async function finish(index: number) {
  await act(async () => reads[index].finish());
}
const file = (name: string) => new File(["abc"], name, { type: "image/png" });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  reads = [];
  vi.stubGlobal("FileReader", Reader);
  bridge = {
    onUpdate: vi.fn((callback) => {
      receive = callback;
      return () => {};
    }),
    ready: vi.fn(),
    resize: vi.fn(),
    act: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<BrowserAnnotationEditor bridge={bridge} />));
  publish();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Browser annotation manual images", () => {
  it("pastes one image once, blocks send during reading, then removes it at a new revision", async () => {
    await transfer("paste", [file("pasted.png")]);
    expect(reads).toHaveLength(1);
    expect(button(labels.send).disabled).toBe(true);
    act(() =>
      editor().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(bridge.act).not.toHaveBeenCalled();
    await finish(0);
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body",
      5,
      [expect.objectContaining({ dataUrl, filename: "pasted.png" })],
      null,
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(button(labels.send).disabled).toBe(false);
    act(() => button(labels.removeImage + ": pasted.png").click());
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body",
      6,
      [],
      null,
    );
  });
  it("preserves successive drop order and text edited while the images are reading", async () => {
    await transfer("drop", [file("first.png")]);
    await transfer("drop", [file("second.png")]);
    expect(reads).toHaveLength(1);
    const text = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(text, "clipboardData", {
      value: {
        files: [],
        items: [],
        getData: (format: string) =>
          format === "text/plain" ? " updated" : "",
      },
    });
    act(() => editor().dispatchEvent(text));
    await finish(0);
    expect(reads).toHaveLength(2);
    expect(button(labels.send).disabled).toBe(true);
    await finish(1);
    expect(bridge.act).toHaveBeenLastCalledWith(
      "change",
      "Initial body updated",
      7,
      [
        expect.objectContaining({ filename: "first.png" }),
        expect.objectContaining({ filename: "second.png" }),
      ],
      null,
    );
  });
  it("does not send a partially read batch after a failure and permits a later retry", async () => {
    await transfer("paste", [file("first.png"), file("failed.png")]);
    await act(async () => {
      reads[0].finish();
      reads[1].onerror?.();
    });
    expect(bridge.act).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      labels.attachmentFailed,
    );
    await transfer("paste", [file("retry.png")]);
    await finish(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => button(labels.save).click());
    expect(bridge.act).toHaveBeenLastCalledWith(
      "save",
      "Initial body",
      5,
      [expect.objectContaining({ filename: "retry.png" })],
      null,
    );
  });
  it.each(["flush", "replace"] as const)(
    "rejects a delayed image after native %s",
    async (action) => {
      await transfer("drop", [file("late.png")]);
      if (action === "flush")
        act(() =>
          window.dispatchEvent(new Event("browser-annotation-editor-flush")),
        );
      else
        publish(
          { editorId: "successor", body: "Next document", attachedImages: [] },
          initial.generation + 1,
        );
      await finish(0);
      expect(
        vi
          .mocked(bridge.act)
          .mock.calls.every(([, , , images]) => images.length === 0),
      ).toBe(true);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );
  it("keeps saved images through preview, restores Composer focus, and lets Escape close the preview first", async () => {
    publish({ attachedImages: [image], revision: 6 });
    act(() => button(labels.previewImage + ": saved.png").click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(editor());
    expect(bridge.act).not.toHaveBeenCalled();
    act(() => button(labels.send).click());
    expect(bridge.act).toHaveBeenCalledExactlyOnceWith(
      "send",
      "Initial body",
      6,
      [image],
      null,
    );
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "uses the real localized attachment controls in %s",
    (locale) => {
      const resources = import.meta.glob<Record<string, string>>(
        "../../../../../../i18n/resources/*/browserAnnotation.json",
        { eager: true, import: "default" },
      );
      const resource =
        resources[
          `../../../../../../i18n/resources/${locale}/browserAnnotation.json`
        ];
      const localized = Object.fromEntries(
        Object.keys(labels).map((key) => [
          key,
          resource["browserAnnotation." + key],
        ]),
      ) as typeof labels;
      publish({ labels: localized, attachedImages: [image], revision: 6 });
      expect(button(localized.previewImage + ": saved.png")).toBeDefined();
      act(() => button(localized.removeImage + ": saved.png").click());
      expect(bridge.act).toHaveBeenCalledExactlyOnceWith(
        "change",
        "Initial body",
        7,
        [],
        null,
      );
    },
  );
});
