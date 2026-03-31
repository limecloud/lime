import type { LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import type { IconComponent } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import { A2UI_RENDERER_TOKENS } from "../../../rendererTokens";

interface IconRendererProps {
  component: IconComponent;
  data: Record<string, unknown>;
  scopePath?: string;
}

const ICON_ALIASES: Record<string, string> = {
  accountCircle: "CircleUserRound",
  calendarToday: "CalendarDays",
  locationOn: "MapPin",
  favoriteOff: "HeartOff",
  notificationsOff: "BellOff",
  moreVert: "EllipsisVertical",
  moreHoriz: "Ellipsis",
  visibility: "Eye",
  visibilityOff: "EyeOff",
  volumeDown: "Volume1",
  volumeMute: "VolumeX",
  volumeOff: "VolumeOff",
  volumeUp: "Volume2",
  priority_high: "AlertTriangle",
};

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function resolveLucideIcon(name: string): LucideIcon | null {
  const iconName = ICON_ALIASES[name] || toPascalCase(name);
  return (
    ((LucideIcons as Record<string, unknown>)[iconName] as LucideIcon) || null
  );
}

function isSvgPath(path: string): boolean {
  return /^[MmLlHhVvCcSsQqTtAaZz]/.test(path.trim()) && /\d/.test(path);
}

export function IconRenderer({
  component,
  data,
  scopePath = "/",
}: IconRendererProps) {
  if (
    typeof component.name === "object" &&
    component.name !== null &&
    "path" in component.name &&
    typeof component.name.path === "string"
  ) {
    const maybePath = component.name.path;

    if (isSvgPath(maybePath)) {
      return (
        <span className={A2UI_RENDERER_TOKENS.iconShell}>
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d={maybePath} />
          </svg>
        </span>
      );
    }
  }

  const iconName =
    typeof component.name === "string"
      ? component.name
      : String(
          resolveDynamicValue(
            component.name as { path: string },
            data,
            "",
            scopePath,
          ),
        );
  const IconComponent = resolveLucideIcon(iconName);

  return (
    <span className={A2UI_RENDERER_TOKENS.iconShell}>
      {IconComponent ? (
        <IconComponent className="h-5 w-5" strokeWidth={1.8} />
      ) : (
        <span className={cn(A2UI_RENDERER_TOKENS.iconFallback)}>
          {iconName.slice(0, 2) || "?"}
        </span>
      )}
    </span>
  );
}

export const Icon = IconRenderer;
