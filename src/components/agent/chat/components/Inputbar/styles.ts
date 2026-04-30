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
  padding: 0 8px 12px;
  width: 100%;
  max-width: none;
  margin: 0;

  &.floating-composer {
    padding: 0 0 6px;
  }
`;

export const InputBarContainer = styled.div`
  position: relative;
  border: 1px solid var(--lime-composer-border, rgba(110, 231, 183, 0.84));
  border-radius: 22px;
  padding: 10px 12px 10px 10px;
  background: var(--lime-composer-surface);
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
    border-radius: 34px;
    padding: 20px 24px 18px 22px;
    background: var(--lime-composer-surface-floating);
    border-color: var(--lime-composer-border, rgba(110, 231, 183, 0.84));
    box-shadow:
      0 28px 56px -38px var(--lime-shadow-color),
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

export const InputSuggestionLayer = styled.div`
  position: absolute;
  top: 4px;
  right: 0;
  left: 0;
  z-index: 0;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  color: hsl(var(--muted-foreground) / 0.58);
  font-size: 14px;
  line-height: 1.5;
  pointer-events: none;

  &.floating-composer {
    top: 4px;
    font-size: 17px;
    line-height: 1.78;
  }

  &.floating-composer.floating-collapsed {
    top: 8px;
    line-height: 1.35;
  }
`;

export const InputSuggestionText = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const InputSuggestionKeycap = styled.span`
  display: inline-flex;
  min-height: 25px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.11);
  padding: 0 0.62rem;
  color: hsl(var(--muted-foreground) / 0.82);
  font-size: 0.82em;
  font-weight: 760;
  letter-spacing: 0.01em;
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
    min-height: 126px;
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
  padding-top: 10px;
  margin-top: 10px;
  gap: 12px;
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  border-top: 1px solid rgba(148, 163, 184, 0.22);

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

export const ActionButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
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
          : "rgba(148, 163, 184, 0.28)"};
  background: ${({ $primary, $destructive }) =>
    $primary
      ? "var(--lime-brand, #10b981)"
      : $destructive
        ? "rgba(255, 226, 234, 0.92)"
        : "rgba(255, 255, 255, 0.9)"};
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

  &.is-recording {
    border-color: var(--lime-brand, #10b981);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }

  &.is-processing {
    border-color: var(--lime-surface-border-strong, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }

  &:disabled {
    cursor: default;
    color: hsl(var(--muted-foreground));
    opacity: 0.5;
    transform: none;
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
