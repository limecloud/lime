import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { WorktreePreferences } from "@/lib/api/worktreePreferences";
import {
  SettingsAction,
  SettingsRow,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";

export function WorktreeCleanup({
  preferences,
  saving,
  save,
}: {
  preferences: WorktreePreferences;
  saving: boolean;
  save: <K extends keyof WorktreePreferences>(
    key: K,
    value: WorktreePreferences[K],
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation("settings");
  const enabled = preferences["auto-cleanup-enabled"];
  const saved = String(preferences["keep-count"]);
  const [value, setValue] = useState(saved);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const baseline = useRef(saved);
  const pending = useRef(false);
  useEffect(() => {
    const previous = baseline.current;
    setValue((current) => (current === previous ? saved : current));
    baseline.current = saved;
  }, [saved]);
  useSettingsDraft({ dirty: value !== saved, saving });
  async function setEnabled(next: boolean) {
    if (saving || pending.current) return;
    pending.current = true;
    try {
      if (await save("auto-cleanup-enabled", next)) setConfirming(false);
      else toast.error(t("settings.worktrees.failed"));
    } finally {
      pending.current = false;
    }
  }
  async function flush() {
    if (!enabled || saving || pending.current) return;
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed)) {
      setValue(saved);
      setFailed(false);
      return;
    }
    const next = Math.max(1, Math.min(4294967295, Math.floor(parsed)));
    setValue(String(next));
    if (next === preferences["keep-count"]) return;
    pending.current = true;
    try {
      const success = await save("keep-count", next);
      setFailed(!success);
      if (!success) toast.error(t("settings.worktrees.failed"));
    } finally {
      pending.current = false;
    }
  }
  return (
    <>
      <SettingsRow
        targetId="worktrees-auto-cleanup"
        label={t("settings.worktrees.autoCleanup")}
        description={t("settings.worktrees.autoCleanupDescription")}
      >
        <SettingsSwitch
          aria-labelledby="worktrees-auto-cleanup-label"
          aria-describedby="worktrees-auto-cleanup-description"
          checked={enabled}
          disabled={saving}
          onCheckedChange={(next) =>
            next ? void setEnabled(true) : setConfirming(true)
          }
        />
      </SettingsRow>
      <SettingsRow
        targetId="worktrees-keep-count"
        label={t("settings.worktrees.keepCount")}
        description={t(
          enabled
            ? "settings.worktrees.keepCountDescription"
            : "settings.worktrees.keepCountDisabled",
        )}
      >
        <div className="flex flex-col items-end gap-2">
          <input
            id="worktrees-keep-count-input"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            aria-labelledby="worktrees-keep-count-label"
            aria-describedby="worktrees-keep-count-description"
            aria-invalid={failed}
            disabled={!enabled || saving}
            className="h-8 w-24 rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setFailed(false);
            }}
            onBlur={() => void flush()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void flush();
              }
            }}
          />
          {failed ? (
            <SettingsAction disabled={saving} onClick={() => void flush()}>
              {t("settings.worktrees.retry")}
            </SettingsAction>
          ) : null}
        </div>
      </SettingsRow>
      <Dialog.Root
        open={confirming}
        onOpenChange={(open) => {
          if (!pending.current) setConfirming(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none"
            onEscapeKeyDown={(event) => {
              if (pending.current) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (pending.current) event.preventDefault();
            }}
          >
            <Dialog.Title className="text-base font-medium">
              {t("settings.worktrees.disableCleanupTitle")}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
              {t("settings.worktrees.disableCleanupDescription")}
            </Dialog.Description>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <SettingsAction disabled={saving}>
                  {t("settings.worktrees.keepCleanup")}
                </SettingsAction>
              </Dialog.Close>
              <SettingsAction
                disabled={saving}
                onClick={() => void setEnabled(false)}
              >
                {t("settings.worktrees.disableCleanup")}
              </SettingsAction>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
