import styled from "styled-components";

// --- InputbarCore Styles ---

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
  transition: opacity 0.2s;
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
  position: relative;
  border: 1px solid var(--lime-composer-border, rgba(110, 231, 183, 0.84));
  border-radius: 22px;
  padding: 9px 10px;
  background: var(
    --lime-composer-surface,
    var(--lime-surface, hsl(var(--card)))
  );
  box-shadow:
    0 10px 28px var(--lime-shadow-color),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;

  &:focus-within {
    border-color: var(--lime-composer-border-focus, rgba(74, 222, 128, 0.7));
    background: var(--lime-composer-surface-focus);
    box-shadow:
      0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.24)),
      0 14px 32px var(--lime-shadow-color),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  &.file-dragging {
    border: 2px dashed var(--lime-brand, #10b981);
    background-color: var(--lime-brand-soft, #ecfdf5);
  }

  &.floating-composer {
    border-radius: 18px;
    padding: 14px 16px 12px;
    background: var(
      --lime-composer-surface-floating,
      var(--lime-surface, hsl(var(--card)))
    );
    border-color: var(--lime-composer-border, rgba(110, 231, 183, 0.84));
    box-shadow:
      0 28px 56px -38px var(--lime-shadow-color),
      inset 0 1px 0 rgba(255, 255, 255, 0.88);
  }

  &.floating-composer.context-connected {
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
    border-bottom-color: transparent;
    box-shadow:
      0 18px 42px -36px var(--lime-shadow-color),
      inset 0 1px 0 rgba(255, 255, 255, 0.88);
  }

  &.floating-composer.floating-collapsed {
    min-height: 52px;
    cursor: text;
  }

  &.floating-composer:focus-within {
    background: var(--lime-composer-surface-focus);
    border-color: var(--lime-composer-border-focus, rgba(74, 222, 128, 0.7));
    box-shadow:
      0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.24)),
      0 28px 56px -34px var(--lime-shadow-color),
      inset 0 1px 0 rgba(255, 255, 255, 0.88);
  }

  &.floating-composer.context-connected:focus-within {
    border-bottom-color: transparent;
    box-shadow:
      0 0 0 3px rgba(74, 222, 128, 0.1),
      0 22px 48px -38px var(--lime-shadow-color),
      inset 0 1px 0 rgba(255, 255, 255, 0.88);
  }
`;

export const MainRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;

  &.floating-composer.floating-collapsed {
    align-items: center;
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
    font-size: 13px;
    line-height: 1;
    letter-spacing: 1px;
  }
`;

export const DictationRecordingDuration = styled.span`
  display: inline-flex;
  width: 36px;
  justify-content: flex-start;
  font-size: 13px;
  font-weight: 760;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

export const DictationLiveTranscript = styled.div`
  margin-top: 4px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
  opacity: 0.86;
`;

export const StyledTextarea = styled.textarea`
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 4px 0 0;
  border-radius: 0;
  resize: none !important;
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
  min-height: 34px;

  &.floating-composer {
    font-size: 17px;
    line-height: 1.78;
    min-height: 88px;
  }

  &.floating-composer.floating-collapsed {
    padding: 8px 0 6px;
    min-height: 30px;
    max-height: 30px;
    line-height: 1.35;
    overflow: hidden;
  }

  &.composer-expanded {
    min-height: 210px;
  }

  &::placeholder {
    color: hsl(var(--muted-foreground) / 0.78);
  }

  &::-webkit-scrollbar {
    width: 3px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border));
    border-radius: 2px;
  }
`;

export const BottomBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  margin-top: 8px;
  gap: 8px;
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  border-top: 1px solid var(--lime-surface-border, hsl(var(--border) / 0.7));

  &.floating-composer {
    padding-top: 15px;
    margin-top: 15px;
    gap: 10px;
  }

  &.floating-composer.floating-collapsed {
    display: none;
  }
`;

