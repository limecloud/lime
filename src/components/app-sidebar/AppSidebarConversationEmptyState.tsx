import { Clock3 } from "lucide-react";
import styled from "styled-components";

const ConversationEmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex: 1;
  min-height: 26px;
  border-radius: 12px;
  padding: 4px 7px;
  color: var(--sidebar-muted);
  font-size: 12px;
  background: transparent;
  text-align: center;
`;

export function AppSidebarConversationEmptyState({ text }: { text: string }) {
  return (
    <ConversationEmptyState>
      <Clock3 size={14} />
      {text}
    </ConversationEmptyState>
  );
}

export function AppSidebarConversationLoading({ label }: { label: string }) {
  return (
    <div
      data-testid="app-sidebar-conversations-loading"
      aria-busy="true"
      className="flex flex-col gap-1 px-1 py-1"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          aria-hidden="true"
          className="h-6 animate-pulse rounded-lg bg-[var(--sidebar-hover)] opacity-60"
          style={{ width: `${88 - row * 10}%` }}
        />
      ))}
    </div>
  );
}
