import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  getRegisteredCommands,
  registerCommand,
  runCommand,
} from "@/lib/commands/registry";
const api = vi.hoisted(() => ({
  available: true,
  listener: null as null | ((request: { requestId: string }) => void),
  listen: vi.fn(),
  respond: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  stop: vi.fn(),
}));
vi.mock("@/lib/api/windowCloseConfirmation", () => ({
  canCloseWindow: () => api.available,
  listenWindowCloseConfirmation: (handler: typeof api.listener) => {
    api.listener = handler;
    return api.listen();
  },
  respondWindowCloseConfirmation: api.respond,
  requestWindowClose: api.close,
}));
import { WindowCloseConfirmationDialogHost } from "./WindowCloseConfirmationDialogHost";
let root: Root, container: HTMLDivElement;
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
};
beforeEach(async () => {
  vi.clearAllMocks();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
  api.available = true;
  api.listen.mockResolvedValue(api.stop);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
describe("window close AppShell integration", () => {
  it("closes through the gateway only when the existing tab owner does not handle Close", async () => {
    act(() => root.render(<WindowCloseConfirmationDialogHost />));
    await settle();
    const closeTab = vi.fn();
    const stop = registerCommand({
      id: "closeTab",
      titleKey: "tab",
      section: "panels",
      bindings: [],
      handler: closeTab,
    });
    expect(runCommand("closeWindow")).toBe(true);
    expect(closeTab).toHaveBeenCalledOnce();
    expect(api.close).not.toHaveBeenCalled();
    stop();
    runCommand("closeWindow");
    expect(api.close).toHaveBeenCalledOnce();
  });
  it("renders one request and responds once with the originating token", async () => {
    act(() => root.render(<WindowCloseConfirmationDialogHost />));
    await settle();
    act(() => {
      api.listener?.({ requestId: "first" });
      api.listener?.({ requestId: "duplicate" });
    });
    await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    act(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] button[type="button"]:not([role="checkbox"])',
        )!
        .click(),
    );
    await settle();
    expect(api.respond).toHaveBeenCalledExactlyOnceWith({
      requestId: "first",
      confirmed: false,
      doNotAskAgain: false,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("unmount cancels a pending request and a late subscription is immediately released", async () => {
    let resolve!: (stop: () => void) => void;
    api.listen.mockReturnValueOnce(
      new Promise<() => void>((done) => {
        resolve = done;
      }),
    );
    act(() => root.render(<WindowCloseConfirmationDialogHost />));
    act(() => api.listener?.({ requestId: "pending" }));
    act(() => root.render(null));
    expect(api.respond).toHaveBeenCalledExactlyOnceWith({
      requestId: "pending",
      confirmed: false,
      doNotAskAgain: false,
    });
    resolve(api.stop);
    await settle();
    expect(api.stop).toHaveBeenCalledOnce();
    expect(runCommand("closeWindow")).toBe(false);
  });
  it("does not advertise native Close in a browser without the Host", async () => {
    api.available = false;
    api.listen.mockReturnValueOnce(null);
    act(() => root.render(<WindowCloseConfirmationDialogHost />));
    await settle();
    expect(
      getRegisteredCommands().find((command) => command.id === "closeWindow"),
    ).toBeUndefined();
    expect(runCommand("closeWindow")).toBe(false);
  });
});