export const LeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 420px;
  min-width: 0;
  flex-wrap: wrap;
  transition:
    opacity 0.16s ease,
    width 0.16s ease,
    flex-basis 0.16s ease,
    margin 0.16s ease;

  &.floating-collapsed {
    display: none;
  }
`;

export const MetaSlot = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
`;

export const TrailingSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
  flex-wrap: wrap;
`;

export const MetaSelectWrap = styled.label`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  border: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.82));
  background: var(--lime-surface, #ffffff);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  color: hsl(var(--muted-foreground));
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;

  &::after {
    content: "";
    position: absolute;
    right: 11px;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-62%) rotate(45deg);
    pointer-events: none;
    opacity: 0.76;
  }

  &:focus-within {
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    background: var(--lime-surface, #ffffff);
    box-shadow:
      0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.24)),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
    color: hsl(var(--foreground));
  }
`;

export const MetaSelectIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;

  svg {
    width: 14px;
    height: 14px;
  }
`;

export const MetaSelect = styled.select<{ $width?: string }>`
  appearance: none;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 0 14px 0 0;
  min-width: 0;
  width: ${({ $width }) => $width || "auto"};
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:focus {
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }
`;

export const MetaToggleButton = styled.button<{
  $checked?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 13px 0 11px;
  border-radius: 999px;
  border: 1px solid
    ${({ $checked }) =>
      $checked
        ? "var(--lime-surface-border-strong, #bbf7d0)"
        : "var(--lime-surface-border, rgba(226, 240, 226, 0.82))"};
  background: ${({ $checked }) =>
    $checked
      ? "var(--lime-brand-soft, #ecfdf5)"
      : "var(--lime-surface, #ffffff)"};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  color: ${({ $checked }) =>
    $checked ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;

  &:hover {
    border-color: ${({ $checked }) =>
      $checked
        ? "var(--lime-surface-border-strong, #bbf7d0)"
        : "var(--lime-surface-border, rgba(226, 240, 226, 0.82))"};
    background: ${({ $checked }) =>
      $checked
        ? "var(--lime-brand-soft, #ecfdf5)"
        : "var(--lime-surface-hover, #f4fdf4)"};
    color: hsl(var(--foreground));
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: none;
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    box-shadow:
      0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.24)),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
    transform: none;
  }
`;

export const MetaToggleCheck = styled.span<{
  $checked?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 4px;
  border: 1px solid
    ${({ $checked }) =>
      $checked
        ? "var(--lime-brand, #10b981)"
        : "var(--lime-surface-border, rgba(226, 240, 226, 0.82))"};
  background: ${({ $checked }) =>
    $checked
      ? "var(--lime-brand-soft, #ecfdf5)"
      : "var(--lime-surface, #ffffff)"};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.88);
  flex-shrink: 0;

  &::after {
    content: "";
    width: 6px;
    height: 3px;
    border-left: 1.6px solid currentColor;
    border-bottom: 1.6px solid currentColor;
    transform: rotate(-45deg)
      scale(${({ $checked }) => ($checked ? "1" : "0.35")});
    opacity: ${({ $checked }) => ($checked ? 1 : 0)};
    transition:
      transform 0.18s ease,
      opacity 0.18s ease;
  }
`;

export const MetaToggleGlyph = styled.span`
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex-shrink: 0;

  svg {
    width: 14px;
    height: 14px;
  }
`;

export const MetaToggleLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
`;

export const MetaIconButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  width: 38px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "rgba(251, 191, 36, 0.58)" : "rgba(148, 163, 184, 0.24)"};
  background: ${({ $active }) =>
    $active ? "rgba(255, 251, 235, 0.94)" : "rgba(255, 255, 255, 0.9)"};
  color: ${({ $active }) =>
    $active ? "#b45309" : "hsl(var(--muted-foreground))"};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    border-color: rgba(251, 191, 36, 0.66);
    background: rgba(255, 251, 235, 0.98);
    color: #b45309;
    transform: translateY(-1px);
    box-shadow: 0 10px 20px -18px rgba(120, 53, 15, 0.38);
  }

  &:focus-visible {
    outline: none;
    border-color: rgba(251, 191, 36, 0.7);
    box-shadow:
      0 0 0 3px rgba(251, 191, 36, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }
`;

