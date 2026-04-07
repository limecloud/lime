import React from "react";
import { ListChecks, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface AgentPlanBlockProps {
  content: string;
  isComplete?: boolean;
}

export const AgentPlanBlock: React.FC<AgentPlanBlockProps> = ({
  content,
  isComplete = true,
}) => {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/35 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ListChecks className="h-4 w-4" />
        </div>
        <div className="text-sm font-medium text-foreground">执行计划</div>
        <Badge
          variant={isComplete ? "outline" : "secondary"}
          className="ml-auto"
        >
          {isComplete ? (
            "已生成"
          ) : (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              规划中
            </span>
          )}
        </Badge>
      </div>
      <div className="text-sm">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
};
