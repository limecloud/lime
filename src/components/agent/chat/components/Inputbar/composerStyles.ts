import { inlineMentionStyles } from "@/components/input-kit/inlineMentionStyles";
import styled from "styled-components";
import { ComposerEditor } from "@/components/input-kit";

export const DragHandle = styled.div`
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  color: var(--muted-foreground);
  opacity: 0;
  z-index: 10;

  &:hover {
    opacity: 1;
  }
`;

export const Container = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
  padding: 0 8px 10px;
  width: 100%;
  max-width: none;
  margin: 0;

  &.floating-composer {
    padding: 0 0 6px;
  }

  &.floating-composer.context-connected {
    padding-bottom: 0;
  }
`;

export const InputBarContainer = styled.div`
  container: composer / inline-size;
  min-width: 0;
  position: relative;
  border: 0.5px solid var(--lime-surface-border-strong);
  border-radius: 18px;
  padding: 8px 8px 0;
  background: var(--lime-surface);

  &:focus-within {
    border-color: var(--lime-brand-strong);
  }

  &.file-dragging {
    border-style: dashed;
    border-color: var(--lime-brand-strong);
    background: var(--lime-brand-soft);
  }

  &.floating-composer {
    padding: 12px 8px 0;
  }

  &.context-connected {
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
    border-bottom-color: transparent;
  }
`;

export const InputColumn = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
`;

export const DictationRecordingDot = styled.span`
  display: inline-flex;
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: currentColor;
`;

export const DictationRecordingWaveform = styled.span`
  display: inline-flex;
  width: 34px;
  height: 10px;
  flex: 0 0 auto;
  align-items: center;
  opacity: 0.76;

  &::before {
    content: "••••••";
    font-size: 14px;
    line-height: 1;
    letter-spacing: 1px;
  }
`;

export const DictationRecordingDuration = styled.span`
  display: inline-flex;
  width: 36px;
  justify-content: flex-start;
  font-size: 14px;
  font-weight: 760;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

export const DictationLiveTranscript = styled.div`
  margin-top: 4px;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
  opacity: 0.86;
`;

export const StyledComposerEditor = styled(ComposerEditor)`
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 4px 0 0;
  border-radius: 0;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: none;
  outline: none;
  line-height: 1.5;
  font-family: inherit;
  font-size: 14px;
  color: hsl(var(--foreground));
  /* 普通草稿保留紧凑文本区，长内容随原编辑器增长或展开。 */
  min-height: 44px;
  overflow-wrap: anywhere;

  &.floating-composer {
    font-size: 14px;
    line-height: 1.5;
    min-height: 44px;
  }

  [data-testid="inputbar-core-container"]:has([data-composer-expand-toggle]) & {
    padding-inline-end: 40px;
  }

  &.composer-expanded {
    min-height: 210px;
  }

  [data-composer-footer-input][data-composer-layout="single-line"] & {
    display: flex;
    align-items: center;
    height: 32px;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    white-space: pre;

    p {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: pre;
    }
  }

  &[data-empty="true"]::before {
    color: hsl(var(--muted-foreground) / 0.78);
  }

  p {
    margin: 0;
  }
  &[data-empty="true"]::before {
    content: attr(data-placeholder);
    position: absolute;
    pointer-events: none;
    inset-inline: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-composer-token="paste"],
  [data-composer-token="element"] {
    border-radius: 4px;
    padding: 0 3px;
    background: hsl(var(--muted));
  }

  [data-appearance="inline-mention"] {
    ${inlineMentionStyles}
  }

  &::-webkit-scrollbar {
    width: 3px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border));
    border-radius: 2px;
  }
`;

export const ExpansionControl = styled.div`
  position: absolute;
  inset-block-start: 10px;
  inset-inline-end: 10px;
  z-index: 2;
`;
