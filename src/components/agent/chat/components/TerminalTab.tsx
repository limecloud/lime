import { useCallback, useState } from "react";
import { TerminalPanel, type TerminalState } from "./TerminalPanel";

interface TerminalTabProps {
  cwd?: string | null;
  command?: string;
  sessionId: string;
  active?: boolean;
  onNewTerminalTab?: () => void;
}

/** 一个外层标签对应一个进程；隐藏保留，关闭卸载后终止。 */
export function TerminalTab({
  cwd,
  command,
  sessionId,
  active = true,
  onNewTerminalTab,
}: TerminalTabProps) {
  const [state, setState] = useState<Partial<TerminalState>>({ ready: false });
  // 回调身份固定，避免显示状态更新重启 PTY。
  const onStateChange = useCallback(
    (patch: Partial<TerminalState>) =>
      setState((current) => ({ ...current, ...patch })),
    [],
  );
  return (
    <section
      className="relative h-full min-h-0 w-full overflow-hidden"
      data-testid="terminal-tab"
      data-session-id={sessionId}
      data-ready={state.ready ? "true" : "false"}
      data-exit-code={state.exitCode ?? undefined}
    >
      <TerminalPanel
        cwd={cwd}
        command={command}
        sessionId={sessionId}
        active={active}
        onNewTerminalTab={onNewTerminalTab}
        onStateChange={onStateChange}
      />
      {state.errorText ? (
        <div
          role="alert"
          className="absolute inset-x-4 top-2 text-xs text-[color:var(--lime-danger)]"
        >
          {state.errorText}
        </div>
      ) : null}
    </section>
  );
}
