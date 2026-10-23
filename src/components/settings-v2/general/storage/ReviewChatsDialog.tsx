import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import {
  deleteStorage,
  reviewStorage,
  type StorageReview,
  type StorageDeleteResult,
} from "@/lib/api/storage";
import { SettingsAction, SettingsSelect } from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";
import { formatStorageBytes } from "./formatStorageBytes";

export function ReviewChatsDialog({
  onClose,
  onDeleted,
  onRestoreFocus,
}: {
  onClose: () => void;
  onDeleted: () => void;
  onRestoreFocus: () => void;
}) {
  const { t, i18n } = useTranslation("settings");
  const [days, setDays] = useState(90);
  const [archivedOnly, setArchivedOnly] = useState(true);
  const [review, setReview] = useState<StorageReview | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<StorageDeleteResult | null>(null);
  const saving = useRef(false);
  const continueButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useSettingsDraft({ dirty: false, saving: pending });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setReview(null);
    setSelected(new Set());
    setLimit(50);
    void reviewStorage({ days, archivedOnly })
      .then((next) => {
        if (!active) return;
        setReview(next);
        setSelected(
          new Set(next.candidates.map((entry) => entry.root.threadId)),
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days, archivedOnly, retry]);
  const candidates = review?.candidates ?? [];
  const chosen = candidates.filter((entry) =>
    selected.has(entry.root.threadId),
  );
  const selectedBytes = chosen.reduce((total, entry) => total + entry.bytes, 0);
  async function remove() {
    if (!review || saving.current || chosen.length === 0) return;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      const next = await deleteStorage({
        cutoffMs: review.cutoffMs,
        archivedOnly: review.archivedOnly,
        candidates: chosen,
      });
      setResult(next);
      setConfirm(false);
      onDeleted();
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  const close = (open: boolean) => {
    if (!open && !saving.current) onClose();
  };
  return (
    <Dialog.Root open onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
          className="fixed left-1/2 top-1/2 z-[70] flex max-h-[min(720px,calc(100dvh-48px))] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-popover p-6 text-[13px] text-popover-foreground shadow-lg outline-none"
          onEscapeKeyDown={(event) => {
            if (saving.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (saving.current) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.storage.reviewTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[12px] text-muted-foreground">
            {t("settings.storage.reviewDescription")}
          </Dialog.Description>
          {result ? (
            <div className="mt-5" role="status">
              {t("settings.storage.result", {
                deleted: result.deleted,
                skipped: result.skipped,
                failed: result.failed,
              })}
            </div>
          ) : (
            <>
              <div className="my-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  {t("settings.storage.olderThan")}
                  <SettingsSelect
                    value={days}
                    disabled={pending}
                    onChange={(event) => setDays(Number(event.target.value))}
                  >
                    {[30, 90, 180, 365].map((days) => (
                      <option key={days} value={days}>
                        {t("settings.storage.days", { count: days })}
                      </option>
                    ))}
                  </SettingsSelect>
                </label>
                <SettingsSelect
                  aria-label={t("settings.storage.scope")}
                  value={archivedOnly ? "archived" : "all"}
                  disabled={pending}
                  onChange={(event) =>
                    setArchivedOnly(event.target.value === "archived")
                  }
                >
                  <option value="archived">
                    {t("settings.storage.archivedOnly")}
                  </option>
                  <option value="all">{t("settings.storage.allChats")}</option>
                </SettingsSelect>
              </div>
              {loading ? (
                <p role="status">{t("settings.storage.loadingReview")}</p>
              ) : failed ? (
                <div role="alert">
                  {t("settings.storage.reviewFailed")}{" "}
                  <SettingsAction
                    type="button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    {t("settings.storage.retry")}
                  </SettingsAction>
                </div>
              ) : candidates.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  {t("settings.storage.noCandidates")}
                </p>
              ) : (
                <>
                  <label className="mb-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.size === candidates.length}
                      onChange={(event) =>
                        setSelected(
                          new Set(
                            event.target.checked
                              ? candidates.map((entry) => entry.root.threadId)
                              : [],
                          ),
                        )
                      }
                    />
                    {t("settings.storage.selectAll")}
                  </label>
                  <div className="min-h-0 overflow-y-auto rounded-xl border border-border px-3">
                    {candidates.slice(0, limit).map((entry) => (
                      <label
                        key={entry.root.threadId}
                        className="flex cursor-pointer items-start gap-3 border-b border-border py-3 last:border-0"
                      >
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={selected.has(entry.root.threadId)}
                          onChange={(event) =>
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (event.target.checked)
                                next.add(entry.root.threadId);
                              else next.delete(entry.root.threadId);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium">
                            {entry.name || t("settings.storage.untitled")}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-muted-foreground">
                            {new Intl.DateTimeFormat(i18n.language, {
                              dateStyle: "medium",
                            }).format(entry.root.updatedAtMs)}
                            {entry.descendants.length > 0
                              ? ` · ${t("settings.storage.subagents", { count: entry.descendants.length })}`
                              : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {formatStorageBytes(entry.bytes, i18n.language)}
                        </span>
                      </label>
                    ))}
                    {limit < candidates.length ? (
                      <SettingsAction
                        type="button"
                        className="my-2"
                        onClick={() => setLimit((value) => value + 50)}
                      >
                        {t("settings.storage.showMore")}
                      </SettingsAction>
                    ) : null}
                  </div>
                </>
              )}
            </>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-muted-foreground">
              {!result && !loading && !failed
                ? t("settings.storage.selected", {
                    count: chosen.length,
                    size: formatStorageBytes(selectedBytes, i18n.language),
                  })
                : null}
            </span>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <SettingsAction
                  ref={closeButton}
                  type="button"
                  disabled={pending}
                >
                  {t(
                    result
                      ? "settings.storage.done"
                      : "settings.storage.cancel",
                  )}
                </SettingsAction>
              </Dialog.Close>
              {!result ? (
                <SettingsAction
                  ref={continueButton}
                  type="button"
                  disabled={loading || failed || chosen.length === 0 || pending}
                  onClick={() => setConfirm(true)}
                >
                  {t("settings.storage.continue")}
                </SettingsAction>
              ) : null}
            </div>
          </div>
          <Dialog.Root
            open={confirm}
            onOpenChange={(open) => {
              if (!saving.current) {
                setConfirm(open);
                setFailed(false);
              }
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/30" />
              <Dialog.Content
                role="alertdialog"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  (continueButton.current ?? closeButton.current)?.focus();
                }}
                className="fixed left-1/2 top-1/2 z-[80] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none"
                onEscapeKeyDown={(event) => {
                  if (saving.current) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                  if (saving.current) event.preventDefault();
                }}
              >
                <Dialog.Title className="text-base font-medium">
                  {t("settings.storage.confirmTitle", { count: chosen.length })}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
                  {t("settings.storage.confirmDescription")}
                </Dialog.Description>
                {failed ? (
                  <p
                    role="alert"
                    className="mt-3 text-[13px] text-[color:var(--lime-danger)]"
                  >
                    {t("settings.storage.deleteFailed")}
                  </p>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <SettingsAction type="button" disabled={pending}>
                      {t("settings.storage.cancel")}
                    </SettingsAction>
                  </Dialog.Close>
                  <SettingsAction
                    type="button"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => void remove()}
                  >
                    <span className="text-[color:var(--lime-danger)]">
                      {t(
                        pending
                          ? "settings.storage.deleting"
                          : "settings.storage.delete",
                      )}
                    </span>
                  </SettingsAction>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
