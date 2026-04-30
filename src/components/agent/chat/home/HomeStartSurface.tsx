import { useEffect, useState } from "react";
import styled from "styled-components";
import { HomeStarterChips } from "./HomeStarterChips";
import { HomeMoreSkillsDrawer } from "./HomeMoreSkillsDrawer";
import { HomeGuideCards } from "./HomeGuideCards";
import { HomeSceneSkillManagerDialog } from "./HomeSceneSkillManagerDialog";
import type {
  HomeGuideCard,
  HomeSkillSection,
  HomeSkillSurfaceItem,
  HomeStarterChip,
} from "./homeSurfaceTypes";

const Surface = styled.div`
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 0.9rem;
`;

const SupplementalRow = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.45rem;
`;

const SupplementalButton = styled.button`
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.9));
  background: var(--lime-surface, #fff);
  padding: 0.42rem 0.72rem;
  color: var(--lime-text, rgb(71 85 105));
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;

  &:hover {
    border-color: var(--lime-surface-border-strong, rgba(203, 213, 225, 0.96));
    background: var(--lime-surface-soft, rgba(248, 250, 252, 0.98));
    color: var(--lime-text-strong, rgb(15 23 42));
  }
`;

export interface HomeSupplementalAction {
  id: string;
  label: string;
  title?: string;
  testId?: string;
  onSelect: () => void;
}

interface HomeStartSurfaceProps {
  starterChips: HomeStarterChip[];
  guideCards?: HomeGuideCard[];
  guideOpen?: boolean;
  sections: HomeSkillSection[];
  supplementalActions?: HomeSupplementalAction[];
  onGuideOpenChange?: (open: boolean) => void;
  onSelectStarterChip: (chip: HomeStarterChip) => void;
  onSelectGuideCard?: (card: HomeGuideCard) => void;
  onSelectSkillItem: (item: HomeSkillSurfaceItem) => void;
}

export function HomeStartSurface({
  starterChips,
  guideCards = [],
  guideOpen,
  sections,
  supplementalActions = [],
  onGuideOpenChange,
  onSelectStarterChip,
  onSelectGuideCard,
  onSelectSkillItem,
}: HomeStartSurfaceProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [internalGuideOpen, setInternalGuideOpen] = useState(false);
  const resolvedGuideOpen = guideOpen ?? internalGuideOpen;
  const updateGuideOpen = (
    nextOpen: boolean | ((current: boolean) => boolean),
  ) => {
    const resolvedNextOpen =
      typeof nextOpen === "function" ? nextOpen(resolvedGuideOpen) : nextOpen;
    if (guideOpen === undefined) {
      setInternalGuideOpen(resolvedNextOpen);
    }
    onGuideOpenChange?.(resolvedNextOpen);
  };

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const handleSelectStarterChip = (chip: HomeStarterChip) => {
    if (chip.launchKind === "open_drawer") {
      setDrawerOpen((current) => !current);
      updateGuideOpen(false);
      return;
    }
    if (chip.launchKind === "open_manager") {
      setManagerOpen(true);
      return;
    }
    if (chip.launchKind === "toggle_guide") {
      updateGuideOpen((current) => !current);
      setDrawerOpen(false);
      return;
    }
    updateGuideOpen(false);
    onSelectStarterChip(chip);
  };

  return (
    <Surface data-testid="home-start-surface">
      {!resolvedGuideOpen ? (
        <HomeStarterChips
          chips={starterChips}
          onSelect={handleSelectStarterChip}
        />
      ) : null}

      {resolvedGuideOpen ? (
        <HomeGuideCards
          cards={guideCards}
          onSelect={(card) => onSelectGuideCard?.(card)}
        />
      ) : null}

      {!resolvedGuideOpen && supplementalActions.length > 0 ? (
        <SupplementalRow data-testid="home-supplemental-actions">
          {supplementalActions.map((action) => (
            <SupplementalButton
              key={action.id}
              type="button"
              data-testid={action.testId}
              title={action.title}
              onClick={action.onSelect}
            >
              {action.label}
            </SupplementalButton>
          ))}
        </SupplementalRow>
      ) : null}

      <HomeMoreSkillsDrawer
        open={drawerOpen}
        sections={sections}
        onSelectItem={onSelectSkillItem}
      />
      <HomeSceneSkillManagerDialog
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
      />
    </Surface>
  );
}
