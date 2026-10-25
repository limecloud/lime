import styled from "styled-components";

export const MetaSlot = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
`;

export const MetaSelectWrap = styled.label`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 28px;
  height: 28px;
  gap: 4px;
  padding: 0 4px;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  [data-access-mode-label] {
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
  }

  @container composer (max-width: 24rem) {
    [data-access-mode-label] {
      display: none;
    }
  }

  &[data-access-mode="full-access"] {
    color: var(--lime-warning, #d97706);
  }

  &:focus-within {
    outline: 1px solid hsl(var(--ring));
    outline-offset: 1px;
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

export const MetaSelect = styled.select`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  appearance: none;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 0 14px 0 0;
  min-width: 0;
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
  gap: 4px;
  margin-inline-start: 4px;
  flex: 0 0 auto;
  justify-content: flex-end;

  .is-dictation:not(.is-recording) {
    width: 24px;
    height: 28px;
    border-color: transparent;
    background: transparent;
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
