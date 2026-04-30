import styled from "styled-components";
import type { HomeGuideCard } from "./homeSurfaceTypes";

const GuideGrid = styled.div`
  display: grid;
  width: min(1520px, 100%);
  min-width: 0;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.68rem;
  margin: 0.35rem auto 0;

  @media (max-width: 1180px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const GuideButton = styled.button`
  position: relative;
  display: flex;
  min-height: 104px;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 0.52rem;
  border-radius: 18px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  background: color-mix(
    in srgb,
    var(--lime-surface, #fff) 90%,
    var(--lime-surface-soft, #f4f8f2) 10%
  );
  padding: 1rem 1.1rem;
  text-align: left;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.035);
  outline: none;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover {
    transform: translateY(-1px);
    border-color: var(--lime-surface-border-strong, rgba(148, 163, 184, 0.72));
    box-shadow: 0 14px 30px rgba(15, 23, 42, 0.07);
  }

  &:focus-visible {
    border-color: var(--lime-composer-border-focus, rgba(74, 222, 128, 0.7));
    box-shadow:
      0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.18)),
      0 14px 30px rgba(15, 23, 42, 0.07);
  }
`;

const GuideCopy = styled.span`
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 0.46rem;
`;

const GuideTitle = styled.span`
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 15px;
  font-weight: 780;
  line-height: 1.28;
`;

const GuideSummary = styled.span`
  display: -webkit-box;
  overflow: hidden;
  color: var(--lime-text-muted, rgb(100 116 139));
  font-size: 12px;
  font-weight: 520;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
`;

interface HomeGuideCardsProps {
  cards: HomeGuideCard[];
  onSelect: (card: HomeGuideCard) => void;
}

export function HomeGuideCards({ cards, onSelect }: HomeGuideCardsProps) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <GuideGrid data-testid="home-guide-cards" aria-label="首页引导帮助">
      {cards.map((card) => (
        <GuideButton
          key={card.id}
          type="button"
          data-testid={card.testId}
          title={`${card.title} · ${card.summary}`}
          onClick={() => onSelect(card)}
        >
          <GuideCopy>
            <GuideTitle>{card.title}</GuideTitle>
            <GuideSummary>{card.summary}</GuideSummary>
          </GuideCopy>
        </GuideButton>
      ))}
    </GuideGrid>
  );
}
