import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
const AgentChatWorkspace = lazy(() =>
  import("@/components/agent/chat/AgentChatWorkspace").then((module) => ({
    default: module.AgentChatWorkspace,
  })),
);
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { createAgentRuntimeSession } from "@/lib/api/agentRuntime/sessionClient";

export function SideChatPanel() {
  const { t } = useTranslation("navigation");
  const navigate = useAppNavigationRequest();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    const focus = () => {
      setOpen(true);
      window.setTimeout(() => {
        panelRef.current
          ?.querySelector<HTMLElement>('[data-testid="composer-editor"]')
          ?.focus();
      }, 450);
    };
    window.addEventListener("lime:toggle-side-chat", toggle);
    window.addEventListener("lime:focus-side-chat", focus);
    return () => {
      window.removeEventListener("lime:toggle-side-chat", toggle);
      window.removeEventListener("lime:focus-side-chat", focus);
    };
  }, []);

  useEffect(() => {
    if (!open || sessionId) return;
    let cancelled = false;
    setError(false);
    void createAgentRuntimeSession(
      undefined,
      t("sideChat.title"),
      undefined,
      { ephemeral: true },
    )
      .then((id) => {
        if (!cancelled) setSessionId(id);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, t]);

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      data-testid="side-chat-panel"
      className="fixed inset-y-0 right-0 z-[90] flex w-[min(460px,100vw)] flex-col border-l border-[color:var(--lime-surface-border)] bg-[color:var(--lime-app-bg)] shadow-2xl">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[color:var(--lime-surface-border)] px-3">
        <span className="text-sm font-semibold text-[color:var(--lime-text-strong)]">
          {t("sideChat.title")}
        </span>
        <button
          type="button"
          aria-label={t("sideChat.close")}
          className="rounded-md p-1 text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-4 text-sm text-[color:var(--lime-text-muted)]">
            {t("sideChat.failed")}
          </p>
        ) : sessionId ? (
          <Suspense
            fallback={
              <p className="p-4 text-sm text-[color:var(--lime-text-muted)]">
                {t("sideChat.loading")}
              </p>
            }
          >
            <AgentChatWorkspace
              hideTopBar
              onNavigate={navigate ?? undefined}
              initialSessionId={sessionId}
              initialSessionName={t("sideChat.title")}
              showChatPanel={false}
            />
          </Suspense>
        ) : (
          <p className="p-4 text-sm text-[color:var(--lime-text-muted)]">
            {t("sideChat.loading")}
          </p>
        )}
      </div>
    </aside>
  );
}
