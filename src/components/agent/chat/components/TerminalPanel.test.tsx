import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalTab } from "./TerminalTab";
import { LIME_THEME_CHANGED_EVENT } from "@/lib/appearance/themeMode";

const api = vi.hoisted(() => ({
  exec: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  terminate: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@/lib/api/commandExec", () => ({
  execCommand: api.exec,
  writeCommandExec: api.write,
  resizeCommandExec: api.resize,
  terminateCommandExec: api.terminate,
  subscribeCommandExecOutput: api.subscribe,
}));

const terminals: Terminal[] = [];
class Terminal {
  cols = 80;
  rows = 24;
  options: {
    disableStdin: boolean;
    theme?: { background?: string; foreground?: string };
  };
  onInput: (value: string) => void = () => {};
  keyEvent: (event: KeyboardEvent) => boolean = () => true;
  write = vi.fn();
  writeln = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  refresh = vi.fn();
  inputDispose = vi.fn();
  paste = vi.fn();
  hasSelection = () => false;
  getSelection = () => "";
  loadAddon() {}
  open() {}
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.keyEvent = handler;
  }
  onData(handler: (value: string) => void) {
    this.onInput = handler;
    return { dispose: this.inputDispose };
  }
  constructor(options: Terminal["options"]) {
    this.options = options;
    terminals.push(this);
  }
}
vi.mock("@xterm/xterm", () => ({ Terminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TerminalTab / TerminalPanel current process lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  const processes = new Map<
    string,
    {
      resolve: (value: { exitCode: number }) => void;
      reject: (error: Error) => void;
      output: (delta: { deltaBase64: string }) => void;
      unlisten: ReturnType<typeof vi.fn>;
    }
  >();

  beforeEach(() => {
    vi.clearAllMocks();
    terminals.length = 0;
    processes.clear();
    api.subscribe.mockImplementation((id, output) => {
      const unlisten = vi.fn();
      processes.set(id, {
        output,
        unlisten,
        resolve: vi.fn(),
        reject: vi.fn(),
      });
      return unlisten;
    });
    api.exec.mockImplementation(
      ({ processId }) =>
        new Promise((resolve, reject) => {
          Object.assign(processes.get(processId)!, { resolve, reject });
        }),
    );
    api.write.mockResolvedValue({});
    api.resize.mockResolvedValue({});
    api.terminate.mockResolvedValue({});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.style.removeProperty("--lime-surface");
    document.documentElement.style.removeProperty("--lime-text");
    vi.useRealTimers();
  });
  async function mount(onNewTerminalTab?: () => void) {
    await act(async () =>
      root.render(
        <TerminalTab
          cwd="/workspace"
          sessionId="terminal"
          onNewTerminalTab={onNewTerminalTab}
        />,
      ),
    );
    await vi.waitFor(() => expect(api.exec).toHaveBeenCalledOnce());
    const id = api.exec.mock.calls[0][0].processId as string;
    return { id, terminal: terminals[0], process: processes.get(id)! };
  }

  it("waits for real output before accepting input", async () => {
    const { id, terminal, process } = await mount();
    expect(terminal.options.disableStdin).toBe(true);
    await act(async () => terminal.onInput("too-early\r"));
    expect(api.write).not.toHaveBeenCalled();
    await act(async () => process.output({ deltaBase64: btoa("$ ") }));
    expect(terminal.options.disableStdin).toBe(false);
    await act(async () => terminal.onInput("printf ready\r"));
    expect(api.write).toHaveBeenCalledWith({
      processId: id,
      deltaBase64: btoa("printf ready\r"),
    });
    expect(api.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["/bin/sh", "-i"],
        cwd: "/workspace",
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
      }),
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("runs a configured command in the same process owner and preserves its actual exit", async () => {
    await act(async () =>
      root.render(
        <TerminalTab
          cwd="/worktree/packages/app"
          sessionId="action"
          command="printf 'a b'; exit 7"
        />,
      ),
    );
    await vi.waitFor(() => expect(api.exec).toHaveBeenCalledOnce());
    expect(api.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["/bin/sh", "-c", "printf 'a b'; exit 7"],
        cwd: "/worktree/packages/app",
        tty: true,
      }),
    );
    const { processId } = api.exec.mock.calls[0][0];
    const process = processes.get(processId)!;
    await act(async () => process.output({ deltaBase64: btoa("a b") }));
    expect(terminals[0].write).toHaveBeenCalledWith("a b");
    await act(async () =>
      root.render(
        <TerminalTab
          cwd="/worktree/packages/app"
          sessionId="action"
          command="printf 'a b'; exit 7"
          active={false}
        />,
      ),
    );
    expect(api.exec).toHaveBeenCalledOnce();
    await act(async () => process.resolve({ exitCode: 7 }));
    expect(
      container
        .querySelector('[data-testid="terminal-tab"]')
        ?.getAttribute("data-exit-code"),
    ).toBe("7");
    expect(terminals[0].options.disableStdin).toBe(true);
  });

  it("rejects input and late output after startup fails", async () => {
    const { terminal, process } = await mount();
    await act(async () => process.reject(new Error("spawn failed")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "spawn failed",
    );
    await act(async () => {
      terminal.onInput("late\r");
      process.output({ deltaBase64: btoa("late output") });
    });
    expect(terminal.options.disableStdin).toBe(true);
    expect(api.write).not.toHaveBeenCalled();
    expect(terminal.write).not.toHaveBeenCalled();
    expect(api.exec).toHaveBeenCalledOnce();
  });

  it("disconnects and drops pending input when the real process exits", async () => {
    const { terminal, process } = await mount();
    await act(async () => process.output({ deltaBase64: btoa("$ ") }));
    await act(async () => {
      terminal.onInput("pending");
      process.resolve({ exitCode: 0 });
    });
    expect(terminal.options.disableStdin).toBe(true);
    await act(async () => terminal.onInput("late\r"));
    expect(api.write).not.toHaveBeenCalled();
  });

  it("serializes fast input and flushes Enter without reordering", async () => {
    const { terminal, process } = await mount();
    await act(async () => process.output({ deltaBase64: btoa("$ ") }));
    let finish!: () => void;
    api.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      terminal.onInput("first\r");
      terminal.onInput("second\r");
    });
    expect(api.write).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(
      api.write.mock.calls.map(([request]) => atob(request.deltaBase64)),
    ).toEqual(["first\r", "second\r"]);
    api.write.mockClear();
    await act(async () => {
      terminal.onInput("pri");
      terminal.onInput("ntf");
      terminal.onInput("\r");
    });
    expect(
      api.write.mock.calls.map(([request]) => atob(request.deltaBase64)),
    ).toEqual(["printf\r"]);
  });

  it("changes theme on the existing xterm without restarting the process", async () => {
    const { terminal } = await mount();
    const colors: Record<string, string> = {
      "--lime-surface": "#121212",
      "--lime-text": "#ededed",
    };
    const computed = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (key: string) => colors[key] ?? "",
    } as CSSStyleDeclaration);
    for (const event of [LIME_THEME_CHANGED_EVENT]) {
      await act(async () => window.dispatchEvent(new Event(event)));
      expect(terminal.options.theme).toMatchObject({
        background: "#121212",
        foreground: "#ededed",
      });
    }
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
    expect(api.exec).toHaveBeenCalledOnce();
    expect(api.terminate).not.toHaveBeenCalled();
    computed.mockRestore();
  });

  it("Meta+T delegates to the outer tab owner", async () => {
    const add = vi.fn();
    const { terminal } = await mount(add);
    const event = new KeyboardEvent("keydown", {
      key: "t",
      metaKey: true,
      cancelable: true,
    });
    expect(terminal.keyEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(add).toHaveBeenCalledOnce();
    expect(api.exec).toHaveBeenCalledOnce();
    expect(api.write).not.toHaveBeenCalled();
  });

  it("hides distinct sessions without terminating; close cleans only that session", async () => {
    const render = (active: string, ids = ["first", "second"]) => (
      <>
        {ids.map((id) => (
          <div key={id} hidden={id !== active}>
            <TerminalTab
              cwd="/workspace"
              sessionId={id}
              active={id === active}
            />
          </div>
        ))}
      </>
    );
    await act(async () => root.render(render("first", ["first"])));
    await vi.waitFor(() => expect(api.exec).toHaveBeenCalledTimes(1));
    await act(async () => root.render(render("second")));
    await vi.waitFor(() => expect(api.exec).toHaveBeenCalledTimes(2));
    const firstId = api.exec.mock.calls[0][0].processId;
    const secondId = api.exec.mock.calls[1][0].processId;
    expect(firstId).not.toBe(secondId);
    await act(async () => root.render(render("second")));
    expect(api.exec).toHaveBeenCalledTimes(2);
    expect(api.terminate).not.toHaveBeenCalled();
    await act(async () =>
      processes.get(firstId)!.output({ deltaBase64: btoa("first only") }),
    );
    expect(terminals[0].write).toHaveBeenCalledWith("first only");
    expect(terminals[1].write).not.toHaveBeenCalled();
    await act(async () => root.render(render("second", ["second"])));
    expect(api.terminate).toHaveBeenCalledExactlyOnceWith({
      processId: firstId,
    });
    expect(processes.get(firstId)!.unlisten).toHaveBeenCalledOnce();
    expect(terminals[0].inputDispose).toHaveBeenCalledOnce();
    expect(terminals[0].dispose).toHaveBeenCalledOnce();
    expect(terminals[1].dispose).not.toHaveBeenCalled();
  });
});
