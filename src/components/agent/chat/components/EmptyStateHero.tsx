import type { ReactNode } from "react";
import styled, { keyframes } from "styled-components";
import {
  EMPTY_STATE_BADGE_BASE_CLASSNAME,
  EMPTY_STATE_BADGE_TONE_CLASSNAMES,
  EMPTY_STATE_CARD_SURFACE_CLASSNAME,
  EMPTY_STATE_ICON_TONE_CLASSNAMES,
  EMPTY_STATE_META_PILL_CLASSNAME,
} from "./emptyStateSurfaceTokens";

const heroReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.994);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const cardReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const HeroSection = styled.section`
  position: relative;
  overflow: visible;
  animation: ${heroReveal} 620ms cubic-bezier(0.22, 1, 0.36, 1) both;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const HeroContent = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem;

  @media (min-width: 1024px) {
    gap: 0.875rem;
    padding: 1rem;
  }

  @media (max-height: 940px) {
    gap: 0.625rem;
  }
`;

const LeadBlock = styled.div`
  min-width: 0;
  animation: ${cardReveal} 520ms cubic-bezier(0.22, 1, 0.36, 1) both;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const LeadTopRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
`;

const IntroGrid = styled.div`
  display: grid;
  gap: 0.75rem;
  align-items: start;

  @media (min-width: 1240px) {
    grid-template-columns: minmax(0, 1.08fr) minmax(380px, 0.92fr);
    gap: 0.875rem;
  }
`;

const LeadTextGroup = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0.625rem;
`;

const LeadSupportingText = styled.p`
  margin: 0;
  max-width: 48rem;
  font-size: 12px;
  line-height: 1.65;
  color: rgb(100 116 139);

  @media (min-width: 768px) {
    font-size: 13px;
  }
`;

const PriorityShell = styled.div<{ $delay: number }>`
  animation: ${cardReveal} 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $delay }) => `${$delay}ms`};

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const SupportingShell = styled.div<{ $delay: number }>`
  animation: ${cardReveal} 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $delay }) => `${$delay}ms`};

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const CardsShell = styled.div`
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(1, minmax(0, 1fr));

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-height: 940px) {
    gap: 0.625rem;
  }
`;

const HeroCard = styled.article.attrs({
  className: EMPTY_STATE_CARD_SURFACE_CLASSNAME,
})<{ $index: number }>`
  position: relative;
  transition:
    transform 220ms ease,
    box-shadow 220ms ease,
    border-color 220ms ease;
  animation: ${cardReveal} 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $index }) => `${160 + $index * 70}ms`};

  &::after {
    content: "";
    position: absolute;
    left: 1rem;
    right: 1rem;
    bottom: 0.9rem;
    height: 1px;
    background: linear-gradient(
      90deg,
      rgba(16, 185, 129, 0) 0%,
      rgba(16, 185, 129, 0.28) 32%,
      rgba(56, 189, 248, 0.22) 70%,
      rgba(56, 189, 248, 0) 100%
    );
    opacity: 0.7;
  }

  &:hover {
    transform: translateY(-4px);
    border-color: rgba(203, 213, 225, 0.96);
    box-shadow: 0 18px 34px -28px rgba(15, 23, 42, 0.18);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
  }

  @media (max-width: 1180px), (max-height: 940px) {
    padding: 0.875rem;

    .card-icon {
      height: 2rem;
      width: 2rem;
      border-radius: 1rem;
    }

    .card-content {
      margin-top: 0.625rem;
    }

    .card-title {
      font-size: 0.95rem;
      line-height: 1.3;
    }

    .card-value {
      margin-top: 0.125rem;
    }

    .card-description {
      -webkit-line-clamp: 2;
      font-size: 11px;
      line-height: 1.45;
    }

    .card-preview {
      margin-top: 0.75rem;
    }

    .card-preview img {
      height: 68px;
    }
  }
`;

const FeaturePanel = styled.div`
  order: 5;
  animation: ${cardReveal} 620ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: 260ms;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export interface EmptyStateHeroBadge {
  key: string;
  label: string;
  tone?: "slate" | "sky" | "emerald" | "amber";
}

export interface EmptyStateHeroCard {
  key: string;
  eyebrow: string;
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  imageSrc?: string;
  imageAlt?: string;
  tone?: "slate" | "sky" | "emerald" | "amber";
  action?: ReactNode;
}

export interface EmptyStateHeroFeature {
  key: string;
  title: string;
  description: string;
}

