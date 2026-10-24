import { useEffect, useId, useRef } from "react";
import { ChevronDown, History, ListFilter, Search } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import {
  browserHistoryVisitKey,
  type BrowserHistorySource,
} from "@/lib/api/browserHistoryVisits";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";
import { BrowserManagementHeader } from "./BrowserManagementHeader";
import {
  BrowserHistoryRow,
  HISTORY_MENU_CONTENT,
  HISTORY_MENU_ITEM,
} from "./BrowserHistoryRow";
import {
  groupBrowserHistory,
  selectedBrowserHistory,
} from "./browserHistoryModel";
import { useBrowserHistory } from "./useBrowserHistory";
import { useBrowserClearBrowsingData } from "./useBrowserClearBrowsingData";
import { BrowserClearBrowsingDataDialog } from "./BrowserClearBrowsingDataDialog";

const sourceKeys = {
  all: "browserHistory.source.all",
  agent: "browserHistory.source.agent",
  other: "browserHistory.source.other",
} as const;
const filterKeys = {
  all: "browserHistory.filter.all",
  agent: "browserHistory.filter.agent",
  other: "browserHistory.filter.other",
} as const;

export function BrowserHistoryPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation("settings");
  const history = useBrowserHistory();
  const browsingData = useBrowserClearBrowsingData();
  const searchRef = useRef<HTMLInputElement>(null);
  const groupId = useId();
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  const groups = groupBrowserHistory(history.page?.entries ?? []);
  const selected = selectedBrowserHistory(
    history.page?.entries ?? [],
    history.selected,
  );
  const blocked =
    history.busy ||
    browsingData.opening ||
    browsingData.clearing ||
    Boolean(browsingData.settings);
  const errorKey =
    history.error === "open"
      ? "browserHistory.openError"
      : history.error === "more"
        ? "browserHistory.paginationError"
        : "browserHistory.error";
  return (
    <div
      className="mx-auto w-full max-w-[960px] space-y-5 pb-8"
      data-testid="browser-history-page"
    >
      <BrowserManagementHeader
        title={t("browserHistory.title")}
        onBack={onBack}
      />
      <div className="sticky top-0 z-10 flex min-w-0 items-center gap-2 bg-background py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchRef}
            type="search"
            aria-label={t("browserHistory.search")}
            placeholder={t("browserHistory.search")}
            value={history.query}
            disabled={blocked}
            onChange={(event) => history.changeQuery(event.target.value)}
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              type="button"
              disabled={blocked}
              aria-label={t(filterKeys[history.source])}
              className={`${BROWSER_SETTINGS_BUTTON} shrink-0 gap-2`}
            >
              <ListFilter aria-hidden="true" className="size-4" />
              {history.source === "all" ? null : t(sourceKeys[history.source])}
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={4}
              className={HISTORY_MENU_CONTENT}
            >
              <Menu.RadioGroup
                value={history.source}
                onValueChange={(value) =>
                  history.changeSource(value as BrowserHistorySource)
                }
              >
                {(["all", "agent", "other"] as const).map((source) => (
                  <Menu.RadioItem
                    key={source}
                    value={source}
                    disabled={blocked}
                    className={HISTORY_MENU_ITEM}
                  >
                    <span className="w-3" aria-hidden="true">
                      {history.source === source ? "✓" : ""}
                    </span>
                    {t(sourceKeys[source])}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("browserHistory.allTime")}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selected.length ? (
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={blocked || !history.canRemove}
              onClick={() => void history.remove(selected)}
            >
              {t("browserHistory.removeSelected")}
            </button>
          ) : null}
          <button
            ref={browsingData.triggerRef}
            type="button"
            className={BROWSER_SETTINGS_BUTTON}
            disabled={blocked || !history.page || !history.settingsReady}
            onClick={() => void browsingData.open()}
          >
            {t("browserHistory.clearData")}
          </button>
        </div>
      </div>
      {history.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-xs text-destructive"
        >
          {t(errorKey)}
          {history.error === "load" || history.error === "more" ? (
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={blocked || history.loading}
              onClick={() =>
                history.error === "more"
                  ? void history.loadMore()
                  : history.retry()
              }
            >
              {t("browserHistory.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {browsingData.error?.kind === "open" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("browserData.error.open")}
        </p>
      ) : null}
      {!history.canOpen ? (
        <p className="text-xs text-muted-foreground">
          {t("browserHistory.openUnavailable")}
        </p>
      ) : null}
      <div aria-busy={history.loading || blocked}>
        {groups.map((group, index) => {
          const expanded = history.expanded?.has(group.key) ?? index === 0;
          const id = `${groupId}-${index}`;
          return (
            <section
              key={group.key}
              className="mb-3"
              data-testid="browser-history-date-group"
            >
              <h3>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={id}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-3 text-left text-sm font-medium hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => history.toggleGroup(group.key, groups[0].key)}
                >
                  {new Intl.DateTimeFormat(i18n.language, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }).format(group.visitTime)}
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
              </h3>
              <div id={id} hidden={!expanded}>
                <ul>
                  {expanded
                    ? group.entries.map((entry) => (
                        <BrowserHistoryRow
                          key={browserHistoryVisitKey(entry)}
                          entry={entry}
                          checked={history.selected.has(
                            browserHistoryVisitKey(entry),
                          )}
                          busy={blocked}
                          canOpen={history.canOpen}
                          canRemove={history.canRemove}
                          onSelect={() => history.toggleSelection(entry)}
                          onOpen={() => void history.open(entry)}
                          onRemove={() =>
                            void history.remove([
                              { url: entry.url, visitTime: entry.visitTime },
                            ])
                          }
                        />
                      ))
                    : null}
                </ul>
              </div>
            </section>
          );
        })}
        {!groups.length && (history.loading || history.error !== "load") ? (
          <div
            role="status"
            className="space-y-2 py-12 text-center text-muted-foreground"
          >
            <History aria-hidden="true" className="mx-auto mb-3 size-6" />
            <p className="text-sm font-medium">
              {t(
                history.loading
                  ? "browserHistory.loading"
                  : history.query
                    ? "browserHistory.noResults"
                    : history.source === "agent"
                      ? "browserHistory.emptyAgent"
                      : history.source === "other"
                        ? "browserHistory.emptyOther"
                        : "browserHistory.empty",
              )}
            </p>
            {!history.loading ? (
              <p className="text-xs">
                {t(
                  history.query
                    ? "browserHistory.noResultsDescription"
                    : history.source === "all"
                      ? "browserHistory.emptyDescription"
                      : "browserHistory.emptySourceDescription",
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        {history.page?.nextCursor && history.error !== "more" ? (
          <button
            type="button"
            className={`${BROWSER_SETTINGS_BUTTON} mt-4 w-full`}
            disabled={history.loading || blocked}
            onClick={() => void history.loadMore()}
          >
            {t("browserHistory.loadMore")}
          </button>
        ) : null}
      </div>
      <BrowserClearBrowsingDataDialog controller={browsingData} />
    </div>
  );
}
