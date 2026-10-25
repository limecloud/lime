import { useRef, useState } from "react";
import styled from "styled-components";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Webhook,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PRODUCT_LINKS } from "@/lib/productLinks";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import { HookRow } from "./HookRow";
import {
  hookSourceEntries,
  hooksByEvent,
  needsHookReview,
  type HookSourceEntry,
} from "./hooks-settings-model";
import { useHooks } from "./useHooks";

const AttentionText = styled.span`
  @media (max-width: 480px) {
    display: none;
  }
`;

export function HooksSettings() {
  const { t } = useTranslation("settings");
  const state = useHooks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const entries = hookSourceEntries(state.data);
  const selected = entries.find((entry) => entry.id === selectedId);
  const title = (entry: HookSourceEntry) =>
    entry.source === "project"
      ? entry.cwd
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .pop() || entry.cwd
      : entry.source === "plugin"
        ? entry.pluginId?.split("@")[0] || t("settings.hooks.unknownPlugin")
        : t(`settings.hooks.source.${entry.source}`);
  const groups = [
    {
      key: "config",
      entries: entries.filter((entry) =>
        ["user", "admin"].includes(entry.source),
      ),
    },
    {
      key: "plugins",
      entries: entries.filter((entry) => entry.source === "plugin"),
    },
    {
      key: "projects",
      entries: entries.filter((entry) => entry.source === "project"),
    },
    {
      key: "other",
      entries: entries.filter((entry) =>
        ["sessionFlags", "unknown"].includes(entry.source),
      ),
    },
  ];
  const disabled =
    state.loading ||
    state.pending ||
    state.loadError ||
    state.mutationError === "refresh";
  const review =
    selected?.hooks.filter(
      (hook) => needsHookReview(hook) && !hook.isManaged,
    ) ?? [];
  return (
    <SettingsPageBody
      data-testid="hooks-settings"
      aria-busy={state.loading || state.pending}
    >
      <div className="space-y-2">
        <SettingsPageHeader
          title={t("settings.hooks.title")}
          actions={
            <SettingsAction
              type="button"
              disabled={
                state.loading ||
                state.pending ||
                (!state.hasProjects && !state.loadError)
              }
              onClick={() => void state.reload()}
              title={t("settings.hooks.reload")}
              aria-label={t("settings.hooks.reload")}
            >
              <RefreshCw aria-hidden />
            </SettingsAction>
          }
        />
        <p
          data-settings-search-target="hooks-sources"
          tabIndex={-1}
          className="text-muted-foreground"
        >
          {t("settings.hooks.description")}{" "}
          <a
            href={PRODUCT_LINKS.userGuide}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("settings.hooks.learnMore")}
          </a>
        </p>
      </div>
      {state.loading ? (
        <SettingsEmptyState role="status">
          {t("settings.hooks.loading")}
        </SettingsEmptyState>
      ) : state.loadError ? (
        <SettingsEmptyState role="alert">
          {t("settings.hooks.loadFailed")}{" "}
          <SettingsAction type="button" onClick={() => void state.reload()}>
            {t("settings.hooks.retry")}
          </SettingsAction>
        </SettingsEmptyState>
      ) : entries.length === 0 ? (
        <SettingsEmptyState>
          <p className="font-medium text-foreground">
            {t("settings.hooks.empty")}
          </p>
          <p>
            {t(
              state.hasProjects
                ? "settings.hooks.emptyDescription"
                : "settings.hooks.noProjects",
            )}
          </p>
        </SettingsEmptyState>
      ) : (
        groups
          .filter((group) => group.entries.length)
          .map((group) => (
            <SettingsSection
              key={group.key}
              title={t(`settings.hooks.group.${group.key}`)}
            >
              <SettingsGroup>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    data-hook-source={entry.source}
                    ref={(node) => {
                      if (node) triggers.current.set(entry.id, node);
                      else triggers.current.delete(entry.id);
                    }}
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className="flex w-full min-w-0 items-center justify-between gap-3 border-b border-border py-3 text-left last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {title(entry)}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {t("settings.hooks.count", {
                          count: entry.hooks.length,
                        })}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[13px]">
                      {entry.hooks.some(needsHookReview) ||
                      entry.errors.length + entry.warnings.length > 0 ? (
                        <>
                          <AlertTriangle
                            className="size-3.5 text-muted-foreground"
                            aria-label={t("settings.hooks.attention")}
                          />
                          <AttentionText>
                            {[
                              entry.errors.length + entry.warnings.length > 0
                                ? t("settings.hooks.issueCount", {
                                    count:
                                      entry.errors.length +
                                      entry.warnings.length,
                                  })
                                : "",
                              entry.hooks.some(needsHookReview)
                                ? t("settings.hooks.reviewCount", {
                                    count:
                                      entry.hooks.filter(needsHookReview)
                                        .length,
                                  })
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </AttentionText>
                        </>
                      ) : null}
                      <ChevronRight className="size-3.5" aria-hidden />
                    </span>
                  </button>
                ))}
              </SettingsGroup>
            </SettingsSection>
          ))
      )}
      <Dialog.Root
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        {selected ? (
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/40" />
            <Dialog.Content
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                triggers.current.get(selected.id)?.focus();
              }}
              aria-busy={state.pending}
              className="fixed left-1/2 top-1/2 z-[71] flex max-h-[min(680px,calc(100dvh-4rem))] w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-background p-5 text-[13px] text-foreground shadow-xl focus:outline-none"
            >
              <header className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="break-words text-[18px] font-medium leading-6">
                    {title(selected)}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 break-words text-[12px] text-muted-foreground">
                    {selected.cwd || t("settings.hooks.allProjects")}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label={t("settings.hooks.close")}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </Dialog.Close>
              </header>
              {state.loadError ? (
                <p role="alert" className="text-destructive">
                  {t("settings.hooks.loadFailed")}{" "}
                  <SettingsAction
                    type="button"
                    onClick={() => void state.reload()}
                  >
                    {t("settings.hooks.retry")}
                  </SettingsAction>
                </p>
              ) : null}
              {state.mutationError ? (
                <p role="alert" className="text-destructive">
                  {t(`settings.hooks.error.${state.mutationError}`)}
                </p>
              ) : null}
              <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
                {review.length ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
                    <p className="min-w-0 flex-1">
                      {t("settings.hooks.reviewWarning")}
                    </p>
                    <SettingsAction
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        void state.update(
                          review.map((hook) => ({
                            key: hook.key,
                            trustedHash: hook.currentHash,
                          })),
                        )
                      }
                    >
                      {t("settings.hooks.trustAll")}
                    </SettingsAction>
                  </div>
                ) : null}
                {selected.warnings.length + selected.errors.length ? (
                  <details className="rounded-lg border border-border px-3 py-2">
                    <summary className="cursor-pointer">
                      {t("settings.hooks.issues", {
                        count:
                          selected.warnings.length + selected.errors.length,
                      })}
                    </summary>
                    <ul className="mt-2 space-y-2 break-words text-muted-foreground">
                      {selected.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                      {selected.errors.map((error) => (
                        <li key={JSON.stringify([error.path, error.message])}>
                          {error.path}: {error.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {hooksByEvent(selected.hooks).map(({ eventName, hooks }) => (
                  <SettingsGroup key={eventName}>
                    <SettingsRow
                      label={
                        <span className="flex items-center gap-2">
                          <Webhook className="size-4" aria-hidden />
                          {t(`settings.hooks.event.${eventName}`)}
                        </span>
                      }
                      description={t(
                        `settings.hooks.eventDescription.${eventName}`,
                      )}
                    >
                      {hooks.some(needsHookReview) ? (
                        <AlertTriangle
                          aria-label={t("settings.hooks.attention")}
                          className="size-3.5 text-muted-foreground"
                        />
                      ) : null}
                    </SettingsRow>
                    {hooks.map((hook, index) => (
                      <HookRow
                        key={hook.key}
                        hook={hook}
                        index={index}
                        disabled={disabled}
                        update={state.update}
                      />
                    ))}
                  </SettingsGroup>
                ))}
              </div>
              {state.mutationError === "refresh" ? (
                <SettingsAction
                  type="button"
                  disabled={state.pending || state.loading}
                  onClick={() => void state.reload()}
                >
                  {t("settings.hooks.reload")}
                </SettingsAction>
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </Dialog.Root>
    </SettingsPageBody>
  );
}