export const ModeStatusChip = styled.button`
  display: inline-flex;
  position: relative;
  align-items: center;
  height: 28px;
  min-width: 0;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(248, 250, 252, 0.92);
  color: #475569;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    padding 0.16s ease,
    transform 0.16s ease,
    box-shadow 0.16s ease;

  &:hover {
    padding-left: 30px;
    border-color: rgba(148, 163, 184, 0.36);
    background: rgba(241, 245, 249, 0.98);
    color: #0f172a;
    transform: translateY(-1px);
    box-shadow: 0 10px 20px -18px rgba(15, 23, 42, 0.34);
  }

  &:focus-visible {
    padding-left: 30px;
    outline: none;
    border-color: rgba(59, 130, 246, 0.34);
    box-shadow:
      0 0 0 3px rgba(59, 130, 246, 0.14),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }
`;

export const ModeStatusRemoveMark = styled.span`
  display: inline-flex;
  position: absolute;
  left: 8px;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
  color: #64748b;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.84);
  transition:
    background 0.16s ease,
    color 0.16s ease,
    opacity 0.16s ease,
    transform 0.16s ease;

  ${ModeStatusChip}:hover &,
  ${ModeStatusChip}:focus-visible & {
    background: rgba(15, 23, 42, 0.09);
    color: #0f172a;
    opacity: 1;
    transform: scale(1);
  }

  svg {
    width: 11px;
    height: 11px;
  }
`;

export const ModeStatusLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
`;

export const PlanModeContext = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: min(360px, 100%);
  min-width: 0;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(20, 184, 166, 0.24);
  background: rgba(240, 253, 250, 0.9);
  color: #0f766e;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
`;

export const PlanModeContextSegment = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const PlanModeContextSeparator = styled.span`
  color: rgba(15, 118, 110, 0.48);
`;

export const ActionButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  align-self: flex-end;
  flex: 0 0 auto;
  justify-content: flex-end;
  padding-bottom: 2px;
`;

// --- InputbarTools Styles ---

export const ToolButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  color: hsl(var(--muted-foreground));
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(148, 163, 184, 0.22);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;

  &:hover {
    color: hsl(var(--foreground));
    border-color: rgba(148, 163, 184, 0.38);
    background: rgba(255, 255, 255, 0.96);
  }

  &.active {
    color: var(--lime-brand-strong, #166534);
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
  }

  span {
    white-space: nowrap;
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

export const InputIconButton = styled.button<{
  $primary?: boolean;
  $destructive?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid
    ${({ $primary, $destructive }) =>
      $primary
        ? "rgba(15, 23, 42, 0.12)"
        : $destructive
          ? "rgba(225, 29, 72, 0.28)"
          : "var(--lime-surface-border, hsl(var(--border)))"};
  background: ${({ $primary, $destructive }) =>
    $primary
      ? "var(--lime-brand, #10b981)"
      : $destructive
        ? "rgba(255, 226, 234, 0.92)"
        : "var(--lime-surface, hsl(var(--card)))"};
  color: ${({ $primary, $destructive }) =>
    $primary
      ? "#f0fdf4"
      : $destructive
        ? "#be123c"
        : "hsl(var(--muted-foreground))"};
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    background: ${({ $primary, $destructive }) =>
      $primary
        ? "var(--lime-brand-strong, #166534)"
        : $destructive
          ? "rgba(255, 221, 229, 1)"
          : "rgba(255, 255, 255, 1)"};
    color: ${({ $primary, $destructive }) =>
      $primary
        ? "#ffffff"
        : $destructive
          ? "#9f1239"
          : "hsl(var(--foreground))"};
  }

  &.is-active {
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }

  &.is-dictation {
    border-color: rgba(16, 185, 129, 0.34);
    background: rgba(236, 253, 245, 0.94);
    color: var(--lime-brand-strong, #166534);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86);
  }

  &.is-dictation:hover:not(:disabled) {
    border-color: rgba(16, 185, 129, 0.48);
    background: rgba(220, 252, 231, 0.98);
    color: #14532d;
  }

  &.is-recording {
    gap: 6px;
    width: 128px;
    min-width: 128px;
    max-width: 128px;
    padding: 0 12px 0 11px;
    border-color: rgba(190, 18, 60, 0.2);
    background: rgba(255, 241, 242, 0.96);
    color: #be123c;
    box-shadow:
      0 12px 26px -20px rgba(190, 18, 60, 0.48),
      inset 0 1px 0 rgba(255, 255, 255, 0.86);
    transform: none;
  }

  &.is-recording:hover:not(:disabled) {
    border-color: rgba(190, 18, 60, 0.3);
    background: rgba(255, 228, 230, 0.98);
    color: #9f1239;
    transform: none;
    box-shadow:
      0 14px 28px -20px rgba(190, 18, 60, 0.54),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  &.is-processing {
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }

  &.is-processing svg {
    animation: lime-inputbar-spin 0.9s linear infinite;
  }

  &:disabled {
    cursor: default;
    color: hsl(var(--muted-foreground));
    opacity: 0.5;
    transform: none;
  }

  @keyframes lime-inputbar-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

export const SendButton = styled(InputIconButton).attrs({
  $primary: true,
})`
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.14);

  svg {
    width: 16px;
    height: 16px;
  }

  &:disabled {
    border-color: rgba(148, 163, 184, 0.24);
    background: rgba(226, 232, 240, 0.92);
    color: #64748b;
    opacity: 1;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
  }
