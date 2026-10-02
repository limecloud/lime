import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { AgentThreadItem } from "../types";
import {
  resolveItemStatusLabel,
  resolveStatusBadgeVariant,
} from "./timeline-utils";

export function UnsupportedItemCard({ item }: { item: AgentThreadItem }) {
  const { t } = useTranslation("agent");
  const unsupportedType =
    item.type === "unknown_item" ? item.upstream_type : item.type;
  const unknownFieldNames =
    item.type === "unknown_item" ? item.field_names : [];

  return (
    <div className="py-0.5" data-testid="timeline-unsupported-item">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {t("agentChat.threadTimeline.unsupportedItem.title")}
        </span>
        <Badge
          variant={resolveStatusBadgeVariant(item.status)}
          className="ml-auto"
        >
          {resolveItemStatusLabel(item.status)}
        </Badge>
      </div>
      <div className="text-sm leading-6 text-muted-foreground">
        {t("agentChat.threadTimeline.unsupportedItem.description")}
      </div>
      <details className="mt-1 text-xs leading-5 text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("agentChat.threadTimeline.unsupportedItem.diagnostics")}
        </summary>
        <div
          className="mt-1 break-all"
          data-testid="timeline-unsupported-item-diagnostics"
        >
          <div>
            {t("agentChat.threadTimeline.unsupportedItem.type", {
              type: unsupportedType,
            })}
          </div>
          {unknownFieldNames.length > 0 ? (
            <div>
              {t("agentChat.threadTimeline.unsupportedItem.fields", {
                fields: unknownFieldNames.join(", "),
              })}
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
