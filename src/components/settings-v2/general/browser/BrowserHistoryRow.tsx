import { Globe2, MoreHorizontal, ExternalLink, Trash2 } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import type { BrowserHistoryVisitRow } from "@/lib/api/browserHistoryVisits";

export const HISTORY_MENU_ITEM =
  "flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
export const HISTORY_MENU_CONTENT =
  "z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md";

export function BrowserHistoryRow({
  entry,
  checked,
  busy,
  canOpen,
  canRemove,
  onSelect,
  onOpen,
  onRemove,
}: {
  entry: BrowserHistoryVisitRow;
  checked: boolean;
  busy: boolean;
  canOpen: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation("settings");
  const hostname = new URL(entry.url).hostname;
  const title = entry.title || hostname;
  return (
    <li
      className="flex min-w-0 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/60 focus-within:bg-muted/60"
      data-testid="browser-history-row"
    >
      <Checkbox
        checked={checked}
        disabled={busy || !canRemove}
        aria-label={t("browserHistory.select", { title })}
        onCheckedChange={onSelect}
      />
      <Globe2
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <a
        href={entry.url}
        aria-label={t("browserHistory.open", { title })}
        aria-disabled={busy || !canOpen}
        aria-busy={busy}
        tabIndex={busy || !canOpen ? -1 : undefined}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded text-sm outline-none underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          event.preventDefault();
          if (!busy && canOpen) onOpen();
        }}
      >
        <span className="truncate" title={title}>
          {title}
        </span>
        <span className="truncate text-muted-foreground" title={entry.url}>
          {hostname}
        </span>
      </a>
      <div className="flex shrink-0 items-center gap-2">
        {entry.isActorVisit ? (
          <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {t("browserHistory.agentBadge")}
          </span>
        ) : null}
        <time
          dateTime={new Date(entry.visitTime).toISOString()}
          className="text-xs tabular-nums text-muted-foreground"
        >
          {new Intl.DateTimeFormat(i18n.language, {
            timeStyle: "short",
          }).format(entry.visitTime)}
        </time>
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              type="button"
              disabled={busy}
              aria-label={t("browserHistory.actions", { title })}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={4}
              className={HISTORY_MENU_CONTENT}
            >
              <Menu.Item
                disabled={busy || !canOpen}
                onSelect={onOpen}
                className={HISTORY_MENU_ITEM}
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {t("browserHistory.openPage")}
              </Menu.Item>
              <Menu.Item
                disabled={busy || !canRemove}
                onSelect={onRemove}
                className={HISTORY_MENU_ITEM}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                {t("browserHistory.removePage")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </li>
  );
}
