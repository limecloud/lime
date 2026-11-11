import type { SkillMarketplaceVisualAsset } from "@/lib/api/officialSkillMarketplace";
import { cn } from "@/lib/utils";
import type { ServiceSkillTone } from "@/components/agent/chat/service-skills/types";

function svgToDataUrl(svg?: string): string | null {
  const normalized = svg?.trim();
  if (!normalized || !normalized.startsWith("<svg")) {
    return null;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
}

function resolveVisualAssetSource(
  asset?: SkillMarketplaceVisualAsset,
): string | null {
  const url = asset?.url?.trim();
  if (url) {
    return url;
  }
  return svgToDataUrl(asset?.svg);
}

export function SkillTileSvg({ tone = "emerald" }: { tone?: ServiceSkillTone }) {
  const fillByTone: Record<ServiceSkillTone, string> = {
    amber: "#f59e0b",
    emerald: "#10b981",
    sky: "#0ea5e9",
    slate: "#475569",
  };
  const fill = fillByTone[tone];

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-10 w-10">
      <rect x="3" y="3" width="42" height="42" rx="13" fill="#fff" />
      <rect
        x="3"
        y="3"
        width="42"
        height="42"
        rx="13"
        fill={fill}
        opacity="0.1"
      />
      <rect
        x="3"
        y="3"
        width="42"
        height="42"
        rx="13"
        stroke={fill}
        strokeOpacity="0.22"
        strokeWidth="2"
      />
      <path
        d="M24 12 34 18v12l-10 6-10-6V18l10-6Z"
        fill={fill}
        opacity="0.9"
      />
      <path
        d="m18 20 6 4 6-4M24 24v8"
        fill="none"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

export function MarketplaceSkillVisual({
  asset,
  title,
  tone = "emerald",
  variant = "icon",
}: {
  asset?: SkillMarketplaceVisualAsset;
  title: string;
  tone?: ServiceSkillTone;
  variant?: "icon" | "cover";
}) {
  const source = resolveVisualAssetSource(asset);
  if (!source) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden bg-white",
          variant === "cover" ? "h-full w-full" : "h-10 w-10 rounded-xl",
        )}
      >
        <SkillTileSvg tone={tone} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={title}
      className={cn(
        "shrink-0 object-cover",
        variant === "cover"
          ? "h-full w-full"
          : "h-10 w-10 rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]",
      )}
    />
  );
}
