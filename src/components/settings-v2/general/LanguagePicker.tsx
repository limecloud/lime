import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UI_LOCALE_OPTIONS, type LocalePreference } from "@/i18n/locales";
import { SettingsAction } from "../SettingsPrimitives";

export function LanguagePicker({
  value,
  disabled,
  onChange,
}: {
  value: LocalePreference;
  disabled: boolean;
  onChange: (locale: LocalePreference) => void;
}) {
  const { t, i18n } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const english = new Intl.DisplayNames(["en"], { type: "language" });
    const localized = new Intl.DisplayNames([i18n.resolvedLanguage ?? "en"], {
      type: "language",
    });
    return UI_LOCALE_OPTIONS.filter((option) => option.id !== "auto")
      .map((option) => ({
        ...option,
        english: english.of(option.id),
        localized: localized.of(option.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [i18n.resolvedLanguage]);
  const search = query.trim().toLocaleLowerCase();
  const visible = options.filter((option) =>
    [option.label, option.english, option.localized].some((label) =>
      label?.toLocaleLowerCase().includes(search),
    ),
  );
  const select = (locale: LocalePreference) => {
    setOpen(false);
    setQuery("");
    if (!disabled && locale !== value) onChange(locale);
  };
  const auto = t("settings.desktop.autoDetectLanguage");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <SettingsAction
          type="button"
          disabled={disabled}
          aria-labelledby="general-language-label general-language-value"
          aria-describedby="general-language-description"
        >
          <span id="general-language-value">
            {value === "auto"
              ? auto
              : options.find((option) => option.id === value)?.label}
          </span>
          <ChevronDown aria-hidden="true" />
        </SettingsAction>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[70] w-72 max-w-[calc(100vw-2rem)] rounded-xl p-1 text-[13px]"
      >
        <Command
          shouldFilter={false}
          label={t("settings.desktop.searchLanguages")}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("settings.desktop.searchLanguages")}
            aria-label={t("settings.desktop.searchLanguages")}
            className="h-9 text-[13px]"
          />
          <CommandList className="max-h-80">
            <CommandItem
              value="auto"
              onSelect={() => select("auto")}
              className="text-[13px]"
            >
              {auto}
              {value === "auto" ? (
                <Check className="ml-auto size-3.5" aria-hidden="true" />
              ) : null}
            </CommandItem>
            {visible.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                onSelect={() => select(option.id)}
                className="text-[13px]"
              >
                <span className="truncate">{option.label}</span>
                {value === option.id ? (
                  <Check className="ml-auto size-3.5" aria-hidden="true" />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
