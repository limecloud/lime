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
