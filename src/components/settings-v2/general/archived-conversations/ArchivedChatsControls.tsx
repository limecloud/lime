import { Check, ChevronDown, Search, X } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsAction, SettingsValueMenu } from "../../SettingsPrimitives";
import type { ArchiveProject, ArchivedChatSort } from "./archivedChats";

export function ArchivedChatsControls({
  query,
  projectFilter,
  sort,
  projects,
  disabled,
  onQuery,
  onProject,
  onSort,
}: {
  query: string;
  projectFilter: string;
  sort: ArchivedChatSort;
  projects: ArchiveProject[];
  disabled: boolean;
  onQuery: (value: string) => void;
  onProject: (value: string) => void;
  onSort: (value: ArchivedChatSort) => void;
}) {
  const { t } = useTranslation("settings");
  const search = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={search}
          type="search"
          value={query}
          disabled={disabled}
          aria-label={t("settings.archivedConversations.search")}
          placeholder={t("settings.archivedConversations.search")}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              onQuery("");
            }
          }}
          className="h-9 w-full min-w-0 rounded-xl border border-border bg-transparent pl-9 pr-9 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
          data-testid="settings-archived-search"
        />
        {query ? (
          <button
            type="button"
            disabled={disabled}
            aria-label={t("settings.archivedConversations.clearSearch")}
            onClick={() => {
              onQuery("");
              search.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground focus-visible:outline focus-visible:outline-2"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap gap-2">
        <Menu.Root open={filterOpen} onOpenChange={setFilterOpen}>
          <Menu.Trigger asChild>
            <SettingsAction
              type="button"
              disabled={disabled}
              aria-label={t("settings.archivedConversations.filter.ariaLabel")}
              aria-labelledby="archived-filter-label archived-filter-value"
              data-testid="settings-archived-filter"
            >
              <span id="archived-filter-value" className="min-w-0 truncate">
                {t("settings.archivedConversations.filter.all")}
              </span>
              <ChevronDown aria-hidden="true" className="shrink-0" />
            </SettingsAction>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={4}
              className="z-[70] min-w-52 rounded-xl border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.defaultPrevented) {
                  event.preventDefault();
                  setFilterOpen(false);
                }
              }}
            >
              <Menu.Label className="px-2 py-1 text-[12px] text-muted-foreground">
                {t("settings.archivedConversations.filter.type")}
              </Menu.Label>
              <Menu.RadioGroup value="all" onValueChange={() => undefined}>
                <Menu.RadioItem
                  value="all"
                  className="flex cursor-default items-center justify-between gap-3 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-accent"
                >
                  {t("settings.archivedConversations.filter.all")}
                  <Menu.ItemIndicator>
                    <Check aria-hidden="true" className="size-4" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              </Menu.RadioGroup>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Label className="px-2 py-1 text-[12px] text-muted-foreground">
                {t("settings.archivedConversations.filter.sortBy")}
              </Menu.Label>
              <Menu.RadioGroup
                value={sort}
                onValueChange={(value) => {
                  onSort(value as ArchivedChatSort);
                  setFilterOpen(false);
                }}
              >
                {(
                  [
                    ["updated", "sort.updated"],
                    ["created", "sort.created"],
                    ["alphabetical", "sort.alphabetical"],
                  ] as const
                ).map(([value, key]) => (
                  <Menu.RadioItem
                    key={value}
                    value={value}
                    className="flex cursor-default items-center justify-between gap-3 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-accent"
                  >
                    {t(`settings.archivedConversations.${key}`)}
                    <Menu.ItemIndicator>
                      <Check aria-hidden="true" className="size-4" />
                    </Menu.ItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <span id="archived-project-label" className="sr-only">
          {t("settings.archivedConversations.projectFilter")}
        </span>
        <SettingsValueMenu
          targetId="archived-project"
          value={projectFilter}
          disabled={disabled}
          onChange={onProject}
          options={[
            {
              value: "all",
              label: t("settings.archivedConversations.allProjects"),
            },
            { value: "none", label: t("settings.archivedConversations.chats") },
            ...projects.map((project) => ({
              value: `project:${project.id}`,
              label: project.name.trim() || project.id,
            })),
          ]}
        />
      </div>
    </div>
  );
}
