import type { HomeStarterChip } from "./homeSurfaceTypes";
import styled from "styled-components";

const StarterRow = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.2rem 0.25rem 0;
`;

const StarterButton = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid
    ${({ $primary }) =>
      $primary
        ? "var(--lime-brand-strong, rgba(47, 83, 60, 0.96))"
        : "var(--lime-surface-border, rgba(209, 220, 204, 0.92))"};
  background: ${({ $primary }) =>
    $primary
      ? "var(--lime-brand-strong, #2f533c)"
      : "var(--lime-surface-soft, rgba(239, 244, 236, 0.96))"};
  padding: 0.46rem 0.78rem;
  color: ${({ $primary }) =>
    $primary ? "#fff" : "var(--lime-text, rgb(71 85 105))"};
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;

  &:hover {
    transform: translateY(-1px);
    border-color: ${({ $primary }) =>
      $primary
        ? "var(--lime-brand-strong, #2f533c)"
        : "var(--lime-surface-border-strong, rgba(148, 163, 184, 0.72))"};
    background: ${({ $primary }) =>
      $primary ? "var(--lime-brand-strong, #2f533c)" : "#fff"};
    color: ${({ $primary }) =>
      $primary ? "#fff" : "var(--lime-text-strong, rgb(15 23 42))"};
  }
`;

interface HomeStarterChipsProps {
  chips: HomeStarterChip[];
  onSelect: (chip: HomeStarterChip) => void;
}

export function HomeStarterChips({ chips, onSelect }: HomeStarterChipsProps) {
  return (
    <StarterRow data-testid="home-starter-chips" aria-label="首页起手入口">
      {chips.map((chip) => (
        <StarterButton
          key={chip.id}
          type="button"
          $primary={chip.primary}
          data-testid={chip.testId}
          aria-label={chip.label === "⚙" ? "管理做法" : chip.label}
          title={chip.label === "⚙" ? "管理做法" : chip.label}
          onClick={() => onSelect(chip)}
        >
          {chip.label}
        </StarterButton>
      ))}
    </StarterRow>
  );
}
