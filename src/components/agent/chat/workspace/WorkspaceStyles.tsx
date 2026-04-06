import { memo, type ReactNode } from "react";
import styled from "styled-components";
import { LayoutTransition } from "@/lib/workspace/workbenchUi";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { SyncStatus } from "../hooks/useContentSync";

export const PageContainer = styled.div<{ $compact?: boolean }>`
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
  min-height: 0;
  gap: ${({ $compact }) => ($compact ? "8px" : "14px")};
  padding: ${({ $compact }) => ($compact ? "4px 8px 8px" : "8px 14px 14px")};
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(
      circle at 14% 18%,
      rgba(56, 189, 248, 0.08),
      transparent 30%
    ),
    radial-gradient(
      circle at 86% 14%,
      rgba(16, 185, 129, 0.06),
      transparent 28%
    ),
    radial-gradient(
      circle at 72% 84%,
      rgba(245, 158, 11, 0.04),
      transparent 24%
    ),
    linear-gradient(180deg, #f8fafc 0%, #f8fafc 44%, #f3f8f5 100%);

  > * {
    position: relative;
    z-index: 1;
  }
`;

export const MainArea = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: ${({ $compact }) => ($compact ? "24px" : "32px")};
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow:
    0 24px 72px -36px rgba(15, 23, 42, 0.18),
    0 16px 28px -24px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
`;

function resolveContentSyncTone(status: SyncStatus): {
  text: string;
  background: string;
  border: string;
} {
  switch (status) {
    case "syncing":
      return {
        text: "#475569",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.92) 100%)",
        border: "rgba(226, 232, 240, 0.9)",
      };
    case "success":
      return {
        text: "#047857",
        background:
          "linear-gradient(180deg, rgba(236,253,245,0.98) 0%, rgba(220,252,231,0.92) 100%)",
        border: "rgba(167, 243, 208, 0.95)",
      };
    case "error":
      return {
        text: "#be123c",
        background:
          "linear-gradient(180deg, rgba(255,241,242,0.98) 0%, rgba(255,228,230,0.92) 100%)",
        border: "rgba(254, 205, 211, 0.95)",
      };
    case "idle":
    default:
      return {
        text: "#475569",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.9) 100%)",
        border: "rgba(226, 232, 240, 0.88)",
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

export const ChatContainerInner = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.76) 0%,
    rgba(248, 250, 252, 0.2) 16%,
    rgba(255, 255, 255, 0) 100%
  );
`;

export const EntryBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 10px 12px;
  border-radius: 18px;
  border: 1px solid rgba(191, 219, 254, 0.9);
  background: linear-gradient(
    180deg,
    rgba(239, 246, 255, 0.96) 0%,
    rgba(248, 250, 252, 0.92) 100%
  );
  color: #0f172a;
  font-size: 13px;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.16);
`;

export const EntryBannerClose = styled.button`
  margin-left: auto;
  border: none;
  background: transparent;
  color: #64748b;
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

export const GeneralWorkbenchLayoutShell = styled.div<{ $bottomInset: string }>`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
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
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.94) 0%,
    rgba(248, 250, 252, 0.9) 100%
  );
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 30;
  box-shadow: 0 14px 28px -24px rgba(15, 23, 42, 0.2);

  &:hover {
    color: #0f172a;
    border-color: rgba(148, 163, 184, 0.84);
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(241, 245, 249, 0.92) 100%
    );
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
