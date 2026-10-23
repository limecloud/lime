// @vitest-environment jsdom
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, vi } from "vitest";
import { installBrowserPageAnnotations } from "./browserPagePreload";
import { installConstructedSheets } from "./browserDesignPreview.testFixture";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
} from "./browserAnnotationModel";

const page = vi.hoisted(() => ({
  ipc: undefined as EventEmitter | undefined,
  send: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  page.ipc = new EventEmitter();
  return {
    ipcRenderer: {
      on: (...args: Parameters<EventEmitter["on"]>) => page.ipc!.on(...args),
      off: (...args: Parameters<EventEmitter["off"]>) => page.ipc!.off(...args),
      send: page.send,
    },
  };
});

let dispose: () => void;
let restoreSheets: () => void;
let button: HTMLButtonElement;
const originalTitle = document.title;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);
const begin = {
  type: "begin",
  annotationId: "annotation-1",
  token: "private-token",
  pageRevision: 3,
};
const command = (payload: Record<string, unknown>) =>
  page.ipc!.emit(
    BROWSER_ANNOTATION_PAGE_COMMAND,
    {},
    {
      ...(["retain", "restore-marker"].includes(String(payload.type))
        ? { markersVisible: true }
        : {}),
      ...payload,
    },
  );
const pointer = (type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  button.dispatchEvent(event);
  return event;
};
const messages = (type: string) =>
  page.send.mock.calls
    .filter(
      (call) =>
        call[0] === BROWSER_ANNOTATION_PAGE_EVENT && call[1].type === type,
    )
    .map((call) => call[1]);
beforeEach(() => {
  restoreSheets = installConstructedSheets();
  page.send.mockClear();
  document.body.innerHTML =
    '<button id="save" aria-label="Save changes">Save</button>';
  document.title = "Test page";
  button = document.querySelector("button")!;
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 120,
    width: 200,
    height: 60,
    top: 120,
    left: 100,
    right: 300,
    bottom: 180,
    toJSON: () => ({}),
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => button),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    callback(0);
    return 1;
  });
  dispose = installBrowserPageAnnotations();
});
afterEach(() => {
  dispose();
  restoreSheets();
  page.ipc!.removeAllListeners();
  document.body.replaceChildren();
  document.title = originalTitle;
  if (originalElementFromPoint) {
    Object.defineProperty(
      document,
      "elementFromPoint",
      originalElementFromPoint,
    );
  } else {
    Reflect.deleteProperty(document, "elementFromPoint");
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

export { page, button, begin, command, pointer, messages, dispose };
