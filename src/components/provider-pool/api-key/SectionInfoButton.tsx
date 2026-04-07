import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SectionInfoButtonProps {
  label: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  contentTestId?: string;
  triggerTestId?: string;
}

export function SectionInfoButton({
  label,
  children,
  className,
  contentClassName,
  contentTestId,
  triggerTestId,
}: SectionInfoButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:border-slate-300 hover:text-slate-700",
            className,
          )}
          data-testid={triggerTestId}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn(
          "w-[280px] rounded-[18px] border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600 shadow-lg shadow-slate-950/8",
          contentClassName,
        )}
        data-testid={contentTestId}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default SectionInfoButton;