interface EmptyStateHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  supportingDescription?: string;
  badges: EmptyStateHeroBadge[];
  cards: EmptyStateHeroCard[];
  features?: EmptyStateHeroFeature[];
  prioritySlot?: ReactNode;
  supportingSlot?: ReactNode;
  headerControls?: ReactNode;
}

export function EmptyStateHero({
  eyebrow,
  title,
  description,
  supportingDescription,
  badges,
  cards,
  features = [],
  prioritySlot,
  supportingSlot,
  headerControls,
}: EmptyStateHeroProps) {
  return (
    <HeroSection>
      <HeroContent>
        <IntroGrid>
          <LeadBlock className="flex w-full min-w-0 flex-col gap-3 rounded-[28px] border border-slate-200/80 bg-white px-4 py-4 text-left shadow-sm shadow-slate-950/5 md:px-5 md:py-[18px]">
            <LeadTopRow>
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-200/80 bg-white/92 px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-emerald-700 shadow-sm shadow-slate-950/5">
                {eyebrow}
              </div>
              {headerControls}
            </LeadTopRow>

            <LeadTextGroup>
              <h1 className="max-w-[14ch] text-[28px] font-semibold leading-[1.05] tracking-tight text-slate-900 md:text-[38px]">
                {title}
              </h1>
              <p className="max-w-[40rem] text-[14px] font-medium leading-7 text-slate-700 md:text-[15px]">
                {description}
              </p>
              {supportingDescription ? (
                <LeadSupportingText>{supportingDescription}</LeadSupportingText>
              ) : null}
            </LeadTextGroup>

            {badges.length > 0 ? (
              <div className="flex max-w-[44rem] flex-wrap gap-2">
                {badges.map((badge) => (
                  <span
                    key={badge.key}
                    className={`${EMPTY_STATE_BADGE_BASE_CLASSNAME} ${
                      EMPTY_STATE_BADGE_TONE_CLASSNAMES[badge.tone || "slate"]
                    }`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
          </LeadBlock>

          <CardsShell>
            {cards.map((card, index) => (
              <HeroCard key={card.key} $index={index}>
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`card-icon flex h-9 w-9 items-center justify-center rounded-2xl border ${
                      EMPTY_STATE_ICON_TONE_CLASSNAMES[card.tone || "slate"]
                    }`}
                  >
                    {card.icon}
                  </div>
                  <span className={EMPTY_STATE_META_PILL_CLASSNAME}>
                    {card.eyebrow}
                  </span>
                </div>

                <div className="card-content mt-2.5 space-y-1">
                  <div className="card-title text-sm font-semibold text-slate-900">
                    {card.title}
                  </div>
                  <div className="card-value line-clamp-1 text-[11px] font-medium text-slate-500">
                    {card.value}
                  </div>
                  <p className="card-description line-clamp-3 text-[12px] leading-5 text-slate-500">
                    {card.description}
                  </p>
                </div>

                {card.imageSrc ? (
                  <div className="card-preview mt-3 overflow-hidden rounded-[18px] border border-slate-200/70 bg-slate-50">
                    <img
                      src={card.imageSrc}
                      alt={card.imageAlt || card.title}
                      className="h-[74px] w-full object-cover md:h-[82px] xl:h-[74px] 2xl:h-[86px]"
                    />
                  </div>
                ) : null}

                {card.action ? (
                  <div className="mt-2.5">{card.action}</div>
                ) : null}
              </HeroCard>
            ))}
          </CardsShell>
        </IntroGrid>

        {prioritySlot ? (
          <PriorityShell $delay={120} className="mx-auto w-full max-w-[1120px]">
            {prioritySlot}
          </PriorityShell>
        ) : null}

        {supportingSlot ? (
          <SupportingShell
            $delay={180}
            className="mx-auto w-full max-w-[1120px]"
          >
            {supportingSlot}
          </SupportingShell>
        ) : null}

        {features.length > 0 ? (
          <FeaturePanel className="hidden rounded-[22px] border border-slate-200/80 bg-white px-4 py-3.5 shadow-sm shadow-slate-950/5 md:block">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.key}
                  title={feature.description}
                  className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50 px-3 py-2.5"
                >
                  <div className="text-[11px] font-semibold text-slate-700">
                    {feature.title}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </FeaturePanel>
        ) : null}
      </HeroContent>
    </HeroSection>
  );
}

export default EmptyStateHero;
