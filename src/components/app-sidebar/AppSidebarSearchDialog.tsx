import { useEffect, useState } from "react";
import {
  ChevronDown,
  MessageSquare,
  MessageSquarePlus,
  Search,
  X,
} from "lucide-react";
import styled from "styled-components";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import type { SidebarSearchSession } from "./sidebarThreadSearch";
import { Modal } from "@/components/Modal";
import {
  SidebarSearchBody,
  SidebarSearchCloseButton,
  SidebarSearchCreateButton,
  SidebarSearchCreateText,
  SidebarSearchDivider,
  SidebarSearchEmptyState,
  SidebarSearchEnterHint,
  SidebarSearchHeader,
  SidebarSearchInput,
  SidebarSearchKey,
  SidebarSearchMoreButton,
  SidebarSearchResultButton,
  SidebarSearchResultList,
  SidebarSearchResultMeta,
  SidebarSearchResultTitle,
  SidebarSearchSectionLabel,
  SidebarSearchShortcut,
  SidebarSearchSurface,
} from "./AppSidebar.styles";

export interface AppSidebarSearchDialogCopy {
  inputLabel: string;
  closeLabel: string;
  createConversationLabel: string;
  matchesLabel: string;
  recentLabel: string;
  loadingLabel: string;
  selectProjectFirstLabel: string;
  emptyMatchesLabel: string;
  emptyRecentLabel: string;
  contentSearchErrorLabel: string;
  loadingMoreLabel: string;
  moreMatchesLabel: string;
  moreRecentLabel: string;
}

interface AppSidebarSearchDialogProps {
  isOpen: boolean;
  query: string;
  inputRef: {
    current: HTMLInputElement | null;
  };
  copy: AppSidebarSearchDialogCopy;
  sessions: SidebarSearchSession[];
  contentSearchError?: boolean;
  currentProjectId?: string | null;
  currentSessionId?: string | null;
  hasQuery: boolean;
  hasMoreResults: boolean;
  loading: boolean;
  loadingMore: boolean;
  resolveSessionTitle: (session: AgentSessionInfo) => string;
  formatSessionMeta: (session: AgentSessionInfo) => string;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onCreateConversation: () => void;
  onResultClick: (session: AgentSessionInfo) => void;
  onShowMore: () => void;
}

