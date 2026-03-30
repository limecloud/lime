import { PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function WorkbenchRightRailCollapseBar({
  onCollapse,
}: {
  onCollapse: () => void;
}) {
  return (
    <div className="flex items-center justify-end border-b bg-background/96 px-3 py-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={onCollapse}
              title="折叠能力面板"
            >
              <PanelRightClose size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>折叠能力面板</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function WorkbenchRightRailHeadingCard({
  eyebrow,
  heading,
  subheading,
}: {
  eyebrow?: string;
  heading?: string | null;
  subheading?: string | null;
}) {
  if (!heading) {
    return null;
  }

  return (
    <div className="px-1 py-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
        {eyebrow ?? "独立右栏"}
      </div>
      <div className="mt-1.5 text-[15px] font-semibold text-foreground tracking-tight">{heading}</div>
      {subheading ? (
        <div className="mt-1 text-[13px] text-muted-foreground">{subheading}</div>
      ) : null}
    </div>
  );
}
