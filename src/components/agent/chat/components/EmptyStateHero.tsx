import type { ReactNode } from "react";
import styled, { keyframes } from "styled-components";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  EMPTY_STATE_BADGE_BASE_CLASSNAME,
  EMPTY_STATE_BADGE_TONE_CLASSNAMES,
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
  min-height: clamp(560px, calc(100dvh - 190px), 820px);
  flex-direction: column;
  gap: 0.95rem;
  padding: 0.35rem 0.45rem 0.55rem;

  @media (min-width: 1024px) {
    gap: 1.1rem;
    padding: 0.45rem 0.6rem 0.7rem;
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
  gap: 0.875rem;
  max-width: min(1180px, 100%);
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
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.08em;
  color: rgb(5 150 105 / 0.82);
`;

const LeadBody = styled.div`
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.8rem;
`;

const LeadTextGroup = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0.6rem;
  max-width: 58rem;
`;

const shimmer = keyframes`
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
`;

const SloganLine = styled.p`
  margin: 0;
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 1.3rem;

  /* lime gradient with scan effect */
  background: linear-gradient(
    90deg,
    #10b981 0%,
    #65a30d 25%,
    #bef264 50%,
    #65a30d 75%,
    #10b981 100%
  );
  background-size: 200% auto;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ${shimmer} 3.5s ease-in-out infinite;

  font-size: clamp(44px, 5.3vw, 80px);
  line-height: 0.94;
  font-weight: 800;
  letter-spacing: -0.03em;
  text-shadow: 0 14px 28px rgba(101, 163, 13, 0.12);

  &::before {
    content: "";
    width: 0.92rem;
    height: 0.92rem;
    flex-shrink: 0;
    border-radius: 9999px;
    background: linear-gradient(
      135deg,
      rgba(132, 204, 22, 0.9),
      rgba(16, 185, 129, 0.75)
    );
    box-shadow: 0 0 0 12px rgba(132, 204, 22, 0.12);
  }
`;

const LeadDescriptionText = styled.p`
  margin: 0;
  max-width: 42rem;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.72;
  color: rgb(51 65 85);

  @media (min-width: 768px) {
    font-size: 16px;
  }
`;

const LeadSupportingText = styled.p`
  margin: 0;
  max-width: 50rem;
  font-size: 12.5px;
  line-height: 1.72;
  color: rgb(100 116 139);
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
    border-color: rgba(203, 213, 225, 0.96);
    box-shadow: 0 14px 28px -24px rgba(15, 23, 42, 0.14);
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
  color: rgb(100 116 139);
`;

const CardEyebrow = styled.span`
  border-radius: 9999px;
  border: 1px solid rgba(226, 232, 240, 0.88);
  background: rgba(255, 255, 255, 0.92);
  padding: 0.18rem 0.5rem;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  color: rgb(148 163 184);
`;

export interface EmptyStateHeroBadge {
  key: string;
  label: string;
  tone?: EmptyStateTone;
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
  badges: EmptyStateHeroBadge[];
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
  badges,
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
                  {slogan ? <SloganLine>{slogan}</SloganLine> : null}
                  {title ? (
                    <h1 className="max-w-[18ch] text-[28px] font-semibold leading-[1.04] tracking-tight text-slate-900 md:text-[38px]">
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

                {badges.length > 0 ? (
                  <div className="flex max-w-[44rem] flex-wrap gap-2">
                    {badges.map((badge) => (
                      <span
                        key={badge.key}
                        className={`${EMPTY_STATE_BADGE_BASE_CLASSNAME} ${
                          EMPTY_STATE_BADGE_TONE_CLASSNAMES[
                            badge.tone || "slate"
                          ]
                        }`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                ) : null}
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
                    <div className="card-title text-sm font-semibold text-slate-900">
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
                          className="card-preview block overflow-hidden rounded-[16px] border border-slate-200/70 bg-slate-50/88 text-left transition hover:border-slate-300/90 disabled:cursor-default disabled:opacity-70"
                        >
                          <img
                            src={card.imageSrc}
                            alt={card.imageAlt || card.title}
                            className="block h-[82px] w-full object-cover object-center opacity-95 md:h-[90px] xl:h-[86px]"
                          />
                        </button>
                      ) : (
                        <div className="card-preview overflow-hidden rounded-[16px] border border-slate-200/70 bg-slate-50/88">
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
