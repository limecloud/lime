import type { KnowledgePackStatus } from "@/lib/api/knowledge";
import { cn } from "@/lib/utils";
import {
  resolveStatusClassName,
  resolveStatusLabel,
} from "../domain/knowledgeLabels";

export function StatusPill({ status }: { status: KnowledgePackStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        resolveStatusClassName(status),
      )}
    >
      {resolveStatusLabel(status)}
    </span>
  );
}
