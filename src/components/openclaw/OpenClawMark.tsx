import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpenClawMarkProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "h-12 w-12",
  md: "h-16 w-16",
  lg: "h-20 w-20",
};

const iconSizeMap = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

export function OpenClawMark({ size = "md", className }: OpenClawMarkProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-gradient-to-br from-red-400 via-rose-500 to-red-600 text-white shadow-lg shadow-red-500/20",
        sizeMap[size],
        className,
      )}
    >
      <Bot className={iconSizeMap[size]} />
    </div>
  );
}
