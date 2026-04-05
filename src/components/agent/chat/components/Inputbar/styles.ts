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
    padding: 0 0 4px;
  }
`;

export const InputBarContainer = styled.div`
  position: relative;
  border: 1px solid #d7e0ea;
  border-radius: 22px;
  padding: 10px 12px 10px 10px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f8fb 100%);
  box-shadow:
    0 10px 28px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;

  &:focus-within {
    border-color: #c5d3e2;
    background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    box-shadow:
      0 0 0 3px rgba(191, 219, 254, 0.32),
      0 14px 32px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  &.file-dragging {
    border: 2px dashed #2ecc71;
    background-color: rgba(46, 204, 113, 0.03);
  }

  &.floating-composer {
    border-radius: 20px;
    padding: 8px 10px;
    background: linear-gradient(180deg, #fcfdff 0%, #f7f9fc 100%);
    border-color: #d7e0ea;
    box-shadow:
      0 10px 26px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.78);
  }

  &.floating-composer.floating-collapsed {
    min-height: 52px;
    cursor: text;
  }

  &.floating-composer:focus-within {
    background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    border-color: #c5d3e2;
    box-shadow:
      0 0 0 3px rgba(191, 219, 254, 0.38),
      0 12px 28px rgba(15, 23, 42, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.86);

  }
`;

export const MainRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
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
`;

export const StyledTextarea = styled.textarea`
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
    font-size: 13px;
    line-height: 1.4;
    min-height: 28px;
  }

  &.floating-composer.floating-collapsed {
    padding: 8px 0 6px;
    min-height: 30px;
    max-height: 30px;
    line-height: 1.35;
    overflow: hidden;
  }

  &.composer-expanded {
    min-height: 168px;
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
    padding-top: 8px;
    margin-top: 8px;
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
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.9);
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
    border-color: rgba(125, 167, 255, 0.42);
    background: rgba(255, 255, 255, 0.98);
    box-shadow:
      0 0 0 3px rgba(191, 219, 254, 0.28),
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
  min-height: 28px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  border: 1px solid
    ${({ $checked }) =>
      $checked
        ? "rgba(125, 167, 255, 0.4)"
        : "rgba(148, 163, 184, 0.24)"};
  background: ${({ $checked }) =>
    $checked ? "rgba(240, 246, 255, 0.98)" : "rgba(255, 255, 255, 0.9)"};
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
        ? "rgba(125, 167, 255, 0.5)"
        : "rgba(148, 163, 184, 0.34)"};
    background: ${({ $checked }) =>
      $checked ? "rgba(244, 248, 255, 1)" : "rgba(255, 255, 255, 0.98)"};
    color: hsl(var(--foreground));
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: none;
    border-color: rgba(125, 167, 255, 0.44);
    box-shadow:
      0 0 0 3px rgba(191, 219, 254, 0.28),
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
        ? "rgba(59, 130, 246, 0.45)"
        : "rgba(148, 163, 184, 0.42)"};
  background: ${({ $checked }) =>
    $checked ? "rgba(219, 234, 254, 0.9)" : "rgba(255, 255, 255, 0.96)"};
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
    color: #0f172a;
    border-color: rgba(125, 167, 255, 0.44);
    background: rgba(224, 236, 255, 0.82);
  }

  span {
    white-space: nowrap;
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

export const Divider = styled.div`
  width: 1px;
  height: 16px;
  background-color: rgba(148, 163, 184, 0.28);
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
      ? "#0f172a"
      : $destructive
        ? "rgba(255, 226, 234, 0.92)"
        : "rgba(255, 255, 255, 0.9)"};
  color: ${({ $primary, $destructive }) =>
    $primary
      ? "#f8fafc"
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
        ? "#111c31"
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
    border-color: rgba(125, 167, 255, 0.44);
    background: rgba(224, 236, 255, 0.82);
    color: #0f172a;
  }

  &.is-recording {
    border-color: rgba(120, 235, 190, 0.6);
    background: rgba(120, 235, 190, 0.12);
    color: #0f172a;
  }

  &.is-processing {
    border-color: rgba(160, 200, 255, 0.6);
    background: rgba(160, 200, 255, 0.12);
    color: #0f172a;
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
