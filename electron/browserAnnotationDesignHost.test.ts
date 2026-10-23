import { describe, expect, it, vi } from "vitest";
import {
  BrowserAnnotationDesignHost,
  type BrowserAnnotationDesignEvent,
} from "./browserAnnotationDesignHost";

const snapshot = {
  elementTagName: "button",
  declarations: [{ property: "color", value: "black", previousValue: "black" }],
};
const event: BrowserAnnotationDesignEvent = {
  annotationId: "a",
  browserSessionId: "b",
  threadId: "t",
  tabId: "tab",
  viewId: "view",
  ownerWebContentsId: 1,
  webContentsId: 2,
  windowId: 3,
  pageRevision: 4,
  revision: 0,
  action: "change",
};
const change = {
  declarations: [{ property: "color", value: "red", previousValue: "black" }],
};

describe("annotation design presentation revision", () => {
  it("reverts unsaved previews on close, retains saved groups and refuses late revisions", () => {
    const host = new BrowserAnnotationDesignHost();
    const send = vi.fn();
    host.register("a", snapshot);
    host.receive({ ...event, revision: 1, designChange: change }, send);
    expect(send).toHaveBeenLastCalledWith(change);
    host.receive(
      { ...event, revision: 1, action: "close", designChange: change },
      send,
    );
    expect(send).toHaveBeenLastCalledWith(null);
    host.receive(
      { ...event, revision: 1, action: "save", designChange: change },
      send,
    );
    host.receive(
      {
        ...event,
        revision: 2,
        designChange: {
          declarations: [{ ...change.declarations[0], value: "blue" }],
        },
      },
      send,
    );
    host.receive(
      {
        ...event,
        revision: 2,
        action: "close",
        designChange: {
          declarations: [{ ...change.declarations[0], value: "blue" }],
        },
      },
      send,
    );
    expect(send).toHaveBeenLastCalledWith(change);
    send.mockClear();
    host.receive({ ...event, revision: 1, designChange: change }, send);
    host.receive({ ...event, revision: 2, designChange: change }, send);
    expect(send).not.toHaveBeenCalled();
    host.remove("a");
    host.receive({ ...event, revision: 3, designChange: change }, send);
    expect(send).not.toHaveBeenCalled();
  });
});
