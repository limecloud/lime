import { act } from "react";
import { expect, it } from "vitest";
import {
  api,
  selected,
  setup,
  screen,
  fireEvent,
  waitFor,
  editorEvent,
} from "./browserAnnotationHook.testFixture";

it.each(["save", "send"] as const)(
  "applies the first Design %s screenshot before closing or canonical send",
  async (action) => {
    const { drafts, runtime } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
    await waitFor(() => expect(api.begin).toHaveBeenCalled());
    await act(async () => {
      api.selection!({
        ...selected,
        designSnapshot: {
          elementTagName: "h1",
          declarations: [
            { property: "color", value: "black", previousValue: "black" },
          ],
          text: { previousValue: "Example", value: "Example" },
        },
      });
    });
    await waitFor(() => expect(api.show).toHaveBeenCalled());
    const capture = {
      ...drafts.get(selected.annotationId)!.capture,
      screenshotStatus: "captured" as const,
      failureReason: null,
      screenshot: {
        dataUrl: "data:image/png;base64,bmV3",
        width: 800,
        height: 600,
        kind: "viewport" as const,
        viewportSize: { width: 800, height: 600 },
      },
    };
    await act(async () => {
      api.editor!({
        ...editorEvent(action, "", 1),
        designChange: {
          declarations: [],
          text: { previousValue: "Example", value: "Preview" },
        },
        capture,
      });
    });
    expect(drafts.get(selected.annotationId)!.capture).toEqual(capture);
    expect(drafts.get(selected.annotationId)!.designChange?.text?.value).toBe(
      "Preview",
    );
    if (action === "send")
      await waitFor(() => expect(runtime.send).toHaveBeenCalledTimes(1));
    else expect(runtime.send).not.toHaveBeenCalled();
  },
);

it("blocks a stale first send, keeps the draft without old pixels, and releases editor pending state", async () => {
  const { drafts, runtime } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => {
    api.selection!(selected);
  });
  await waitFor(() => expect(api.show).toHaveBeenCalled());
  await act(async () => {
    api.editor!({
      ...editorEvent("send"),
      capture: {
        ...drafts.get(selected.annotationId)!.capture,
        screenshot: null,
        screenshotStatus: "stale",
        failureReason: "page-changed",
      },
    });
  });
  expect(runtime.send).not.toHaveBeenCalled();
  expect(drafts.get(selected.annotationId)!.capture.screenshot).toBeNull();
  expect(api.update).toHaveBeenCalledWith(
    selected.tabId,
    expect.any(String),
    5,
    false,
    true,
  );
});
