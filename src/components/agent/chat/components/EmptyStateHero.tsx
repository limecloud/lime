import type { ReactNode } from "react";

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
  badges: EmptyStateHeroBadge[];
  cards: EmptyStateHeroCard[];
  features?: EmptyStateHeroFeature[];
  prioritySlot?: ReactNode;
  supportingSlot?: ReactNode;
  themeTabs?: ReactNode;
}

const BADGE_TONE_CLASSNAME: Record<
  NonNullable<EmptyStateHeroBadge["tone"]>,
  string
> = {
  slate: "border-slate-200 bg-white/90 text-slate-700",
  sky: "border-sky-200 bg-sky-50/90 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
  amber: "border-amber-200 bg-amber-50/90 text-amber-700",
};

const CARD_TONE_CLASSNAME: Record<
  NonNullable<EmptyStateHeroCard["tone"]>,
  string
> = {
  slate: "border-slate-200 bg-slate-100 text-slate-700",
  sky: "border-sky-200 bg-sky-100 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-100 text-emerald-700",
  amber: "border-amber-200 bg-amber-100 text-amber-700",
};

export function EmptyStateHero({
  eyebrow,
  title,
  description,
  badges,
  cards,
  features = [],
  prioritySlot,
  supportingSlot,
  themeTabs,
}: EmptyStateHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-slate-200/85 bg-[linear-gradient(140deg,rgba(248,250,252,0.97)_0%,rgba(255,255,255,0.985)_42%,rgba(243,248,252,0.95)_74%,rgba(239,250,245,0.88)_100%)] shadow-sm shadow-slate-950/5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/90" />
      <div className="pointer-events-none absolute -left-24 top-[-86px] h-56 w-56 rounded-full bg-emerald-200/18 blur-3xl" />
      <div className="pointer-events-none absolute right-[-64px] top-[-18px] h-48 w-48 rounded-full bg-sky-200/24 blur-3xl" />
      <div className="relative space-y-3 p-4 lg:space-y-3.5 lg:p-[18px]">
        <div className="mx-auto flex max-w-[46rem] flex-col items-center gap-2 text-center">
          <div className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/88 px-3 py-1 text-[10px] font-semibold tracking-[0.12em] text-slate-500 shadow-sm shadow-slate-950/5">
            {eyebrow}
          </div>

          <div className="space-y-1.5">
            <h1 className="max-w-[18ch] text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              {title}
            </h1>
            <p className="max-w-[42rem] text-[13px] leading-[1.7] text-slate-600 md:text-sm">
              {description}
            </p>
          </div>

          {badges.length > 0 ? (
            <div className="flex max-w-[44rem] flex-wrap justify-center gap-1.5">
              {badges.map((badge) => (
                <span
                  key={badge.key}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm shadow-slate-950/5 ${
                    BADGE_TONE_CLASSNAME[badge.tone || "slate"]
                  }`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          {themeTabs ? (
            <div className="flex w-full justify-center">{themeTabs}</div>
          ) : null}
        </div>

        {prioritySlot ? (
          <div className="mx-auto w-full max-w-[980px]">{prioritySlot}</div>
        ) : null}

        {supportingSlot ? (
          <div className="mx-auto w-full max-w-[980px]">{supportingSlot}</div>
        ) : null}

        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <article
              key={card.key}
              className="overflow-hidden rounded-[20px] border border-white/90 bg-white/78 p-3 shadow-sm shadow-slate-950/5 backdrop-blur-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${
                    CARD_TONE_CLASSNAME[card.tone || "slate"]
                  }`}
                >
                  {card.icon}
                </div>
                <span className="rounded-full border border-slate-200/80 bg-white/88 px-2.5 py-1 text-[10px] font-medium text-slate-500">
                  {card.eyebrow}
                </span>
              </div>

              <div className="mt-2.5 space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  {card.title}
                </div>
                <div className="line-clamp-1 text-[11px] font-medium text-slate-500">
                  {card.value}
                </div>
                <p className="line-clamp-3 text-[12px] leading-5 text-slate-500">
                  {card.description}
                </p>
              </div>

              {card.imageSrc ? (
                <div className="mt-2.5 overflow-hidden rounded-[16px] border border-slate-200/70 bg-slate-50">
                  <img
                    src={card.imageSrc}
                    alt={card.imageAlt || card.title}
                    className="h-[78px] w-full object-cover md:h-[88px] xl:h-[78px] 2xl:h-[92px]"
                  />
                </div>
              ) : null}

              {card.action ? <div className="mt-2.5">{card.action}</div> : null}
            </article>
          ))}
        </div>

        {features.length > 0 ? (
          <div className="hidden rounded-[20px] border border-white/85 bg-white/60 px-4 py-3 shadow-sm shadow-slate-950/5 backdrop-blur-sm md:block">
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.key}
                  title={feature.description}
                  className="min-w-0 rounded-2xl border border-white/80 bg-white/54 px-3 py-2.5"
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
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default EmptyStateHero;
