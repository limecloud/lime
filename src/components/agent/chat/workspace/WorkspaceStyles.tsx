import styled from "styled-components";
import type { SyncStatus } from "../hooks/useContentSync";
import {
  FLOATING_CONVERSATION_CONTENT_WIDTH,
  INLINE_CONVERSATION_CONTENT_WIDTH,
} from "../styles/conversationLayoutTokens";
import {
  LIME_STAGE_SURFACE,
  LIME_STAGE_SURFACE_SOFT,
} from "./taskCenterChromeTokens";

export const PageContainer = styled.div<{ $compact?: boolean }>`
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
  min-height: 0;
  gap: 0;
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  background: ${LIME_STAGE_SURFACE};

  > * {
    position: relative;
    z-index: 1;
  }
`;

export const MainArea = styled.div<{
  $compact?: boolean;
  $taskCenterSurface?: boolean;
}>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: ${({ $taskCenterSurface }) =>
    $taskCenterSurface ? LIME_STAGE_SURFACE : "transparent"};
  border: none;
  box-shadow: none;
`;

function resolveContentSyncTone(status: SyncStatus): {
  text: string;
  background: string;
  border: string;
} {
  switch (status) {
    case "syncing":
      return {
        text: "var(--lime-text, #1a3b2b)",
        background: "var(--lime-surface)",
        border: "var(--lime-surface-border, rgba(226, 240, 226, 0.9))",
      };
    case "success":
      return {
        text: "var(--lime-brand-strong, #166534)",
        background: "var(--lime-brand-soft, #ecfdf5)",
        border: "var(--lime-surface-border-strong, #bbf7d0)",
      };
    case "error":
      return {
        text: "var(--lime-danger, #be123c)",
        background: "var(--lime-danger-soft, #fff1f2)",
        border: "var(--lime-danger-border, #fecdd3)",
      };
    case "idle":
    default:
      return {
        text: "var(--lime-text-muted, #6b826b)",
        background: "var(--lime-surface)",
        border: "var(--lime-surface-border, rgba(226, 240, 226, 0.88))",
      };
  }
}

export const ContentSyncNotice = styled.div<{ $status: SyncStatus }>`
  ${({ $status }) => {
    const tone = resolveContentSyncTone($status);
    return `
      display: flex;
      align-items: center;
      gap: 8px;
      margin: -2px 14px 10px;
      padding: 8px 12px;
      border: 1px solid ${tone.border};
      border-radius: 14px;
      background: ${tone.background};
      color: ${tone.text};
      box-shadow: 0 10px 24px hsl(var(--foreground) / 0.03);
    `;
  }}
`;

export const ContentSyncNoticeText = styled.span`
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
`;

export const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
`;

export const ChatContainerInner = styled.div<{ $taskCenterSurface?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: ${({ $taskCenterSurface }) =>
    $taskCenterSurface
      ? LIME_STAGE_SURFACE
      : "var(--lime-stage-surface, var(--lime-app-bg, #f4f7f1))"};
`;

export const EntryBanner = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 10px 0;
  padding: 8px 10px;
  border-radius: 16px;
  border: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.9));
  background: var(--lime-surface);
  color: var(--lime-text, #1a3b2b);
  font-size: 12px;
  line-height: 1.45;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.16);

  > span {
    min-width: 0;
    flex: 1 1 240px;
    overflow-wrap: anywhere;
  }
`;

export const EntryBannerClose = styled.button`
  margin-left: auto;
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--lime-text-muted, #6b826b);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.45;
  white-space: nowrap;
`;

export const ChatContent = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: ${({ $compact }) => ($compact ? "0 6px 6px" : "0 10px 10px")};
  overflow: hidden;
  position: relative;
`;

export const MessageViewport = styled.div<{ $bottomPadding?: string }>`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-bottom: ${({ $bottomPadding }) => $bottomPadding || "128px"};
`;

export const ChatInputSlot = styled.div`
  flex: 0 0 auto;
  width: ${INLINE_CONVERSATION_CONTENT_WIDTH};
  max-width: 100%;
  margin: 0 auto;
`;

export const GeneralWorkbenchInputOverlay = styled.div<{
  $bottomInset: string;
}>`
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: calc(20px + ${({ $bottomInset }) => $bottomInset});
  z-index: 25;
  pointer-events: none;
  display: flex;
  justify-content: center;
  box-sizing: border-box;

  > * {
    pointer-events: auto;
    width: ${FLOATING_CONVERSATION_CONTENT_WIDTH};
    max-width: 100%;
  }
`;

export const GeneralWorkbenchLayoutShell = styled.div<{
  $bottomInset: string;
  $taskCenterSurface?: boolean;
}>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  background: ${({ $taskCenterSurface }) =>
    $taskCenterSurface ? LIME_STAGE_SURFACE_SOFT : "transparent"};
  padding-bottom: ${({ $bottomInset }) => $bottomInset};
  transition: padding-bottom 0.2s ease;
`;

export const GeneralWorkbenchLeftExpandButton = styled.button`
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 78px;
  border: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.92));
  border-radius: 14px;
  background: var(--lime-surface);
  color: var(--lime-text-muted, #6b826b);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 30;
  box-shadow: 0 14px 28px -24px var(--lime-shadow-color);

  &:hover {
    color: var(--lime-text-strong, #0f172a);
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    background: var(--lime-surface-soft);
  }
`;

export const TEAM_PRIMARY_CHAT_PANEL_WIDTH =
  "min(100%, clamp(420px, 34%, 560px))";
export const CODE_WORKBENCH_CHAT_PANEL_WIDTH =
  "min(100%, clamp(640px, 54%, 1180px))";
