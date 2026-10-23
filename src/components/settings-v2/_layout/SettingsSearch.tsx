import { useId, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { SettingsSearchResult } from "../settingsSearch";
import type { SettingsTabs } from "@/types/settings";

const SearchWrap = styled.div`
  position: sticky;
  top: 0;
  z-index: 2;
  padding-bottom: 10px;
  background: var(
    --lime-sidebar-surface,
    var(--lime-surface-subtle, hsl(var(--card)))
  );
`;
const SearchField = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 8px;
  border: 1px solid var(--lime-sidebar-border, hsl(var(--border)));
  border-radius: 18px;
  background: var(--lime-sidebar-search-bg, hsl(var(--muted)));
  color: var(--lime-sidebar-muted, hsl(var(--muted-foreground)));
  &:focus-within {
    border-color: var(--lime-brand, hsl(var(--primary)));
  }
  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  input {
    min-width: 0;
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--lime-sidebar-foreground, hsl(var(--foreground)));
    font-size: 13px;
  }
  input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  button {
    display: inline-flex;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
`;
const ResultList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
  [role="option"] {
    padding: 8px 9px;
    border-radius: 7px;
    color: var(--lime-sidebar-foreground, hsl(var(--foreground)));
    cursor: pointer;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  [aria-selected="true"],
  [role="option"]:hover {
    background: var(--lime-sidebar-active, hsl(var(--accent)));
  }
  small {
    display: block;
    margin-top: 3px;
    color: var(--lime-sidebar-muted, hsl(var(--muted-foreground)));
  }
`;

interface SettingsSearchProps {
  query: string;
  results: SettingsSearchResult[];
  inputRef: RefObject<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onSelect: (result: SettingsSearchResult) => void;
  onPrefetch?: (tab: SettingsTabs) => void;
}

export function SettingsSearch({
  query,
  results,
  inputRef,
  onQueryChange,
  onSelect,
  onPrefetch,
}: SettingsSearchProps) {
  const { t } = useTranslation("settings");
  const id = useId();
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const expanded = Boolean(query.trim()) && !dismissed;
  const index = Math.min(highlight, results.length - 1);
  const changeQuery = (value: string) => {
    setHighlight(0);
    setDismissed(false);
    onQueryChange(value);
  };
  return (
    <SearchWrap>
      <SearchField>
        <Search aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? id : undefined}
          aria-activedescendant={
            expanded && index >= 0 ? `${id}-${index}` : undefined
          }
          aria-label={t("settings.layout.sidebar.search.label")}
          placeholder={t("settings.layout.sidebar.search.placeholder")}
          data-testid="settings-sidebar-search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onFocus={() => setDismissed(false)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            if (
              composing ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              changeQuery("");
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setDismissed(false);
              if (!results.length) return;
              const next =
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  results.length) %
                results.length;
              setHighlight(next);
              onPrefetch?.(results[next].section);
            } else if (event.key === "Enter" && expanded && results[index]) {
              event.preventDefault();
              onSelect(results[index]);
            }
          }}
          onBlur={() => setDismissed(true)}
        />
        {query ? (
          <button
            type="button"
            aria-label={t("settings.layout.sidebar.search.clear")}
            onClick={() => {
              changeQuery("");
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden />
          </button>
        ) : null}
      </SearchField>
      {expanded ? (
        <>
          <ResultList
            id={id}
            role="listbox"
            aria-label={t("settings.layout.sidebar.search.label")}
          >
            {results.map((result, resultIndex) => (
              <div
                key={result.section}
                id={`${id}-${resultIndex}`}
                role="option"
                aria-selected={resultIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  setHighlight(resultIndex);
                  onPrefetch?.(result.section);
                }}
                onClick={() => onSelect(result)}
              >
                {result.label}
                {result.targetId ? <small>{result.panelLabel}</small> : null}
              </div>
            ))}
          </ResultList>
          {!results.length ? (
            <p
              role="status"
              className="px-2 py-3 text-sm text-muted-foreground"
              data-testid="settings-sidebar-no-results"
            >
              {t("settings.layout.sidebar.search.noResults")}
            </p>
          ) : null}
        </>
      ) : null}
    </SearchWrap>
  );
}
