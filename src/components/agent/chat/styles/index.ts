import styled from "styled-components";
import { ScrollArea } from "@/components/ui/scroll-area";

export const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 40px);
  background-color: var(--background);
  color: var(--foreground);
  overflow: hidden;
`;

export const Navbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  min-height: 56px;
  border-bottom: 1px solid hsl(var(--border) / 0.72);
  background:
    linear-gradient(
      180deg,
      hsl(var(--background) / 0.98) 0%,
      hsl(var(--background) / 0.94) 62%,
      hsl(var(--secondary) / 0.58) 100%
    );
  box-shadow:
    inset 0 -1px 0 hsl(var(--background) / 0.58),
    0 8px 24px hsl(var(--foreground) / 0.04);
  backdrop-filter: blur(14px);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
`;

export const Breadcrumb = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted-foreground);
`;

export const NavItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  &:hover {
    background-color: var(--muted);
    color: var(--foreground);
  }
`;

export const MainContent = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
`;

export const ChatArea = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
`;

export const MessageListContainer = styled(ScrollArea)`
  flex: 1;
  padding: 10px 0 16px;
`;

// Linear Layout Wrapper: Always Row, Left Aligned
export const MessageWrapper = styled.div<{ $isUser: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 12px 6px;
  gap: 12px;
  width: 100%;
  max-width: none;
  margin: 0;

  &:hover .message-actions {
    opacity: 1;
  }
`;

export const AvatarColumn = styled.div`
  flex-shrink: 0;
  padding-top: 2px;
`;

export const ContentColumn = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const MessageHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
`;

export const SenderName = styled.span`
  font-size: 14px;
  font-weight: 600;
`;

// Placeholder for time if needed
export const TimeStamp = styled.span`
  font-size: 12px;
  color: var(--muted-foreground);
  font-weight: normal;
`;

export const AvatarCircle = styled.div<{ $isUser: boolean }>`
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #10a37f;
  color: white;
  font-size: 14px;
  overflow: hidden;
`;

// Removed Bubble Styling - Now Transparent Text Block
export const MessageBubble = styled.div<{ $isUser: boolean }>`
  width: 100%;
  color: var(--foreground);
  font-size: 15px;
  line-height: 1.7;
  position: relative;
  /* Markdown styling would go here */
`;

export const MessageActions = styled.div`
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  background-color: transparent;
  margin-top: 8px;
`;

export const InputSection = styled.div`
  padding: 0 20px 20px;
  max-width: 840px;
  width: 100%;
  margin: 0 auto;
  flex-shrink: 0;
`;

export const InputContainer = styled.div<{ $focused: boolean }>`
  border: 1px solid
    ${(props) => (props.$focused ? "var(--primary)" : "var(--border)")};
  border-radius: 12px;
  background-color: var(--background);
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  padding: 12px;
  box-shadow: ${(props) => (props.$focused ? "0 0 0 2px var(--ring)" : "none")};
`;

export const CustomTextarea = styled.textarea`
  width: 100%;
  background: transparent;
  border: none;
  resize: none !important;
  color: var(--foreground);
  font-size: 15px;
  line-height: 1.6;
  padding: 4px 0;
  outline: none;
  min-height: 48px;
  max-height: 300px;

  &::placeholder {
    color: var(--muted-foreground);
  }
`;

export const InputToolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
`;

export const ToolbarGroup = styled.div`
  display: flex;
  gap: 6px;
`;

export const ThinkingBox = styled.div<{ $expanded: boolean }>`
  width: 100%;
  border-left: 2px solid var(--border);
  padding-left: 12px;
  margin-bottom: 12px;
  margin-top: 4px;
`;

export const ThinkingHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--muted-foreground);
  font-style: italic;

  &:hover {
    color: var(--foreground);
  }
`;

export const ThinkingContent = styled.div`
  padding: 8px 0;
  font-size: 13px;
  color: var(--muted-foreground);
  white-space: pre-wrap;
  font-family: monospace;
`;
