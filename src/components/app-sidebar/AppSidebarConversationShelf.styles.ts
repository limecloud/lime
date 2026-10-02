import styled from "styled-components";

export const ConversationShelf = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  margin: 4px 0 12px;
`;

export const ConversationSection = styled.section<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  max-height: none;
  padding: 0;
  overflow: visible;
`;

export const ConversationSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  padding: 0 4px;
  color: var(--sidebar-muted);
`;

export const ConversationSectionActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  opacity: 1;
  pointer-events: auto;
`;

export const ConversationSectionTitle = styled.h2`
  display: inline-flex;
  align-items: center;
  padding: 0;
  margin: 0;
  color: inherit;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
`;

export const ConversationActionButton = styled.button`
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const ConversationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow: visible;
  padding-right: 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--sidebar-border);
    border-radius: 9999px;
  }
`;

export const ConversationListMoreButton = styled.button`
  width: 100%;
  min-height: 26px;
  border: none;
  border-radius: 7px;
  padding: 0 7px;
  background: transparent;
  color: var(--sidebar-muted);
  font-size: 12px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
  }
`;