export function AppSidebarSearchDialog({
  isOpen,
  query,
  inputRef,
  copy,
  sessions,
  contentSearchError = false,
  currentProjectId,
  currentSessionId,
  hasQuery,
  hasMoreResults,
  loading,
  loadingMore,
  resolveSessionTitle,
  formatSessionMeta,
  onClose,
  onQueryChange,
  onCreateConversation,
  onResultClick,
  onShowMore,
}: AppSidebarSearchDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  useEffect(() => {
    setSelectedIndex(-1);
  }, [isOpen, query, sessions.length]);
  useEffect(() => {
    if (!isOpen) return;
    const move = (offset: number) => {
      if (sessions.length === 0) return;
      setSelectedIndex((index) => {
        const next = (index + offset + sessions.length) % sessions.length;
        return next;
      });
    };
    const previous = () => move(-1);
    const next = () => move(1);
    const openSelected = () => {
      const session = sessions[selectedIndex];
      if (session) onResultClick(session);
    };
    window.addEventListener("lime:search-chats-previous", previous);
    window.addEventListener("lime:search-chats-next", next);
    window.addEventListener("lime:search-chats-open", openSelected);
    return () => {
      window.removeEventListener("lime:search-chats-previous", previous);
      window.removeEventListener("lime:search-chats-next", next);
      window.removeEventListener("lime:search-chats-open", openSelected);
    };
  }, [isOpen, onResultClick, selectedIndex, sessions]);
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="border-none bg-transparent p-0 shadow-none"
      maxWidth="max-w-[832px]"
      showCloseButton={false}
    >
      <SidebarSearchSurface data-testid="app-sidebar-search-dialog">
        <SidebarSearchHeader>
          <Search aria-hidden="true" />
          <SidebarSearchInput
            ref={(node) => {
              inputRef.current = node;
            }}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={copy.inputLabel}
            aria-label={copy.inputLabel}
            data-testid="app-sidebar-search-input"
          />
          <SidebarSearchShortcut aria-hidden="true">
            <SidebarSearchKey>⌘</SidebarSearchKey>
            <SidebarSearchKey>K</SidebarSearchKey>
          </SidebarSearchShortcut>
          <SidebarSearchCloseButton
            type="button"
            aria-label={copy.closeLabel}
            onClick={onClose}
          >
            <X />
          </SidebarSearchCloseButton>
        </SidebarSearchHeader>
        <SidebarSearchDivider />
        <SidebarSearchBody>
          <SidebarSearchCreateButton
            type="button"
            onClick={onCreateConversation}
            data-testid="app-sidebar-search-new-conversation"
          >
            <MessageSquarePlus />
            <SidebarSearchCreateText>
              {copy.createConversationLabel}
            </SidebarSearchCreateText>
            <SidebarSearchEnterHint aria-hidden="true">
              ↵
            </SidebarSearchEnterHint>
          </SidebarSearchCreateButton>

          <SidebarSearchSectionLabel>
            {hasQuery ? copy.matchesLabel : copy.recentLabel}
          </SidebarSearchSectionLabel>

          {contentSearchError ? (
            <SidebarSearchNotice
              role="status"
              data-testid="app-sidebar-search-error"
            >
              {copy.contentSearchErrorLabel}
            </SidebarSearchNotice>
          ) : null}

          {loading ? (
            <SidebarSearchEmptyState role="status">
              {copy.loadingLabel}
            </SidebarSearchEmptyState>
          ) : sessions.length > 0 ? (
            <SidebarSearchResultList>
              {sessions.map((session, index) => {
                const title = resolveSessionTitle(session);
                const isCurrentConversation = currentSessionId === session.id;
                const selected = selectedIndex === index;
                return (
                  <SidebarSearchResultButton
                    key={session.id}
                    type="button"
                    $active={isCurrentConversation || selected}
                    data-search-selected={selected || undefined}
                    disabled={loading}
                    aria-current={isCurrentConversation ? "page" : undefined}
                    title={title}
                    data-testid="app-sidebar-search-result"
                    onClick={() => onResultClick(session)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <MessageSquare />
                    <SidebarSearchResultCopy>
                      <SidebarSearchResultTitle>
                        {title}
                      </SidebarSearchResultTitle>
                      {session.searchSnippet ? (
                        <SidebarSearchResultSnippet
                          data-testid="app-sidebar-search-snippet"
                        >
                          {session.searchSnippet}
                        </SidebarSearchResultSnippet>
                      ) : null}
                    </SidebarSearchResultCopy>
                    <SidebarSearchResultMeta>
                      {formatSessionMeta(session)}
                    </SidebarSearchResultMeta>
                  </SidebarSearchResultButton>
                );
              })}
            </SidebarSearchResultList>
          ) : (
            <SidebarSearchEmptyState role="status">
              {hasQuery
                ? copy.emptyMatchesLabel
                : !currentProjectId
                  ? copy.selectProjectFirstLabel
                  : copy.emptyRecentLabel}
            </SidebarSearchEmptyState>
          )}

          {hasMoreResults ? (
            <SidebarSearchMoreButton
              type="button"
              disabled={loadingMore}
              onClick={onShowMore}
              data-testid="app-sidebar-search-more"
            >
              {loadingMore
                ? copy.loadingMoreLabel
                : hasQuery
                  ? copy.moreMatchesLabel
                  : copy.moreRecentLabel}
              <ChevronDown />
            </SidebarSearchMoreButton>
          ) : null}
        </SidebarSearchBody>
      </SidebarSearchSurface>
    </Modal>
  );
}

const SidebarSearchResultCopy = styled.span`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;

  ${SidebarSearchResultTitle} {
    flex: none;
  }
`;

const SidebarSearchResultSnippet = styled.span`
  overflow: hidden;
  color: var(--lime-text-soft, #9aa89a);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SidebarSearchNotice = styled.p`
  margin: 0;
  color: var(--lime-text-muted, #6b826b);
  font-size: 13px;
  font-weight: 650;
`;
