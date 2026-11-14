import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentThreadItem, AgentThreadTurn } from "../types";
import { XtermOutputPanel } from "../components/XtermOutputPanel";
import { selectBackgroundTerminals } from "./localConversationBackgroundTerminalSignals";
import { useTerminalPanelPreferences } from "@/lib/terminalPanelPreferences";

export function BottomTerminalPanel({
  threadId,
  turns,
  items,
}: {
  threadId?: string | null;
  turns?: readonly AgentThreadTurn[];
  items?: readonly AgentThreadItem[];
}) {
  const { t } = useTranslation("agent");
  const preferences = useTerminalPanelPreferences();
  const [open, setOpen] = useState(preferences.location === "bottom");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const terminals = selectBackgroundTerminals(
    threadId,
    turns ?? [],
    items ?? [],
  );
  const selected =
    terminals.find((terminal) => terminal.id === selectedId) ?? terminals[0];
  const output =
    selected?.type === "command_execution"
      ? (selected.aggregated_output ?? "")
      : "";
  const visible = preferences.showControl || open;

  useEffect(() => {
    if (preferences.location === "bottom" && terminals.length > 0) {
      setOpen(true);
    }
  }, [preferences.location, terminals.length]);

  useEffect(() => {
    const openFromWorkspace = (event: Event) => {
      const detail = (
        event as CustomEvent<{ threadId?: string; itemId?: string }>
      ).detail;
      if (!detail?.itemId || detail.threadId !== threadId) return;
      const target = terminals.find((terminal) => terminal.id === detail.itemId);
      if (!target) return;
      setSelectedId(target.id);
      setOpen(true);
    };
    const openTerminal = () => {
      if (terminals.length > 0) setOpen(true);
    };
    const togglePanel = () => setOpen((value) => !value);
    window.addEventListener("lime:open-bottom-terminal", openFromWorkspace);
    window.addEventListener("lime:toggle-bottom-terminal", togglePanel);
    window.addEventListener("lime:open-terminal", openTerminal);
    return () => {
      window.removeEventListener(
        "lime:open-bottom-terminal",
        openFromWorkspace,
      );
      window.removeEventListener("lime:toggle-bottom-terminal", togglePanel);
      window.removeEventListener("lime:open-terminal", openTerminal);
    };
  }, [terminals, threadId]);

  if (!visible || (!open && terminals.length === 0)) return null;
  if (!open) {
    return (
      <div className="flex h-8 shrink-0 items-center border-t border-[color:var(--lime-surface-border)] px-3">
        <button
          type="button"
          data-testid="bottom-terminal-toggle"
          className="flex items-center gap-1.5 text-[12px] text-[color:var(--lime-text-muted)] hover:text-[color:var(--lime-text)]"
          onClick={() => setOpen(true)}
        >
          <Terminal size={14} aria-hidden />
          {t("agentChat.terminal.panelTitle", { defaultValue: "终端" })}
          {terminals.length > 0 ? ` (${terminals.length})` : null}
          <ChevronUp size={13} aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <section
      data-testid="bottom-terminal-panel"
      className="flex h-[260px] min-h-0 shrink-0 flex-col border-t border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[color:var(--lime-surface-border)] px-3">
        <Terminal size={14} aria-hidden />
        <span className="text-[12px] font-medium">
          {t("agentChat.terminal.panelTitle", { defaultValue: "终端" })}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              onClick={() => setSelectedId(terminal.id)}
              className={`max-w-[220px] truncate rounded-md px-2 py-1 text-[11px] ${
                terminal.id === selected?.id
                  ? "bg-[color:var(--lime-surface-hover)] text-[color:var(--lime-text)]"
                  : "text-[color:var(--lime-text-muted)]"
              }`}
            >
              {terminal.command.trim() || terminal.id}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("agentChat.terminal.collapse", {
            defaultValue: "收起终端",
          })}
          className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-[color:var(--lime-surface-hover)]"
          onClick={() => setOpen(false)}
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {output ? (
          <XtermOutputPanel output={output} />
        ) : (
          <p className="p-4 text-xs text-[color:var(--lime-text-muted)]">
            {t("agentChat.terminal.noOutput", {
              defaultValue: "没有终端输出",
            })}
          </p>
        )}
      </div>
    </section>
  );
}
