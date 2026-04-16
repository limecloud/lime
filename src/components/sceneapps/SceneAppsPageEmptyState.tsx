import { Button } from "@/components/ui/button";

interface SceneAppsPageEmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline";
  testId?: string;
}

interface SceneAppsPageEmptyStateProps {
  eyebrow?: string;
  title: string;
  description: string;
  detail?: string;
  primaryAction?: SceneAppsPageEmptyStateAction;
  secondaryAction?: SceneAppsPageEmptyStateAction;
}

export function SceneAppsPageEmptyState({
  eyebrow,
  title,
  description,
  detail,
  primaryAction,
  secondaryAction,
}: SceneAppsPageEmptyStateProps) {
  return (
    <section
      data-testid="sceneapps-empty-state"
      className="rounded-[28px] border border-dashed border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/5"
    >
      {eyebrow ? (
        <div className="text-[11px] font-semibold tracking-[0.1em] text-lime-700">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="mt-2 text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-3 max-w-[760px] text-sm leading-7 text-slate-600">
        {description}
      </p>
      {detail ? (
        <p className="mt-2 max-w-[760px] text-sm leading-6 text-slate-500">
          {detail}
        </p>
      ) : null}
      {primaryAction || secondaryAction ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {primaryAction ? (
            <Button
              type="button"
              data-testid={primaryAction.testId}
              variant={primaryAction.variant ?? "default"}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              type="button"
              data-testid={secondaryAction.testId}
              variant={secondaryAction.variant ?? "outline"}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
