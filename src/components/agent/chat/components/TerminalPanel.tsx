import React from "react";
import { agentText } from "./harnessPanelText";
import { LIME_THEME_CHANGED_EVENT } from "@/lib/appearance/themeMode";
import { readTerminalTheme } from "./terminalTheme";
import { handleTerminalKeyEvent } from "./terminalKeyboard";
import {
  execCommand,
  resizeCommandExec,
  subscribeCommandExecOutput,
  terminateCommandExec,
  writeCommandExec,
} from "@/lib/api/commandExec";
import "@xterm/xterm/css/xterm.css";

type XTermTerminal = import("@xterm/xterm").Terminal;
type XTermDisposable = ReturnType<XTermTerminal["onData"]>;
type XTermFitAddon = import("@xterm/addon-fit").FitAddon;
export interface TerminalState {
  errorText: string | null;
  ready: boolean;
  exitCode: number | null;
}

interface TerminalPanelProps {
  active: boolean;
  cwd?: string | null;
  command?: string;
  sessionId: string;
  onNewTerminalTab?: () => void;
  onStateChange: (state: Partial<TerminalState>) => void;
}

const FALLBACK_COLS = 120;
const FALLBACK_ROWS = 14;
const INPUT_FLUSH_DELAY_MS = 8;

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TerminalPanel({
  active,
  cwd,
  command,
  sessionId,
  onNewTerminalTab,
  onStateChange,
}: TerminalPanelProps) {
  const normalizedCwd = cwd?.trim() || null;
  const terminalContainerRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<XTermTerminal | null>(null);
  const fitAddonRef = React.useRef<XTermFitAddon | null>(null);
  const processIdRef = React.useRef<string | null>(null);
  const connectedRef = React.useRef(false);
  const writeQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const terminalSizeRef = React.useRef({
    cols: FALLBACK_COLS,
    rows: FALLBACK_ROWS,
  });

  const patchState = onStateChange;
  const newTerminalRef = React.useRef(onNewTerminalTab);
  newTerminalRef.current = onNewTerminalTab;

  const fitTerminal = React.useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    fitTerminalToContainer({
      terminal,
      fitAddon,
      processIdRef,
      terminalSizeRef,
    });
  }, []);

  const writeShellData = React.useCallback((data: string) => {
    const processId = processIdRef.current;
    if (!processId || !connectedRef.current) return;
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (processIdRef.current !== processId || !connectedRef.current) return;
        await writeCommandExec({
          processId,
          deltaBase64: encodeBase64(data),
        });
      })
      .catch((error) => {
        terminalRef.current?.writeln(
          `\r\n${agentText(
            "agentChat.terminal.writeFailed",
            "写入 Shell 失败：{{message}}",
            { message: extractErrorMessage(error) },
          )}`,
        );
      });
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let terminal: XTermTerminal | null = null;
    let fitAddon: XTermFitAddon | null = null;
    let inputDisposable: XTermDisposable | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let unlisten: (() => void) | null = null;
    let processIdForBoot: string | null = null;
    let pendingInput = "";
    let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushPendingInput() {
      if (inputFlushTimer) {
        clearTimeout(inputFlushTimer);
        inputFlushTimer = null;
      }
      const data = pendingInput;
      pendingInput = "";
      if (data && !disposed) writeShellData(data);
    }

    function scheduleInputFlush() {
      if (!inputFlushTimer) {
        inputFlushTimer = setTimeout(flushPendingInput, INPUT_FLUSH_DELAY_MS);
      }
    }

    async function bootShell() {
      const container = terminalContainerRef.current;
      if (!container) return;
      patchState({
        errorText: null,
        ready: false,
        exitCode: null,
      });
      if (!normalizedCwd) {
        patchState({
          errorText: agentText(
            "agentChat.terminal.noProjectRoot",
            "当前项目缺少本地目录",
          ),
        });
        return;
      }

      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        if (disposed) return;
        terminal = new Terminal({
          cols: FALLBACK_COLS,
          rows: FALLBACK_ROWS,
          cursorBlink: true,
          convertEol: true,
          disableStdin: true,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.35,
          scrollback: 2000,
          theme: readTerminalTheme(container),
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        terminal.open(container);
        terminal.attachCustomKeyEventHandler((event) =>
          handleTerminalKeyEvent({
            event,
            terminal: terminal!,
            onNewTerminalTab: () => newTerminalRef.current?.(),
            sendText: writeShellData,
          }),
        );
        fitTerminalToContainer({
          terminal,
          fitAddon,
          processIdRef,
          terminalSizeRef,
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() =>
            fitTerminalToContainer({
              terminal: terminal!,
              fitAddon: fitAddon!,
              processIdRef,
              terminalSizeRef,
            }),
          );
          resizeObserver.observe(container);
        }

        const processId = createProcessId();
        processIdForBoot = processId;
        processIdRef.current = processId;
        const shell = resolveTerminalCommand(command);
        const decoder = new TextDecoder();
        unlisten = subscribeCommandExecOutput(processId, (delta) => {
          if (disposed || processIdRef.current !== processId) return;
          const output = decoder.decode(decodeBytes(delta.deltaBase64), {
            stream: true,
          });
          if (output && !connectedRef.current) {
            connectedRef.current = true;
            terminal!.options.disableStdin = false;
            patchState({
              ready: true,
            });
          }
          terminal?.write(output);
        });
        const size = terminalSizeRef.current;
        const disconnect = () => {
          connectedRef.current = false;
          if (processIdRef.current === processId) processIdRef.current = null;
          terminal!.options.disableStdin = true;
          if (inputFlushTimer) clearTimeout(inputFlushTimer);
          pendingInput = "";
        };
        void execCommand({
          command: shell,
          processId,
          tty: true,
          streamStdin: true,
          streamStdoutStderr: true,
          disableOutputCap: true,
          disableTimeout: true,
          cwd: normalizedCwd,
          size,
        })
          .then((result) => {
            if (disposed) return;
            disconnect();
            terminal?.write(decoder.decode());
            terminal?.writeln(
              `\r\n${agentText(
                "agentChat.terminal.exited",
                "Shell 已退出：{{code}}",
                { code: result.exitCode },
              )}`,
            );
            patchState({
              ready: false,
              exitCode: result.exitCode,
            });
          })
          .catch((error) => {
            if (disposed) return;
            disconnect();
            const message = extractErrorMessage(error);
            patchState({
              ready: false,
              errorText: message,
            });
            terminal?.writeln(
              `\r\n${agentText(
                "agentChat.terminal.startFailed",
                "Shell 启动失败：{{message}}",
                { message },
              )}`,
            );
          });

        inputDisposable = terminal.onData((data) => {
          if (!connectedRef.current) return;
          pendingInput += data;
          if (data.includes("\r") || data.includes("\n")) {
            flushPendingInput();
          } else {
            scheduleInputFlush();
          }
        });
      } catch (error) {
        if (disposed) return;
        const message = extractErrorMessage(error);
        patchState({
          errorText: message,
          ready: false,
        });
      }
    }

    void bootShell();
    return () => {
      disposed = true;
      connectedRef.current = false;
      unlisten?.();
      inputDisposable?.dispose();
      if (inputFlushTimer) clearTimeout(inputFlushTimer);
      pendingInput = "";
      resizeObserver?.disconnect();
      if (processIdForBoot && processIdRef.current === processIdForBoot) {
        processIdRef.current = null;
        void terminateCommandExec({ processId: processIdForBoot }).catch(
          () => undefined,
        );
      }
      terminal?.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
    };
  }, [normalizedCwd, command, sessionId, patchState, writeShellData]);

  React.useEffect(() => {
    const updateTheme = () => {
      const terminal = terminalRef.current;
      const container = terminalContainerRef.current;
      if (!terminal || !container) return;
      terminal.options.theme = readTerminalTheme(container);
      if (terminal.rows > 0) terminal.refresh(0, terminal.rows - 1);
    };
    window.addEventListener(LIME_THEME_CHANGED_EVENT, updateTheme);
    return () => {
      window.removeEventListener(LIME_THEME_CHANGED_EVENT, updateTheme);
    };
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const animationFrame = requestAnimationFrame(() => {
      fitTerminal();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [active, fitTerminal]);

  return (
    <div
      id={`terminal-panel-${sessionId}`}
      className="relative flex h-full w-full flex-col bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
      data-active={active ? "true" : "false"}
      data-testid="terminal-panel"
      onClick={() => terminalRef.current?.focus()}
    >
      <div className="min-h-0 flex-1 overflow-hidden ps-4 pt-2 pb-3 tracking-normal">
        <div
          ref={terminalContainerRef}
          className="h-full w-full overflow-hidden [&_.xterm-screen]:outline-none [&_.xterm_.xterm-viewport]:bg-[color:var(--lime-surface)] [&_.xterm]:h-full [&_.xterm]:w-full"
          data-testid="terminal-xterm"
        />
      </div>
    </div>
  );
}

function fitTerminalToContainer({
  terminal,
  fitAddon,
  processIdRef,
  terminalSizeRef,
}: {
  terminal: XTermTerminal;
  fitAddon: XTermFitAddon;
  processIdRef: React.MutableRefObject<string | null>;
  terminalSizeRef: React.MutableRefObject<{ cols: number; rows: number }>;
}) {
  try {
    fitAddon.fit();
  } catch {
    return;
  }
  const cols = terminal.cols || FALLBACK_COLS;
  const rows = terminal.rows || FALLBACK_ROWS;
  const previous = terminalSizeRef.current;
  if (previous.cols === cols && previous.rows === rows) return;
  terminalSizeRef.current = { cols, rows };
  const processId = processIdRef.current;
  if (!processId) return;
  void resizeCommandExec({ processId, size: { cols, rows } }).catch(
    () => undefined,
  );
}

function createProcessId(): string {
  return `shell-${crypto.randomUUID()}`;
}

function resolveTerminalCommand(command?: string): string[] {
  if (/Windows/i.test(navigator.userAgent))
    return command === undefined
      ? ["cmd.exe", "/d"]
      : ["cmd.exe", "/d", "/s", "/c", command];
  return command === undefined ? ["/bin/sh", "-i"] : ["/bin/sh", "-c", command];
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes));
}

function decodeBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
