import { MoreHorizontal, Search, Trash2, X } from "lucide-react";
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
        <span id="archived-sort-label" className="sr-only">
          {t("settings.archivedConversations.sortBy")}
        </span>
        <SettingsValueMenu
          targetId="archived-sort"
          value={sort}
          disabled={disabled}
          onChange={onSort}
          options={[
            {
              value: "updated",
              label: t("settings.archivedConversations.sort.updated"),
              groupLabel: t("settings.archivedConversations.sortBy"),
            },
            {
              value: "created",
              label: t("settings.archivedConversations.sort.created"),
            },
            {
              value: "alphabetical",
              label: t("settings.archivedConversations.sort.alphabetical"),
            },
          ]}
        />
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

export function ArchivedProjectActions({
  disabled,
  onDelete,
}: {
  disabled: boolean;
  onDelete: (trigger: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <SettingsAction
          ref={setTrigger}
          type="button"
          disabled={disabled}
          aria-label={t("settings.archivedConversations.projectActions")}
        >
          <MoreHorizontal aria-hidden="true" />
        </SettingsAction>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-[70] rounded-xl border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <Menu.Item
            asChild
            disabled={disabled}
            onSelect={() => trigger && onDelete(trigger)}
          >
            <SettingsAction
              type="button"
              $tone="danger"
              data-testid="settings-archived-delete-project"
            >
              <Trash2 aria-hidden="true" />
              {t("settings.archivedConversations.action.deleteProject")}
            </SettingsAction>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
