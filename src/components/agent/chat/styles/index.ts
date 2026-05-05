import styled from "styled-components";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LIME_STAGE_SURFACE } from "../workspace/taskCenterChromeTokens";

export const Navbar = styled.div<{
  $compact?: boolean;
  $collapsed?: boolean;
  $taskCenter?: boolean;
}>`
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "flex-end" : "space-between"};
  gap: ${({ $compact, $collapsed, $taskCenter }) =>
    $collapsed ? "10px" : $taskCenter ? "8px" : $compact ? "8px" : "12px"};
  padding: ${({ $compact, $collapsed, $taskCenter }) =>
    $collapsed
      ? $compact
        ? "6px 8px 2px"
        : "6px 14px 2px"
      : $taskCenter
        ? $compact
          ? "1px 8px 0"
          : "1px 8px 0"
        : $compact
          ? "7px 10px 7px"
          : "12px 16px 10px"};
  min-height: ${({ $compact, $collapsed, $taskCenter }) =>
    $collapsed ? "auto" : $taskCenter ? "auto" : $compact ? "50px" : "64px"};
  border-bottom: ${({ $collapsed }) =>
    $collapsed
      ? "none"
      : "1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.72))"};
  border-bottom-color: ${({ $collapsed, $taskCenter }) =>
    $collapsed
      ? "transparent"
      : $taskCenter
        ? "transparent"
        : "var(--lime-surface-border, rgba(226, 240, 226, 0.72))"};
  background: ${({ $collapsed, $taskCenter }) =>
    $collapsed
      ? "transparent"
      : $taskCenter
        ? "transparent"
        : "var(--lime-composer-surface-floating)"};
  box-shadow: ${({ $collapsed, $taskCenter }) =>
    $collapsed
      ? "none"
      : $taskCenter
        ? "none"
        : `inset 0 -1px 0 rgba(255, 255, 255, 0.74),
    0 10px 28px rgba(15, 23, 42, 0.04)`};
  backdrop-filter: ${({ $collapsed, $taskCenter }) =>
    $collapsed || $taskCenter ? "none" : "blur(18px)"};
  align-self: ${({ $collapsed }) => ($collapsed ? "flex-end" : "stretch")};
  width: ${({ $collapsed }) => ($collapsed ? "fit-content" : "auto")};
  max-width: ${({ $collapsed }) => ($collapsed ? "calc(100% - 24px)" : "100%")};
  margin-left: ${({ $collapsed }) => ($collapsed ? "auto" : "0")};
  flex-shrink: 0;
  position: relative;
  z-index: 10;
`;

export const MessageListContainer = styled(ScrollArea)<{
  $taskCenterSurface?: boolean;
}>`
  flex: 1;
  padding: 6px 0 16px;
  background: ${({ $taskCenterSurface }) =>
    $taskCenterSurface
      ? LIME_STAGE_SURFACE
      : `linear-gradient(
          180deg,
          var(--lime-surface-muted, rgba(242, 247, 243, 0.66)) 0%,
          var(--lime-surface-soft, rgba(248, 252, 249, 0.26)) 22%,
          rgba(255, 255, 255, 0) 100%
        )`};
`;

// Linear Layout Wrapper: Always Row, Left Aligned
export const MessageWrapper = styled.div<{
  $isUser: boolean;
  $compactLeadingSpacing?: boolean;
}>`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: ${({ $isUser }) => ($isUser ? "flex-end" : "flex-start")};
  padding: ${({ $compactLeadingSpacing }) =>
    $compactLeadingSpacing ? "8px 2px" : "8px 4px"};
  gap: 0;
  width: 100%;
  max-width: none;
  margin: 0;

  &:hover .message-actions,
  &:focus-within .message-actions {
    opacity: 1;
    max-height: 48px;
    margin-top: 8px;
    transform: translateY(0);
    pointer-events: auto;
  }
`;

export const ContentColumn = styled.div<{ $isUser: boolean }>`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  align-items: ${({ $isUser }) => ($isUser ? "flex-end" : "stretch")};
`;

export const MessageBubble = styled.div<{ $isUser: boolean }>`
  width: ${({ $isUser }) => ($isUser ? "fit-content" : "100%")};
  max-width: ${({ $isUser }) =>
    $isUser ? "min(72%, 560px)" : "min(100%, 1040px)"};
  padding: ${({ $isUser }) => ($isUser ? "12px 16px" : "15px 17px")};
  display: flex;
  flex-direction: column;
  gap: ${({ $isUser }) => ($isUser ? "8px" : "12px")};
  border-radius: 18px;
  border: 1px solid
    ${({ $isUser }) =>
      $isUser
        ? "var(--lime-surface-border-strong, rgba(187, 247, 208, 0.72))"
        : "var(--lime-surface-border, rgba(226, 240, 226, 0.58))"};
  background: ${({ $isUser }) =>
    $isUser
      ? "linear-gradient(180deg, var(--lime-surface, #ffffff) 0%, var(--lime-brand-soft, #ecfdf5) 100%)"
      : "linear-gradient(180deg, var(--lime-surface, #ffffff) 0%, var(--lime-surface-subtle, #fcfff9) 100%)"};
  box-shadow: ${({ $isUser }) =>
    $isUser
      ? "0 16px 36px -30px rgba(15, 23, 42, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.74)"
      : "0 14px 34px -30px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.78)"};
  color: ${({ $isUser }) =>
    $isUser ? "rgb(30, 41, 59)" : "var(--foreground)"};
  font-size: 15px;
  line-height: 1.7;
  position: relative;

  .markdown-renderer,
  .markdown-renderer * {
    color: inherit;
  }
`;

export const MessageActions = styled.div`
  display: flex;
  gap: 4px;
  align-self: flex-end;
  position: relative;
  z-index: 5;
  max-height: 48px;
  overflow: visible;
  opacity: 1;
  pointer-events: auto;
  margin-top: 8px;
  transform: translateY(0);
  transition:
    opacity 0.18s ease,
    max-height 0.18s ease,
    margin-top 0.18s ease,
    transform 0.18s ease;
  background-color: transparent;
`;