`;

export const SecondaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 68px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.9);
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 500;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;

  &:hover:not(:disabled) {
    border-color: rgba(148, 163, 184, 0.36);
    background: rgba(255, 255, 255, 1);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: default;
    color: hsl(var(--muted-foreground));
    opacity: 0.6;
  }
`;

// --- Image Preview Styles ---

export const ImagePreviewContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 0 10px;
`;

export const ImagePreviewItem = styled.div`
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  background-color: hsl(var(--muted));
`;

export const ImagePreviewImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

export const ImageRemoveButton = styled.button`
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(220, 38, 38, 0.9);
  }
`;

export const PathReferenceContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 0 10px;
`;

export const PathReferenceChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: min(100%, 320px);
  border: 1px solid rgba(251, 191, 36, 0.34);
  border-radius: 14px;
  background: rgba(255, 251, 235, 0.92);
  padding: 6px 7px 6px 8px;
  color: #78350f;
  box-shadow: 0 8px 18px -16px rgba(120, 53, 15, 0.36);
`;

export const PathReferenceIcon = styled.span<{ $isDir: boolean }>`
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid
    ${({ $isDir }) =>
      $isDir ? "rgba(245, 158, 11, 0.3)" : "rgba(56, 189, 248, 0.28)"};
  background: ${({ $isDir }) =>
    $isDir ? "rgba(254, 243, 199, 0.92)" : "rgba(240, 249, 255, 0.92)"};
  color: ${({ $isDir }) => ($isDir ? "#92400e" : "#0369a1")};
`;

export const PathReferenceText = styled.span`
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
`;

export const PathReferenceName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2937;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
`;

export const PathReferencePath = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
  font-size: 11px;
  line-height: 1.2;
`;

export const PathReferenceRemoveButton = styled.button`
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: #92400e;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    background: rgba(254, 226, 226, 0.92);
    color: #be123c;
    transform: translateY(-1px);
  }
`;

export const PathReferenceKnowledgeButton = styled.button`
  display: inline-flex;
  height: 24px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid rgba(14, 165, 233, 0.24);
  border-radius: 999px;
  background: rgba(240, 249, 255, 0.92);
  padding: 0 8px;
  color: #0369a1;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    background: rgba(224, 242, 254, 0.96);
    color: #075985;
    transform: translateY(-1px);
  }
`;
