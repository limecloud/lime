import { Bug, FlaskConical, Play, Wrench } from "lucide-react";
import type { EnvironmentActionIcon as ActionIcon } from "@/lib/localEnvironments";

const icons = { tool: Wrench, run: Play, debug: Bug, test: FlaskConical };

export function EnvironmentActionIcon({
  icon,
  className = "h-4 w-4",
}: {
  icon?: ActionIcon | null;
  className?: string;
}) {
  const Icon = icons[icon ?? "tool"];
  return <Icon className={className} aria-hidden="true" />;
}
