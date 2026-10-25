import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

const searchLabels = {
  plugins: "settings.plugins.search.plugins",
  mcps: "settings.plugins.search.mcps",
  skills: "settings.plugins.search.skills",
  marketplace: "settings.plugins.search.marketplace",
} as const;

export function PluginsSettingsSearch({
  tab,
  query,
  onQueryChange,
}: {
  tab: keyof typeof searchLabels;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { t } = useTranslation("settings");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "f" ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      )
        return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const label = t(searchLabels[tab]);
  return (
    <div className="flex h-8 w-56 min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-transparent px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-ring">
      <Search
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <label htmlFor="plugins-page-manage-search" className="sr-only">
        {label}
      </label>
      <input
        id="plugins-page-manage-search"
        ref={input}
        type="search"
        autoComplete="off"
        value={query}
        placeholder={label}
        onChange={(event) => onQueryChange(event.target.value)}
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
