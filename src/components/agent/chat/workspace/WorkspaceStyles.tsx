import { memo, type ReactNode } from "react";
import styled from "styled-components";
import { LayoutTransition } from "@/lib/workspace/workbenchUi";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { SyncStatus } from "../hooks/useContentSync";
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
  gap: ${({ $compact }) => ($compact ? "8px" : "20px")};
  padding: ${({ $compact }) => ($compact ? "4px 10px 10px" : "12px 20px 20px")};
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

export const AutoHideNavbarHost = styled.div`
  position: absolute;
  top: 2px;
  left: 12px;
  right: 12px;
  z-index: 35;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  pointer-events: none;
`;

export const AutoHideNavbarBackdrop = styled.button<{ $visible: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 32;
  border: none;
  padding: 0;
  margin: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--lime-surface-soft, #f8fcf9) 34%, transparent) 0%,
    color-mix(in srgb, var(--lime-surface-soft, #f8fcf9) 52%, transparent) 26%,
    color-mix(in srgb, var(--lime-surface-soft, #f8fcf9) 60%, transparent) 100%
  );
  backdrop-filter: blur(18px) saturate(1.04);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  transition: opacity 0.18s ease;
`;

export const AutoHideNavbarHandle = styled.button<{ $visible: boolean }>`
  display: inline-flex;
  align-items: center;
  align-self: flex-end;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.95));
  border-radius: 999px;
  background: var(--lime-home-card-surface-strong);
  color: ${({ $visible }) =>
    $visible
      ? "var(--lime-text-strong, #0f172a)"
      : "var(--lime-text-muted, #6b826b)"};
  box-shadow: 0 10px 24px -18px var(--lime-shadow-color);
  pointer-events: auto;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;

  &:hover {
    color: var(--lime-text-strong, #0f172a);
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    transform: translateY(-1px);
  }
`;

export const AutoHideNavbarPanel = styled.div<{ $visible: boolean }>`
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  max-height: ${({ $visible }) => ($visible ? "180px" : "0")};
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transform: ${({ $visible }) =>
    $visible ? "translateY(0)" : "translateY(-10px) scale(0.98)"};
  transform-origin: top right;
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  transition:
    max-height 0.18s ease,
    opacity 0.18s ease,
    transform 0.18s ease;
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
        background: "var(--lime-home-card-surface)",
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
        background: "var(--lime-home-card-surface)",
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
  align-items: center;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 10px 12px;
  border-radius: 18px;
  border: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.9));
  background: var(--lime-home-card-surface);
  color: var(--lime-text, #1a3b2b);
  font-size: 13px;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.16);
`;

export const EntryBannerClose = styled.button`
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--lime-text-muted, #6b826b);
  cursor: pointer;
  font-size: 13px;
`;

export const ChatContent = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: ${({ $compact }) => ($compact ? "0 6px 6px" : "0 10px 10px")};
  overflow: hidden;
  height: 100%;
  position: relative;
`;

export const MessageViewport = styled.div<{ $bottomPadding?: string }>`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-bottom: ${({ $bottomPadding }) => $bottomPadding || "128px"};
`;

export const ChatInputSlot = styled.div`
  width: min(calc(100% - 20px), 900px);
  max-width: 100%;
  margin: 0 auto;
`;

export const GeneralWorkbenchInputOverlay = styled.div`
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 25;
  pointer-events: none;
  display: flex;
  justify-content: center;
  box-sizing: border-box;

  > * {
    pointer-events: auto;
    width: min(calc(100% - 16px), 900px);
    max-width: 100%;
  }
`;

export const GeneralWorkbenchLayoutShell = styled.div<{
  $bottomInset: string;
  $taskCenterSurface?: boolean;
}>`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: ${({ $taskCenterSurface }) =>
    $taskCenterSurface ? LIME_STAGE_SURFACE_SOFT : "transparent"};
  padding-bottom: ${({ $bottomInset }) => $bottomInset};
  transition: padding-bottom 0.2s ease;
`;

const GeneralWorkbenchCanvasHost = styled.div`
  flex: 1;
  min-height: 0;

  > * {
    height: 100%;
  }
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
  background: var(--lime-home-card-surface);
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
    background: var(--lime-home-card-surface-strong);
  }
`;

interface LayoutTransitionRenderGateProps {
  mode: LayoutMode;
  chatContent: ReactNode;
  canvasContent: ReactNode;
  chatPanelWidth?: string;
  chatPanelMinWidth?: string;
  forceOpenChatPanel?: boolean;
}

export const LayoutTransitionRenderGate = memo(
  ({
    mode,
    chatContent,
    canvasContent,
    chatPanelWidth,
    chatPanelMinWidth,
    forceOpenChatPanel = false,
  }: LayoutTransitionRenderGateProps) => (
    <GeneralWorkbenchCanvasHost>
      <LayoutTransition
        mode={mode}
        chatContent={chatContent}
        canvasContent={canvasContent}
        chatPanelChrome="plain"
        chatPanelWidth={chatPanelWidth}
        chatPanelMinWidth={chatPanelMinWidth}
        forceOpenChatPanel={forceOpenChatPanel}
      />
    </GeneralWorkbenchCanvasHost>
  ),
  (previous, next) =>
    previous.mode === next.mode &&
    previous.chatContent === next.chatContent &&
    previous.canvasContent === next.canvasContent &&
    previous.chatPanelWidth === next.chatPanelWidth &&
    previous.chatPanelMinWidth === next.chatPanelMinWidth &&
    previous.forceOpenChatPanel === next.forceOpenChatPanel,
);

LayoutTransitionRenderGate.displayName = "LayoutTransitionRenderGate";

export const TEAM_PRIMARY_CHAT_PANEL_WIDTH =
  "min(100%, clamp(420px, 34%, 560px))";
export const TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH = "400px";
