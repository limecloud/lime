// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createAnnotationEditorRelay } from "./browserAnnotationEditorRelay";
import type { BrowserAnnotationEditorEvent } from "../src/lib/api/browserAnnotationEditorTypes";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";

const event: BrowserAnnotationEditorEvent & BrowserAnnotationIdentity = {
  browserSessionId: "b",
  threadId: "t",
  tabId: "tab",
  viewId: "view",
  windowId: 1,
  ownerWebContentsId: 2,
  webContentsId: 3,
  pageRevision: 1,
  editorId: "editor",
  annotationId: "a",
  draftId: "a",
  generation: 1,
  revision: 2,
  action: "save",
  body: "",
  attachedImages: [],
};
it("processes new revisions immediately but delivers save before its synchronous close", async () => {
  let resolve!: (value: typeof event) => void;
  const pending = new Promise<typeof event>((done) => {
    resolve = done;
  });
  const prepare = vi.fn((value) =>
    value.action === "save" ? pending : Promise.resolve(value),
  );
  const emit = vi.fn();
  const relay = createAnnotationEditorRelay(prepare, emit);
  relay(event);
  relay({ ...event, action: "close" });
  relay({ ...event, editorId: "independent", action: "change" });
  expect(prepare).toHaveBeenCalledTimes(3);
  await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
  expect(emit.mock.calls[0][0].editorId).toBe("independent");
  resolve(event);
  await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(3));
  expect(emit.mock.calls.slice(1).map((call) => call[0].action)).toEqual([
    "save",
    "close",
  ]);
});
it("finishes the queue after a rejected capture instead of suppressing the final flush", async () => {
  const emit = vi.fn();
  const relay = createAnnotationEditorRelay(
    (value) =>
      value.action === "save"
        ? Promise.reject(new Error("retired"))
        : Promise.resolve(value),
    emit,
  );
  relay(event);
  relay({ ...event, action: "close" });
  await vi.waitFor(() =>
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "close" }),
    ),
  );
});
