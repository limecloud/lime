import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import type { StorageState } from "@/lib/api/storage";
import { SettingsAction } from "../../SettingsPrimitives";
import { formatStorageBytes } from "./formatStorageBytes";

const categoryNames = [
  "threads",
  "subagents",
  "archived",
  "worktrees",
  "other",
] as const;
const colors = [
  "var(--lime-info, hsl(var(--primary)))",
  "var(--lime-success, #16a34a)",
  "var(--lime-warning, #d97706)",
  "var(--lime-text-muted, hsl(var(--muted-foreground)))",
  "var(--lime-surface-border, hsl(var(--border)))",
];

export function StorageUsage({
  state,
  failed,
  pending,
  onRefresh,
}: {
  state: StorageState | null;
  failed: boolean;
  pending: boolean;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation("settings");
  const usage = state?.usage;
  const scanning = !state || state.status === "scanning";
  const error = failed || state?.status === "error";
  const categories = categoryNames.map((name) => ({
    name,
    bytes:
      usage?.categories
        .filter(
          (entry) =>
            entry.category === name ||
            (name === "other" && entry.category === "unclassified"),
        )
        .reduce((total, entry) => total + entry.bytes, 0) ?? 0,
  }));
  return (
    <div
      id="storage-usage"
      data-settings-search-target="storage-usage"
      tabIndex={-1}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="min-w-0 text-[13px] font-medium">
          {usage
            ? t(
                state?.measuredAt == null && state?.status !== "ready"
                  ? "settings.storage.measuredTotal"
                  : "settings.storage.total",
                { size: formatStorageBytes(usage.totalBytes, i18n.language) },
              )
            : t("settings.storage.dataDirectory")}
        </div>
        <SettingsAction
          type="button"
          disabled={pending || (scanning && !error)}
          onClick={onRefresh}
        >
          {scanning && !error ? (
            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          ) : null}
          {t(
            scanning && !error
              ? "settings.storage.updating"
              : "settings.storage.refresh",
          )}
        </SettingsAction>
      </div>
      {usage || (scanning && !error) ? (
        <div
          role={usage ? "img" : "progressbar"}
          aria-label={
            usage
              ? t("settings.storage.capacity", {
                  size: formatStorageBytes(usage.totalBytes, i18n.language),
                })
              : t("settings.storage.scanning")
          }
          className="flex h-6 overflow-hidden rounded-lg bg-muted"
        >
          {categories.map((category, index) =>
            category.bytes > 0 && usage && usage.totalBytes > 0 ? (
              <div
                key={category.name}
                title={`${t(`settings.storage.category.${category.name}`)}: ${formatStorageBytes(category.bytes, i18n.language)}`}
                style={{
                  width: `${(category.bytes / usage.totalBytes) * 100}%`,
                  background: colors[index],
                }}
              />
            ) : null,
          )}
        </div>
      ) : null}
      {usage ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-muted-foreground">
            {categories.map((category, index) => (
              <li key={category.name} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[13px]">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: colors[index] }}
                  />
                  {t(`settings.storage.category.${category.name}`)}{" "}
                </span>
                <span className="text-[12px] tabular-nums">
                  {state?.completedCategories.includes(category.name) &&
                  (category.name !== "other" ||
                    state.completedCategories.includes("unclassified"))
                    ? formatStorageBytes(category.bytes, i18n.language)
                    : t(
                        error
                          ? "settings.storage.categoryIncomplete"
                          : "settings.storage.categoryUpdating",
                        {
                          size: formatStorageBytes(
                            category.bytes,
                            i18n.language,
                          ),
                        },
                      )}
                </span>
              </li>
            ))}
          </ul>
          <p
            className="mt-3 select-text break-all text-[12px] text-muted-foreground"
            title={usage.scannedRoots.join("\n")}
          >
            {usage.dataRoot}
          </p>
        </>
      ) : null}
      <div
        aria-live="polite"
        className="mt-2 text-[12px] text-muted-foreground"
      >
        {error ? (
          <p role="alert">{t("settings.storage.measureFailed")}</p>
        ) : scanning ? (
          <p className="sr-only">
            {t(usage ? "settings.storage.cached" : "settings.storage.scanning")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
