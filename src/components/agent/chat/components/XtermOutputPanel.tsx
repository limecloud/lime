import { useEffect, useRef, useState } from "react";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { LIME_THEME_CHANGED_EVENT } from "@/lib/appearance/themeMode";
import { readTerminalTheme } from "./terminalTheme";
import { handleTerminalKeyEvent } from "./terminalKeyboard";
import "@xterm/xterm/css/xterm.css";

type Terminal = import("@xterm/xterm").Terminal;

/** canonical snapshot只投影到显示buffer，永不建立可写进程或第二份业务状态。 */
export function XtermOutputPanel({ output }: { output: string }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const latestOutput = useRef(output);
  latestOutput.current = output;
  const renderedOutput = useRef("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let instance: Terminal | undefined;
    const updateTheme = () => {
      if (!instance || !container.current) return;
      instance.options.theme = readTerminalTheme(container.current);
      if (instance.rows > 0) instance.refresh(0, instance.rows - 1);
    };
    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-web-links"),
    ])
      .then(([{ Terminal }, { FitAddon }, { WebLinksAddon }]) => {
        if (disposed || !container.current) return;
        instance = new Terminal({
          disableStdin: true,
          cursorStyle: "bar",
          allowTransparency: true,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.2,
          letterSpacing: 0,
          theme: readTerminalTheme(container.current),
        });
        const fit = new FitAddon();
        instance.loadAddon(fit);
        instance.loadAddon(
          new WebLinksAddon((_event, url) => {
            void openExternalUrlWithSystemBrowser(url).catch(() => undefined);
          }),
        );
        instance.open(container.current);
        instance.attachCustomKeyEventHandler((event) =>
          handleTerminalKeyEvent({
            event,
            terminal: instance!,
            sendText: () => undefined,
          }),
        );
        terminal.current = instance;
        fit.fit();
        renderedOutput.current = latestOutput.current;
        if (renderedOutput.current)
          instance.write(renderedOutput.current, () => {
            if (!disposed) instance?.scrollToBottom();
          });
        observer = new ResizeObserver(() => {
          if (!disposed) fit.fit();
        });
        observer.observe(container.current);
      })
      .catch((error) => {
        if (!disposed)
          setError(error instanceof Error ? error.message : String(error));
      });
    window.addEventListener(LIME_THEME_CHANGED_EVENT, updateTheme);
    return () => {
      disposed = true;
      window.removeEventListener(LIME_THEME_CHANGED_EVENT, updateTheme);
      observer?.disconnect();
      terminal.current = null;
      instance?.dispose();
    };
  }, []);

  useEffect(() => {
    const view = terminal.current;
    if (!view) return;
    const previous = renderedOutput.current;
    const follow = view.buffer.active.viewportY >= view.buffer.active.baseY;
    const delta = output.startsWith(previous)
      ? output.slice(previous.length)
      : output;
    if (!output.startsWith(previous)) view.reset();
    renderedOutput.current = output;
    if (delta)
      view.write(delta, () => {
        if (terminal.current === view && follow) view.scrollToBottom();
      });
  }, [output]);

  return (
    <div
      data-testid="xterm-output-panel"
      className="flex h-full min-h-0 w-full flex-col bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
    >
      {error ? (
        <div
          role="alert"
          className="px-3 py-2 text-xs text-[color:var(--lime-danger)]"
        >
          {error}
        </div>
      ) : null}
      <div className="flex-1 overflow-hidden py-3 ps-3 tracking-normal">
        <div ref={container} className="h-full w-full overflow-hidden" />
      </div>
    </div>
  );
}
