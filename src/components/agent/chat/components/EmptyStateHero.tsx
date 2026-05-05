import type { ReactNode } from "react";
import styled, { keyframes } from "styled-components";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  EMPTY_STATE_CARD_SURFACE_CLASSNAME,
  EMPTY_STATE_ICON_TONE_CLASSNAMES,
  type EmptyStateTone,
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

const sloganShine = keyframes`
  0% {
    background-position: 250% center, 250% center, 0% 50%;
  }
  45% {
    background-position: -50% center, -50% center, 100% 50%;
  }
  50% {
    background-position: -50% center, -50% center, 100% 50%;
  }
  95% {
    background-position: 250% center, 250% center, 0% 50%;
  }
  100% {
    background-position: 250% center, 250% center, 0% 50%;
  }
`;

const dotPulse = keyframes`
  0%, 100% {
    transform: scale(0.95);
    opacity: 0.7;
    filter: brightness(1);
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
    filter: brightness(1.2);
  }
`;



const HeroSection = styled.section`
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 100%;
  overflow: visible;
  animation: ${heroReveal} 620ms cubic-bezier(0.22, 1, 0.36, 1) both;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const HeroContent = styled.div`
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: clamp(620px, calc(100dvh - 168px), 900px);
  flex-direction: column;
  gap: 1.35rem;
  padding: 0.45rem 0.55rem 0.85rem;

  @media (min-width: 1024px) {
    gap: 1.55rem;
    padding: 0.5rem 0.7rem 1rem;
  }

  @media (max-height: 940px) {
    gap: 0.625rem;
  }
`;

const StageGrid = styled.div`
  display: block;
`;

const LeadColumn = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.56rem;
  max-width: min(1100px, 100%);
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

const EyebrowText = styled.div`
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.08em;
  color: rgb(47 111 70 / 0.86);
`;

const LeadBody = styled.div`
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.55rem;
`;

const LeadTextGroup = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0.34rem;
  max-width: 56rem;
`;

const SloganWrap = styled.div`
  position: relative;
  width: fit-content;
  margin-bottom: 0.4rem;
  overflow: visible;
`;

const SloganLine = styled.p`
  position: relative;
  margin: 0;
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.8rem;

  background: 
    /* Layer 1: Prismatic Holographic Sweep */
    linear-gradient(
      110deg,
      transparent 35%,
      rgba(255, 255, 255, 0) 42%,
      rgba(255, 255, 255, 0.4) 47%,
      var(--lime-brand, rgba(134, 239, 172, 0.8)) 49%, 
      rgba(255, 255, 255, 1) 50%, 
      rgba(56, 189, 248, 0.8) 51%, 
      rgba(255, 255, 255, 0.4) 53%,
      rgba(255, 255, 255, 0) 58%,
      transparent 65%
    ),
    /* Layer 2: Crystal Facet Intersection */
    linear-gradient(
      70deg,
      transparent 40%,
      rgba(255, 255, 255, 0) 46%,
      rgba(255, 255, 255, 0.4) 49%,
      rgba(255, 255, 255, 0.9) 50%,
      rgba(255, 255, 255, 0.4) 51%,
      rgba(255, 255, 255, 0) 54%,
      transparent 60%
    ),
    /* Layer 3: Base Text Gradient */
    var(--lime-home-title-gradient);
  background-size: 250% 100%, 250% 100%, 400% auto;
  background-repeat: no-repeat;
  -webkit-background-clip: text, text, text;
  background-clip: text, text, text;
  color: transparent;

  font-size: clamp(36px, 4vw, 52px);
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.01em;

  text-shadow: var(--lime-home-title-shadow);
  animation: ${sloganShine} 10s ease-in-out infinite;

  &::before {
    content: "";
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border-radius: 9999px;
    background: var(--lime-home-dot-gradient);
    box-shadow: var(--lime-home-dot-shadow);
    animation: ${dotPulse} 4s ease-in-out infinite;
  }
`;

const LeadDescriptionText = styled.p`
  margin: 0;
  max-width: 44rem;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.72;
  color: var(--lime-text, #1a3b2b);

  @media (min-width: 768px) {
    font-size: 17px;
  }
`;

const LeadSupportingText = styled.p`
  margin: 0;
  max-width: 48rem;
  font-size: 13px;
  line-height: 1.7;
  color: var(--lime-text-muted, #6b826b);
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
  margin-top: auto;
  gap: 0.7rem;
  padding-top: clamp(1rem, 4vh, 2.6rem);
  grid-template-columns: repeat(1, minmax(0, 1fr));
  align-items: stretch;
  grid-auto-rows: minmax(0, 1fr);

  @media (min-width: 720px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (min-width: 1120px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  @media (max-height: 940px) {
    gap: 0.625rem;
  }
`;

const HeroCard = styled.article.attrs({
  className: EMPTY_STATE_CARD_SURFACE_CLASSNAME,
})<{ $index: number }>`
  position: relative;
  display: flex;
  height: 100%;
  min-height: 210px;
  flex-direction: column;
  transition:
    transform 220ms ease,
    box-shadow 220ms ease,
    border-color 220ms ease;
  animation: ${cardReveal} 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $index }) => `${160 + $index * 70}ms`};

  &:hover {
    transform: translateY(-2px);
    border-color: var(--lime-home-card-hover-border, #93c5fd);
    box-shadow: 0 14px 28px -24px var(--lime-shadow-color);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
  }

  @media (max-width: 1180px), (max-height: 940px) {
    padding: 0.8rem;

    .card-icon {
      height: 1.9rem;
      width: 1.9rem;
      border-radius: 0.95rem;
    }

    .card-content {
      margin-top: 0.5rem;
      min-height: 0;
    }

    .card-title {
      font-size: 0.92rem;
      line-height: 1.3;
    }
  }

  .card-media {
    margin-top: auto;
    padding-top: 0.8rem;
  }
`;

const CardTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const CardValueText = styled.div`
  margin-top: 0.2rem;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--lime-text-muted, #6b826b);
`;

const CardEyebrow = styled.span`
  border-radius: 9999px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.88));
  background: var(--lime-surface, rgba(255, 255, 255, 0.92));
  padding: 0.18rem 0.5rem;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--lime-text-muted, #6b826b);
`;

export interface EmptyStateHeroCard {
  key: string;
  eyebrow: string;
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  imageSrc?: string;
  imageAlt?: string;
  tone?: EmptyStateTone;
  action?: ReactNode;
  onMediaAction?: () => void;
  mediaActionLabel?: string;
  mediaActionDisabled?: boolean;
}

interface EmptyStateHeroProps {
  eyebrow: string;
  title: string;
  slogan?: string;
  description: string;
  supportingDescription?: string;
  cards: EmptyStateHeroCard[];
  prioritySlot?: ReactNode;
  supportingSlot?: ReactNode;
  headerControls?: ReactNode;
}

export function EmptyStateHero({
  eyebrow,
  title,
  slogan,
  description,
  supportingDescription,
  cards,
  prioritySlot,
  supportingSlot,
  headerControls,
}: EmptyStateHeroProps) {
  return (
    <HeroSection>
      <HeroContent>
        <StageGrid>
          <LeadColumn>
            <LeadBlock className="flex w-full min-w-0 flex-col gap-2.5 px-2.5 py-2.5 text-left md:gap-3 md:px-4 md:py-3.5">
              <LeadTopRow>
                <EyebrowText>{eyebrow}</EyebrowText>
                {headerControls}
              </LeadTopRow>

              <LeadBody>
                <LeadTextGroup>
                  {slogan ? (
                    <SloganWrap>
                      <SloganLine>{slogan}</SloganLine>
                    </SloganWrap>
                  ) : null}
                  {title ? (
                    <h1
                      className="max-w-[18ch] text-[28px] font-semibold leading-[1.04] tracking-tight text-[color:var(--lime-text-strong)] md:text-[38px]"
                      style={{ textShadow: "var(--lime-home-title-shadow)" }}
                    >
                      {title}
                    </h1>
                  ) : null}
                  <LeadDescriptionText>{description}</LeadDescriptionText>
                  {supportingDescription ? (
                    <LeadSupportingText>
                      {supportingDescription}
                    </LeadSupportingText>
                  ) : null}
                </LeadTextGroup>
              </LeadBody>
            </LeadBlock>
          </LeadColumn>
        </StageGrid>

        {prioritySlot ? (
          <PriorityShell $delay={120} className="w-full">
            {prioritySlot}
          </PriorityShell>
        ) : null}

        {supportingSlot ? (
          <SupportingShell $delay={180} className="w-full">
            {supportingSlot}
          </SupportingShell>
        ) : null}

        {cards.length > 0 ? (
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
                  <CardEyebrow>{card.eyebrow}</CardEyebrow>
                </div>

                <div className="card-content mt-2.5">
                  <CardTitleRow>
                    <div className="card-title text-sm font-semibold text-[color:var(--lime-text-strong)]">
                      {card.title}
                    </div>
                    <WorkbenchInfoTip
                      ariaLabel={`${card.title}说明`}
                      variant="icon"
                      tone={card.tone === "emerald" ? "mint" : "slate"}
                      side="top"
                      align="end"
                      content={
                        <div style={{ width: "220px" }} className="space-y-1">
                          <p className="m-0">{card.value}</p>
                          <p className="m-0">{card.description}</p>
                        </div>
                      }
                    />
                  </CardTitleRow>
                  <CardValueText>{card.value}</CardValueText>
                </div>

                {card.imageSrc || card.action ? (
                  <div className="card-media mt-3 space-y-2.5">
                    {card.imageSrc ? (
                      card.onMediaAction ? (
                        <button
                          type="button"
                          onClick={card.onMediaAction}
                          disabled={card.mediaActionDisabled}
                          aria-label={card.mediaActionLabel || card.title}
                          className="card-preview block overflow-hidden rounded-[16px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)] text-left transition hover:border-[color:var(--lime-surface-border-strong)] disabled:cursor-default disabled:opacity-70"
                        >
                          <img
                            src={card.imageSrc}
                            alt={card.imageAlt || card.title}
                            className="block h-[82px] w-full object-cover object-center opacity-95 md:h-[90px] xl:h-[86px]"
                          />
                        </button>
                      ) : (
                        <div className="card-preview overflow-hidden rounded-[16px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)]">
                          <img
                            src={card.imageSrc}
                            alt={card.imageAlt || card.title}
                            className="block h-[82px] w-full object-cover object-center opacity-95 md:h-[90px] xl:h-[86px]"
                          />
                        </div>
                      )
                    ) : null}

                    {card.action ? <div>{card.action}</div> : null}
                  </div>
                ) : null}
              </HeroCard>
            ))}
          </CardsShell>
        ) : null}
      </HeroContent>
    </HeroSection>
  );
}

export default EmptyStateHero;
